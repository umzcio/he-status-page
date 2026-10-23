import { STATUS_COLORS, STATUS_ICONS, STATUS_LABELS } from './constants';
import { createGuardedHttpClient } from './urlGuard';

// Teams / Power Automate webhooks are public HTTPS endpoints that never
// redirect, so delivery is held to the strictest policy: public addresses only
// (checked at connect time) and no redirects.
const webhookHttp = createGuardedHttpClient({ allowPrivate: false, maxRedirects: 0 });

export interface QueryExecutor {
  query(text: string, params?: any[]): Promise<{ rows: any[] }>;
}

interface WebhookRow {
  id: string;
  name: string;
  webhook_url: string;
}

export interface OverrideInfo {
  userName: string;
  reason?: string;
  isRemoval?: boolean;
}

export interface NotifyParams {
  serviceId: string;
  serviceName: string;
  categorySlug: string;
  oldStatus: string;
  newStatus: string;
  statusMessage: string;
  overrideInfo?: OverrideInfo;
}

export async function getActiveWebhooks(db: QueryExecutor, categorySlug?: string): Promise<WebhookRow[]> {
  let queryText: string;
  let params: any[];

  if (categorySlug) {
    queryText = `
      SELECT id, name, webhook_url
      FROM teams_webhooks
      WHERE enabled = true
        AND (category_filter IS NULL OR category_filter @> $1::jsonb)
    `;
    params = [JSON.stringify([categorySlug])];
  } else {
    queryText = `
      SELECT id, name, webhook_url
      FROM teams_webhooks
      WHERE enabled = true AND category_filter IS NULL
    `;
    params = [];
  }

  const result = await db.query(queryText, params);
  return result.rows;
}

export function buildStatusChangeCard(params: NotifyParams): object {
  const { serviceName, oldStatus, newStatus, statusMessage, overrideInfo } = params;
  const icon = STATUS_ICONS[newStatus as keyof typeof STATUS_ICONS] || STATUS_ICONS.unknown;
  const publicUrl = process.env.PUBLIC_URL || 'http://localhost:3001';

  const facts: { title: string; value: string }[] = [
    { title: 'Status Change', value: `${STATUS_LABELS[oldStatus as keyof typeof STATUS_LABELS] || oldStatus} \u2192 ${STATUS_LABELS[newStatus as keyof typeof STATUS_LABELS] || newStatus}` },
    { title: 'Message', value: statusMessage || 'No details provided' },
  ];

  if (overrideInfo) {
    if (overrideInfo.isRemoval) {
      facts.push({ title: 'Action', value: 'Override Removed' });
    }
    facts.push({ title: 'Set by', value: overrideInfo.userName });
    if (overrideInfo.reason) {
      facts.push({ title: 'Reason', value: overrideInfo.reason });
    }
  }

  facts.push({ title: 'Time', value: new Date().toLocaleString('en-US', { timeZone: 'America/Denver' }) });

  const card = {
    type: 'AdaptiveCard',
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    version: '1.4',
    body: [
      {
        type: 'Container',
        style: 'emphasis',
        items: [
          {
            type: 'TextBlock',
            text: `${icon} ${serviceName}`,
            weight: 'Bolder',
            size: 'Medium',
            color: newStatus === 'operational' ? 'Good' : newStatus === 'outage' ? 'Attention' : newStatus === 'degraded' ? 'Warning' : 'Default',
          },
        ],
      },
      {
        type: 'FactSet',
        facts,
      },
    ],
    actions: [
      {
        type: 'Action.OpenUrl',
        title: 'View Status Page',
        url: publicUrl,
      },
    ],
  };

  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        contentUrl: null,
        content: card,
      },
    ],
  };
}

export async function sendTeamsWebhook(
  webhookUrl: string,
  payload: object
): Promise<{ success: boolean; error?: string; responseTimeMs: number }> {
  const start = Date.now();
  try {
    if (!webhookUrl.startsWith('https://')) {
      throw new Error('Webhook URL must use https://');
    }
    await webhookHttp.post(webhookUrl, payload, { timeout: 10000 });
    return { success: true, responseTimeMs: Date.now() - start };
  } catch (err: any) {
    // Only the status code: the target's response body is never echoed back
    // to the admin API or stored in teams_webhook_logs.
    const message = err.response ? `HTTP ${err.response.status}` : err.message;
    return { success: false, error: message, responseTimeMs: Date.now() - start };
  }
}

async function logWebhookDelivery(db: QueryExecutor, data: {
  webhookId: string;
  serviceId: string;
  statusFrom: string;
  statusTo: string;
  success: boolean;
  errorMessage?: string;
  responseTimeMs: number;
}): Promise<void> {
  try {
    await db.query(
      `INSERT INTO teams_webhook_logs
        (webhook_id, service_id, status_from, status_to, success, error_message, response_time_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [data.webhookId, data.serviceId, data.statusFrom, data.statusTo, data.success, data.errorMessage || null, data.responseTimeMs]
    );
  } catch (err) {
    console.error('Failed to log webhook delivery:', err);
  }
}

export function createTeamsNotifier(db: QueryExecutor) {
  return async function notifyTeams(params: NotifyParams): Promise<void> {
    try {
      const webhooks = await getActiveWebhooks(db, params.categorySlug);
      if (webhooks.length === 0) return;

      const payload = buildStatusChangeCard(params);

      const results = await Promise.allSettled(
        webhooks.map(async (wh) => {
          const result = await sendTeamsWebhook(wh.webhook_url, payload);
          await logWebhookDelivery(db, {
            webhookId: wh.id,
            serviceId: params.serviceId,
            statusFrom: params.oldStatus,
            statusTo: params.newStatus,
            success: result.success,
            errorMessage: result.error,
            responseTimeMs: result.responseTimeMs,
          });
          if (!result.success) {
            console.error(`Teams webhook "${wh.name}" failed: ${result.error}`);
          }
          return result;
        })
      );

      const successCount = results.filter(r => r.status === 'fulfilled').length;
      console.log(`  -> Teams: ${successCount}/${webhooks.length} webhook(s) delivered`);
    } catch (err) {
      console.error('Teams notification error (swallowed):', err);
    }
  };
}
