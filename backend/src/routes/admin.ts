import { Router, Request, Response } from 'express';
import { body, param, validationResult } from 'express-validator';
import pool from '../db/connection';
import bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';
import { authMiddleware, requireRole, AuthRequest } from './middleware/auth';
import { requireCsrf } from './middleware/csrf';
import * as cas from '../lib/cas';
import { isOidcConfigured } from '../lib/oidc';
import { isSamlConfigured } from '../lib/saml';
import { issueAuthCode, consumeAuthCode } from '../lib/authCode';
import { notifyTeams } from '../lib/teams';
import { logAdminAction } from '../lib/adminLog';
import { autoCreateIncident, autoResolveIncident } from '../lib/incidents';
import { issueSession, clearSession, SESSION_COOKIE } from '../lib/authCookies';
import { signSession, revokeSessionToken } from '../lib/session';
import { setDeviceCookie } from '../lib/loginThrottle';

const router = Router();

// Only these roles may perform mutating admin actions; viewer stays read-only.
const MUTATE_ROLES = ['admin', 'super_admin'];

// Compared against when the email is unknown or the account has no password,
// so every failed login costs one bcrypt comparison and response timing does
// not reveal which emails have accounts. Same cost factor as users.ts.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(randomBytes(16).toString('hex'), 10);

// GET /api/admin/cas/login - Redirect to CAS login
router.get('/cas/login', (req, res) => {
  if (!cas.isCasConfigured()) {
    return res.status(503).json({ error: 'CAS SSO is not configured' });
  }
  res.redirect(cas.getLoginUrl());
});

// GET /api/admin/cas/callback - CAS ticket validation callback
router.get('/cas/callback', async (req, res) => {
  const frontendUrl = process.env.PUBLIC_URL || 'http://localhost:3001';
  const adminPath = `${frontendUrl}/admin/`;

  try {
    const ticket = req.query.ticket as string;
    if (!ticket) {
      return res.redirect(`${adminPath}?error=${encodeURIComponent('No CAS ticket provided')}`);
    }

    const result = await cas.validateTicket(ticket);
    if (!result.success || !result.user) {
      return res.redirect(`${adminPath}?error=${encodeURIComponent(result.error || 'Authentication failed')}`);
    }

    console.log(`CAS auth: ${result.user.email} authenticated`);

    // Issue a one-time code and redirect with ONLY the code. The JWT is never
    // placed in the URL — the frontend exchanges the code at /auth/exchange.
    const code = await issueAuthCode(result.user.id);
    res.redirect(`${adminPath}?code=${encodeURIComponent(code)}`);
  } catch (err) {
    console.error('CAS callback error:', err);
    res.redirect(`${adminPath}?error=${encodeURIComponent('Authentication service error')}`);
  }
});

// POST /api/admin/cas/logout - CAS logout
router.post('/cas/logout', (req, res) => {
  res.json({ success: true, redirectUrl: cas.getLogoutUrl() });
});

// GET /api/admin/auth/providers - Public: which login providers are available.
// password is always available; cas/oidc reflect their config state.
router.get('/auth/providers', (req, res) => {
  res.json({
    password: true,
    cas: cas.isCasConfigured(),
    oidc: isOidcConfigured(),
    saml: isSamlConfigured(),
  });
});

