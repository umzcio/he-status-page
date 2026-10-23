import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

// Read a non-HttpOnly cookie value (used for the readable CSRF token).
function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/([.*+?^${}()|[\]\\])/g, '\\$1') + '=([^;]*)'));
  return match ? decodeURIComponent(match[1]) : null;
}

// Single shared axios instance for all API calls.
// - withCredentials sends the HttpOnly session cookie on every request.
// - A request interceptor attaches the double-submit CSRF token header for
//   mutating methods (the backend enforces it only for cookie-authed requests).
// - A response interceptor redirects to the admin login on 401 (session expiry).
export const adminApi = axios.create({ withCredentials: true });

adminApi.interceptors.request.use((config) => {
  const method = (config.method || 'get').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    const csrf = readCookie('hsp_csrf');
    if (csrf) {
      config.headers.set('X-CSRF-Token', csrf);
    }
  }
  return config;
});

adminApi.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      if (typeof window !== 'undefined' && window.location.pathname.includes('/admin')) {
        const adminBase = window.location.pathname.split('/admin')[0] + '/admin';
        window.location.href = adminBase;
      }
      return Promise.reject(new Error('Session expired. Please log in again.'));
    }
    return Promise.reject(error);
  }
);

export interface OverrideResult {
  success: boolean;
  message: string;
}

export async function activateOverride(
  serviceId: string,
  override: { status: string; message: string; reason?: string; expires_at?: string }
): Promise<OverrideResult> {
  const response = await adminApi.post(
    `${API_URL}/api/admin/services/${serviceId}/override`,
    override
  );
  return response.data;
}

export async function deactivateOverride(serviceId: string): Promise<OverrideResult> {
  const response = await adminApi.delete(
    `${API_URL}/api/admin/services/${serviceId}/override`
  );
  return response.data;
}

// --- Category Management ---

export interface AdminCategory {
  id: string;
  slug: string;
  display_name: string;
  description: string | null;
  display_order: number;
  service_count: number;
  created_at: string;
  updated_at: string;
}

export async function getCategories(): Promise<{ categories: AdminCategory[] }> {
  const response = await adminApi.get(`${API_URL}/api/admin/categories`);
  return response.data;
}

export async function createCategory(data: { slug: string; display_name: string; description?: string; display_order?: number }): Promise<AdminCategory> {
  const response = await adminApi.post(`${API_URL}/api/admin/categories`, data);
  return response.data;
}

export async function updateCategory(id: string, data: { slug?: string; display_name?: string; description?: string; display_order?: number }): Promise<AdminCategory> {
  const response = await adminApi.put(`${API_URL}/api/admin/categories/${id}`, data);
  return response.data;
}

export async function deleteCategory(id: string): Promise<void> {
  await adminApi.delete(`${API_URL}/api/admin/categories/${id}`);
}

// --- Service Management ---

export interface AdminService {
  id: string;
  name: string;
  description: string | null;
  category: string;
  category_id: string | null;
  category_slug: string | null;
  category_display_name: string | null;
  provider: string | null;
  status_api_endpoint: string | null;
  status_api_type: string | null;
  check_enabled: boolean;
  check_interval_minutes: number;
  external_link: string | null;
  display_order: number;
  visible: boolean;
  status: string;
  status_source: string;
  status_message: string;
}

export async function getAdminServices(): Promise<{ services: AdminService[] }> {
  const response = await adminApi.get(`${API_URL}/api/admin/services`);
  return response.data;
}

export interface ServiceInput {
  name: string;
  description?: string | null;
  category_id?: string | null;
  provider?: string | null;
  status_api_endpoint?: string | null;
  status_api_type: string;
  check_enabled?: boolean;
  external_link?: string | null;
  display_order?: number;
  visible?: boolean;
}

export async function createService(data: ServiceInput): Promise<AdminService> {
  const response = await adminApi.post(`${API_URL}/api/admin/services`, data);
  return response.data;
}

