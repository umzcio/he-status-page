import { Router, Response } from 'express';
import pool from '../db/connection';
import { authMiddleware, requireRole, AuthRequest } from './middleware/auth';
import { requireCsrf } from './middleware/csrf';
import { listDevices, listGroups, listServicesForDevice } from '../lib/librenms';
import { logAdminAction } from '../lib/adminLog';

const router = Router();

// GET /api/admin/services - List all services with full config
router.get('/', authMiddleware, requireCsrf, async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT
        s.*,
        c.slug AS category_slug,
        c.display_name AS category_display_name,
        ss.status,
        ss.status_source,
        ss.status_message,
        ss.override_active
      FROM services s
      LEFT JOIN categories c ON s.category_id = c.id
      LEFT JOIN service_status ss ON s.id = ss.service_id
      ORDER BY s.display_order ASC
    `);
    res.json({ services: result.rows });
  } catch (error) {
    console.error('Error fetching admin services:', error);
    res.status(500).json({ error: 'Failed to fetch services' });
  }
});

// POST /api/admin/services - Create service
router.post('/', authMiddleware, requireCsrf, requireRole('super_admin'), async (req: AuthRequest, res: Response) => {
  const client = await pool.connect();
  try {
    const {
      name, description, category_id, provider,
      status_api_endpoint, status_api_type,
      check_enabled = true, external_link, display_order = 0,
      visible = true
    } = req.body;

    if (!name || !status_api_type) {
      return res.status(400).json({ error: 'name and status_api_type are required' });
    }

    await client.query('BEGIN');

    // Also set legacy category column for backwards compat
    let categorySlug = null;
    if (category_id) {
      const catResult = await client.query('SELECT slug FROM categories WHERE id = $1', [category_id]);
      categorySlug = catResult.rows[0]?.slug || null;
    }

    const result = await client.query(`
      INSERT INTO services (
        name, description, category, category_id, provider,
        status_api_endpoint, status_api_type,
        check_enabled, external_link, display_order, visible
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `, [
      name, description || null, categorySlug, category_id || null, provider || null,
      status_api_endpoint || null, status_api_type,
      check_enabled, external_link || null, display_order, visible
    ]);

    const serviceId = result.rows[0].id;

    // Initialize service_status
    await client.query(`
      INSERT INTO service_status (service_id, status, status_source, status_message)
      VALUES ($1, 'operational', $2, 'Initial status')
    `, [serviceId, check_enabled ? 'automated' : 'manual_override']);

    // Initial history record
    await client.query(`
      INSERT INTO status_history (service_id, status, status_source, status_message, started_at)
      VALUES ($1, 'operational', $2, 'Initial status', NOW())
    `, [serviceId, check_enabled ? 'automated' : 'manual_override']);

    // Log
    await logAdminAction(req.user!.id, 'service_created', { serviceId, name, status_api_type }, client);

    await client.query('COMMIT');
    res.status(201).json(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creating service:', error);
    res.status(500).json({ error: 'Failed to create service' });
  } finally {
    client.release();
  }
});

// PUT /api/admin/services/:id - Update service config
router.put('/:id', authMiddleware, requireCsrf, requireRole('super_admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const {
      name, description, category_id, provider,
      status_api_endpoint, status_api_type,
      check_enabled, external_link, display_order, visible
    } = req.body;

    // Get category slug for backwards compat
    let categorySlug = undefined;
    if (category_id !== undefined) {
      if (category_id) {
        const catResult = await pool.query('SELECT slug FROM categories WHERE id = $1', [category_id]);
        categorySlug = catResult.rows[0]?.slug || null;
      } else {
        categorySlug = null;
      }
    }

    const result = await pool.query(`
      UPDATE services SET
        name = COALESCE($1, name),
        description = COALESCE($2, description),
        category = COALESCE($3, category),
        category_id = COALESCE($4, category_id),
        provider = COALESCE($5, provider),
        status_api_endpoint = COALESCE($6, status_api_endpoint),
        status_api_type = COALESCE($7, status_api_type),
        check_enabled = COALESCE($8, check_enabled),
        external_link = COALESCE($9, external_link),
        display_order = COALESCE($10, display_order),
        visible = COALESCE($11, visible),
        updated_at = NOW()
      WHERE id = $12
      RETURNING *
    `, [name, description, categorySlug, category_id, provider, status_api_endpoint, status_api_type, check_enabled, external_link, display_order, visible, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Service not found' });
    }

    await logAdminAction(req.user!.id, 'service_updated', { serviceId: id, name });

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating service:', error);
    res.status(500).json({ error: 'Failed to update service' });
  }
});

// DELETE /api/admin/services/:id - Delete service (cascades)
router.delete('/:id', authMiddleware, requireCsrf, requireRole('super_admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const result = await pool.query('DELETE FROM services WHERE id = $1 RETURNING name', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Service not found' });
    }

    await logAdminAction(req.user!.id, 'service_deleted', { serviceId: id, name: result.rows[0].name });

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting service:', error);
    res.status(500).json({ error: 'Failed to delete service' });
  }
});

// --- LibreNMS Proxy Endpoints ---

// GET /api/admin/librenms/devices
router.get('/librenms/devices', authMiddleware, requireCsrf, requireRole('super_admin'), async (req: AuthRequest, res: Response) => {
  try {
    const devices = await listDevices();
    res.json({ devices });
  } catch (error: any) {
    console.error('LibreNMS devices error:', error.message);
    res.status(502).json({ error: error.message || 'Failed to fetch LibreNMS devices' });
  }
});

// GET /api/admin/librenms/groups
router.get('/librenms/groups', authMiddleware, requireCsrf, requireRole('super_admin'), async (req: AuthRequest, res: Response) => {
  try {
    const groups = await listGroups();
    res.json({ groups });
  } catch (error: any) {
    console.error('LibreNMS groups error:', error.message);
    res.status(502).json({ error: error.message || 'Failed to fetch LibreNMS groups' });
  }
});

// GET /api/admin/librenms/services/:hostname
router.get('/librenms/services/:hostname', authMiddleware, requireCsrf, requireRole('super_admin'), async (req: AuthRequest, res: Response) => {
  try {
    const services = await listServicesForDevice(req.params.hostname);
    res.json({ services });
  } catch (error: any) {
    console.error('LibreNMS services error:', error.message);
    res.status(502).json({ error: error.message || 'Failed to fetch LibreNMS services' });
  }
});

// --- Service Dependencies ---

// GET /api/admin/services/:id/dependencies - Get dependencies for a service
router.get('/:id/dependencies', authMiddleware, requireCsrf, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`
      SELECT sd.id, sd.depends_on_service_id, s.name AS depends_on_name
      FROM service_dependencies sd
      JOIN services s ON sd.depends_on_service_id = s.id
      WHERE sd.service_id = $1
      ORDER BY s.name
    `, [id]);
    res.json({ dependencies: result.rows });
  } catch (error) {
    console.error('Error fetching dependencies:', error);
    res.status(500).json({ error: 'Failed to fetch dependencies' });
  }
});

// POST /api/admin/services/:id/dependencies - Add a dependency
router.post('/:id/dependencies', authMiddleware, requireCsrf, requireRole('super_admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { depends_on_service_id } = req.body;

    if (!depends_on_service_id) {
      return res.status(400).json({ error: 'depends_on_service_id is required' });
    }

    if (id === depends_on_service_id) {
      return res.status(400).json({ error: 'A service cannot depend on itself' });
    }

    const result = await pool.query(`
      INSERT INTO service_dependencies (service_id, depends_on_service_id)
      VALUES ($1, $2)
      ON CONFLICT (service_id, depends_on_service_id) DO NOTHING
      RETURNING *
    `, [id, depends_on_service_id]);

    await logAdminAction(req.user!.id, 'dependency_added', { service_id: id, depends_on_service_id });

    res.status(201).json(result.rows[0] || { message: 'Already exists' });
  } catch (error) {
    console.error('Error adding dependency:', error);
    res.status(500).json({ error: 'Failed to add dependency' });
  }
});

// DELETE /api/admin/services/:id/dependencies/:depId - Remove a dependency
router.delete('/:id/dependencies/:depId', authMiddleware, requireCsrf, requireRole('super_admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { id, depId } = req.params;

    const result = await pool.query(
      'DELETE FROM service_dependencies WHERE id = $1 AND service_id = $2 RETURNING *',
      [depId, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Dependency not found' });
    }

    await logAdminAction(req.user!.id, 'dependency_removed', { dependency_id: depId, service_id: id });

    res.json({ success: true });
  } catch (error) {
    console.error('Error removing dependency:', error);
    res.status(500).json({ error: 'Failed to remove dependency' });
  }
});

export default router;
