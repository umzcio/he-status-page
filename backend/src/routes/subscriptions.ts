import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import pool from '../db/connection';
import type { PoolClient } from 'pg';
import crypto from 'crypto';
import { sendEmail, isEmailConfigured } from '../lib/email';
import { verificationEmail } from '../lib/emailTemplates';
import { escapeHtml } from '@he-status/shared';
import { verifyTurnstile } from '../lib/turnstile';
import { canonicalEduAddress } from '../lib/emailAddress';
import { PgRateLimitStore } from '../lib/pgRateLimitStore';
import type { Options } from 'express-rate-limit';

const router = Router();

// Every accepted subscribe request gets this same response, whatever state the
// address was already in, so the endpoint can't be used to learn who is
// subscribed. What actually happened is only visible in the mailbox.
const SUBSCRIBE_RESPONSE = {
  success: true,
  message: 'Thanks! If this address can receive notifications, a confirmation email is on its way.',
};

// Verification mail limits. Each address gets at most one verification mail
// per RECIPIENT_INTERVAL, and the whole site at most GLOBAL_PER_HOUR per hour,
// however many clients ask. (Per-client limits alone can't stop one address
// from being mailed repeatedly from many addresses.)
const RECIPIENT_INTERVAL = '1 hour';
const GLOBAL_PER_HOUR = parseInt(process.env.VERIFICATION_MAIL_PER_HOUR || '200', 10);
const globalMailStore = new PgRateLimitStore('verify_mail');
globalMailStore.init({ windowMs: 60 * 60 * 1000 } as Options);

async function claimGlobalMailSlot(): Promise<boolean> {
  const { totalHits } = await globalMailStore.increment('all');
  return totalHits <= GLOBAL_PER_HOUR;
}

interface VisibleService {
  id: string;
  name: string;
}

// The publicly visible services among `requested` (all of them if empty).
// Hidden services can never be subscribed to from the public form.
async function visibleServices(requested: string[]): Promise<VisibleService[]> {
  const result = requested.length > 0
    ? await pool.query(
        'SELECT id, name FROM services WHERE visible IS NOT false AND id = ANY($1::uuid[]) ORDER BY name',
        [requested]
      )
    : await pool.query('SELECT id, name FROM services WHERE visible IS NOT false ORDER BY name');
  return result.rows;
}

async function setSubscriptionServices(client: PoolClient, subscriptionId: string, serviceIds: string[]): Promise<void> {
  await client.query('DELETE FROM subscription_services WHERE subscription_id = $1', [subscriptionId]);
  for (const serviceId of serviceIds) {
    await client.query(
      'INSERT INTO subscription_services (subscription_id, service_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [subscriptionId, serviceId]
    );
  }
}

// POST /api/subscriptions - Create new subscription
router.post('/', [
  body('email').isString().withMessage('Valid email required'),
  body('service_ids').optional().isArray({ max: 500 }),
  body('service_ids.*').isUUID().withMessage('Invalid service id'),
  body('turnstileToken').optional().isString(),
], async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: errors.array()[0].msg });
    }

    const { service_ids = [], turnstileToken } = req.body;

    // A plain .edu address only: no whitespace, control characters or quoted
    // local parts, and ".edu" checked on the real domain.
    const email = canonicalEduAddress(req.body.email);
    if (!email) {
      return res.status(400).json({ error: 'Enter a plain .edu email address' });
    }

    // Verify Turnstile if configured
    if (process.env.TURNSTILE_SECRET_KEY) {
      if (!turnstileToken) {
        return res.status(400).json({ error: 'Please complete the CAPTCHA' });
      }
      let valid: boolean;
      try {
        valid = await verifyTurnstile(turnstileToken, req.ip);
      } catch {
        // siteverify unreachable — fail closed rather than accept unverified.
        return res.status(503).json({ error: 'CAPTCHA verification is temporarily unavailable. Please try again.' });
      }
      if (!valid) {
        return res.status(400).json({ error: 'CAPTCHA verification failed. Please try again.' });
      }
    }

    // Answer before touching any subscription state: how much work follows
    // depends on whether the address is already subscribed, so doing it first
    // would let response timing reveal that.
    res.json(SUBSCRIBE_RESPONSE);
    processSubscription(email, service_ids as string[]).catch((err) =>
      console.error('Subscription processing error:', err)
    );
  } catch (error) {
    console.error('Subscription error:', error);
    res.status(500).json({ error: 'Failed to create subscription' });
  }
});

