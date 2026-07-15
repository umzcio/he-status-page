'use client';

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useAuth } from '../../lib/auth';
import {
  AdminService, AdminCategory, ServiceInput,
  getAdminServices, getCategories, createService, updateService, deleteService
} from '../../lib/adminApi';
import { useDebounce } from '../../lib/useDebounce';
import ServiceForm from './ServiceForm';
import ConfirmDialog from '../ConfirmDialog';
import styles from './ServiceManager.module.css';

const typeStyles: { [key: string]: string } = {
  statuspage: styles.typeStatuspage,
  librenms: styles.typeLibrenms,
  ellucian: styles.typeEllucian,
  manual: styles.typeManual,
};

function statusDotClass(status: string): string {
  const map: { [k: string]: string } = {
    operational: styles.dotOperational,
    degraded: styles.dotDegraded,
    outage: styles.dotOutage,
    maintenance: styles.dotMaintenance,
  };
  return map[status] || styles.dotUnknown;
}

export default function ServiceManager() {
  const { isAuthenticated } = useAuth();
  const [services, setServices] = useState<AdminService[]>([]);
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [typeFilter, setTypeFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingService, setEditingService] = useState<AdminService | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminService | null>(null);

  const fetchData = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const [svcData, catData] = await Promise.all([
        getAdminServices(),
        getCategories(),
      ]);
      setServices(svcData.services);
      setCategories(catData.categories);
    } catch (err) {
      console.error('Failed to load services:', err);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;
    let active = true;
    Promise.all([getAdminServices(), getCategories()])
      .then(([svcData, catData]) => {
        if (!active) return;
        setServices(svcData.services);
        setCategories(catData.categories);
      })
      .catch(err => console.error('Failed to load services:', err))
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [isAuthenticated]);

  const filtered = useMemo(() => {
    return services.filter(s => {
      if (debouncedSearch && !s.name.toLowerCase().includes(debouncedSearch.toLowerCase())) return false;
      if (typeFilter && s.status_api_type !== typeFilter) return false;
      return true;
    });
  }, [services, debouncedSearch, typeFilter]);

  const handleCreate = async (data: ServiceInput) => {
    if (!isAuthenticated) return;
    await createService(data);
    await fetchData();
  };

  const handleUpdate = async (data: ServiceInput) => {
    if (!isAuthenticated || !editingService) return;
    await updateService(editingService.id, data);
    await fetchData();
  };

  const handleDelete = async () => {
    if (!isAuthenticated || !deleteTarget) return;
    await deleteService(deleteTarget.id);
    setDeleteTarget(null);
    await fetchData();
  };

  if (loading) {
    return <div className={styles.loading} role="status">Loading services...</div>;
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2>Services</h2>
        <button className={styles.addBtn} onClick={() => setShowForm(true)}>Add Service</button>
      </div>

      <div className={styles.searchBar}>
        <input
          className={styles.searchInput}
          placeholder="Search services..."
          aria-label="Search services"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select className={styles.filterSelect} aria-label="Filter by type" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
          <option value="">All Types</option>
          <option value="statuspage">Statuspage</option>
          <option value="librenms">LibreNMS</option>
          <option value="ellucian">Ellucian</option>
          <option value="manual">Manual</option>
          <option value="microsoft_graph">Microsoft</option>
          <option value="google_status">Google</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <p className={styles.empty}>No services found.</p>
      ) : (
        <table className={styles.table}>
          <caption className="sr-only">Services list</caption>
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Category</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(svc => (
              <tr key={svc.id}>
                <td>
                  {svc.name}
                  {svc.visible === false && <span className={styles.hiddenBadge} title="Hidden from public page">Hidden</span>}
                </td>
                <td>
                  <span className={`${styles.typeBadge} ${typeStyles[svc.status_api_type || ''] || ''}`}>
                    {svc.status_api_type || 'unknown'}
                  </span>
                </td>
                <td>{svc.category_slug || svc.category || '—'}</td>
                <td>
                  <span className={`${styles.statusDot} ${statusDotClass(svc.status)}`} />
                  {svc.status || 'unknown'}
                </td>
                <td className={styles.actions}>
                  <button className={styles.editBtn} onClick={() => { setEditingService(svc); setShowForm(true); }} aria-label={`Edit ${svc.name}`}>Edit</button>
                  <button className={styles.deleteBtn} onClick={() => setDeleteTarget(svc)} aria-label={`Delete ${svc.name}`}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showForm && (
        <ServiceForm
          service={editingService}
          categories={categories}
          allServices={services}
          onSave={editingService ? handleUpdate : handleCreate}
          onClose={() => { setShowForm(false); setEditingService(null); }}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="Delete Service"
          message={`Are you sure you want to delete "${deleteTarget.name}"? This will also delete all status history and logs.`}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
