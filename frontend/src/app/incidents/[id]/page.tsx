'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import Header from '../../../components/Header';
import { getIncident, Incident } from '../../../lib/api';
import { formatDuration } from '../../../lib/duration';
import styles from './page.module.css';

const SITE_NAME = process.env.NEXT_PUBLIC_SITE_NAME || 'IT Status';

function statusLabel(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }
function impactLabel(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', second: '2-digit',
  });
}

function formatDurationFromMinutes(minutes: number): string {
  if (minutes < 1) return '< 1 minute';
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = minutes / 60;
  if (hours < 24) {
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  const days = Math.floor(hours / 24);
  const remHours = Math.floor(hours % 24);
  return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
}

export default function IncidentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [incident, setIncident] = useState<Incident | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Reset to the loading state during render whenever the incident id changes,
  // avoiding a synchronous setState inside the effect.
  const [prevId, setPrevId] = useState(id);
  if (id !== prevId) {
    setPrevId(id);
    setLoading(true);
  }

  useEffect(() => {
    getIncident(id)
      .then(inc => { setIncident(inc); setLoading(false); })
      .catch(err => { setError(err.message); setLoading(false); });
  }, [id]);

  useEffect(() => {
    document.title = incident
      ? `${incident.title} — ${SITE_NAME}`
      : `Incident — ${SITE_NAME}`;
  }, [incident]);

  if (loading) {
    return (
      <>
        <Header />
        <main id="main-content" className={styles.container}>
          <div className={styles.empty}>Loading…</div>
        </main>
      </>
    );
  }

  if (error || !incident) {
    return (
      <>
        <Header />
        <main id="main-content" className={styles.container}>
          <div className={styles.empty}>
            Incident not found.
            <p style={{ marginTop: '1rem' }}><Link href="/incidents" className={styles.back}>← Back to incidents</Link></p>
          </div>
        </main>
      </>
    );
  }

  const isResolved = !!incident.resolved_at;

  return (
    <>
      <Header />
      <main id="main-content" className={styles.container}>
        <p className={styles.breadcrumb}>
          <Link href="/incidents" className={styles.back}>← All incidents</Link>
        </p>

        <div className={styles.headerBlock}>
          <div className={styles.badges}>
            <span className={`${styles.badge} ${styles[`impact_${incident.impact}`]}`}>
              {impactLabel(incident.impact)}
            </span>
            <span className={`${styles.statusBadge} ${styles[`status_${incident.status}`]}`}>
              {statusLabel(incident.status)}
            </span>
            {incident.auto_created && (
              <span className={styles.autoBadge} title="Created automatically by status detection">Auto</span>
            )}
          </div>
          <h1 className={styles.title}>{incident.title}</h1>
          <p className={styles.serviceName}>Affected: <strong>{incident.service_name}</strong></p>

          <dl className={styles.metaList}>
            <div>
              <dt>Started</dt>
              <dd>{formatDate(incident.started_at)}</dd>
            </div>
            <div>
              <dt>{isResolved ? 'Resolved' : 'Status'}</dt>
              <dd>
                {isResolved
                  ? formatDate(incident.resolved_at!)
                  : <span className={styles.ongoing}>Ongoing for {formatDuration(incident.started_at)}</span>}
              </dd>
            </div>
            <div>
              <dt>Duration</dt>
              <dd>{formatDurationFromMinutes(incident.duration_minutes)}</dd>
            </div>
          </dl>
        </div>

        <section className={styles.timelineSection} aria-label="Incident timeline">
          <h2 className={styles.timelineHeading}>Updates</h2>
          <ol className={styles.timeline}>
            {[...incident.updates].reverse().map(update => (
              <li key={update.id} className={styles.timelineItem}>
                <div className={styles.timelineMarker}>
                  <span className={`${styles.timelineDot} ${styles[`status_${update.status}`]}`} aria-hidden="true" />
                </div>
                <div className={styles.timelineContent}>
                  <div className={styles.timelineHeader}>
                    <span className={`${styles.statusBadge} ${styles[`status_${update.status}`]}`}>
                      {statusLabel(update.status)}
                    </span>
                    <time dateTime={update.created_at} className={styles.timelineTime}>
                      {formatDate(update.created_at)}
                    </time>
                  </div>
                  <p className={styles.timelineMessage}>{update.message}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </main>
    </>
  );
}
