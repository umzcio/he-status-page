'use client';

import React, { useState } from 'react';
import { AdminCategory } from '../../lib/adminApi';
import { apiErrorText, errorMessage } from '../../lib/errors';
import AccessibleDialog from '../AccessibleDialog';
import styles from './CategoryForm.module.css';

interface CategoryFormProps {
  category?: AdminCategory | null;
  onSave: (data: { slug: string; display_name: string; description?: string; display_order?: number }) => Promise<void>;
  onClose: () => void;
}

export default function CategoryForm({ category, onSave, onClose }: CategoryFormProps) {
  const [slug, setSlug] = useState(category?.slug || '');
  const [displayName, setDisplayName] = useState(category?.display_name || '');
  const [description, setDescription] = useState(category?.description || '');
  const [displayOrder, setDisplayOrder] = useState(category?.display_order ?? 0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!slug.trim() || !displayName.trim()) return;

    setSaving(true);
    setError('');
    try {
      await onSave({ slug: slug.trim(), display_name: displayName.trim(), description: description.trim() || undefined, display_order: displayOrder });
      onClose();
    } catch (err) {
      setError(apiErrorText(err) || errorMessage(err) || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AccessibleDialog
      title={category ? 'Edit Category' : 'Add Category'}
      onClose={onClose}
      overlayClassName={styles.overlay}
      dialogClassName={styles.modal}
    >
      <form onSubmit={handleSubmit}>
        <h3>{category ? 'Edit Category' : 'Add Category'}</h3>
        {error && <p className={styles.error} role="alert">{error}</p>}

        <div className={styles.field}>
          <label htmlFor="cat-slug">Slug</label>
          <input id="cat-slug" value={slug} onChange={e => setSlug(e.target.value)} placeholder="e.g. infrastructure" required />
        </div>

        <div className={styles.field}>
          <label htmlFor="cat-name">Display Name</label>
          <input id="cat-name" value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="e.g. Network & Infrastructure" required />
        </div>

        <div className={styles.field}>
          <label htmlFor="cat-desc">Description</label>
          <textarea id="cat-desc" value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional description" />
        </div>

        <div className={styles.field}>
          <label htmlFor="cat-order">Display Order</label>
          <input id="cat-order" type="number" value={displayOrder} onChange={e => setDisplayOrder(parseInt(e.target.value) || 0)} />
        </div>

        <div className={styles.actions}>
          <button type="button" className={styles.cancelBtn} onClick={onClose}>Cancel</button>
          <button type="submit" className={styles.saveBtn} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
        </div>
      </form>
    </AccessibleDialog>
  );
}