// Create, reactivate, or re-confirm a subscription. Runs after the response
// has been sent (see POST /).
//
// A verification link always activates exactly the services listed in the
// email that carried it: every (re)send issues a new token and stores this
// request's selection with it, replacing any earlier unconfirmed selection.
// When no mail can be sent (throttled or capped), nothing is changed.
async function processSubscription(email: string, requestedServiceIds: string[]): Promise<void> {
  if (!isEmailConfigured()) return;

  const services = await visibleServices(requestedServiceIds);
  if (services.length === 0) return; // never create a subscription that covers nothing

  const existing = await pool.query(
    'SELECT id, verified, unsubscribed_at, verification_sent_at FROM subscriptions WHERE lower(email) = $1',
    [email]
  );
  const sub = existing.rows[0];
  if (sub && sub.verified && !sub.unsubscribed_at) return; // already active: nothing to do

  if (!(await claimGlobalMailSlot())) {
    console.warn('Verification mail cap reached; skipping a subscription request');
    return;
  }

  const token = crypto.randomBytes(32).toString('hex');
  const client = await pool.connect();
  let claimed = false;
  try {
    await client.query('BEGIN');
    let subscriptionId: string | undefined;
    if (sub) {
      // Claim this address's mail slot; another request inside the interval wins nothing.
      const updated = await client.query(
        `UPDATE subscriptions
            SET verification_token = $2, verification_sent_at = NOW(),
                verified = false, unsubscribed_at = NULL
          WHERE id = $1
            AND (verification_sent_at IS NULL OR verification_sent_at < NOW() - INTERVAL '${RECIPIENT_INTERVAL}')
            AND NOT (verified AND unsubscribed_at IS NULL)
          RETURNING id`,
        [sub.id, token]
      );
      subscriptionId = updated.rows[0]?.id;
    } else {
      const inserted = await client.query(
        `INSERT INTO subscriptions (email, verification_token, verified, verification_sent_at)
         VALUES ($1, $2, false, NOW())
         ON CONFLICT ((lower(email))) DO NOTHING
         RETURNING id`,
        [email, token]
      );
      subscriptionId = inserted.rows[0]?.id;
    }

    if (subscriptionId) {
      await setSubscriptionServices(client, subscriptionId, services.map((s) => s.id));
      claimed = true;
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  if (claimed) {
    const template = verificationEmail(token, services.map((s) => s.name));
    await sendEmail({ to: email, subject: template.subject, html: template.html });
  }
}

// GET /api/subscriptions/verify/:token - Verify subscription
router.get('/verify/:token', async (req, res) => {
  try {
    const { token } = req.params;

    const result = await pool.query(`
      UPDATE subscriptions
      SET verified = true, verified_at = NOW()
      WHERE verification_token = $1 AND verified = false
      RETURNING id, email, verification_token
    `, [token]);

    if (result.rows.length === 0) {
      return res.status(400).send(`
        <html><body style="font-family:Arial;text-align:center;padding:60px;">
          <h2>Invalid or already verified link</h2>
          <p>This verification link may have already been used or is invalid.</p>
        </body></html>
      `);
    }

    const sub = result.rows[0];
    const covered = await pool.query(
      `SELECT s.name FROM subscription_services ss JOIN services s ON s.id = ss.service_id
        WHERE ss.subscription_id = $1 AND s.visible IS NOT false ORDER BY s.name`,
      [sub.id]
    );
    const coverage = covered.rows.map((r: any) => `<li>${escapeHtml(r.name)}</li>`).join('');
    const publicUrl = process.env.PUBLIC_URL || 'http://localhost:3001';
    res.send(`
      <html><body style="font-family:Arial;text-align:center;padding:60px;">
        <h2 style="color:#22c55e;">Subscription Verified!</h2>
        <p>You'll now receive status change notifications at <strong>${escapeHtml(sub.email)}</strong> for:</p>
        <ul style="display:inline-block;text-align:left;">${coverage}</ul>
        <p>Not what you wanted? <a href="${escapeHtml(publicUrl)}/api/subscriptions/unsubscribe/${escapeHtml(sub.verification_token)}">Unsubscribe</a> and sign up again.</p>
        <p><a href="${escapeHtml(publicUrl)}">Return to Status Page</a></p>
      </body></html>
    `);
  } catch (error) {
    console.error('Verification error:', error);
    res.status(500).send('Verification failed. Please try again.');
  }
});

// GET /api/subscriptions/unsubscribe/:token - One-click unsubscribe
router.get('/unsubscribe/:token', async (req, res) => {
  try {
    const { token } = req.params;

    const result = await pool.query(`
      UPDATE subscriptions
      SET unsubscribed_at = NOW()
      WHERE verification_token = $1 AND unsubscribed_at IS NULL
      RETURNING email
    `, [token]);

    if (result.rows.length === 0) {
      return res.status(400).send(`
        <html><body style="font-family:Arial;text-align:center;padding:60px;">
          <h2>Already unsubscribed</h2>
          <p>This email has already been unsubscribed or the link is invalid.</p>
        </body></html>
      `);
    }

    const publicUrl = process.env.PUBLIC_URL || 'http://localhost:3001';
    res.send(`
      <html><body style="font-family:Arial;text-align:center;padding:60px;">
        <h2>Unsubscribed</h2>
        <p>You've been unsubscribed from status notifications.</p>
        <p><a href="${escapeHtml(publicUrl)}">Return to Status Page</a></p>
      </body></html>
    `);
  } catch (error) {
    console.error('Unsubscribe error:', error);
    res.status(500).send('Unsubscribe failed. Please try again.');
  }
});

export default router;
