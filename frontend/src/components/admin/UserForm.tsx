'use client';

import React, { useState } from 'react';
import { AdminUser } from '../../lib/adminApi';
import { apiErrorText, errorMessage } from '../../lib/errors';
import AccessibleDialog from '../AccessibleDialog';
import styles from './UserForm.module.css';

/** Fields a UserForm can submit; which are present depends on the mode. */
export interface UserFormData {
  email?: string;
  name?: string;
  role?: string;
  password?: string;
}

interface UserFormProps {
  user?: AdminUser | null;
  mode: 'create' | 'edit' | 'password';
  onSave: (data: UserFormData) => Promise<void>;
  onClose: () => void;
}

export default function UserForm({ user, mode, onSave, onClose }: UserFormProps) {
  const [email, setEmail] = useState(user?.email || '');
  const [name, setName] = useState(user?.name || '');
  const [role, setRole] = useState(user?.role || 'admin');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      if (mode === 'create') {
        await onSave({ email, name, role, password });
      } else if (mode === 'edit') {
        await onSave({ name, role });
      } else if (mode === 'password') {
        await onSave({ password });
      }
      onClose();
    } catch (err) {
      setError(apiErrorText(err) || errorMessage(err) || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const title = mode === 'create' ? 'Add User' : mode === 'edit' ? 'Edit User' : 'Reset Password';

  return (
    <AccessibleDialog
      title={title}
      onClose={onClose}
      overlayClassName={styles.overlay}
      dialogClassName={styles.modal}
    >
      <form onSubmit={handleSubmit}>
        <h3>{title}</h3>
        {error && <p className={styles.error} role="alert">{error}</p>}

        {mode === 'create' && (
          <div className={styles.field}>
            <label htmlFor="user-email">Email</label>
            <input id="user-email" type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" />
          </div>
        )}

        {(mode === 'create' || mode === 'edit') && (
          <>
            <div className={styles.field}>
              <label htmlFor="user-name">Name</label>
              <input id="user-name" value={name} onChange={e => setName(e.target.value)} autoComplete="name" />
            </div>
            <div className={styles.field}>
              <label htmlFor="user-role">Role</label>
              <select id="user-role" value={role} onChange={e => setRole(e.target.value)}>
                <option value="super_admin">Super Admin</option>
                <option value="admin">Admin</option>
                <option value="viewer">Viewer</option>
              </select>
            </div>
          </>
        )}

        {(mode === 'create' || mode === 'password') && (
          <div className={styles.field}>
            <label htmlFor="user-pass">Password</label>
            <input id="user-pass" type="password" value={password} onChange={e => setPassword(e.target.value)} minLength={6} required autoComplete="new-password" />
          </div>
        )}

        <div className={styles.actions}>
          <button type="button" className={styles.cancelBtn} onClick={onClose}>Cancel</button>
          <button type="submit" className={styles.saveBtn} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
        </div>
      </form>
    </AccessibleDialog>
  );
}
