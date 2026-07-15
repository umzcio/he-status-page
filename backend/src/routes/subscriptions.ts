import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import pool from '../db/connection';
import crypto from 'crypto';
import axios from 'axios';
import { sendEmail, isEmailConfigured } from '../lib/email';
import { verificationEmail } from '../lib/emailTemplates';

const router = Router();

// Verify a Cloudflare Turnstile token server-side against siteverify.
// Returns true/false for a definitive verdict; throws on network/siteverify
// failure so the caller can fail closed with a distinct error.
async function verifyTurnstile(token: string, remoteip?: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true; // Skip if not configured

  const params = new URLSearchParams();
  params.append('secret', secret);
  params.append('response', token);
  if (remoteip) params.append('remoteip', remoteip);

  const response = await axios.post(
    'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    params,
    {
      timeout: 5000,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }
  );
  return response.data.success === true;
}

// POST /api/subscriptions - Create new subscription
router.post('/', [
  body('email').isEmail().withMessage('Valid email required').normalizeEmail(),
  body('service_ids').optional().isArray(),
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

    // Check for existing subscription with same email
    const existing = await pool.query(
      'SELECT id, verified, unsubscribed_at, verification_token FROM subscriptions WHERE email = $1',
      [email]
    );

    if (existing.rows.length > 0) {
      const sub = existing.rows[0];

      if (sub.unsubscribed_at) {
        // Previously unsubscribed — reactivate
        const newToken = crypto.randomBytes(32).toString('hex');
        await pool.query(
          `UPDATE subscriptions SET unsubscribed_at = NULL, verified = false, verification_token = $1 WHERE id = $2`,
          [newToken, sub.id]
        );

        // Re-add service subscriptions
        await pool.query('DELETE FROM subscription_services WHERE subscription_id = $1', [sub.id]);
        let serviceIds = service_ids as string[];
        if (serviceIds.length === 0) {
          const allServices = await pool.query('SELECT id FROM services');
          serviceIds = allServices.rows.map((r: any) => r.id);
        }
        for (const serviceId of serviceIds) {
          await pool.query(
            'INSERT INTO subscription_services (subscription_id, service_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [sub.id, serviceId]
          );
        }

        if (isEmailConfigured()) {
          try {
            const template = verificationEmail(newToken);
            await sendEmail({ to: email, subject: template.subject, html: template.html });
          } catch (err) {
            console.error('Failed to send verification email:', err);
          }
        }

        return res.json({
          success: true,
          message: 'Subscription reactivated. Please check your email to verify.',
        });
      }

      if (sub.verified) {
        // Already active and verified
        return res.json({
          success: true,
          message: "You're already subscribed to status notifications.",
        });
      }

      // Active but unverified — resend verification
      if (isEmailConfigured()) {
        try {
          const template = verificationEmail(sub.verification_token);
          await sendEmail({ to: email, subject: template.subject, html: template.html });
        } catch (err) {
          console.error('Failed to resend verification email:', err);
        }
      }

      return res.json({
        success: true,
        message: 'Verification email resent. Please check your email.',
      });
    }

    // New subscription
    // Resolve service IDs — subscribe to all if none specified
    let serviceIds = service_ids as string[];
    if (serviceIds.length === 0) {
      const allServices = await pool.query('SELECT id FROM services');
      serviceIds = allServices.rows.map((r: any) => r.id);
    }

    const token = crypto.randomBytes(32).toString('hex');

    const result = await pool.query(`
      INSERT INTO subscriptions (email, verification_token, verified)
      VALUES ($1, $2, false)
      RETURNING id
    `, [email, token]);

    const subscriptionId = result.rows[0].id;

    // Add service subscriptions
    for (const serviceId of serviceIds) {
      await pool.query(`
        INSERT INTO subscription_services (subscription_id, service_id)
        VALUES ($1, $2)
        ON CONFLICT DO NOTHING
      `, [subscriptionId, serviceId]);
    }

    // Send verification email if configured
    if (isEmailConfigured()) {
      try {
        const template = verificationEmail(token);
        await sendEmail({ to: email, subject: template.subject, html: template.html });
      } catch (err) {
        console.error('Failed to send verification email:', err);
      }
    }

    res.json({
      success: true,
      message: 'Subscription created. Please check your email to verify.',
    });

  } catch (error) {
    console.error('Subscription error:', error);
    res.status(500).json({ error: 'Failed to create subscription' });
  }
});

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
        <p>You'll now receive status change notifications at <strong>${result.rows[0].email}</strong>.</p>
        <p><a href="${publicUrl}">Return to Status Page</a></p>
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
        <p><a href="${publicUrl}">Return to Status Page</a></p>
      </body></html>
    `);
  } catch (error) {
    console.error('Unsubscribe error:', error);
    res.status(500).send('Unsubscribe failed. Please try again.');
  }
});

export default router;
