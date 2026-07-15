'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../lib/auth';
import {
  getMaintenances, createMaintenance, cancelMaintenance, cancelMaintenanceSeries,
  getAdminServices, PlannedMaintenance, AdminService,
} from '../../lib/adminApi';
import { apiErrorText, errorMessage } from '../../lib/errors';
import styles from './IncidentManager.module.css';

type FilterState = 'upcoming' | 'completed' | 'all';

const RECURRENCE_LABELS: Record<string, string> = {
  once: 'One-time',
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
};

const STATUS_PARAM: Record<FilterState, string> = {
  upcoming: 'scheduled,active',
  completed: 'completed,cancelled',
  all: 'scheduled,active,completed,cancelled',
};

function formatDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

// --- Create Dialog ---

interface CreateDialogProps {
  services: AdminService[];
  onCreated: () => void;
  onCancel: () => void;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function computeFirstOccurrence(
  recurrenceType: 'daily' | 'weekly' | 'monthly',
  startTime: string,
  endTime: string,
  dayOfWeek: number,
  dayOfMonth: number,
): { startISO: string; endISO: string } {
  const [startH, startM] = startTime.split(':').map(Number);
  const [endH, endM] = endTime.split(':').map(Number);
  const now = new Date();

  let startDate: Date;
  if (recurrenceType === 'daily') {
    startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), startH, startM);
    if (startDate <= now) startDate.setDate(startDate.getDate() + 1);
  } else if (recurrenceType === 'weekly') {
    const todayDow = now.getDay();
    let daysUntil = (dayOfWeek - todayDow + 7) % 7;
    if (daysUntil === 0) {
      const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), startH, startM);
      if (candidate <= now) daysUntil = 7;
    }
    startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysUntil, startH, startM);
  } else {
    // Clamp the requested day-of-month to the target month's length BEFORE
    // constructing the date. `new Date(y, m, 31)` rolls over into the next month
    // in short months (e.g. Feb 31 -> Mar 3), which then corrupts the subsequent
    // month arithmetic; clamping first keeps the occurrence in the intended month.
    const clampedDay = (y: number, m: number) =>
      Math.min(dayOfMonth, new Date(y, m + 1, 0).getDate());
    let y = now.getFullYear();
    let m = now.getMonth();
    startDate = new Date(y, m, clampedDay(y, m), startH, startM);
    if (startDate <= now) {
      m += 1;
      if (m > 11) { m = 0; y += 1; }
      startDate = new Date(y, m, clampedDay(y, m), startH, startM);
    }
  }

  const endDate = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate(), endH, endM);
  if (endDate <= startDate) endDate.setDate(endDate.getDate() + 1);

  return { startISO: startDate.toISOString(), endISO: endDate.toISOString() };
}

