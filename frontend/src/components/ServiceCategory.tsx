'use client';

import React, { useState, useMemo } from 'react';
import { Service } from '../lib/api';
import ServiceItem from './ServiceItem';
import styles from './ServiceCategory.module.css';

interface ServiceCategoryProps {
  title: string;
  displayName?: string;
  services: Service[];
}

const categoryTitles: { [key: string]: string } = {
  'core': 'Core Applications',
  'academic': 'Academic & Student Services',
  'business': 'Business Systems',
  'banner': 'Banner',
  'infrastructure': 'Network & Infrastructure'
};

function getCategoryStatus(services: Service[]): string {
  if (services.some(s => s.status === 'outage')) return 'outage';
  if (services.some(s => s.status === 'degraded')) return 'degraded';
  if (services.some(s => s.status === 'maintenance')) return 'maintenance';
  if (services.some(s => s.status === 'unknown')) return 'unknown';
  return 'operational';
}

function getStatusLabel(status: string): string {
  switch (status) {
    case 'operational': return 'All Operational';
    case 'degraded': return 'Degraded';
    case 'outage': return 'Outage';
    case 'maintenance': return 'Maintenance';
    default: return 'Unknown';
  }
}

export default function ServiceCategory({ title, displayName, services }: ServiceCategoryProps) {
  const displayTitle = displayName || categoryTitles[title] || title;
  const categoryStatus = useMemo(() => getCategoryStatus(services), [services]);
  const hasIssue = categoryStatus !== 'operational';

  const [isOpen, setIsOpen] = useState(hasIssue);

  const issueCount = services.filter(s => s.status !== 'operational').length;

  return (
    <section className={styles.section}>
      <h2 className={styles.heading} id={`heading-${title}`}>
        <button
          className={`${styles.header} ${hasIssue ? styles.headerIssue : ''}`}
          onClick={() => setIsOpen(!isOpen)}
          aria-expanded={isOpen}
          aria-controls={`category-${title}`}
        >
          <div className={styles.headerLeft}>
            <span
              className={`${styles.indicator} ${styles[categoryStatus]}`}
              aria-hidden="true"
            />
            <span className={styles.title}>{displayTitle}</span>
            <span className={styles.count}>{services.length} services</span>
          </div>
          <div className={styles.headerRight}>
            {hasIssue && (
              <span className={`${styles.issuebadge} ${styles[categoryStatus]}`}>
                {issueCount} {issueCount === 1 ? 'issue' : 'issues'}
              </span>
            )}
            <span className={`${styles.statusLabel} ${styles[categoryStatus]}`}>
              {getStatusLabel(categoryStatus)}
            </span>
            <svg
              className={`${styles.chevron} ${isOpen ? styles.chevronOpen : ''}`}
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </button>
      </h2>
      <div
        id={`category-${title}`}
        className={`${styles.list} ${isOpen ? styles.listOpen : styles.listClosed}`}
        role="region"
        aria-labelledby={`heading-${title}`}
      >
        {services.map(service => (
          <ServiceItem key={service.id} service={service} />
        ))}
      </div>
    </section>
  );
}
