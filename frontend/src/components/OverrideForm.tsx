'use client';

import React, { useState } from 'react';
import { useAuth } from '../lib/auth';
import { activateOverride } from '../lib/adminApi';
import { apiErrorText } from '../lib/errors';
import styles from './OverrideForm.module.css';

interface OverrideFormProps {
  serviceId: string;
  onDone: () => void;
  onCancel: () => void;
}

export default function OverrideForm({ serviceId, onDone, onCancel }: OverrideFormProps) {
  const { isAuthenticated } = useAuth();
  const [status, setStatus] = useState('degraded');
  const [message, setMessage] = useState('');
  const [reason, setReason] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isAuthenticated) return;
    setError('');
    setSubmitting(true);
    try {
      await activateOverride(serviceId, {
        status,
        message,
        reason: reason || undefined,
        expires_at: expiresAt ? new Date(expiresAt).toISOString() : undefined,
      });
      onDone();
    } catch (err) {
      setError(apiErrorText(err) || 'Failed to set override.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.wrapper}>
      {error && (
        <div className={styles.error} role="alert">{error}</div>
      )}
      <form onSubmit={handleSubmit} className={styles.form}>
        <div className={styles.row}>
          <div className={styles.field}>
            <label htmlFor={`override-status-${serviceId}`} className={styles.label}>
              Status
            </label>
            <select
              id={`override-status-${serviceId}`}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className={styles.select}
              aria-required="true"
              disabled={submitting}
            >
              <option value="operational">Operational</option>
              <option value="degraded">Degraded</option>
              <option value="outage">Outage</option>
              <option value="maintenance">Maintenance</option>
            </select>
          </div>

          <div className={styles.field} style={{ flex: 2 }}>
            <label htmlFor={`override-message-${serviceId}`} className={styles.label}>
              Public Message
            </label>
            <input
              id={`override-message-${serviceId}`}
              type="text"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className={styles.input}
              required
              aria-required="true"
              placeholder="e.g. Service experiencing intermittent issues"
              disabled={submitting}
            />
          </div>
        </div>

        <div className={styles.row}>
          <div className={styles.field} style={{ flex: 2 }}>
            <label htmlFor={`override-reason-${serviceId}`} className={styles.label}>
              Internal Reason <span className={styles.optional}>(optional)</span>
            </label>
            <textarea
              id={`override-reason-${serviceId}`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className={styles.textarea}
              rows={2}
              placeholder="Internal note — not shown publicly"
              disabled={submitting}
            />
          </div>

          <div className={styles.field}>
            <label htmlFor={`override-expires-${serviceId}`} className={styles.label}>
              Expires At <span className={styles.optional}>(optional)</span>
            </label>
            <input
              id={`override-expires-${serviceId}`}
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              className={styles.input}
              disabled={submitting}
            />
          </div>
        </div>

        <div className={styles.actions}>
          <button type="submit" className={styles.submitBtn} disabled={submitting}>
            {submitting ? 'Saving...' : 'Apply Override'}
          </button>
          <button type="button" onClick={onCancel} className={styles.cancelBtn} disabled={submitting}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