// POST /api/admin/auth/exchange - Trade a one-time SSO code for a session JWT.
// This is the ONLY place a JWT is minted for the SSO paths (CAS + OIDC); the
// code — never the JWT — is what travels in the post-auth redirect URL.
router.post('/auth/exchange', [
  body('code').isString().notEmpty().withMessage('code required'),
], async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Invalid or expired code' });
    }

    const { code } = req.body;

    // Atomic single-use consume; null => invalid/expired/replayed.
    const user = await consumeAuthCode(code);
    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired code' });
    }

    // Sign the SAME JWT the password-login path signs.
    const token = signSession(user);

    await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

    // Set the JWT as an HttpOnly cookie (+ CSRF cookie). The token is NEVER
    // returned in the body, so it can never reach JS.
    issueSession(res, token);

    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    });
  } catch (error) {
    console.error('Auth exchange error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

// POST /api/admin/auth/logout - Revoke the presented session token server-side
// and clear the session cookies. Not behind authMiddleware and NOT CSRF-guarded:
// ending a session is not harmful and we must never lock a user out of logging
// out. Returns the CAS logout URL when CAS is configured so the UI can
// optionally redirect for single-logout.
router.post('/auth/logout', async (req, res) => {
  const authHeader = req.headers.authorization;
  const token =
    (req.cookies?.[SESSION_COOKIE] as string | undefined) ||
    (authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined);
  try {
    await revokeSessionToken(token);
  } catch (err) {
    console.error('Session revocation error on logout:', err);
  }
  clearSession(res);
  res.json({
    ok: true,
    casLogoutUrl: cas.isCasConfigured() ? cas.getLogoutUrl() : null,
  });
});

// GET /api/admin/auth/status - Verify token and return user
router.get('/auth/status', authMiddleware, requireCsrf, (req: AuthRequest, res) => {
  res.json({
    authenticated: true,
    user: {
      id: req.user!.id,
      email: req.user!.email,
      role: req.user!.role,
    },
  });
});

// POST /api/admin/login - Admin login (legacy email/password)
router.post('/login', [
  body('email').isEmail().withMessage('Valid email required'),
  body('password').isString().notEmpty().withMessage('Password required'),
], async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: errors.array()[0].msg });
    }

    const { email, password } = req.body;

    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );

    // Always run exactly one bcrypt comparison (see DUMMY_PASSWORD_HASH).
    const user = result.rows[0];
    const storedHash: string | null = user?.hashed_password || null;
    const validPassword = await bcrypt.compare(password, storedHash || DUMMY_PASSWORD_HASH);
    if (!user || !storedHash || !validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = signSession(user);

    // Update last login
    await pool.query(
      'UPDATE users SET last_login_at = NOW() WHERE id = $1',
      [user.id]
    );

    // Set the JWT as an HttpOnly cookie (+ CSRF cookie). The token is NEVER
    // returned in the body. The device cookie exempts this browser from the
    // per-account lockout (lib/loginThrottle.ts).
    issueSession(res, token);
    setDeviceCookie(res, user.email);

    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// POST /api/admin/services/:id/override - Activate manual override
router.post('/services/:id/override', authMiddleware, requireCsrf, requireRole(...MUTATE_ROLES), [
  body('status').isIn(['operational', 'degraded', 'outage', 'maintenance']).withMessage('Invalid status'),
  body('message').optional().isString().isLength({ max: 500 }),
  body('reason').optional().isString().isLength({ max: 500 }),
  body('expires_at').optional().isISO8601(),
], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: errors.array()[0].msg });
    }

    const { id } = req.params;
    const { status, message, reason, expires_at } = req.body;

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Get current status
      const currentStatus = await client.query(
        'SELECT status FROM service_status WHERE service_id = $1',
        [id]
      );

      // End current history record
      await client.query(`
        UPDATE status_history
        SET ended_at = NOW(),
            duration_minutes = EXTRACT(EPOCH FROM (NOW() - started_at))/60
        WHERE service_id = $1 AND ended_at IS NULL
      `, [id]);

      // Update service_status with override
      await client.query(`
        INSERT INTO service_status (
          service_id, status, status_source, status_message,
          override_active, override_by_user_id, override_at,
          override_reason, override_expires_at, detected_at
        )
        VALUES ($1, $2, 'manual_override', $3, true, $4, NOW(), $5, $6, NOW())
        ON CONFLICT (service_id) DO UPDATE SET
          status = $2,
          status_source = 'manual_override',
          status_message = $3,
          override_active = true,
          override_by_user_id = $4,
          override_at = NOW(),
          override_reason = $5,
          override_expires_at = $6,
          detected_at = NOW()
      `, [id, status, message, req.user!.id, reason, expires_at]);

      // Create new history record
      await client.query(`
        INSERT INTO status_history (
          service_id, status, status_source, status_message,
          triggered_by_user_id, started_at
        )
        VALUES ($1, $2, 'manual_override', $3, $4, NOW())
      `, [id, status, message, req.user!.id]);

      // Log admin action
      await logAdminAction(req.user!.id, 'override_activated', { serviceId: id, status, reason }, client);

      // Auto-incident: open one if status is non-operational, resolve if returning to operational
      const oldStatus = currentStatus.rows.length > 0 ? currentStatus.rows[0].status : 'unknown';
      try {
        const svcRow = await client.query('SELECT name FROM services WHERE id = $1', [id]);
        const svcName = svcRow.rows[0]?.name || 'Service';
        if (status === 'operational') {
          await autoResolveIncident(id, client);
        } else if (status !== oldStatus) {
          await autoCreateIncident(id, svcName, status, message || null, client);
        }
      } catch (incErr) {
        console.error('Incident auto-management failed (swallowed):', incErr);
      }

      await client.query('COMMIT');

      // Fire-and-forget Teams notification
      try {
        const svcInfo = await pool.query(
          `SELECT s.name, COALESCE(c.slug, s.category) AS category_slug
           FROM services s LEFT JOIN categories c ON s.category_id = c.id
           WHERE s.id = $1`, [id]
        );
        if (svcInfo.rows.length > 0) {
          notifyTeams({
            serviceId: id,
            serviceName: svcInfo.rows[0].name,
            categorySlug: svcInfo.rows[0].category_slug,
            oldStatus,
            newStatus: status,
            statusMessage: message || '',
            overrideInfo: { userName: req.user!.email, reason },
          });
        }
      } catch (teamsErr) {
        console.error('Teams notification error (swallowed):', teamsErr);
      }

      res.json({ success: true, message: 'Manual override activated' });

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

  } catch (error) {
    console.error('Override error:', error);
    res.status(500).json({ error: 'Failed to activate override' });
  }
});

