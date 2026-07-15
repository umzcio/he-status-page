import { Router, Response } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import pool from '../db/connection';
import { authMiddleware, requireRole, AuthRequest } from './middleware/auth';
import { requireCsrf } from './middleware/csrf';
import { logAdminAction } from '../lib/adminLog';

const router = Router();

// GET / - List all API keys (all users)
router.get('/', authMiddleware, requireCsrf, requireRole('super_admin'), async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT ak.id, ak.user_id, u.email AS user_email, ak.name, ak.key_prefix,
             ak.created_at, ak.last_used_at, ak.revoked_at, ak.expires_at
      FROM api_keys ak
      JOIN users u ON u.id = ak.user_id
      ORDER BY ak.created_at DESC
    `);
    res.json({ keys: result.rows });
  } catch (error) {
    console.error('Error fetching API keys:', error);
    res.status(500).json({ error: 'Failed to fetch API keys' });
  }
});

// GET /user/:userId - List keys for a specific user
router.get('/user/:userId', authMiddleware, requireCsrf, requireRole('super_admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { userId } = req.params;
    const result = await pool.query(`
      SELECT ak.id, ak.user_id, u.email AS user_email, ak.name, ak.key_prefix,
             ak.created_at, ak.last_used_at, ak.revoked_at, ak.expires_at
      FROM api_keys ak
      JOIN users u ON u.id = ak.user_id
      WHERE ak.user_id = $1
      ORDER BY ak.created_at DESC
    `, [userId]);
    res.json({ keys: result.rows });
  } catch (error) {
    console.error('Error fetching user API keys:', error);
    res.status(500).json({ error: 'Failed to fetch API keys' });
  }
});

// POST / - Create a new API key
router.post('/', authMiddleware, requireCsrf, requireRole('super_admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { user_id, name, expires_in_days } = req.body;

    if (!user_id) {
      return res.status(400).json({ error: 'user_id is required' });
    }

    // Verify user exists
    const userResult = await pool.query('SELECT id FROM users WHERE id = $1', [user_id]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Generate key: hsp_ + 32 hex chars
    const randomHex = crypto.randomBytes(16).toString('hex');
    const plaintextKey = `hsp_${randomHex}`;
    const keyPrefix = randomHex.slice(0, 8);
    const keyHash = await bcrypt.hash(plaintextKey, 10);

    // Default expiration: 365 days, configurable via expires_in_days
    const days = typeof expires_in_days === 'number' && expires_in_days > 0 ? expires_in_days : 365;
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

    const result = await pool.query(`
      INSERT INTO api_keys (user_id, key_prefix, key_hash, name, expires_at)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, user_id, name, key_prefix, created_at, last_used_at, revoked_at, expires_at
    `, [user_id, keyPrefix, keyHash, name || 'Default', expiresAt]);

    // Get user email for response
    const userRow = await pool.query('SELECT email FROM users WHERE id = $1', [user_id]);

    await logAdminAction(req.user!.id, 'api_key_created', { target_user_id: user_id, key_prefix: keyPrefix, name: name || 'Default' });

    res.status(201).json({
      key: { ...result.rows[0], user_email: userRow.rows[0].email },
      plaintext_key: plaintextKey,
    });
  } catch (error: any) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Key prefix collision, please try again' });
    }
    console.error('Error creating API key:', error);
    res.status(500).json({ error: 'Failed to create API key' });
  }
});

// DELETE /:id - Revoke an API key
router.delete('/:id', authMiddleware, requireCsrf, requireRole('super_admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const result = await pool.query(`
      UPDATE api_keys SET revoked_at = NOW()
      WHERE id = $1 AND revoked_at IS NULL
      RETURNING id, key_prefix
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'API key not found or already revoked' });
    }

    await logAdminAction(req.user!.id, 'api_key_revoked', { key_id: id, key_prefix: result.rows[0].key_prefix });

    res.json({ success: true });
  } catch (error) {
    console.error('Error revoking API key:', error);
    res.status(500).json({ error: 'Failed to revoke API key' });
  }
});

export default router;
