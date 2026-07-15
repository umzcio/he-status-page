'use client';

import React, { useEffect, useState } from 'react';
import { getUptime, UptimeDay } from '../lib/api';
import styles from './UptimeBar.module.css';

interface UptimeBarProps {
  serviceId: string;
  days?: number;
}

function formatDayLabel(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatImpactDuration(seconds: number): string {
  if (seconds < 60) return '< 1 min';
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hours < 24) return remMins > 0 ? `${hours}h ${remMins}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function dayLabel(day: UptimeDay): string {
  const base = formatDayLabel(day.date);
  switch (day.status) {
    case 'operational': return `${base} — Operational`;
    case 'degraded': return `${base} — Degraded (${formatImpactDuration(day.impacted_seconds)} impact)`;
    case 'outage': return `${base} — Outage (${formatImpactDuration(day.impacted_seconds)} impact)`;
    case 'maintenance': return `${base} — Maintenance`;
    case 'unknown': return `${base} — Unknown`;
    case 'no_data': return `${base} — No data`;
    default: return base;
  }
}

export default function UptimeBar({ serviceId, days = 90 }: UptimeBarProps) {
  const [data, setData] = useState<UptimeDay[] | null>(null);
  const [uptimePercent, setUptimePercent] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Reset to the loading state during render when the requested series changes,
  // avoiding a synchronous setState inside the effect.
  const seriesKey = `${serviceId}|${days}`;
  const [prevSeriesKey, setPrevSeriesKey] = useState(seriesKey);
  if (seriesKey !== prevSeriesKey) {
    setPrevSeriesKey(seriesKey);
    setLoading(true);
  }

  useEffect(() => {
    let cancelled = false;
    getUptime(serviceId, days)
      .then(res => {
        if (cancelled) return;
        setData(res.daily);
        setUptimePercent(res.uptime_percent);
        setLoading(false);
      })
      .catch(err => {
        if (cancelled) return;
        setError(err.message);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [serviceId, days]);

  if (loading) {
    return <div className={styles.loading} aria-label="Loading uptime data" />;
  }

  if (error || !data) {
    return null;
  }

  const firstDate = data.length > 0 ? formatDayLabel(data[0].date) : '';
  const lastDate = data.length > 0 ? formatDayLabel(data[data.length - 1].date) : '';

  return (
    <div className={styles.container}>
      <div className={styles.bar} role="img" aria-label={`${days}-day uptime: ${uptimePercent !== null ? uptimePercent.toFixed(2) + '% uptime' : 'data unavailable'}`}>
        {data.map((day, i) => (
          <span
            key={i}
            className={`${styles.day} ${styles[day.status]}`}
            title={dayLabel(day)}
          />
        ))}
      </div>
      <div className={styles.footer}>
        <span className={styles.dateLabel}>{firstDate}</span>
        <span className={styles.uptime}>
          {uptimePercent !== null ? `${uptimePercent.toFixed(2)}% uptime` : 'No data'}
        </span>
        <span className={styles.dateLabel}>{lastDate}</span>
      </div>
    </div>
  );
}
