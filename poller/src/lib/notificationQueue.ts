import pool from '../db/connection';
import { statusChangeEmail } from './emailTemplates';
import { notifyTeams } from './teams';

export async function queueNotifications(
  serviceId: string,
  serviceName: string,
  oldStatus: string,
  newStatus: string
): Promise<void> {
  try {
    // Find verified, active subscribers who are subscribed to this service.
    // Hidden services never email the public, even for older enrolments.
    const subscribers = await pool.query(`
      SELECT s.id AS subscription_id, s.email, s.verification_token
      FROM subscriptions s
      JOIN subscription_services ss ON s.id = ss.subscription_id
      JOIN services svc ON svc.id = ss.service_id AND svc.visible IS NOT false
      WHERE ss.service_id = $1
        AND s.verified = true
        AND s.unsubscribed_at IS NULL
    `, [serviceId]);

    if (subscribers.rows.length === 0) return;

    for (const sub of subscribers.rows) {
      const template = statusChangeEmail(serviceName, oldStatus, newStatus, sub.verification_token);

      await pool.query(`
        INSERT INTO notification_queue (
          subscription_id, service_id, notification_type,
          status_change_from, status_change_to, subject, body
        )
        VALUES ($1, $2, 'status_change', $3, $4, $5, $6)
      `, [sub.subscription_id, serviceId, oldStatus, newStatus, template.subject, template.html]);
    }

    console.log(`  → Queued ${subscribers.rows.length} notification(s)`);
  } catch (error) {
    console.error('  → Failed to queue notifications:', error);
  }
}

export async function notifyDependents(
  dependencyServiceId: string,
  dependencyName: string,
  dependencyStatus: string
): Promise<void> {
  try {
    // Find all services that depend on this one
    const dependents = await pool.query(`
      SELECT s.id, s.name, COALESCE(c.slug, s.category) AS category_slug
      FROM service_dependencies sd
      JOIN services s ON sd.service_id = s.id
      LEFT JOIN categories c ON s.category_id = c.id
      WHERE sd.depends_on_service_id = $1
    `, [dependencyServiceId]);

    if (dependents.rows.length === 0) return;

    const names = dependents.rows.map((d: any) => d.name);
    console.log(`  → ${dependencyName} ${dependencyStatus}: notifying ${names.length} dependent service(s): ${names.join(', ')}`);

    // Send a single Teams notification about the dependency impact
    notifyTeams({
      serviceId: dependencyServiceId,
      serviceName: dependencyName,
      categorySlug: dependents.rows[0].category_slug,
      oldStatus: 'operational',
      newStatus: dependencyStatus,
      statusMessage: `${dependencyName} is ${dependencyStatus}. Services that may be affected: ${names.join(', ')}`,
    });
  } catch (error) {
    console.error('  → Failed to notify dependents:', error);
  }
}
