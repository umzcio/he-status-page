'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../../lib/auth';
import {
  getNotificationStats, getNotificationSubscribers, getNotificationQueue,
  sendTestEmail, deleteSubscriber,
  NotificationStats, NotificationSubscriber, NotificationQueueItem,
} from '../../lib/adminApi';
import { apiErrorText } from '../../lib/errors';
import styles from './NotificationManager.module.css';

export default function NotificationManager() {
  const { isAuthenticated } = useAuth();
  const [stats, setStats] = useState<NotificationStats | null>(null);
  const [subscribers, setSubscribers] = useState<NotificationSubscriber[]>([]);
  const [queue, setQueue] = useState<NotificationQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [testEmailAddr, setTestEmailAddr] = useState('');
  const [sending, setSending] = useState(false);
  const [testResult, setTestResult] = useState('');

  const fetchData = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const [statsData, subsData, queueData] = await Promise.all([
        getNotificationStats(),
        getNotificationSubscribers(),
        getNotificationQueue(),
      ]);
      setStats(statsData);
      setSubscribers(subsData.subscribers);
      setQueue(queueData.queue);
    } catch (err) {
      console.error('Failed to load notification data:', err);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;
    let active = true;
    Promise.all([
      getNotificationStats(),
      getNotificationSubscribers(),
      getNotificationQueue(),
    ])
      .then(([statsData, subsData, queueData]) => {
        if (!active) return;
        setStats(statsData);
        setSubscribers(subsData.subscribers);
        setQueue(queueData.queue);
      })
      .catch(err => console.error('Failed to load notification data:', err))
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [isAuthenticated]);

  const handleTestEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAuthenticated || !testEmailAddr) return;
    setSending(true);
    setTestResult('');
    try {
      await sendTestEmail(testEmailAddr);
      setTestResult('Test email sent!');
      setTestEmailAddr('');
    } catch (err) {
      setTestResult(apiErrorText(err) || 'Failed to send');
    } finally {
      setSending(false);
    }
  };

  const handleRemoveSubscriber = async (id: string) => {
    if (!isAuthenticated) return;
    try {
      await deleteSubscriber(id);
      await fetchData();
    } catch (err) {
      console.error('Failed to remove subscriber:', err);
    }
  };

  if (loading) {
    return <div className={styles.loading} role="status">Loading notifications...</div>;
  }

  function queueStatus(item: NotificationQueueItem): { label: string; cls: string } {
    if (item.sent_at) return { label: 'Sent', cls: styles.badgeSent };
    if (item.failed_at && item.retry_count >= 3) return { label: 'Failed', cls: styles.badgeFailed };
    return { label: 'Pending', cls: styles.badgePending };
  }

  function subStatus(sub: NotificationSubscriber): { label: string; cls: string } {
    if (sub.unsubscribed_at) return { label: 'Unsubscribed', cls: styles.badgeUnsubscribed };
    if (sub.verified) return { label: 'Verified', cls: styles.badgeVerified };
    return { label: 'Unverified', cls: styles.badgeUnverified };
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2>Notifications</h2>
      </div>

      {stats && !stats.email_configured && (
        <div className={styles.notConfigured}>
          Email is not configured. Set SMTP_HOST in your environment to enable email delivery.
        </div>
      )}

      {stats && (
        <div className={styles.statsGrid}>
          <div className={styles.statCard}>
            <div className={styles.statLabel}>Subscribers</div>
            <div className={styles.statValue}>{stats.active_subscribers}</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statLabel}>Sent (24h)</div>
            <div className={styles.statValue}>{stats.sent_24h}</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statLabel}>Sent (7d)</div>
            <div className={styles.statValue}>{stats.sent_7d}</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statLabel}>Pending</div>
            <div className={styles.statValue}>{stats.pending}</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statLabel}>Failed</div>
            <div className={`${styles.statValue} ${stats.failed > 0 ? styles.statWarning : ''}`}>{stats.failed}</div>
          </div>
        </div>
      )}

      {/* Test Email */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h3>Send Test Email</h3>
        </div>
        <form className={styles.testForm} onSubmit={handleTestEmail}>
          <input
            className={styles.testInput}
            type="email"
            placeholder="test@example.edu"
            aria-label="Test email address"
            value={testEmailAddr}
            onChange={e => setTestEmailAddr(e.target.value)}
            required
          />
          <button className={styles.testBtn} disabled={sending}>{sending ? 'Sending...' : 'Send Test'}</button>
          {testResult && <span className={styles.success} role="status">{testResult}</span>}
        </form>
      </div>

      {/* Subscribers */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h3>Subscribers ({subscribers.length})</h3>
        </div>
        {subscribers.length === 0 ? (
          <p className={styles.empty}>No subscribers yet.</p>
        ) : (
          <table className={styles.table}>
            <caption className="sr-only">Subscribers list</caption>
            <thead>
              <tr>
                <th>Email</th>
                <th>Status</th>
                <th>Services</th>
                <th>Subscribed</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {subscribers.map(sub => {
                const s = subStatus(sub);
                return (
                  <tr key={sub.id}>
                    <td>{sub.email}</td>
                    <td><span className={`${styles.statusBadge} ${s.cls}`}>{s.label}</span></td>
                    <td>{sub.service_count}</td>
                    <td>{new Date(sub.created_at).toLocaleDateString()}</td>
                    <td>
                      {!sub.unsubscribed_at && (
                        <button className={styles.removeBtn} onClick={() => handleRemoveSubscriber(sub.id)} aria-label={`Remove subscriber ${sub.email}`}>Remove</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Queue */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h3>Recent Queue ({queue.length})</h3>
        </div>
        {queue.length === 0 ? (
          <p className={styles.empty}>No notifications in queue.</p>
        ) : (
          <table className={styles.table}>
            <caption className="sr-only">Notification queue</caption>
            <thead>
              <tr>
                <th>Service</th>
                <th>Subscriber</th>
                <th>Change</th>
                <th>Status</th>
                <th>Scheduled</th>
              </tr>
            </thead>
            <tbody>
              {queue.slice(0, 50).map(item => {
                const q = queueStatus(item);
                return (
                  <tr key={item.id}>
                    <td>{item.service_name || '—'}</td>
                    <td>{item.subscriber_email || '—'}</td>
                    <td>{item.status_change_from} &rarr; {item.status_change_to}</td>
                    <td><span className={`${styles.statusBadge} ${q.cls}`}>{q.label}</span></td>
                    <td>{new Date(item.scheduled_for).toLocaleString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
