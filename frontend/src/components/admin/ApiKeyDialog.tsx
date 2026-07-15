'use client';

import React, { useState } from 'react';
import { AdminUser, createApiKey } from '../../lib/adminApi';
import { apiErrorText } from '../../lib/errors';
import AccessibleDialog from '../AccessibleDialog';
import styles from './ApiKeyDialog.module.css';

interface ApiKeyDialogProps {
  users: AdminUser[];
  onCreated: () => void;
  onClose: () => void;
}

export default function ApiKeyDialog({ users, onCreated, onClose }: ApiKeyDialogProps) {
  const [userId, setUserId] = useState(users[0]?.id || '');
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [plaintextKey, setPlaintextKey] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId) return;
    setCreating(true);
    setError('');
    try {
      const result = await createApiKey({ user_id: userId, name: name || 'Default' });
      setPlaintextKey(result.plaintext_key);
      onCreated();
    } catch (err) {
      setError(apiErrorText(err) || 'Failed to create API key');
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(plaintextKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <AccessibleDialog
      title={plaintextKey ? 'API Key Created' : 'Generate API Key'}
      onClose={plaintextKey ? () => {} : onClose}
      overlayClassName={styles.overlay}
      dialogClassName={styles.dialog}
    >
      <h2 className={styles.title}>{plaintextKey ? 'API Key Created' : 'Generate API Key'}</h2>

      {plaintextKey ? (
        <div className={styles.keyResult}>
          <div className={styles.warning} role="alert">
            Save this key now. It won&apos;t be shown again.
          </div>
          <div className={styles.keyDisplay}>
            <input
              className={styles.keyInput}
              type="text"
              value={plaintextKey}
              readOnly
              aria-label="Generated API key"
            />
            <button className={styles.copyBtn} onClick={handleCopy}>
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <div className={styles.actions}>
            <button className={styles.cancelBtn} onClick={onClose}>Done</button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleCreate}>
          <div className={styles.field}>
            <label htmlFor="apikey-user">User</label>
            <select
              id="apikey-user"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
            >
              {users.map(u => (
                <option key={u.id} value={u.id}>{u.email}</option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label htmlFor="apikey-name">Key Name</label>
            <input
              id="apikey-name"
              type="text"
              placeholder="e.g. MCP Server"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          {error && <div className={styles.error} role="alert">{error}</div>}
          <div className={styles.actions}>
            <button type="button" className={styles.cancelBtn} onClick={onClose}>Cancel</button>
            <button type="submit" className={styles.createBtn} disabled={creating || !userId}>
              {creating ? 'Generating...' : 'Generate Key'}
            </button>
          </div>
        </form>
      )}
    </AccessibleDialog>
  );
}