// DELETE /api/admin/services/:id/override - Deactivate manual override
router.delete('/services/:id/override', authMiddleware, requireCsrf, requireRole(...MUTATE_ROLES), async (req: AuthRequest, res) => {
  const client = await pool.connect();

  try {
    const { id } = req.params;

    // Capture current override status before clearing
    const prevStatus = await client.query(
      'SELECT status FROM service_status WHERE service_id = $1',
      [id]
    );
    const oldStatus = prevStatus.rows.length > 0 ? prevStatus.rows[0].status : 'unknown';

    await client.query('BEGIN');

    // End current override history record
    await client.query(`
      UPDATE status_history
      SET ended_at = NOW(),
          duration_minutes = EXTRACT(EPOCH FROM (NOW() - started_at))/60
      WHERE service_id = $1 AND ended_at IS NULL
    `, [id]);

    // Reset status back to operational and clear all override fields
    await client.query(`
      UPDATE service_status
      SET status = 'operational',
          status_source = 'automated',
          status_message = 'All systems operational.',
          override_active = false,
          override_by_user_id = NULL,
          override_at = NULL,
          override_reason = NULL,
          override_expires_at = NULL,
          detected_at = NOW()
      WHERE service_id = $1
    `, [id]);

    // Create new history record for the restored status
    await client.query(`
      INSERT INTO status_history (
        service_id, status, status_source, status_message,
        triggered_by_user_id, started_at
      )
      VALUES ($1, 'operational', 'automated', 'All systems operational.', $2, NOW())
    `, [id, req.user!.id]);

    // Log admin action
    await logAdminAction(req.user!.id, 'override_deactivated', { serviceId: id }, client);

    // Auto-resolve any open auto-created incident since we're returning to operational
    try {
      await autoResolveIncident(id, client);
    } catch (incErr) {
      console.error('Incident auto-resolve failed (swallowed):', incErr);
    }

    await client.query('COMMIT');

    // Fire-and-forget Teams notification
    try {
      const svcInfo = await pool.query(
        `SELECT s.name, COALESCE(c.slug, s.category) AS category_slug
         FROM services s LEFT JOIN categories c ON s.category_id = c.id
         WHERE s.id = $1`, [id]
      );
      if (svcInfo.rows.length > 0) {
        notifyTeams({
          serviceId: id,
          serviceName: svcInfo.rows[0].name,
          categorySlug: svcInfo.rows[0].category_slug,
          oldStatus,
          newStatus: 'operational',
          statusMessage: 'All systems operational.',
          overrideInfo: { userName: req.user!.email, isRemoval: true },
        });
      }
    } catch (teamsErr) {
      console.error('Teams notification error (swallowed):', teamsErr);
    }

    res.json({ success: true, message: 'Manual override deactivated' });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Deactivate override error:', error);
    res.status(500).json({ error: 'Failed to deactivate override' });
  } finally {
    client.release();
  }
});

export default router;
