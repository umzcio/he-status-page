'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../../lib/auth';
import { AdminCategory, getCategories, createCategory, updateCategory, deleteCategory } from '../../lib/adminApi';
import CategoryForm from './CategoryForm';
import ConfirmDialog from '../ConfirmDialog';
import styles from './CategoryManager.module.css';

export default function CategoryManager() {
  const { isAuthenticated } = useAuth();
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingCategory, setEditingCategory] = useState<AdminCategory | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AdminCategory | null>(null);

  const fetchCategories = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const data = await getCategories();
      setCategories(data.categories);
    } catch (err) {
      console.error('Failed to load categories:', err);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;
    let active = true;
    getCategories()
      .then(data => { if (active) setCategories(data.categories); })
      .catch(err => console.error('Failed to load categories:', err))
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [isAuthenticated]);

  const handleCreate = async (data: { slug: string; display_name: string; description?: string; display_order?: number }) => {
    if (!isAuthenticated) return;
    await createCategory(data);
    await fetchCategories();
  };

  const handleUpdate = async (data: { slug: string; display_name: string; description?: string; display_order?: number }) => {
    if (!isAuthenticated || !editingCategory) return;
    await updateCategory(editingCategory.id, data);
    await fetchCategories();
  };

  const handleDelete = async () => {
    if (!isAuthenticated || !deleteTarget) return;
    await deleteCategory(deleteTarget.id);
    setDeleteTarget(null);
    await fetchCategories();
  };

  if (loading) {
    return <div className={styles.loading} role="status">Loading categories...</div>;
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2>Categories</h2>
        <button className={styles.addBtn} onClick={() => setShowAdd(true)}>Add Category</button>
      </div>

      {categories.length === 0 ? (
        <p className={styles.empty}>No categories yet.</p>
      ) : (
        <table className={styles.table}>
          <caption className="sr-only">Categories list</caption>
          <thead>
            <tr>
              <th>Order</th>
              <th>Slug</th>
              <th>Display Name</th>
              <th>Services</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {categories.map(cat => (
              <tr key={cat.id}>
                <td>{cat.display_order}</td>
                <td><span className={styles.slug}>{cat.slug}</span></td>
                <td>{cat.display_name}</td>
                <td>{cat.service_count}</td>
                <td className={styles.actions}>
                  <button className={styles.editBtn} onClick={() => setEditingCategory(cat)} aria-label={`Edit ${cat.display_name}`}>Edit</button>
                  <button
                    className={styles.deleteBtn}
                    onClick={() => setDeleteTarget(cat)}
                    disabled={cat.service_count > 0}
                    aria-label={cat.service_count > 0 ? `Cannot delete ${cat.display_name}: remove all services first` : `Delete ${cat.display_name}`}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showAdd && (
        <CategoryForm onSave={handleCreate} onClose={() => setShowAdd(false)} />
      )}

      {editingCategory && (
        <CategoryForm category={editingCategory} onSave={handleUpdate} onClose={() => setEditingCategory(null)} />
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="Delete Category"
          message={`Are you sure you want to delete "${deleteTarget.display_name}"?`}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
