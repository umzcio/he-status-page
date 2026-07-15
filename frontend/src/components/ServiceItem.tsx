'use client';

import React, { memo, useState } from 'react';
import { Service } from '../lib/api';
import { formatDuration } from '../lib/duration';
import UptimeBar from './UptimeBar';
import styles from './ServiceItem.module.css';

function formatDateShort(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

interface ServiceItemProps {
  service: Service;
}

function ServiceItem({ service }: ServiceItemProps) {
  const [expanded, setExpanded] = useState(false);
  const statusClass = service.status || 'unknown';
  const hasImpact = service.affected_by && service.affected_by.length > 0;
  const isNonOperational = service.status && service.status !== 'operational' && service.status !== 'unknown';
  const ongoingDuration = isNonOperational ? formatDuration(service.status_since) : '';

  return (
    <div className={styles.item}>
      <div className={styles.row}>
        <button
          type="button"
          className={styles.expandButton}
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          aria-label={`${expanded ? 'Hide' : 'Show'} 90-day uptime for ${service.name}`}
        >
          <svg
            className={`${styles.chevron} ${expanded ? styles.chevronOpen : ''}`}
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
          </svg>
        </button>
        <div className={styles.left}>
          <span
            className={`${styles.indicator} ${styles[statusClass]}`}
            aria-hidden="true"
          ></span>
          <div className={styles.info}>
            <div className={styles.name}>{service.name}</div>
            <div className={styles.description}>
              {service.status === 'operational' || service.status === 'unknown'
                ? service.description
                : service.status_message || service.description}
            </div>
            {hasImpact && (
              <div className={styles.dependencyWarning} role="alert">
                May be affected by {service.affected_by.map(d => d.name).join(', ')} {service.affected_by.length === 1 ? 'issue' : 'issues'}
              </div>
            )}
            {service.upcoming_maintenance && service.status !== 'maintenance' && (
              <div className={styles.maintenanceNotice}>
                Scheduled maintenance: {service.upcoming_maintenance.title}
                {' · '}
                {formatDateShort(service.upcoming_maintenance.scheduled_start)}
                {' – '}
                {formatDateShort(service.upcoming_maintenance.scheduled_end)}
              </div>
            )}
          </div>
        </div>
        <div className={styles.right}>
          <div className={styles.statusBlock}>
            <span className={`${styles.statusText} ${styles[statusClass]}`}>
              {service.status.charAt(0).toUpperCase() + service.status.slice(1)}
            </span>
            {ongoingDuration && (
              <span className={styles.duration} title={`Ongoing since ${new Date(service.status_since!).toLocaleString()}`}>
                for {ongoingDuration}
              </span>
            )}
          </div>
          {service.external_link && (
            <a
              href={service.external_link}
              className={styles.externalLink}
              aria-label={`View ${service.name} status page (opens in new tab)`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          )}
        </div>
      </div>
      {expanded && (
        <div className={styles.expanded}>
          <UptimeBar serviceId={service.id} days={90} />
        </div>
      )}
    </div>
  );
}

export default memo(ServiceItem);
