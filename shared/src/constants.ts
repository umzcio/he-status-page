export const STATUS_VALUES = ['operational', 'degraded', 'outage', 'maintenance', 'unknown'] as const;
export type StatusValue = typeof STATUS_VALUES[number];

export const STATUS_COLORS: Record<StatusValue, string> = {
  operational: '#22c55e',
  degraded: '#f59e0b',
  outage: '#ef4444',
  maintenance: '#3b82f6',
  unknown: '#9ca3af',
};

export const STATUS_ICONS: Record<StatusValue, string> = {
  operational: '\u2705',
  degraded: '\u26a0\ufe0f',
  outage: '\u274c',
  maintenance: '\ud83d\udd27',
  unknown: '\u2753',
};

export const STATUS_LABELS: Record<StatusValue, string> = {
  operational: 'Operational',
  degraded: 'Degraded Performance',
  outage: 'Major Outage',
  maintenance: 'Under Maintenance',
  unknown: 'Unknown',
};
