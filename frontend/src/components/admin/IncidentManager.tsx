'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../lib/auth';
import {
  getAdminIncidents, getAdminIncident, createIncident, postIncidentUpdate,
  patchIncident, deleteIncident, getAdminServices,
  AdminIncidentSummary, AdminIncidentDetail, AdminService,
} from '../../lib/adminApi';
import { apiErrorText, errorMessage } from '../../lib/errors';
import styles from './IncidentManager.module.css';

const STATUS_OPTIONS = ['investigating', 'identified', 'monitoring', 'resolved'] as const;
const IMPACT_OPTIONS = ['minor', 'major', 'critical'] as const;

function formatDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

function formatDuration(minutes: number): string {
  if (minutes < 1) return '< 1 min';
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = minutes / 60;
  if (hours < 24) {
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

export default function IncidentManager() {
  const { isAuthenticated } = useAuth();
  const [incidents, setIncidents] = useState<AdminIncidentSummary[]>([]);
  const [services, setServices] = useState<AdminService[]>([]);
  const [filter, setFilter] = useState<'all' | 'active' | 'resolved'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  // Reset to the loading state during render when the filter changes, avoiding a
  // synchronous setState inside the effect.
  const [prevFilter, setPrevFilter] = useState(filter);
  if (filter !== prevFilter) {
    setPrevFilter(filter);
    setLoading(true);
    setError(null);
  }

  // Reusable incident reload for event handlers (after create/close).
  const reloadIncidents = useCallback(async () => {
    if (!isAuthenticated) return;
    setLoading(true);
    setError(null);
    try {
      const res = await getAdminIncidents(filter, 100);
      setIncidents(res.incidents);
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

  // Load incidents on mount and whenever the filter changes.
  useEffect(() => {
    if (!isAuthenticated) return;
    let active = true;
    getAdminIncidents(filter, 100)
      .then(res => { if (active) setIncidents(res.incidents); })
      .catch(err => { if (active) setError(errorMessage(err) ?? 'Failed to load'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [isAuthenticated, filter]);

  return (
    <div className={styles.container}>
      <div className={styles.headerRow}>
        <div>
          <h2 className={styles.heading}>Incidents</h2>
          <p className={styles.subtitle}>Manage public incident reports and post status updates.</p>
        </div>
        <button className={styles.primaryBtn} onClick={() => setShowCreate(true)}>
          + New Incident
        </button>
      </div>

      <div className={styles.filterRow} role="tablist">
        {(['all', 'active', 'resolved'] as const).map(f => (
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
      {loading && <div className={styles.empty}>Loading…</div>}

      {!loading && incidents.length === 0 && (
        <div className={styles.empty}>No incidents found.</div>
      )}

      {!loading && incidents.length > 0 && (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Title</th>
              <th>Service</th>
              <th>Impact</th>
              <th>Status</th>
              <th>Started</th>
              <th>Duration</th>
              <th>Source</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {incidents.map(inc => (
              <tr key={inc.id} className={inc.resolved_at ? styles.resolved : ''}>
                <td className={styles.titleCell}>
                  <button className={styles.linkBtn} onClick={() => setSelectedId(inc.id)}>
                    {inc.title}
                  </button>
                  {!inc.visible && <span className={styles.hiddenBadge} title="Not visible publicly">Hidden</span>}
                </td>
                <td>{inc.service_name}</td>
                <td>
                  <span className={`${styles.impactBadge} ${styles[`impact_${inc.impact}`]}`}>
                    {inc.impact}
                  </span>
                </td>
                <td>
                  <span className={`${styles.statusBadge} ${styles[`status_${inc.status}`]}`}>
                    {inc.status}
                  </span>
                </td>
                <td>{formatDate(inc.started_at)}</td>
                <td>{formatDuration(inc.duration_minutes)}</td>
                <td>{inc.auto_created ? 'Auto' : 'Manual'}</td>
                <td>
                  <button className={styles.iconBtn} onClick={() => setSelectedId(inc.id)}>Manage</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showCreate && (
        <CreateIncidentDialog
          services={services}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); reloadIncidents(); }}
        />
      )}

      {selectedId && (
        <IncidentDetailDialog
          incidentId={selectedId}
          onClose={() => { setSelectedId(null); reloadIncidents(); }}
        />
      )}
    </div>
  );
}

function CreateIncidentDialog({ services, onClose, onCreated }: {
  services: AdminService[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const { isAuthenticated } = useAuth();
  const [serviceId, setServiceId] = useState('');
  const [title, setTitle] = useState('');
  const [impact, setImpact] = useState<typeof IMPACT_OPTIONS[number]>('minor');
  const [status, setStatus] = useState<typeof STATUS_OPTIONS[number]>('investigating');
  const [message, setMessage] = useState('');
  const [visible, setVisible] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAuthenticated || !serviceId || !title) return;
    setSubmitting(true);
    setErr(null);
    try {
      await createIncident({
        service_id: serviceId, title, impact, status,
        initial_message: message || undefined, visible,
      });
      onCreated();
    } catch (error) {
      setErr(apiErrorText(error) || errorMessage(error) || 'Failed to create');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.dialogOverlay} onClick={onClose}>
      <div className={styles.dialog} onClick={e => e.stopPropagation()} role="dialog" aria-labelledby="create-inc-title">
        <h3 id="create-inc-title" className={styles.dialogTitle}>Create Incident</h3>
        <form onSubmit={submit} className={styles.form}>
          <label>
            Service
            <select
              value={serviceId}
              onChange={e => {
                setServiceId(e.target.value);
                // Default to the service's own visibility: hidden services get hidden incidents.
                setVisible(services.find(s => s.id === e.target.value)?.visible !== false);
              }}
              required
            >
              <option value="">— select —</option>
              {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label>
            Title
            <input value={title} onChange={e => setTitle(e.target.value)} required maxLength={255} />
          </label>
          <div className={styles.formRow}>
            <label>
              Impact
              <select value={impact} onChange={e => setImpact(e.target.value as typeof IMPACT_OPTIONS[number])}>
                {IMPACT_OPTIONS.map(i => <option key={i} value={i}>{i}</option>)}
              </select>
            </label>
            <label>
              Status
              <select value={status} onChange={e => setStatus(e.target.value as typeof STATUS_OPTIONS[number])}>
                {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
          </div>
          <label>
            Initial update message
            <textarea value={message} onChange={e => setMessage(e.target.value)} rows={4} maxLength={2000}
              placeholder="What is happening? What are you doing about it?" />
          </label>
          <label className={styles.checkbox}>
            <input type="checkbox" checked={visible} onChange={e => setVisible(e.target.checked)} />
            Visible to the public
          </label>
          {err && <div className={styles.error}>{err}</div>}
          <div className={styles.dialogActions}>
            <button type="button" onClick={onClose} className={styles.secondaryBtn}>Cancel</button>
            <button type="submit" disabled={submitting} className={styles.primaryBtn}>
              {submitting ? 'Creating…' : 'Create Incident'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function IncidentDetailDialog({ incidentId, onClose }: { incidentId: string; onClose: () => void }) {
  const { isAuthenticated } = useAuth();
  const [incident, setIncident] = useState<AdminIncidentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [updateStatus, setUpdateStatus] = useState<typeof STATUS_OPTIONS[number]>('investigating');
  const [updateMessage, setUpdateMessage] = useState('');
  const [posting, setPosting] = useState(false);

  // Reusable reload for event handlers (after posting an update / toggling).
  const load = useCallback(async () => {
    if (!isAuthenticated) return;
    setLoading(true);
    try {
      const data = await getAdminIncident(incidentId);
      setIncident(data);
      setUpdateStatus(data.status);
    } catch (error) {
      setErr(errorMessage(error) ?? 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, incidentId]);

  useEffect(() => {
    if (!isAuthenticated) return;
    let active = true;
    getAdminIncident(incidentId)
      .then(data => { if (!active) return; setIncident(data); setUpdateStatus(data.status); })
      .catch(error => { if (active) setErr(errorMessage(error) ?? 'Failed to load'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [isAuthenticated, incidentId]);

  const post = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAuthenticated || !updateMessage.trim()) return;
    setPosting(true);
    setErr(null);
    try {
      await postIncidentUpdate(incidentId, { status: updateStatus, message: updateMessage });
      setUpdateMessage('');
      await load();
    } catch (error) {
      setErr(apiErrorText(error) || errorMessage(error) || 'Failed to post update');
    } finally {
      setPosting(false);
    }
  };

  const toggleVisible = async () => {
    if (!isAuthenticated || !incident) return;
    try {
      await patchIncident(incidentId, { visible: !incident.visible });
      await load();
    } catch (error) {
      setErr(apiErrorText(error) || errorMessage(error) || 'Failed to update');
    }
  };

  const remove = async () => {
    if (!isAuthenticated) return;
    if (!confirm('Delete this incident and its updates? This cannot be undone.')) return;
    try {
      await deleteIncident(incidentId);
      onClose();
    } catch (error) {
      setErr(apiErrorText(error) || errorMessage(error) || 'Failed to delete');
    }
  };

  return (
    <div className={styles.dialogOverlay} onClick={onClose}>
      <div className={`${styles.dialog} ${styles.dialogLarge}`} onClick={e => e.stopPropagation()} role="dialog">
        {loading && <div className={styles.empty}>Loading…</div>}
        {!loading && incident && (
          <>
            <div className={styles.detailHeader}>
              <div>
                <h3 className={styles.dialogTitle}>{incident.title}</h3>
                <div className={styles.detailMeta}>
                  <span className={`${styles.impactBadge} ${styles[`impact_${incident.impact}`]}`}>
                    {incident.impact}
                  </span>
                  <span className={`${styles.statusBadge} ${styles[`status_${incident.status}`]}`}>
                    {incident.status}
                  </span>
                  <span>{incident.service_name}</span>
                  <span>·</span>
                  <span>Started {formatDate(incident.started_at)}</span>
                  {incident.resolved_at && <><span>·</span><span>Resolved {formatDate(incident.resolved_at)}</span></>}
                </div>
              </div>
              <button className={styles.iconBtn} onClick={onClose} aria-label="Close">×</button>
            </div>

            <div className={styles.detailActions}>
              <button onClick={toggleVisible} className={styles.secondaryBtn}>
                {incident.visible ? 'Hide from public' : 'Show to public'}
              </button>
              <button onClick={remove} className={styles.dangerBtn}>Delete</button>
            </div>

            <h4 className={styles.sectionHeading}>Post Update</h4>
            <form onSubmit={post} className={styles.form}>
              <div className={styles.formRow}>
                <label>
                  New status
                  <select value={updateStatus} onChange={e => setUpdateStatus(e.target.value as typeof STATUS_OPTIONS[number])}>
                    {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
              </div>
              <label>
                Message
                <textarea value={updateMessage} onChange={e => setUpdateMessage(e.target.value)} rows={3}
                  required maxLength={2000} placeholder="Update for the public timeline…" />
              </label>
              {err && <div className={styles.error}>{err}</div>}
              <button type="submit" disabled={posting} className={styles.primaryBtn}>
                {posting ? 'Posting…' : 'Post Update'}
              </button>
            </form>

            <h4 className={styles.sectionHeading}>Timeline ({incident.updates.length})</h4>
            <ol className={styles.timeline}>
              {[...incident.updates].reverse().map(u => (
                <li key={u.id} className={styles.timelineItem}>
                  <div className={styles.timelineHeader}>
                    <span className={`${styles.statusBadge} ${styles[`status_${u.status}`]}`}>{u.status}</span>
                    <span className={styles.timelineTime}>
                      {formatDate(u.created_at)}
                      {u.created_by_name && <> · by {u.created_by_name}</>}
                    </span>
                  </div>
                  <p className={styles.timelineMessage}>{u.message}</p>
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
    </div>
  );
}
