'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import Turnstile from '../components/Turnstile';
import Header from '../components/Header';
import OverallStatusAlert from '../components/OverallStatusAlert';
import StatusLegend from '../components/StatusLegend';
import ServiceCategory from '../components/ServiceCategory';
import ActiveIncidents from '../components/ActiveIncidents';
import { getServices, subscribe, ServicesResponse } from '../lib/api';
import { apiErrorText, errorMessage } from '../lib/errors';
import styles from './page.module.css';

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || '';
const ORG_NAME = process.env.NEXT_PUBLIC_ORG_NAME || 'Example University';

export default function Home() {
  const [data, setData] = useState<ServicesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [subEmail, setSubEmail] = useState('');
  const [subStatus, setSubStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [subMessage, setSubMessage] = useState('');
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  // Bumping this key remounts the Turnstile widget, which resets it after a submit.
  const [captchaKey, setCaptchaKey] = useState(0);

  // Polite screen-reader announcements for status changes between polls.
  const [announcement, setAnnouncement] = useState('');
  const prevStatusesRef = useRef<Record<string, string>>({});

  const announce = useCallback((message: string) => {
    setAnnouncement(message);
  }, []);

  useEffect(() => {
    async function fetchData() {
      try {
        const result = await getServices();

        // Announce only services whose status actually changed since last poll.
        const prev = prevStatusesRef.current;
        const isFirstLoad = Object.keys(prev).length === 0;
        const next: Record<string, string> = {};
        const changes: string[] = [];
        for (const svc of result.services) {
          next[svc.id] = svc.status;
          if (!isFirstLoad && prev[svc.id] && prev[svc.id] !== svc.status) {
            changes.push(`${svc.name} status changed to ${svc.status}`);
          }
        }
        prevStatusesRef.current = next;
        if (changes.length > 0) {
          setAnnouncement(changes.join('. ') + '.');
        }

        setData(result);
        setLoading(false);
      } catch (err) {
        setError(errorMessage(err) ?? 'Failed to load service status.');
        setLoading(false);
      }
    }

    fetchData();

    // Refresh every 30 seconds
    const interval = setInterval(fetchData, 30000);

    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <>
        <Header />
        <main id="main-content" className={styles.container}>
          <div className={styles.loading} role="status">Loading service status...</div>
        </main>
      </>
    );
  }

  if (error) {
    return (
      <>
        <Header />
        <main id="main-content" className={styles.container}>
          <div className={styles.error} role="alert">
            Failed to load service status. Please try again later.
          </div>
        </main>
      </>
    );
  }

  if (!data) {
    return null;
  }

  // Use API categories if available, fallback to known slugs
  const categoryOrder = data.categories && data.categories.length > 0
    ? data.categories
    : [
        { slug: 'core', display_name: 'Core Applications', display_order: 1 },
        { slug: 'academic', display_name: 'Academic & Student Services', display_order: 2 },
        { slug: 'business', display_name: 'Business Systems', display_order: 3 },
        { slug: 'banner', display_name: 'Banner', display_order: 4 },
        { slug: 'infrastructure', display_name: 'Network & Infrastructure', display_order: 5 },
        { slug: 'communication', display_name: 'Communication & Collaboration', display_order: 6 },
        { slug: 'learning', display_name: 'Teaching & Learning', display_order: 7 },
      ];

  return (
    <>
      <Header />
      <main id="main-content" role="main">
        <div className="sr-only" role="status" aria-live="polite">
          {announcement}
        </div>
        <div className={styles.container}>
          <OverallStatusAlert status={data.overall_status} />
          <ActiveIncidents onAnnounce={announce} />
          <StatusLegend />

          {categoryOrder.map(cat => {
            const services = data.services_by_category[cat.slug] || [];
            if (services.length === 0) return null;

            return (
              <ServiceCategory
                key={cat.slug}
                title={cat.slug}
                displayName={cat.display_name}
                services={services}
              />
            );
          })}

          <section className={styles.subscription}>
            <h2>Subscribe to Updates</h2>
            <p>Get email notifications when service statuses change. A .edu email address is required.</p>
            <form className={styles.form} onSubmit={async (e) => {
              e.preventDefault();
              if (!subEmail.trim().toLowerCase().endsWith('.edu')) {
                setSubStatus('error');
                setSubMessage('Only .edu email addresses are allowed.');
                return;
              }
              setSubStatus('loading');
              setSubMessage('');
              try {
                const result = await subscribe(subEmail, [], captchaToken || '');
                setSubStatus('success');
                setSubMessage(result.message || 'Check your email to verify your subscription.');
                setSubEmail('');
                setCaptchaToken(null);
                setCaptchaKey((k) => k + 1);
              } catch (err) {
                setSubStatus('error');
                setSubMessage(apiErrorText(err) || 'Failed to subscribe. Please try again.');
                setCaptchaToken(null);
                setCaptchaKey((k) => k + 1);
              }
            }}>
              <label htmlFor="sub-email" className={styles.emailLabel}>
                Email address (.edu required)
              </label>
              <input
                id="sub-email"
                type="email"
                placeholder="you@example.edu"
                required
                pattern=".*\.edu$"
                title="Please enter a .edu email address"
                value={subEmail}
                onChange={(e) => setSubEmail(e.target.value)}
                disabled={subStatus === 'loading'}
                aria-invalid={subStatus === 'error'}
                aria-describedby={subStatus === 'error' ? 'sub-message' : undefined}
              />
              {TURNSTILE_SITE_KEY && (
                <Turnstile key={captchaKey} onToken={setCaptchaToken} />
              )}
              <button type="submit" disabled={subStatus === 'loading'}>
                {subStatus === 'loading' ? 'Subscribing...' : 'Subscribe'}
              </button>
            </form>
            {subMessage && (
              <p
                id="sub-message"
                role={subStatus === 'error' ? 'alert' : 'status'}
                style={{
                  marginTop: '0.75rem',
                  marginBottom: 0,
                  color: subStatus === 'success' ? '#166534' : '#dc2626',
                  fontSize: '0.875rem',
                }}
              >
                {subMessage}
              </p>
            )}
          </section>
        </div>
      </main>

      <footer className={styles.footer} role="contentinfo">
        <p>&copy; {new Date().getFullYear()} {ORG_NAME}. All rights reserved.</p>
        <p className={styles.credit}>Created by Zach Rossmiller at the University of Montana</p>
      </footer>
    </>
  );
}
