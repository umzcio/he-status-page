import pool from '../db/connection';
import { createTeamsNotifier } from '@he-status/shared';

export type { NotifyParams, OverrideInfo } from '@he-status/shared';
export { buildStatusChangeCard, sendTeamsWebhook, getActiveWebhooks } from '@he-status/shared';

export const notifyTeams = createTeamsNotifier(pool);
