import { Pool, PoolClient } from 'pg';
import pool from '../db/connection';

type IncidentImpact = 'minor' | 'major' | 'critical';

const SEVERITY_FOR_STATUS: Record<string, IncidentImpact> = {
  outage: 'critical',
  degraded: 'major',
  maintenance: 'minor',
  unknown: 'minor',
};

function impactForStatus(status: string): IncidentImpact {
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

/**
 * Find an open (unresolved) auto-created incident for a service, if one exists.
 */
export async function findOpenAutoIncident(
  serviceId: string,
  client: PoolClient | Pool = pool
): Promise<{ id: string; status: string; impact: string } | null> {
  const result = await client.query(
    `SELECT id, status, impact FROM incidents
     WHERE service_id = $1
       AND auto_created = true
       AND resolved_at IS NULL
     ORDER BY started_at DESC
     LIMIT 1`,
    [serviceId]
  );
  return result.rows[0] || null;
}

/**
 * Auto-create an incident when a service transitions to a non-operational status.
 * Returns the new incident ID, or null if one already exists.
 */
export async function autoCreateIncident(
  serviceId: string,
  serviceName: string,
  newStatus: string,
  statusMessage: string | null,
  client: PoolClient | Pool = pool
): Promise<string | null> {
  if (newStatus === 'operational') return null;

  const existing = await findOpenAutoIncident(serviceId, client);
  if (existing) {
    // Update impact if severity escalated (e.g., degraded -> outage)
    const newImpact = impactForStatus(newStatus);
    const severityRank: Record<string, number> = { minor: 1, major: 2, critical: 3 };
    if ((severityRank[newImpact] || 0) > (severityRank[existing.impact] || 0)) {
      await client.query(
        `UPDATE incidents SET impact = $1, severity = $1 WHERE id = $2`,
        [newImpact, existing.id]
      );
      await client.query(
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

  const result = await client.query(
    `INSERT INTO incidents (
      service_id, title, description, severity, impact, status,
      source, auto_created, started_at, visible
    )
    SELECT $1, $2, $3, $4, $4, 'investigating', 'automated', true, NOW(),
           -- A hidden service's incidents are hidden too.
           COALESCE((SELECT visible FROM services WHERE id = $1), true)
    RETURNING id`,
    [serviceId, title, message, impact]
  );
  const incidentId = result.rows[0].id;

  await client.query(
    `INSERT INTO incident_updates (incident_id, status, message)
     VALUES ($1, 'investigating', $2)`,
    [incidentId, message]
  );

  return incidentId;
}

/**
 * Auto-resolve an open auto-created incident when service returns to operational.
 */
export async function autoResolveIncident(
  serviceId: string,
  client: PoolClient | Pool = pool
): Promise<string | null> {
  const open = await findOpenAutoIncident(serviceId, client);
  if (!open) return null;

  await client.query(
    `INSERT INTO incident_updates (incident_id, status, message)
     VALUES ($1, 'resolved', 'Service has returned to normal operation.')`,
    [open.id]
  );
  // Trigger handles status + resolved_at update on incidents table
  return open.id;
}
