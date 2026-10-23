'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../../lib/auth';
import { AdminUser, getUsers, createUser, updateUser, deleteUser, resetUserPassword, revokeUserSessions } from '../../lib/adminApi';
import UserForm, { UserFormData } from './UserForm';
import ConfirmDialog from '../ConfirmDialog';
import styles from './UserManager.module.css';

const roleStyles: { [key: string]: string } = {
  super_admin: styles.roleSuperAdmin,
  admin: styles.roleAdmin,
  viewer: styles.roleViewer,
};

const roleLabels: { [key: string]: string } = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  viewer: 'Viewer',
};

export default function UserManager() {
  const { isAuthenticated, user: currentUser } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formMode, setFormMode] = useState<'create' | 'edit' | 'password'>('create');
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<AdminUser | null>(null);

  const fetchUsers = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const data = await getUsers();
      setUsers(data.users);
    } catch (err) {
      console.error('Failed to load users:', err);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;
    let active = true;
    getUsers()
      .then(data => { if (active) setUsers(data.users); })
      .catch(err => console.error('Failed to load users:', err))
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [isAuthenticated]);

  const handleCreate = async (data: UserFormData) => {
    if (!isAuthenticated) return;
    await createUser({
      email: data.email ?? '',
      name: data.name ?? '',
      role: data.role ?? 'admin',
      password: data.password ?? '',
    });
    await fetchUsers();
  };

  const handleUpdate = async (data: UserFormData) => {
    if (!isAuthenticated || !editingUser) return;
    await updateUser(editingUser.id, { name: data.name, role: data.role });
    await fetchUsers();
  };

  const handleResetPassword = async (data: UserFormData) => {
    if (!isAuthenticated || !editingUser) return;
    await resetUserPassword(editingUser.id, data.password ?? '');
  };

  const handleDelete = async () => {
    if (!isAuthenticated || !deleteTarget) return;
    await deleteUser(deleteTarget.id);
    setDeleteTarget(null);
    await fetchUsers();
  };

  const handleRevokeSessions = async () => {
    if (!isAuthenticated || !revokeTarget) return;
    await revokeUserSessions(revokeTarget.id);
    setRevokeTarget(null);
  };

  const openEdit = (user: AdminUser) => {
    setEditingUser(user);
    setFormMode('edit');
    setShowForm(true);
  };

  const openResetPassword = (user: AdminUser) => {
    setEditingUser(user);
    setFormMode('password');
    setShowForm(true);
  };

  if (loading) {
    return <div className={styles.loading} role="status">Loading users...</div>;
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2>Users</h2>
        <button className={styles.addBtn} onClick={() => { setEditingUser(null); setFormMode('create'); setShowForm(true); }}>Add User</button>
      </div>

      {users.length === 0 ? (
        <p className={styles.empty}>No users found.</p>
      ) : (
        <table className={styles.table}>
          <caption className="sr-only">Users list</caption>
          <thead>
            <tr>
              <th>Email</th>
              <th>Name</th>
              <th>Role</th>
              <th>Last Login</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id}>
                <td>{u.email}</td>
                <td>{u.name || '—'}</td>
                <td>
                  <span className={`${styles.roleBadge} ${roleStyles[u.role] || ''}`}>
                    {roleLabels[u.role] || u.role}
                  </span>
                </td>
                <td>{u.last_login_at ? new Date(u.last_login_at).toLocaleDateString() : 'Never'}</td>
                <td className={styles.actions}>
                  <button className={styles.editBtn} onClick={() => openEdit(u)} aria-label={`Edit ${u.email}`}>Edit</button>
                  <button className={styles.resetBtn} onClick={() => openResetPassword(u)} aria-label={`Reset password for ${u.email}`}>Password</button>
                  {u.id !== currentUser?.id && (
                    <button className={styles.resetBtn} onClick={() => setRevokeTarget(u)} aria-label={`Sign out ${u.email} everywhere`}>Sign out</button>
                  )}
                  {u.id !== currentUser?.id && (
                    <button className={styles.deleteBtn} onClick={() => setDeleteTarget(u)} aria-label={`Delete ${u.email}`}>Delete</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showForm && (
        <UserForm
          user={editingUser}
          mode={formMode}
          onSave={formMode === 'create' ? handleCreate : formMode === 'edit' ? handleUpdate : handleResetPassword}
          onClose={() => { setShowForm(false); setEditingUser(null); }}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="Delete User"
          message={`Are you sure you want to delete "${deleteTarget.email}"?`}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {revokeTarget && (
        <ConfirmDialog
          title="Sign Out Everywhere"
          message={`End every active session for "${revokeTarget.email}"? They will need to sign in again.`}
          onConfirm={handleRevokeSessions}
          onCancel={() => setRevokeTarget(null)}
        />
      )}
    </div>
  );
}