export async function updateService(id: string, data: Partial<ServiceInput>): Promise<AdminService> {
  const response = await adminApi.put(`${API_URL}/api/admin/services/${id}`, data);
  return response.data;
}

export async function deleteService(id: string): Promise<void> {
  await adminApi.delete(`${API_URL}/api/admin/services/${id}`);
}

// --- Service Dependencies ---

export interface ServiceDependency {
  id: string;
  depends_on_service_id: string;
  depends_on_name: string;
}

export async function getServiceDependencies(serviceId: string): Promise<{ dependencies: ServiceDependency[] }> {
  const response = await adminApi.get(`${API_URL}/api/admin/services/${serviceId}/dependencies`);
  return response.data;
}

export async function addServiceDependency(serviceId: string, dependsOnServiceId: string): Promise<ServiceDependency> {
  const response = await adminApi.post(`${API_URL}/api/admin/services/${serviceId}/dependencies`, {
    depends_on_service_id: dependsOnServiceId
  });
  return response.data;
}

export async function removeServiceDependency(serviceId: string, depId: string): Promise<void> {
  await adminApi.delete(`${API_URL}/api/admin/services/${serviceId}/dependencies/${depId}`);
}

// --- LibreNMS Proxy ---

export interface LibreNMSDevice {
  device_id: number;
  hostname: string;
  sysName?: string;
  status?: number;
  os?: string;
  hardware?: string;
  location?: string;
}

export interface LibreNMSGroup {
  id: number;
  name: string;
  description?: string;
}

export interface LibreNMSService {
  service_id: number;
  service_type: string;
  service_status: number;
  service_disabled?: boolean;
}

export async function getLibreNMSDevices(): Promise<LibreNMSDevice[]> {
  const response = await adminApi.get(`${API_URL}/api/admin/librenms/devices`);
  return response.data.devices;
}

export async function getLibreNMSGroups(): Promise<LibreNMSGroup[]> {
  const response = await adminApi.get(`${API_URL}/api/admin/librenms/groups`);
  return response.data.groups;
}

export async function getLibreNMSServices(hostname: string): Promise<LibreNMSService[]> {
  const response = await adminApi.get(`${API_URL}/api/admin/librenms/services/${hostname}`);
  return response.data.services;
}

// --- User Management ---

export interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
  created_at: string;
  last_login_at: string | null;
}

export async function getUsers(): Promise<{ users: AdminUser[] }> {
  const response = await adminApi.get(`${API_URL}/api/admin/users`);
  return response.data;
}

export async function createUser(data: { email: string; name: string; role: string; password: string }): Promise<AdminUser> {
  const response = await adminApi.post(`${API_URL}/api/admin/users`, data);
  return response.data;
}

export async function updateUser(id: string, data: { name?: string; role?: string }): Promise<AdminUser> {
  const response = await adminApi.put(`${API_URL}/api/admin/users/${id}`, data);
  return response.data;
}

export async function deleteUser(id: string): Promise<void> {
  await adminApi.delete(`${API_URL}/api/admin/users/${id}`);
}

export async function resetUserPassword(id: string, password: string): Promise<void> {
  await adminApi.post(`${API_URL}/api/admin/users/${id}/reset-password`, { password });
}

export async function revokeUserSessions(id: string): Promise<void> {
  await adminApi.post(`${API_URL}/api/admin/users/${id}/revoke-sessions`);
}

// --- API Key Management ---

