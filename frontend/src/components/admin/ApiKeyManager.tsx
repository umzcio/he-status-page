'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../../lib/auth';
import { ApiKey, AdminUser, getApiKeys, getUsers, revokeApiKey } from '../../lib/adminApi';
import ApiKeyDialog from './ApiKeyDialog';
import ConfirmDialog from '../ConfirmDialog';
import styles from './ApiKeyManager.module.css';

export default function ApiKeyManager() {
  const { isAuthenticated } = useAuth();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<ApiKey | null>(null);

  const fetchData = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const [keysData, usersData] = await Promise.all([
        getApiKeys(),
        getUsers(),
      ]);
      setKeys(keysData.keys);
      setUsers(usersData.users);
    } catch (err) {
      console.error('Failed to load API keys:', err);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;
    let active = true;
    Promise.all([getApiKeys(), getUsers()])
      .then(([keysData, usersData]) => {
        if (!active) return;
        setKeys(keysData.keys);
        setUsers(usersData.users);
      })
      .catch(err => console.error('Failed to load API keys:', err))
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [isAuthenticated]);

  const handleRevoke = async () => {
    if (!isAuthenticated || !revokeTarget) return;
    try {
      await revokeApiKey(revokeTarget.id);
      setRevokeTarget(null);
      await fetchData();
    } catch (err) {
      console.error('Failed to revoke API key:', err);
    }
  };

  if (loading) {
    return <div className={styles.loading} role="status">Loading API keys...</div>;
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2>API Keys</h2>
        <button className={styles.addBtn} onClick={() => setShowDialog(true)}>
          Generate New Key
        </button>
      </div>

      {keys.length === 0 ? (
        <p className={styles.empty}>No API keys found.</p>
      ) : (
        <table className={styles.table}>
          <caption className="sr-only">API keys list</caption>
          <thead>
            <tr>
              <th>Name</th>
              <th>Key</th>
              <th>User</th>
              <th>Created</th>
              <th>Last Used</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {keys.map(k => (
              <tr key={k.id}>
                <td>{k.name}</td>
                <td><code className={styles.prefix}>hsp_{k.key_prefix}...</code></td>
                <td>{k.user_email}</td>
                <td>{new Date(k.created_at).toLocaleDateString()}</td>
                <td>{k.last_used_at ? new Date(k.last_used_at).toLocaleDateString() : 'Never'}</td>
                <td>
                  <span className={`${styles.statusBadge} ${k.revoked_at ? styles.statusRevoked : styles.statusActive}`}>
                    {k.revoked_at ? 'Revoked' : 'Active'}
                  </span>
                </td>
                <td>
                  {!k.revoked_at && (
                    <button className={styles.revokeBtn} onClick={() => setRevokeTarget(k)} aria-label={`Revoke API key ${k.name}`}>
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showDialog && (
        <ApiKeyDialog
          users={users}
          onCreated={() => fetchData()}
          onClose={() => setShowDialog(false)}
        />
      )}

      {revokeTarget && (
        <ConfirmDialog
          title="Revoke API Key"
          message={`Are you sure you want to revoke "${revokeTarget.name}" (hsp_${revokeTarget.key_prefix}...)? This cannot be undone.`}
          confirmLabel="Revoke"
          destructive
          onConfirm={handleRevoke}
          onCancel={() => setRevokeTarget(null)}
        />
      )}
    </div>
  );
}
