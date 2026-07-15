'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../../lib/auth';
import {
  TeamsWebhook, WebhookLog,
  getWebhooks, deleteWebhook, testWebhook, getWebhookLogs,
} from '../../lib/adminApi';
import { apiErrorText } from '../../lib/errors';
import WebhookDialog from './WebhookDialog';
import ConfirmDialog from '../ConfirmDialog';
import styles from './WebhookManager.module.css';

export default function WebhookManager() {
  const { isAuthenticated } = useAuth();
  const [webhooks, setWebhooks] = useState<TeamsWebhook[]>([]);
  const [logs, setLogs] = useState<WebhookLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [editTarget, setEditTarget] = useState<TeamsWebhook | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TeamsWebhook | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { success: boolean; message: string } | null>>({});

  const fetchData = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const [whData, logData] = await Promise.all([
        getWebhooks(),
        getWebhookLogs(),
      ]);
      setWebhooks(whData.webhooks);
      setLogs(logData.logs.slice(0, 20));
    } catch (err) {
      console.error('Failed to load webhooks:', err);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;
    let active = true;
    Promise.all([getWebhooks(), getWebhookLogs()])
      .then(([whData, logData]) => {
        if (!active) return;
        setWebhooks(whData.webhooks);
        setLogs(logData.logs.slice(0, 20));
      })
      .catch(err => console.error('Failed to load webhooks:', err))
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [isAuthenticated]);

  const handleDelete = async () => {
    if (!isAuthenticated || !deleteTarget) return;
    try {
      await deleteWebhook(deleteTarget.id);
      setDeleteTarget(null);
      await fetchData();
    } catch (err) {
      console.error('Failed to delete webhook:', err);
    }
  };

  const handleTest = async (wh: TeamsWebhook) => {
    if (!isAuthenticated) return;
    setTestResults(prev => ({ ...prev, [wh.id]: null }));
    try {
      const result = await testWebhook(wh.id);
      setTestResults(prev => ({
        ...prev,
        [wh.id]: { success: true, message: `Sent (${result.responseTimeMs}ms)` },
      }));
      // Refresh logs after test
      setTimeout(() => fetchData(), 1000);
    } catch (err) {
      const msg = apiErrorText(err) || 'Failed';
      setTestResults(prev => ({
        ...prev,
        [wh.id]: { success: false, message: msg },
      }));
    }
  };

  const handleEdit = (wh: TeamsWebhook) => {
    setEditTarget(wh);
    setShowDialog(true);
  };

  const handleCloseDialog = () => {
    setShowDialog(false);
    setEditTarget(null);
  };

  const truncateUrl = (url: string) => {
    if (url.length <= 60) return url;
    return url.slice(0, 50) + '...';
  };

  if (loading) {
    return <div className={styles.loading} role="status">Loading webhooks...</div>;
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2>Webhooks</h2>
        <button className={styles.addBtn} onClick={() => { setEditTarget(null); setShowDialog(true); }}>
          Add Webhook
        </button>
      </div>

      {webhooks.length === 0 ? (
        <p className={styles.empty}>No webhooks configured. Add a Microsoft Teams webhook to receive status change notifications.</p>
      ) : (
        <table className={styles.table}>
          <caption className="sr-only">Webhooks list</caption>
          <thead>
            <tr>
              <th>Name</th>
              <th>URL</th>
              <th>Categories</th>
              <th>Enabled</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {webhooks.map(wh => (
              <tr key={wh.id}>
                <td>{wh.name}</td>
                <td><code className={styles.urlCode}>{truncateUrl(wh.webhook_url)}</code></td>
                <td>
                  {wh.category_filter ? (
                    <span className={styles.categoryChips}>
                      {wh.category_filter.map(c => (
                        <span key={c} className={styles.chip}>{c}</span>
                      ))}
                    </span>
                  ) : (
                    <span className={styles.chipAll}>All</span>
                  )}
                </td>
                <td>
                  <span className={`${styles.statusBadge} ${wh.enabled ? styles.statusActive : styles.statusDisabled}`}>
                    {wh.enabled ? 'Active' : 'Disabled'}
                  </span>
                </td>
                <td className={styles.actionCell}>
                  <button className={styles.actionBtn} onClick={() => handleEdit(wh)} aria-label={`Edit ${wh.name}`}>Edit</button>
                  <button className={styles.testBtn} onClick={() => handleTest(wh)} aria-label={`Test ${wh.name}`}>
                    Test
                  </button>
                  <button className={styles.deleteBtn} onClick={() => setDeleteTarget(wh)} aria-label={`Delete ${wh.name}`}>Delete</button>
                  {testResults[wh.id] && (
                    <span className={testResults[wh.id]!.success ? styles.testSuccess : styles.testFail}>
                      {testResults[wh.id]!.message}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className={styles.logsSection}>
        <h3>Recent Deliveries</h3>
        {logs.length === 0 ? (
          <p className={styles.empty}>No delivery logs yet.</p>
        ) : (
          <table className={styles.table}>
            <caption className="sr-only">Recent webhook deliveries</caption>
            <thead>
              <tr>
                <th>Webhook</th>
                <th>Service</th>
                <th>Change</th>
                <th>Result</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {logs.map(log => (
                <tr key={log.id}>
                  <td>{log.webhook_name || 'Deleted'}</td>
                  <td>{log.service_name || 'Test'}</td>
                  <td>{log.status_from} &rarr; {log.status_to}</td>
                  <td>
                    <span className={`${styles.statusBadge} ${log.success ? styles.statusActive : styles.statusFailed}`}>
                      {log.success ? 'OK' : 'Failed'}
                    </span>
                    {!log.success && log.error_message && (
                      <span className={styles.errorHint} aria-label={`Error: ${log.error_message}`} role="img">!</span>
                    )}
                  </td>
                  <td>{new Date(log.sent_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showDialog && (
        <WebhookDialog
          webhook={editTarget}
          onSaved={() => fetchData()}
          onClose={handleCloseDialog}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="Delete Webhook"
          message={`Are you sure you want to delete "${deleteTarget.name}"? Delivery logs will be preserved.`}
          confirmLabel="Delete"
          destructive
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