function CreateDialog({ services, onCreated, onCancel }: CreateDialogProps) {
  const [serviceId, setServiceId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [recurrenceType, setRecurrenceType] = useState<'once' | 'daily' | 'weekly' | 'monthly'>('once');
  // once-only fields
  const [scheduledStart, setScheduledStart] = useState('');
  const [scheduledEnd, setScheduledEnd] = useState('');
  // recurring fields
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [dayOfWeek, setDayOfWeek] = useState(1); // Monday
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [announce, setAnnounce] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!serviceId) return setError('Select a service');

    let startISO: string;
    let endISO: string;
    let recurDow: number | undefined;
    let recurDom: number | undefined;

    if (recurrenceType === 'once') {
      if (!scheduledStart || !scheduledEnd) return setError('Start and end times are required');
      if (new Date(scheduledEnd) <= new Date(scheduledStart)) return setError('End time must be after start time');
      startISO = new Date(scheduledStart).toISOString();
      endISO = new Date(scheduledEnd).toISOString();
    } else {
      if (!startTime || !endTime) return setError('Start and end times are required');
      if (startTime === endTime) return setError('End time must differ from start time');
      if (recurrenceType === 'weekly') recurDow = dayOfWeek;
      if (recurrenceType === 'monthly') recurDom = dayOfMonth;
      const computed = computeFirstOccurrence(recurrenceType, startTime, endTime, dayOfWeek, dayOfMonth);
      startISO = computed.startISO;
      endISO = computed.endISO;
    }

    setSaving(true);
    try {
      await createMaintenance({
        service_id: serviceId,
        title,
        description: description || undefined,
        scheduled_start: startISO,
        scheduled_end: endISO,
        recurrence_type: recurrenceType,
        recurrence_day_of_week: recurDow,
        recurrence_day_of_month: recurDom,
        announce,
      });
      onCreated();
    } catch (err) {
      setError(apiErrorText(err) || 'Failed to create');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.dialogOverlay} role="dialog" aria-modal="true" aria-labelledby="create-maint-title">
      <div className={styles.dialog}>
        <h2 className={styles.dialogTitle} id="create-maint-title">Schedule Maintenance</h2>
        {error && <div className={styles.error}>{error}</div>}
        <form onSubmit={handleSubmit} className={styles.form}>
          <label>
            Service <span style={{ color: '#b91c1c' }}>*</span>
            <select value={serviceId} onChange={e => setServiceId(e.target.value)} required>
              <option value="">— Select service —</option>
              {services.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>
          <label>
            Title <span style={{ color: '#b91c1c' }}>*</span>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Network switch replacement"
              required
            />
          </label>
          <label>
            Public Description <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>(optional)</span>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Details shown on the status dashboard"
              rows={2}
            />
          </label>
          <label>
            Recurrence
            <select
              value={recurrenceType}
              onChange={e => setRecurrenceType(e.target.value as 'once' | 'daily' | 'weekly' | 'monthly')}
            >
              <option value="once">One-time</option>
              <option value="daily">Daily (same time each day)</option>
              <option value="weekly">Weekly (same day of week)</option>
              <option value="monthly">Monthly (same day of month)</option>
            </select>
          </label>

          {recurrenceType === 'once' && (
            <div className={styles.formRow}>
              <label>
                Starts At <span style={{ color: '#b91c1c' }}>*</span>
                <input
                  type="datetime-local"
                  value={scheduledStart}
                  onChange={e => setScheduledStart(e.target.value)}
                  required
                />
              </label>
              <label>
                Ends At <span style={{ color: '#b91c1c' }}>*</span>
                <input
                  type="datetime-local"
                  value={scheduledEnd}
                  onChange={e => setScheduledEnd(e.target.value)}
                  required
                />
              </label>
            </div>
          )}

          {recurrenceType === 'weekly' && (
            <label>
              Day of Week <span style={{ color: '#b91c1c' }}>*</span>
              <select value={dayOfWeek} onChange={e => setDayOfWeek(Number(e.target.value))}>
                {DAY_NAMES.map((name, i) => (
                  <option key={i} value={i}>{name}</option>
                ))}
              </select>
            </label>
          )}

          {recurrenceType === 'monthly' && (
            <label>
              Day of Month <span style={{ color: '#b91c1c' }}>*</span>
              <select value={dayOfMonth} onChange={e => setDayOfMonth(Number(e.target.value))}>
                {Array.from({ length: 31 }, (_, i) => i + 1).map(d => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </label>
          )}

          {recurrenceType !== 'once' && (
            <div className={styles.formRow}>
              <label>
                Start Time <span style={{ color: '#b91c1c' }}>*</span>
                <input
                  type="time"
                  value={startTime}
                  onChange={e => setStartTime(e.target.value)}
                  required
                />
              </label>
              <label>
                End Time <span style={{ color: '#b91c1c' }}>*</span>
                <input
                  type="time"
                  value={endTime}
                  onChange={e => setEndTime(e.target.value)}
                  required
                />
              </label>
            </div>
          )}

          <label style={{ flexDirection: 'row', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={announce}
              onChange={e => setAnnounce(e.target.checked)}
              style={{ width: 'auto', margin: 0 }}
            />
            <span>
              Announce
              <span style={{ marginLeft: '0.375rem', fontSize: '0.75rem', color: '#6b7280' }}>
                (show advance notice and highlight in uptime graph)
              </span>
            </span>
          </label>

          <div className={styles.dialogActions}>
            <button type="button" className={styles.secondaryBtn} onClick={onCancel} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className={styles.primaryBtn} disabled={saving}>
              {saving ? 'Scheduling…' : 'Schedule Maintenance'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// --- Detail Dialog ---

interface DetailDialogProps {
  maintenance: PlannedMaintenance;
  onClose: () => void;
  onCancelled: () => void;
}

function DetailDialog({ maintenance: m, onClose, onCancelled }: DetailDialogProps) {
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState('');
  const isRecurring = m.recurrence_type !== 'once';
  const canCancel = m.status === 'scheduled' || m.status === 'active';

  async function handleCancelOne() {
    if (!confirm(`Cancel this occurrence of "${m.title}"?`)) return;
    setCancelling(true);
    try {
      await cancelMaintenance(m.id);
      onCancelled();
    } catch (err) {
      setError(apiErrorText(err) || 'Failed to cancel');
      setCancelling(false);
    }
  }

  async function handleCancelSeries() {
    if (!confirm(`Cancel all future scheduled occurrences of "${m.title}"?`)) return;
    setCancelling(true);
    try {
      await cancelMaintenanceSeries(m.id);
      onCancelled();
    } catch (err) {
      setError(apiErrorText(err) || 'Failed to cancel series');
      setCancelling(false);
    }
  }

  const statusColors: Record<string, string> = {
    scheduled: '#1d4ed8',
    active: '#b45309',
    completed: '#166534',
    cancelled: '#6b7280',
  };

  return (
    <div className={styles.dialogOverlay} role="dialog" aria-modal="true" aria-labelledby="detail-maint-title">
      <div className={styles.dialog}>
        <div className={styles.detailHeader}>
          <div>
            <h2 className={styles.dialogTitle} id="detail-maint-title">{m.title}</h2>
            <div className={styles.detailMeta}>
              <span
                className={styles.statusBadge}
                style={{ background: '#f3f4f6', color: statusColors[m.status] || '#374151' }}
              >
                {m.status}
              </span>
              <span>{m.service_name}</span>
              <span>{RECURRENCE_LABELS[m.recurrence_type]}</span>
            </div>
          </div>
          <button className={styles.iconBtn} onClick={onClose} aria-label="Close">×</button>
        </div>

        {error && <div className={styles.error}>{error}</div>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.875rem', marginBottom: '1rem' }}>
          <div><strong>Start:</strong> {formatDate(m.scheduled_start)}</div>
          <div><strong>End:</strong> {formatDate(m.scheduled_end)}</div>
          {m.description && <div><strong>Description:</strong> {m.description}</div>}
          <div>
            <strong>Announce:</strong>{' '}
            {m.announce
              ? 'Yes — advance notice and uptime highlight shown publicly'
              : 'No — silent maintenance, not visible on public dashboard'}
          </div>
          {m.created_by_name && <div><strong>Created by:</strong> {m.created_by_name}</div>}
          {m.activated_at && <div><strong>Activated:</strong> {formatDate(m.activated_at)}</div>}
          {m.completed_at && <div><strong>Completed:</strong> {formatDate(m.completed_at)}</div>}
        </div>

        {canCancel && (
          <div style={{ display: 'flex', gap: '0.625rem', flexWrap: 'wrap' }}>
            <button
              className={styles.dangerBtn}
              onClick={handleCancelOne}
              disabled={cancelling}
            >
              Cancel this occurrence
            </button>
            {isRecurring && (
              <button
                className={styles.dangerBtn}
                onClick={handleCancelSeries}
                disabled={cancelling}
              >
                Cancel all future occurrences
              </button>
            )}
          </div>
        )}

        <div className={styles.dialogActions}>
          <button className={styles.secondaryBtn} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// --- Main Component ---

export default function MaintenanceManager() {
  const { isAuthenticated } = useAuth();
  const [maintenances, setMaintenances] = useState<PlannedMaintenance[]>([]);
  const [services, setServices] = useState<AdminService[]>([]);
  const [filter, setFilter] = useState<FilterState>('upcoming');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<PlannedMaintenance | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  // Reset to the loading state during render when the filter changes, avoiding a
  // synchronous setState inside the effect.
  const [prevFilter, setPrevFilter] = useState(filter);
  if (filter !== prevFilter) {
    setPrevFilter(filter);
    setLoading(true);
    setError(null);
  }

  // Reusable maintenance reload for event handlers (after create/cancel).
  const reloadMaintenances = useCallback(async () => {
    if (!isAuthenticated) return;
    setLoading(true);
    setError(null);
    try {
      const res = await getMaintenances({ status: STATUS_PARAM[filter] });
      setMaintenances(res.maintenances);
    } catch (err) {
      setError(errorMessage(err) ?? 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, filter]);

  // Load the service list once; it only feeds the create dialog's dropdown.
  useEffect(() => {
    if (!isAuthenticated) return;
    let active = true;
    getAdminServices()
      .then(res => { if (active) setServices(res.services); })
      .catch(err => { if (active) setError(errorMessage(err) ?? 'Failed to load'); });
    return () => { active = false; };
  }, [isAuthenticated]);

  // Load maintenance records on mount and whenever the filter changes.
  useEffect(() => {
    if (!isAuthenticated) return;
    let active = true;
    getMaintenances({ status: STATUS_PARAM[filter] })
      .then(res => { if (active) setMaintenances(res.maintenances); })
      .catch(err => { if (active) setError(errorMessage(err) ?? 'Failed to load'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [isAuthenticated, filter]);

  const statusBadgeStyle = (status: string) => {
    const colors: Record<string, { bg: string; color: string }> = {
      scheduled: { bg: '#dbeafe', color: '#1d4ed8' },
      active:    { bg: '#fef3c7', color: '#b45309' },
      completed: { bg: '#dcfce7', color: '#166534' },
      cancelled: { bg: '#f3f4f6', color: '#6b7280' },
    };
    return colors[status] || { bg: '#f3f4f6', color: '#374151' };
  };

  return (
    <div className={styles.container}>
      <div className={styles.headerRow}>
        <div>
          <h2 className={styles.heading}>Planned Maintenance</h2>
          <p className={styles.subtitle}>
            Schedule maintenance windows in advance. Polling pauses and the dashboard shows maintenance status during the window.
          </p>
        </div>
        <button className={styles.primaryBtn} onClick={() => setShowCreate(true)}>
          + Schedule Maintenance
        </button>
      </div>

      <div className={styles.filterRow} role="tablist">
        {(['upcoming', 'completed', 'all'] as FilterState[]).map(f => (
          <button
            key={f}
            role="tab"
            aria-selected={filter === f}
            className={`${styles.filterBtn} ${filter === f ? styles.filterBtnActive : ''}`}
            onClick={() => setFilter(f)}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {loading ? (
        <div className={styles.empty}>Loading…</div>
      ) : maintenances.length === 0 ? (
        <div className={styles.empty}>
          {filter === 'upcoming' ? 'No upcoming maintenance windows scheduled.' : 'No records found.'}
        </div>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Title</th>
              <th>Service</th>
              <th>Starts</th>
              <th>Ends</th>
              <th>Recurrence</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {maintenances.map(m => {
              const { bg, color } = statusBadgeStyle(m.status);
              return (
                <tr key={m.id}>
                  <td>
                    <button className={styles.linkBtn} onClick={() => setSelected(m)}>
                      {m.title}
                    </button>
                    {!m.announce && (
                      <span style={{
                        marginLeft: '0.4rem', fontSize: '0.7rem', color: '#6b7280',
                        background: '#f3f4f6', borderRadius: '0.25rem', padding: '0.1rem 0.35rem',
                        verticalAlign: 'middle',
                      }}>
                        silent
                      </span>
                    )}
                  </td>
                  <td>{m.service_name}</td>
                  <td>{formatDate(m.scheduled_start)}</td>
                  <td>{formatDate(m.scheduled_end)}</td>
                  <td>{RECURRENCE_LABELS[m.recurrence_type]}</td>
                  <td>
                    <span className={styles.statusBadge} style={{ background: bg, color }}>
                      {m.status}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {showCreate && (
        <CreateDialog
          services={services}
          onCreated={() => { setShowCreate(false); reloadMaintenances(); }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {selected && (
        <DetailDialog
          maintenance={selected}
          onClose={() => setSelected(null)}
          onCancelled={() => { setSelected(null); reloadMaintenances(); }}
        />
      )}
    </div>
  );
}
