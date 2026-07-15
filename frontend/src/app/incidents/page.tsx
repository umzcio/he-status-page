'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Header from '../../components/Header';
import { getIncidents, Incident } from '../../lib/api';
import { formatDuration } from '../../lib/duration';
import styles from './page.module.css';

const SITE_NAME = process.env.NEXT_PUBLIC_SITE_NAME || 'IT Status';

function impactLabel(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

function groupByDate(incidents: Incident[]): Map<string, Incident[]> {
  const groups = new Map<string, Incident[]>();
  for (const inc of incidents) {
    const day = new Date(inc.started_at).toLocaleDateString(undefined, {
      year: 'numeric', month: 'long', day: 'numeric',
    });
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day)!.push(inc);
  }
  return groups;
}

export default function IncidentsPage() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'active' | 'resolved'>('all');

  // Reset to the loading state during render whenever the filter changes, so the
  // spinner shows immediately without a synchronous setState inside the effect.
  const [prevFilter, setPrevFilter] = useState(filter);
  if (filter !== prevFilter) {
    setPrevFilter(filter);
    setLoading(true);
  }

  useEffect(() => {
    document.title = `Incident History — ${SITE_NAME}`;
  }, []);

  useEffect(() => {
    getIncidents(filter, 100)
      .then(res => { setIncidents(res.incidents); setLoading(false); })
      .catch(() => setLoading(false));
  }, [filter]);

  const groups = groupByDate(incidents);

  return (
    <>
      <Header />
      <main id="main-content" className={styles.container}>
        <div className={styles.headerRow}>
          <div>
            <h1 className={styles.title}>Incident History</h1>
            <p className={styles.subtitle}>
              <Link href="/" className={styles.back}>← Back to status</Link>
            </p>
          </div>
          <div className={styles.filters} role="group" aria-label="Filter incidents">
            {(['all', 'active', 'resolved'] as const).map(f => (
              <button
                key={f}
                type="button"
                aria-pressed={filter === f}
                className={`${styles.filterBtn} ${filter === f ? styles.filterBtnActive : ''}`}
                onClick={() => setFilter(f)}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {loading && <div className={styles.empty}>Loading…</div>}
        {!loading && incidents.length === 0 && (
          <div className={styles.empty}>No incidents to display.</div>
        )}

        {Array.from(groups.entries()).map(([day, dayIncidents]) => (
          <section key={day} className={styles.daySection}>
            <h2 className={styles.dayHeading}>{day}</h2>
            <ul className={styles.list}>
              {dayIncidents.map(inc => (
                <li key={inc.id} className={`${styles.item} ${styles[`impact_${inc.impact}`]}`}>
                  <div className={styles.itemTop}>
                    <Link href={`/incidents/${inc.id}`} className={styles.itemTitle}>
                      {inc.title}
                    </Link>
                    <span className={`${styles.badge} ${styles[`impact_${inc.impact}`]}`}>
                      {impactLabel(inc.impact)}
                    </span>
                  </div>
                  <div className={styles.itemMeta}>
                    <span>{inc.service_name}</span>
                    <span>·</span>
                    <span>{formatDate(inc.started_at)}</span>
                    <span>·</span>
                    {inc.resolved_at ? (
                      <span>Lasted {formatDuration(inc.started_at).replace(/^/, '')} (resolved)</span>
                    ) : (
                      <span className={styles.ongoing}>Ongoing for {formatDuration(inc.started_at)}</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </main>
    </>
  );
}
