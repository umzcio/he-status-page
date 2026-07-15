import pool from '../db/connection';

const SEVERITY_FOR_STATUS: Record<string, string> = {
  outage: 'critical',
  degraded: 'major',
  maintenance: 'minor',
  unknown: 'minor',
};

const SEVERITY_RANK: Record<string, number> = { minor: 1, major: 2, critical: 3 };

function impactForStatus(status: string): string {
  return SEVERITY_FOR_STATUS[status] || 'minor';
}

function defaultTitle(serviceName: string, status: string): string {
  switch (status) {
    case 'outage': return `${serviceName} outage`;
    case 'degraded': return `${serviceName} performance degradation`;
    case 'maintenance': return `${serviceName} maintenance`;
    default: return `${serviceName} issue`;
  }
}

function defaultMessage(serviceName: string, status: string): string {
  switch (status) {
    case 'outage':
      return `We're investigating a service interruption affecting ${serviceName}.`;
    case 'degraded':
      return `We're investigating reports of degraded performance with ${serviceName}.`;
    case 'maintenance':
      return `${serviceName} is undergoing scheduled maintenance.`;
    default:
      return `We're investigating an issue with ${serviceName}.`;
  }
}

interface OpenIncident {
  id: string;
  status: string;
  impact: string;
}

async function findOpenAutoIncident(serviceId: string): Promise<OpenIncident | null> {
  const result = await pool.query(
    `SELECT id, status, impact FROM incidents
     WHERE service_id = $1 AND auto_created = true AND resolved_at IS NULL
     ORDER BY started_at DESC LIMIT 1`,
    [serviceId]
  );
  return result.rows[0] || null;
}

/**
 * Auto-create or update an incident on a non-operational status transition.
 */
export async function autoCreateIncident(
  serviceId: string,
  serviceName: string,
  newStatus: string,
  statusMessage: string | null
): Promise<string | null> {
  if (newStatus === 'operational') return null;

  const existing = await findOpenAutoIncident(serviceId);
  if (existing) {
    const newImpact = impactForStatus(newStatus);
    if ((SEVERITY_RANK[newImpact] || 0) > (SEVERITY_RANK[existing.impact] || 0)) {
      await pool.query(
        `UPDATE incidents SET impact = $1, severity = $1 WHERE id = $2`,
        [newImpact, existing.id]
      );
      await pool.query(
        `INSERT INTO incident_updates (incident_id, status, message)
         VALUES ($1, 'investigating', $2)`,
        [existing.id, `Impact updated: now ${newStatus}. ${statusMessage || ''}`.trim()]
      );
    }
    return null;
  }

  const impact = impactForStatus(newStatus);
  const title = defaultTitle(serviceName, newStatus);
  const message = statusMessage || defaultMessage(serviceName, newStatus);

  const result = await pool.query(
    `INSERT INTO incidents (
      service_id, title, description, severity, impact, status,
      source, auto_created, started_at, visible
    )
    VALUES ($1, $2, $3, $4, $4, 'investigating', 'automated', true, NOW(), true)
    RETURNING id`,
    [serviceId, title, message, impact]
  );
  const incidentId = result.rows[0].id;

  await pool.query(
    `INSERT INTO incident_updates (incident_id, status, message)
     VALUES ($1, 'investigating', $2)`,
    [incidentId, message]
  );

  return incidentId;
}

/**
 * Auto-resolve open auto-created incident when service returns to operational.
 */
export async function autoResolveIncident(serviceId: string): Promise<string | null> {
  const open = await findOpenAutoIncident(serviceId);
  if (!open) return null;

  await pool.query(
    `INSERT INTO incident_updates (incident_id, status, message)
     VALUES ($1, 'resolved', 'Service has returned to normal operation.')`,
    [open.id]
  );
  return open.id;
}
