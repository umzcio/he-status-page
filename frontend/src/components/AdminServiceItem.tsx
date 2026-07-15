'use client';

import React, { useState } from 'react';
import { Service } from '../lib/api';
import { useAuth } from '../lib/auth';
import { deactivateOverride } from '../lib/adminApi';
import { apiErrorText } from '../lib/errors';
import OverrideForm from './OverrideForm';
import ConfirmDialog from './ConfirmDialog';
import styles from './AdminServiceItem.module.css';

interface AdminServiceItemProps {
  service: Service;
  onRefresh: () => void;
}

export default function AdminServiceItem({ service, onRefresh }: AdminServiceItemProps) {
  const { isAuthenticated } = useAuth();
  const [showForm, setShowForm] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState('');
  const statusClass = service.status || 'unknown';

  async function handleRemoveOverride() {
    if (!isAuthenticated) return;
    setShowConfirm(false);
    setRemoving(true);
    setError('');
    try {
      await deactivateOverride(service.id);
      onRefresh();
    } catch (err) {
      setError(apiErrorText(err) || 'Failed to remove override.');
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className={styles.item}>
      <div className={styles.row}>
        <div className={styles.left}>
          <span
            className={`${styles.indicator} ${styles[statusClass]}`}
            aria-hidden="true"
          />
          <div className={styles.info}>
            <span className={styles.name}>{service.name}</span>
            <span className={`${styles.statusText} ${styles[statusClass]}`}>
              {service.status.charAt(0).toUpperCase() + service.status.slice(1)}
            </span>
          </div>
        </div>

        <div className={styles.right}>
          {service.override_active && (
            <span className={styles.overrideBadge}>
              Override Active
              {service.override_by && <span className={styles.overrideBy}> by {service.override_by}</span>}
            </span>
          )}

          <div className={styles.actions}>
            {service.override_active ? (
              <button
                onClick={() => setShowConfirm(true)}
                className={styles.removeBtn}
                disabled={removing}
              >
                {removing ? 'Removing...' : 'Remove Override'}
              </button>
            ) : (
              <button
                onClick={() => setShowForm(!showForm)}
                className={styles.overrideBtn}
              >
                {showForm ? 'Cancel' : 'Set Override'}
              </button>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className={styles.errorBar} role="alert">{error}</div>
      )}

      {showForm && (
        <OverrideForm
          serviceId={service.id}
          onDone={() => { setShowForm(false); onRefresh(); }}
          onCancel={() => setShowForm(false)}
        />
      )}

      {showConfirm && (
        <ConfirmDialog
          title="Remove Override"
          message={`Remove the active override on "${service.name}"? The service status will return to operational until the next poll cycle.`}
          confirmLabel="Remove Override"
          destructive
          onConfirm={handleRemoveOverride}
          onCancel={() => setShowConfirm(false)}
        />
      )}
    </div>
  );
}
