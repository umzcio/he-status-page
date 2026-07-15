'use client';

import React, { useState, useEffect } from 'react';
import { TeamsWebhook, AdminCategory, createWebhook, updateWebhook, getCategories } from '../../lib/adminApi';
import { apiErrorText } from '../../lib/errors';
import AccessibleDialog from '../AccessibleDialog';
import styles from './WebhookDialog.module.css';

interface WebhookDialogProps {
  webhook?: TeamsWebhook | null;
  onSaved: () => void;
  onClose: () => void;
}

export default function WebhookDialog({ webhook, onSaved, onClose }: WebhookDialogProps) {
  const [name, setName] = useState(webhook?.name || '');
  const [webhookUrl, setWebhookUrl] = useState(webhook?.webhook_url || '');
  const [enabled, setEnabled] = useState(webhook?.enabled !== false);
  const [filterAll, setFilterAll] = useState(!webhook?.category_filter);
  const [selectedCategories, setSelectedCategories] = useState<string[]>(webhook?.category_filter || []);
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    getCategories().then(data => setCategories(data.categories)).catch(() => {});
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !webhookUrl.trim()) return;

    setSaving(true);
    setError('');

    try {
      const payload = {
        name: name.trim(),
        webhook_url: webhookUrl.trim(),
        enabled,
        category_filter: filterAll ? null : selectedCategories,
      };

      if (webhook) {
        await updateWebhook(webhook.id, payload);
      } else {
        await createWebhook(payload);
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(apiErrorText(err) || 'Failed to save webhook');
    } finally {
      setSaving(false);
    }
  };

  const toggleCategory = (slug: string) => {
    setSelectedCategories(prev =>
      prev.includes(slug) ? prev.filter(s => s !== slug) : [...prev, slug]
    );
  };

  return (
    <AccessibleDialog
      title={webhook ? 'Edit Webhook' : 'Add Webhook'}
      onClose={onClose}
      overlayClassName={styles.overlay}
      dialogClassName={styles.dialog}
    >
      <h2 className={styles.title}>{webhook ? 'Edit Webhook' : 'Add Webhook'}</h2>

      <form onSubmit={handleSubmit}>
        <div className={styles.field}>
          <label htmlFor="wh-name">Name</label>
          <input
            id="wh-name"
            type="text"
            placeholder="e.g. IT Operations Channel"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>

        <div className={styles.field}>
          <label htmlFor="wh-url">Webhook URL</label>
          <input
            id="wh-url"
            type="url"
            placeholder="https://..."
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            required
          />
        </div>

        <div className={styles.checkboxField}>
          <label>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            Enabled
          </label>
        </div>

        <fieldset className={styles.field} style={{ border: 'none', margin: 0, padding: 0 }}>
          <legend style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#374151', marginBottom: '0.25rem' }}>Category Filter</legend>
          <div className={styles.checkboxField}>
            <label>
              <input
                type="radio"
                name="catFilter"
                checked={filterAll}
                onChange={() => setFilterAll(true)}
              />
              All categories
            </label>
          </div>
          <div className={styles.checkboxField}>
            <label>
              <input
                type="radio"
                name="catFilter"
                checked={!filterAll}
                onChange={() => setFilterAll(false)}
              />
              Specific categories
            </label>
          </div>
          {!filterAll && (
            <div className={styles.categoryList}>
              {categories.map(cat => (
                <label key={cat.id} className={styles.categoryCheck}>
                  <input
                    type="checkbox"
                    checked={selectedCategories.includes(cat.slug)}
                    onChange={() => toggleCategory(cat.slug)}
                  />
                  {cat.display_name}
                </label>
              ))}
              {categories.length === 0 && (
                <span className={styles.muted} role="status">Loading categories...</span>
              )}
            </div>
          )}
        </fieldset>

        {error && <div className={styles.error} role="alert">{error}</div>}

        <div className={styles.actions}>
          <button type="button" className={styles.cancelBtn} onClick={onClose}>Cancel</button>
          <button type="submit" className={styles.createBtn} disabled={saving || !name.trim() || !webhookUrl.trim()}>
            {saving ? 'Saving...' : (webhook ? 'Save Changes' : 'Add Webhook')}
          </button>
        </div>
      </form>
    </AccessibleDialog>
  );
}