export interface ApiKey {
  id: string;
  user_id: string;
  user_email: string;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export async function getApiKeys(): Promise<{ keys: ApiKey[] }> {
  const response = await adminApi.get(`${API_URL}/api/admin/api-keys`);
  return response.data;
}

export async function createApiKey(data: { user_id: string; name: string }): Promise<{ key: ApiKey; plaintext_key: string }> {
  const response = await adminApi.post(`${API_URL}/api/admin/api-keys`, data);
  return response.data;
}

export async function revokeApiKey(id: string): Promise<void> {
  await adminApi.delete(`${API_URL}/api/admin/api-keys/${id}`);
}

// --- Notification Management ---

export interface NotificationStats {
  active_subscribers: number;
  sent_24h: number;
  sent_7d: number;
  failed: number;
  pending: number;
  email_configured: boolean;
}

export interface NotificationSubscriber {
  id: string;
  email: string;
  verified: boolean;
  created_at: string;
  unsubscribed_at: string | null;
  service_count: number;
}

export interface NotificationQueueItem {
  id: string;
  subject: string;
  notification_type: string;
  status_change_from: string | null;
  status_change_to: string | null;
  scheduled_for: string;
  sent_at: string | null;
  failed_at: string | null;
  error_message: string | null;
  retry_count: number;
  subscriber_email: string | null;
  service_name: string | null;
}

export async function getNotificationSubscribers(): Promise<{ subscribers: NotificationSubscriber[] }> {
  const response = await adminApi.get(`${API_URL}/api/admin/notifications/subscribers`);
  return response.data;
}

export async function getNotificationQueue(): Promise<{ queue: NotificationQueueItem[] }> {
  const response = await adminApi.get(`${API_URL}/api/admin/notifications/queue`);
  return response.data;
}

export async function getNotificationStats(): Promise<NotificationStats> {
  const response = await adminApi.get(`${API_URL}/api/admin/notifications/stats`);
  return response.data;
}

export async function sendTestEmail(email: string): Promise<void> {
  await adminApi.post(`${API_URL}/api/admin/notifications/test`, { email });
}

export async function deleteSubscriber(id: string): Promise<void> {
  await adminApi.delete(`${API_URL}/api/admin/notifications/subscribers/${id}`);
}

// --- Teams Webhook Management ---

export interface TeamsWebhook {
  id: string;
  name: string;
  webhook_url: string;
  enabled: boolean;
  category_filter: string[] | null;
  created_at: string;
  updated_at: string;
}

export interface WebhookLog {
  id: string;
  webhook_id: string | null;
  service_id: string | null;
  webhook_name: string | null;
  service_name: string | null;
  status_from: string;
  status_to: string;
  success: boolean;
  error_message: string | null;
  response_time_ms: number;
  sent_at: string;
}

export async function getWebhooks(): Promise<{ webhooks: TeamsWebhook[] }> {
  const response = await adminApi.get(`${API_URL}/api/admin/webhooks`);
  return response.data;
}

export async function createWebhook(data: {
  name: string;
  webhook_url: string;
  enabled?: boolean;
  category_filter?: string[] | null;
}): Promise<TeamsWebhook> {
  const response = await adminApi.post(`${API_URL}/api/admin/webhooks`, data);
  return response.data;
}

export async function updateWebhook(id: string, data: {
  name?: string;
  webhook_url?: string;
  enabled?: boolean;
  category_filter?: string[] | null;
}): Promise<TeamsWebhook> {
  const response = await adminApi.put(`${API_URL}/api/admin/webhooks/${id}`, data);
  return response.data;
}

export async function deleteWebhook(id: string): Promise<void> {
  await adminApi.delete(`${API_URL}/api/admin/webhooks/${id}`);
}

export async function testWebhook(id: string): Promise<{ success: boolean; error?: string; responseTimeMs: number }> {
  const response = await adminApi.post(`${API_URL}/api/admin/webhooks/${id}/test`, {});
  return response.data;
}

export async function getWebhookLogs(): Promise<{ logs: WebhookLog[] }> {
  const response = await adminApi.get(`${API_URL}/api/admin/webhooks/logs`);
  return response.data;
}

// --- Incident Management ---

export interface AdminIncidentSummary {
  id: string;
  service_id: string;
  service_name: string;
  title: string;
  description: string | null;
  impact: 'minor' | 'major' | 'critical';
  status: 'investigating' | 'identified' | 'monitoring' | 'resolved';
  source: 'automated' | 'manual';
  auto_created: boolean;
  visible: boolean;
  started_at: string;
  resolved_at: string | null;
  updated_at: string;
  duration_minutes: number;
  created_by_name: string | null;
  update_count: number;
}

interface AdminIncidentUpdate {
  id: string;
  status: 'investigating' | 'identified' | 'monitoring' | 'resolved';
  message: string;
  created_at: string;
  created_by_user_id: string | null;
  created_by_name: string | null;
}

export interface AdminIncidentDetail extends Omit<AdminIncidentSummary, 'update_count'> {
  updates: AdminIncidentUpdate[];
}

export async function getAdminIncidents(status: 'all' | 'active' | 'resolved' = 'all', limit = 50): Promise<{ incidents: AdminIncidentSummary[]; total: number }> {
  const response = await adminApi.get(`${API_URL}/api/admin/incidents`, {
    params: { status, limit },
  });
  return response.data;
}

export async function getAdminIncident(id: string): Promise<AdminIncidentDetail> {
  const response = await adminApi.get(`${API_URL}/api/admin/incidents/${id}`);
  return response.data;
}

export async function createIncident(data: {
  service_id: string;
  title: string;
  description?: string;
  impact: 'minor' | 'major' | 'critical';
  status?: 'investigating' | 'identified' | 'monitoring' | 'resolved';
  initial_message?: string;
  visible?: boolean;
  started_at?: string;
}): Promise<{ id: string }> {
  const response = await adminApi.post(`${API_URL}/api/admin/incidents`, data);
  return response.data;
}

export async function postIncidentUpdate(id: string, data: {
  status: 'investigating' | 'identified' | 'monitoring' | 'resolved';
  message: string;
}): Promise<{ id: string; created_at: string }> {
  const response = await adminApi.post(`${API_URL}/api/admin/incidents/${id}/updates`, data);
  return response.data;
}

export async function patchIncident(id: string, data: {
  title?: string;
  description?: string;
  impact?: 'minor' | 'major' | 'critical';
  visible?: boolean;
}): Promise<void> {
  await adminApi.patch(`${API_URL}/api/admin/incidents/${id}`, data);
}

export async function deleteIncident(id: string): Promise<void> {
  await adminApi.delete(`${API_URL}/api/admin/incidents/${id}`);
}

// --- Planned Maintenance ---

export interface PlannedMaintenance {
  id: string;
  service_id: string;
  service_name: string;
  series_id: string;
  title: string;
  description: string | null;
  scheduled_start: string;
  scheduled_end: string;
  recurrence_type: 'once' | 'daily' | 'weekly' | 'monthly';
  announce: boolean;
  status: 'scheduled' | 'active' | 'completed' | 'cancelled';
  created_at: string;
  created_by_name: string | null;
  activated_at: string | null;
  completed_at: string | null;
}

export async function getMaintenances(
  params: { service_id?: string; status?: string } = {}
): Promise<{ maintenances: PlannedMaintenance[] }> {
  const response = await adminApi.get(`${API_URL}/api/admin/maintenance`, {
    params,
  });
  return response.data;
}

export async function createMaintenance(
  data: {
    service_id: string;
    title: string;
    description?: string;
    scheduled_start: string;
    scheduled_end: string;
    recurrence_type?: 'once' | 'daily' | 'weekly' | 'monthly';
    recurrence_day_of_week?: number;
    recurrence_day_of_month?: number;
    announce?: boolean;
  }
): Promise<PlannedMaintenance> {
  const response = await adminApi.post(`${API_URL}/api/admin/maintenance`, data);
  return response.data;
}

export async function cancelMaintenance(id: string): Promise<void> {
  await adminApi.delete(`${API_URL}/api/admin/maintenance/${id}`);
}

export async function cancelMaintenanceSeries(id: string): Promise<{ cancelled: number }> {
  const response = await adminApi.delete(`${API_URL}/api/admin/maintenance/${id}/series`);
  return response.data;
}
