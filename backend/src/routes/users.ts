import { Router, Response } from 'express';
import pool from '../db/connection';
import bcrypt from 'bcrypt';
import { authMiddleware, requireRole, AuthRequest } from './middleware/auth';
import { requireCsrf } from './middleware/csrf';
import { logAdminAction, inTransaction } from '../lib/adminLog';
import { issueSession } from '../lib/authCookies';
import { signSession } from '../lib/session';
import { passwordProblem } from '../lib/passwordPolicy';

const router = Router();

// GET /api/admin/users - List all users
router.get('/', authMiddleware, requireCsrf, requireRole('super_admin'), async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT id, email, name, role, created_at, last_login_at
      FROM users
      ORDER BY created_at ASC
    `);
    res.json({ users: result.rows });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// POST /api/admin/users - Create user
router.post('/', authMiddleware, requireCsrf, requireRole('super_admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { email, name, role, password } = req.body;

    if (!email || !password || !role) {
      return res.status(400).json({ error: 'email, password, and role are required' });
    }

    const problem = passwordProblem(password);
    if (problem) {
      return res.status(400).json({ error: problem });
    }

    const validRoles = ['super_admin', 'admin', 'viewer'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // The change and its audit row commit together.
    const created = await inTransaction(async (client) => {
      const result = await client.query(`
        INSERT INTO users (email, name, role, hashed_password)
        VALUES ($1, $2, $3, $4)
        RETURNING id, email, name, role, created_at, last_login_at
      `, [email, name || null, role, hashedPassword]);
      await logAdminAction(req.user!.id, 'user_created', { email, role }, client);
      return result.rows[0];
    });

    res.status(201).json(created);
  } catch (error: any) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Email already exists' });
    }
    console.error('Error creating user:', error);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// PUT /api/admin/users/:id - Update user (name, role)
router.put('/:id', authMiddleware, requireCsrf, requireRole('super_admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { name, role } = req.body;

    // Prevent changing own role
    if (id === req.user!.id && role && role !== req.user!.role) {
      return res.status(400).json({ error: 'Cannot change your own role' });
    }

    if (role) {
      const validRoles = ['super_admin', 'admin', 'viewer'];
      if (!validRoles.includes(role)) {
        return res.status(400).json({ error: 'Invalid role' });
      }
    }

    const updated = await inTransaction(async (client) => {
      const result = await client.query(`
        UPDATE users SET
          name = COALESCE($1, name),
          role = COALESCE($2, role)
        WHERE id = $3
        RETURNING id, email, name, role, created_at, last_login_at
      `, [name, role, id]);
      if (result.rows.length === 0) return null;
      await logAdminAction(req.user!.id, 'user_updated', { targetUserId: id, name, role }, client);
      return result.rows[0];
    });

    if (!updated) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(updated);
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// DELETE /api/admin/users/:id - Delete user
router.delete('/:id', authMiddleware, requireCsrf, requireRole('super_admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    // Prevent self-deletion
    if (id === req.user!.id) {
      return res.status(400).json({ error: 'Cannot delete yourself' });
    }

    // Prevent deleting the last super_admin
    const superAdminCount = await pool.query(
      "SELECT COUNT(*)::int AS count FROM users WHERE role = 'super_admin'"
    );
    const targetUser = await pool.query('SELECT role FROM users WHERE id = $1', [id]);

    if (targetUser.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (targetUser.rows[0].role === 'super_admin' && superAdminCount.rows[0].count <= 1) {
      return res.status(400).json({ error: 'Cannot delete the last super_admin' });
    }

    await inTransaction(async (client) => {
      await client.query('DELETE FROM users WHERE id = $1', [id]);
      await logAdminAction(req.user!.id, 'user_deleted', { targetUserId: id }, client);
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// POST /api/admin/users/:id/reset-password - Set new password. Bumping
// token_version ends every existing session for the account (lib/session.ts).
router.post('/:id/reset-password', authMiddleware, requireCsrf, requireRole('super_admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { password } = req.body;

    const problem = passwordProblem(password);
    if (problem) {
      return res.status(400).json({ error: problem });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const updated = await inTransaction(async (client) => {
      const result = await client.query(
        `UPDATE users SET hashed_password = $1, token_version = token_version + 1
         WHERE id = $2
         RETURNING id, email, role, token_version`,
        [hashedPassword, id]
      );
      if (result.rows.length === 0) return null;
      await logAdminAction(req.user!.id, 'user_password_reset', { targetUserId: id }, client);
      return result.rows[0];
    });

    if (!updated) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Resetting your own password should not log out the browser doing it.
    if (id === req.user!.id && req.authVia === 'cookie') {
      issueSession(res, signSession(updated));
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error resetting password:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// POST /api/admin/users/:id/revoke-sessions - End every session for a user
// (e.g. a lost laptop or suspected cookie theft) without changing the password.
router.post('/:id/revoke-sessions', authMiddleware, requireCsrf, requireRole('super_admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const revoked = await inTransaction(async (client) => {
      const result = await client.query(
        'UPDATE users SET token_version = token_version + 1 WHERE id = $1 RETURNING id',
        [id]
      );
      if (result.rows.length === 0) return null;
      await logAdminAction(req.user!.id, 'user_sessions_revoked', { targetUserId: id }, client);
      return result.rows[0];
    });

    if (!revoked) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error revoking sessions:', error);
    res.status(500).json({ error: 'Failed to revoke sessions' });
  }
});

export default router;
