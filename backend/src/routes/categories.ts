import { Router, Response } from 'express';
import pool from '../db/connection';
import { authMiddleware, requireRole, AuthRequest } from './middleware/auth';
import { requireCsrf } from './middleware/csrf';
import { logAdminAction } from '../lib/adminLog';

const router = Router();

// GET /api/admin/categories - List categories with service counts
router.get('/', authMiddleware, requireCsrf, async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT c.*, COUNT(s.id)::int AS service_count
      FROM categories c
      LEFT JOIN services s ON s.category_id = c.id
      GROUP BY c.id
      ORDER BY c.display_order ASC, c.display_name ASC
    `);
    res.json({ categories: result.rows });
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

// POST /api/admin/categories - Create category
router.post('/', authMiddleware, requireCsrf, requireRole('super_admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { slug, display_name, description, display_order } = req.body;

    if (!slug || !display_name) {
      return res.status(400).json({ error: 'slug and display_name are required' });
    }

    const result = await pool.query(`
      INSERT INTO categories (slug, display_name, description, display_order)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [slug, display_name, description || null, display_order || 0]);

    await logAdminAction(req.user!.id, 'category_created', { slug, display_name });

    res.status(201).json(result.rows[0]);
  } catch (error: any) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Category slug already exists' });
    }
    console.error('Error creating category:', error);
    res.status(500).json({ error: 'Failed to create category' });
  }
});

// PUT /api/admin/categories/reorder - Bulk update display_order
router.put('/reorder', authMiddleware, requireCsrf, requireRole('super_admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { order } = req.body; // [{ id, display_order }]

    if (!Array.isArray(order)) {
      return res.status(400).json({ error: 'order array is required' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const item of order) {
        await client.query(
          'UPDATE categories SET display_order = $1, updated_at = NOW() WHERE id = $2',
          [item.display_order, item.id]
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error reordering categories:', error);
    res.status(500).json({ error: 'Failed to reorder categories' });
  }
});

// PUT /api/admin/categories/:id - Update category
router.put('/:id', authMiddleware, requireCsrf, requireRole('super_admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { slug, display_name, description, display_order } = req.body;

    const result = await pool.query(`
      UPDATE categories
      SET slug = COALESCE($1, slug),
          display_name = COALESCE($2, display_name),
          description = COALESCE($3, description),
          display_order = COALESCE($4, display_order),
          updated_at = NOW()
      WHERE id = $5
      RETURNING *
    `, [slug, display_name, description, display_order, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Category not found' });
    }

    await logAdminAction(req.user!.id, 'category_updated', { id, slug, display_name });

    res.json(result.rows[0]);
  } catch (error: any) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Category slug already exists' });
    }
    console.error('Error updating category:', error);
    res.status(500).json({ error: 'Failed to update category' });
  }
});

// DELETE /api/admin/categories/:id - Delete category (only if empty)
router.delete('/:id', authMiddleware, requireCsrf, requireRole('super_admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    // Check for assigned services
    const serviceCount = await pool.query(
      'SELECT COUNT(*)::int AS count FROM services WHERE category_id = $1',
      [id]
    );

    if (serviceCount.rows[0].count > 0) {
      return res.status(400).json({
        error: `Cannot delete: ${serviceCount.rows[0].count} service(s) still assigned to this category`
      });
    }

    const result = await pool.query('DELETE FROM categories WHERE id = $1 RETURNING slug', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Category not found' });
    }

    await logAdminAction(req.user!.id, 'category_deleted', { id, slug: result.rows[0].slug });

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting category:', error);
    res.status(500).json({ error: 'Failed to delete category' });
  }
});

export default router;
