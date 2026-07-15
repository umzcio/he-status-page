'use client';

import React, { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { getIncidents, Incident } from '../lib/api';
import { formatDuration } from '../lib/duration';
import styles from './ActiveIncidents.module.css';

function impactLabel(impact: string): string {
  return impact.charAt(0).toUpperCase() + impact.slice(1);
}

function statusLabel(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

interface ActiveIncidentsProps {
  onAnnounce?: (message: string) => void;
}

export default function ActiveIncidents({ onAnnounce }: ActiveIncidentsProps) {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);

  // Keep the latest callback in a ref so the polling effect stays mount-stable.
  const onAnnounceRef = useRef(onAnnounce);
  useEffect(() => {
    onAnnounceRef.current = onAnnounce;
  });
  const prevIdsRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchActive() {
      try {
        const result = await getIncidents('active', 10);
        if (!cancelled) {
          // Announce only incidents that are newly active since the last poll.
          const prevIds = prevIdsRef.current;
          if (prevIds) {
            const newOnes = result.incidents.filter(inc => !prevIds.has(inc.id));
            if (newOnes.length > 0) {
              onAnnounceRef.current?.(
                newOnes.map(inc => `New active incident: ${inc.title}`).join('. ') + '.'
              );
            }
          }
          prevIdsRef.current = new Set(result.incidents.map(inc => inc.id));
          setIncidents(result.incidents);
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    }
    fetchActive();
    const interval = setInterval(fetchActive, 60000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  if (loading || incidents.length === 0) return null;

  return (
    <section className={styles.section} aria-labelledby="active-incidents-heading">
      <h2 id="active-incidents-heading" className={styles.heading}>
        Active Incidents
      </h2>
      <ul className={styles.list}>
        {incidents.map(inc => {
          const latestUpdate = inc.updates[inc.updates.length - 1];
          return (
            <li key={inc.id} className={`${styles.item} ${styles[`impact_${inc.impact}`]}`}>
              <div className={styles.itemHeader}>
                <span className={`${styles.badge} ${styles[`impact_${inc.impact}`]}`}>
                  {impactLabel(inc.impact)}
                </span>
                <span className={`${styles.statusBadge} ${styles[`status_${inc.status}`]}`}>
                  {statusLabel(inc.status)}
                </span>
                <span className={styles.duration} title={`Started ${new Date(inc.started_at).toLocaleString()}`}>
                  Ongoing for {formatDuration(inc.started_at)}
                </span>
              </div>
              <Link href={`/incidents/${inc.id}`} className={styles.title}>
                {inc.title}
              </Link>
              <div className={styles.serviceName}>{inc.service_name}</div>
              {latestUpdate && (
                <div className={styles.latestUpdate}>
                  <strong>{statusLabel(latestUpdate.status)}:</strong> {latestUpdate.message}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <Link href="/incidents" className={styles.viewAll}>
        View incident history →
      </Link>
    </section>
  );
}
