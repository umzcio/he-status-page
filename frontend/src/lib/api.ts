import { adminApi } from './adminApi';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

interface DependencyImpact {
  name: string;
  status: string;
}

interface UpcomingMaintenance {
  id: string;
  title: string;
  description: string | null;
  scheduled_start: string;
  scheduled_end: string;
  recurrence_type: 'once' | 'daily' | 'weekly' | 'monthly';
  status: 'scheduled' | 'active';
}

export interface Service {
  id: string;
  name: string;
  description: string;
  category: string;
  provider: string;
  external_link: string | null;
  display_order: number;
  status: string;
  status_source: string;
  status_message: string;
  last_checked_at: string;
  override_active: boolean;
  override_at: string | null;
  override_by: string | null;
  status_since: string | null;
  affected_by: DependencyImpact[];
  upcoming_maintenance: UpcomingMaintenance | null;
}

export interface Category {
  slug: string;
  display_name: string;
  display_order: number;
  description?: string;
}

export interface ServicesResponse {
  services: Service[];
  services_by_category: {
    [category: string]: Service[];
  };
  categories: Category[];
  overall_status: string;
  last_updated: string;
}

export async function getServices(): Promise<ServicesResponse> {
  const response = await adminApi.get(`${API_URL}/api/services`);
  return response.data;
}

export interface UptimeDay {
  date: string;
  status: 'operational' | 'degraded' | 'outage' | 'maintenance' | 'unknown' | 'no_data';
  impacted_seconds: number;
}

interface UptimeResponse {
  service_id: string;
  days: number;
  uptime_percent: number | null;
  daily: UptimeDay[];
}

export async function getUptime(serviceId: string, days: number = 90): Promise<UptimeResponse> {
  const response = await adminApi.get(`${API_URL}/api/services/${serviceId}/uptime`, {
    params: { days },
  });
  return response.data;
}

interface IncidentUpdate {
  id: string;
  status: 'investigating' | 'identified' | 'monitoring' | 'resolved';
  message: string;
  created_at: string;
}

export interface Incident {
  id: string;
  service_id: string;
  service_name: string;
  title: string;
  description: string | null;
  impact: 'minor' | 'major' | 'critical';
  status: 'investigating' | 'identified' | 'monitoring' | 'resolved';
  source: 'automated' | 'manual';
  auto_created: boolean;
  started_at: string;
  resolved_at: string | null;
  updated_at: string;
  duration_minutes: number;
  updates: IncidentUpdate[];
}

interface IncidentsResponse {
  incidents: Incident[];
  total: number;
}

export async function getIncidents(status: 'active' | 'resolved' | 'all' = 'all', limit = 30, offset = 0): Promise<IncidentsResponse> {
  const response = await adminApi.get(`${API_URL}/api/incidents`, {
    params: { status, limit, offset },
  });
  return response.data;
}

export async function getIncident(id: string): Promise<Incident> {
  const response = await adminApi.get(`${API_URL}/api/incidents/${id}`);
  return response.data;
}

export interface SubscribeResponse {
  success: boolean;
  message: string;
}

export async function subscribe(email: string, service_ids: string[] = [], turnstileToken?: string): Promise<SubscribeResponse> {
  const response = await adminApi.post(`${API_URL}/api/subscriptions`, {
    email,
    service_ids,
    turnstileToken,
  });
  return response.data;
}
