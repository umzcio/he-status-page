'use client';

import React, { useState } from 'react';
import { Service } from '../lib/api';
import AdminServiceItem from './AdminServiceItem';
import styles from './AdminServiceCategory.module.css';

interface AdminServiceCategoryProps {
  categoryKey: string;
  title: string;
  services: Service[];
  onRefresh: () => void;
}

export default function AdminServiceCategory({ categoryKey, title, services, onRefresh }: AdminServiceCategoryProps) {
  const [isOpen, setIsOpen] = useState(true);

  const overrideCount = services.filter(s => s.override_active).length;

  return (
    <section className={styles.section}>
      <h2 className={styles.heading} id={`admin-heading-${categoryKey}`}>
        <button
          className={styles.header}
          onClick={() => setIsOpen(!isOpen)}
          aria-expanded={isOpen}
          aria-controls={`admin-category-${categoryKey}`}
        >
          <div className={styles.headerLeft}>
            <span className={styles.title}>{title}</span>
            <span className={styles.count}>{services.length} services</span>
            {overrideCount > 0 && (
              <span className={styles.overrideBadge}>
                {overrideCount} override{overrideCount !== 1 ? 's' : ''}
              </span>
            )}
          </div>
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
        </button>
      </h2>
      <div
        id={`admin-category-${categoryKey}`}
        className={`${styles.list} ${isOpen ? styles.listOpen : styles.listClosed}`}
        role="region"
        aria-labelledby={`admin-heading-${categoryKey}`}
      >
        {services.map(service => (
          <AdminServiceItem key={service.id} service={service} onRefresh={onRefresh} />
        ))}
      </div>
    </section>
  );
}
