'use client';

import React, { useEffect, useState } from 'react';
import AdminServiceCategory from './AdminServiceCategory';
import { getServices, ServicesResponse } from '../lib/api';
import { errorMessage } from '../lib/errors';
import styles from './AdminDashboard.module.css';

const fallbackCategoryTitles: { [key: string]: string } = {
  'core': 'Core Applications',
  'academic': 'Academic & Student Services',
  'business': 'Business Systems',
  'banner': 'Banner',
  'infrastructure': 'Network & Infrastructure'
};

export default function AdminDashboard() {
  const [data, setData] = useState<ServicesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  async function fetchData() {
    try {
      const result = await getServices();
      setData(result);
      setLastRefresh(new Date());
      setError(null);
    } catch (err) {
      setError(errorMessage(err) ?? 'Failed to load services');
    }
  }

  useEffect(() => {
    let active = true;
    // Initial load: apply results in the async callback (not synchronously in the
    // effect body) so we don't trip react-hooks/set-state-in-effect.
    getServices()
      .then(result => {
        if (!active) return;
        setData(result);
        setLastRefresh(new Date());
        setError(null);
      })
      .catch(err => { if (active) setError(errorMessage(err) ?? 'Failed to load services'); });
    const interval = setInterval(fetchData, 30000);
    return () => { active = false; clearInterval(interval); };
  }, []);

  const overrideCount = data
    ? data.services.filter(s => s.override_active).length
    : 0;

  const categoryOrder = data?.categories && data.categories.length > 0
    ? data.categories
    : [
        { slug: 'core', display_name: 'Core Applications', display_order: 1 },
        { slug: 'academic', display_name: 'Academic & Student Services', display_order: 2 },
        { slug: 'business', display_name: 'Business Systems', display_order: 3 },
        { slug: 'banner', display_name: 'Banner', display_order: 4 },
        { slug: 'infrastructure', display_name: 'Network & Infrastructure', display_order: 5 },
      ];

  return (
    <div className={styles.container}>
      <div className={styles.summaryBar}>
        <div className={styles.summaryItem}>
          <span className={styles.summaryLabel}>Active Overrides</span>
          <span className={`${styles.summaryValue} ${overrideCount > 0 ? styles.overrideActive : ''}`}>
            {overrideCount}
          </span>
        </div>
        <div className={styles.summaryItem}>
          <span className={styles.summaryLabel}>Last Refresh</span>
          <span className={styles.summaryValue}>
            {lastRefresh ? lastRefresh.toLocaleTimeString() : '—'}
          </span>
        </div>
        <button onClick={fetchData} className={styles.refreshBtn}>
          Refresh Now
        </button>
      </div>

      {error && (
        <div className={styles.error} role="alert">
          Failed to load services: {error}
        </div>
      )}

      {data && categoryOrder.map(cat => {
        const services = data.services_by_category[cat.slug] || [];
        if (services.length === 0) return null;
        return (
          <AdminServiceCategory
            key={cat.slug}
            categoryKey={cat.slug}
            title={cat.display_name || fallbackCategoryTitles[cat.slug] || cat.slug}
            services={services}
            onRefresh={fetchData}
          />
        );
      })}
    </div>
  );
}
