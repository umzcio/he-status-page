import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import pool from '../db/connection';
import crypto from 'crypto';
import { sendEmail, isEmailConfigured } from '../lib/email';
import { verificationEmail } from '../lib/emailTemplates';
import { escapeHtml } from '@he-status/shared';
import { verifyTurnstile } from '../lib/turnstile';

const router = Router();

// Every accepted subscribe request gets this same response, whatever state the
// address was already in, so the endpoint can't be used to learn who is
// subscribed. What actually happened is only visible in the mailbox.
const SUBSCRIBE_RESPONSE = {
  success: true,
  message: 'Thanks! If this address can receive notifications, a confirmation email is on its way.',
};

// Send the verification mail without waiting for SMTP.
function sendVerification(email: string, token: string): void {
  if (!isEmailConfigured()) return;
  const template = verificationEmail(token);
  sendEmail({ to: email, subject: template.subject, html: template.html }).catch((err) =>
    console.error('Failed to send verification email:', err)
  );
}

// The publicly visible services among `requested` (all of them if empty).
// Hidden services can never be subscribed to from the public form.
async function visibleServiceIds(requested: string[]): Promise<string[]> {
  const result = requested.length > 0
    ? await pool.query('SELECT id FROM services WHERE visible IS NOT false AND id = ANY($1::uuid[])', [requested])
    : await pool.query('SELECT id FROM services WHERE visible IS NOT false');
  return result.rows.map((r: any) => r.id);
}

async function setSubscriptionServices(subscriptionId: string, serviceIds: string[]): Promise<void> {
  await pool.query('DELETE FROM subscription_services WHERE subscription_id = $1', [subscriptionId]);
  for (const serviceId of serviceIds) {
    await pool.query(
      'INSERT INTO subscription_services (subscription_id, service_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [subscriptionId, serviceId]
    );
  }
}

// POST /api/subscriptions - Create new subscription
router.post('/', [
  body('email').isEmail().withMessage('Valid email required').normalizeEmail(),
  body('service_ids').optional().isArray({ max: 500 }),
  body('service_ids.*').isUUID().withMessage('Invalid service id'),
  body('turnstileToken').optional().isString(),
], async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: errors.array()[0].msg });
    }

    const { email, service_ids = [], turnstileToken } = req.body;

    // Only allow .edu email addresses
    if (!email.trim().toLowerCase().endsWith('.edu')) {
      return res.status(400).json({ error: 'Only .edu email addresses are allowed' });
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

// Create, reactivate, or re-send verification for a subscription. Runs after
// the response has been sent (see POST /).
async function processSubscription(email: string, requestedServiceIds: string[]): Promise<void> {
  const serviceIds = await visibleServiceIds(requestedServiceIds);

  // Check for existing subscription with same email
  const existing = await pool.query(
    'SELECT id, verified, unsubscribed_at, verification_token FROM subscriptions WHERE email = $1',
    [email]
  );

  if (existing.rows.length > 0) {
    const sub = existing.rows[0];

    if (sub.unsubscribed_at) {
      // Previously unsubscribed — reactivate pending re-verification.
      const newToken = crypto.randomBytes(32).toString('hex');
      await pool.query(
        `UPDATE subscriptions SET unsubscribed_at = NULL, verified = false, verification_token = $1 WHERE id = $2`,
        [newToken, sub.id]
      );
      await setSubscriptionServices(sub.id, serviceIds);
      sendVerification(email, newToken);
    } else if (!sub.verified) {
      // Active but unverified — resend verification.
      sendVerification(email, sub.verification_token);
    }
    // Already active and verified: nothing to do.
    return;
  }

  // New subscription
  const token = crypto.randomBytes(32).toString('hex');

  const result = await pool.query(`
    INSERT INTO subscriptions (email, verification_token, verified)
    VALUES ($1, $2, false)
    RETURNING id
  `, [email, token]);

  await setSubscriptionServices(result.rows[0].id, serviceIds);
  sendVerification(email, token);
}

// GET /api/subscriptions/verify/:token - Verify subscription
router.get('/verify/:token', async (req, res) => {
  try {
    const { token } = req.params;

    const result = await pool.query(`
      UPDATE subscriptions
      SET verified = true, verified_at = NOW()
      WHERE verification_token = $1 AND verified = false
      RETURNING email
    `, [token]);

    if (result.rows.length === 0) {
      return res.status(400).send(`
        <html><body style="font-family:Arial;text-align:center;padding:60px;">
          <h2>Invalid or already verified link</h2>
          <p>This verification link may have already been used or is invalid.</p>
        </body></html>
      `);
    }

    const publicUrl = process.env.PUBLIC_URL || 'http://localhost:3001';
    res.send(`
      <html><body style="font-family:Arial;text-align:center;padding:60px;">
        <h2 style="color:#22c55e;">Subscription Verified!</h2>
        <p>You'll now receive status change notifications at <strong>${escapeHtml(result.rows[0].email)}</strong>.</p>
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
