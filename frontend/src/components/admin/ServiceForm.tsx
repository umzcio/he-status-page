'use client';

import React, { useState, useEffect, useId } from 'react';
import { useAuth } from '../../lib/auth';
import {
  AdminCategory, AdminService, ServiceDependency, ServiceInput,
  getServiceDependencies, addServiceDependency, removeServiceDependency
} from '../../lib/adminApi';
import { apiErrorText, errorMessage } from '../../lib/errors';
import AccessibleDialog from '../AccessibleDialog';
import LibreNMSBrowser from './LibreNMSBrowser';
import styles from './ServiceForm.module.css';

interface ServiceFormProps {
  service?: AdminService | null;
  categories: AdminCategory[];
  allServices?: AdminService[];
  onSave: (data: ServiceInput) => Promise<void>;
  onClose: () => void;
}

type ServiceType = 'statuspage' | 'librenms' | 'ellucian' | 'manual';

function typeFromApiType(apiType: string | null): ServiceType {
  if (apiType === 'librenms') return 'librenms';
  if (apiType === 'ellucian') return 'ellucian';
  if (apiType === 'manual' || !apiType) return 'manual';
  return 'statuspage';
}

export default function ServiceForm({ service, categories, allServices = [], onSave, onClose }: ServiceFormProps) {
  const { isAuthenticated } = useAuth();
  const [serviceType, setServiceType] = useState<ServiceType>(service ? typeFromApiType(service.status_api_type) : 'statuspage');
  const [name, setName] = useState(service?.name || '');
  const [description, setDescription] = useState(service?.description || '');
  const [categoryId, setCategoryId] = useState(service?.category_id || '');
  const [provider, setProvider] = useState(service?.provider || '');
  const [endpoint, setEndpoint] = useState(service?.status_api_endpoint || '');
  const [apiType, setApiType] = useState(service?.status_api_type || 'statuspage');
  const [externalLink, setExternalLink] = useState(service?.external_link || '');
  const [displayOrder, setDisplayOrder] = useState(service?.display_order ?? 0);
  const [checkEnabled, setCheckEnabled] = useState(service?.check_enabled ?? true);
  const [visible, setVisible] = useState(service?.visible ?? true);
  const [showBrowser, setShowBrowser] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const hintId = useId();

  // Dependencies state (only used when editing)
  const [deps, setDeps] = useState<ServiceDependency[]>([]);
  const [depAddId, setDepAddId] = useState('');
  // Start in the loading state when we'll fetch dependencies (editing an existing
  // service), so the effect need not call setState synchronously.
  const [depsLoading, setDepsLoading] = useState(!!(service && isAuthenticated));

  useEffect(() => {
    if (service && isAuthenticated) {
      getServiceDependencies(service.id)
        .then(data => setDeps(data.dependencies))
        .catch(() => {})
        .finally(() => setDepsLoading(false));
    }
  }, [service, isAuthenticated]);

  const handleAddDep = async () => {
    if (!isAuthenticated || !service || !depAddId) return;
    try {
      await addServiceDependency(service.id, depAddId);
      const data = await getServiceDependencies(service.id);
      setDeps(data.dependencies);
      setDepAddId('');
    } catch (err) {
      setError(apiErrorText(err) || 'Failed to add dependency');
    }
  };

  const handleRemoveDep = async (depId: string) => {
    if (!isAuthenticated || !service) return;
    try {
      await removeServiceDependency(service.id, depId);
      setDeps(prev => prev.filter(d => d.id !== depId));
    } catch (err) {
      setError(apiErrorText(err) || 'Failed to remove dependency');
    }
  };

  const handleTypeChange = (type: ServiceType) => {
    setServiceType(type);
    if (type === 'manual') {
      setApiType('manual');
      setCheckEnabled(false);
      setEndpoint('');
    } else if (type === 'librenms') {
      setApiType('librenms');
      setCheckEnabled(true);
    } else if (type === 'ellucian') {
      setApiType('ellucian');
      setCheckEnabled(true);
    } else {
      setApiType('statuspage');
      setCheckEnabled(true);
    }
  };

  const handleLibreNMSSelect = (endpointStr: string) => {
    setEndpoint(endpointStr);
    setShowBrowser(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setSaving(true);
    setError('');
    try {
      await onSave({
        name: name.trim(),
        description: description.trim() || null,
        category_id: categoryId || null,
        provider: provider.trim() || null,
        status_api_endpoint: endpoint.trim() || null,
        status_api_type: apiType,
        check_enabled: checkEnabled,
        external_link: externalLink.trim() || null,
        display_order: displayOrder,
        visible,
      });
      onClose();
    } catch (err) {
      setError(apiErrorText(err) || errorMessage(err) || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AccessibleDialog
      title={service ? 'Edit Service' : 'Add Service'}
      onClose={onClose}
      overlayClassName={styles.overlay}
      dialogClassName={styles.modal}
    >
      <form onSubmit={handleSubmit}>
        <h3>{service ? 'Edit Service' : 'Add Service'}</h3>
        {error && <p className={styles.error} role="alert">{error}</p>}

        {!service && (
          <fieldset style={{ border: 'none', margin: 0, padding: 0 }}>
            <legend style={{ fontSize: '0.8125rem', fontWeight: 500, color: '#374151', marginBottom: '0.25rem', display: 'block' }}>
              Monitoring Type
            </legend>
            <div className={styles.typeSelector}>
              {([
                ['statuspage', 'Statuspage'],
                ['librenms', 'LibreNMS'],
                ['ellucian', 'Ellucian'],
                ['manual', 'Manual'],
              ] as const).map(([value, label]) => (
                <label key={value} className={`${styles.typeBtn} ${serviceType === value ? styles.typeBtnActive : ''}`}>
                  <input
                    type="radio"
                    name="serviceType"
                    value={value}
                    className={styles.typeRadioInput}
                    checked={serviceType === value}
                    onChange={() => handleTypeChange(value)}
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <div className={styles.field}>
          <label htmlFor="svc-name">Service Name</label>
          <input id="svc-name" value={name} onChange={e => setName(e.target.value)} required />
        </div>

        <div className={styles.field}>
          <label htmlFor="svc-desc">Description</label>
          <textarea id="svc-desc" value={description} onChange={e => setDescription(e.target.value)} />
        </div>

        <div className={styles.field}>
          <label htmlFor="svc-cat">Category</label>
          <select id="svc-cat" value={categoryId} onChange={e => setCategoryId(e.target.value)}>
            <option value="">— None —</option>
            {categories.map(c => (
              <option key={c.id} value={c.id}>{c.display_name}</option>
            ))}
          </select>
        </div>

        <div className={styles.field}>
          <label htmlFor="svc-provider">Provider</label>
          <input id="svc-provider" value={provider} onChange={e => setProvider(e.target.value)} placeholder="e.g. zoom, microsoft, custom" />
        </div>

        {serviceType === 'statuspage' && (
          <div className={styles.field}>
            <label htmlFor="svc-endpoint">Statuspage API URL</label>
            <input id="svc-endpoint" value={endpoint} onChange={e => setEndpoint(e.target.value)} placeholder="https://status.example.com/api/v2/status.json" aria-describedby={`${hintId}-sp`} />
            <p id={`${hintId}-sp`} className={styles.hint}>Enter the full URL to the statuspage.io v2 status endpoint</p>
          </div>
        )}

        {serviceType === 'librenms' && (
          <div className={styles.field}>
            <label htmlFor="svc-endpoint-lnms">LibreNMS Endpoint</label>
            <input id="svc-endpoint-lnms" value={endpoint} onChange={e => setEndpoint(e.target.value)} placeholder="group:Network-Core" readOnly aria-describedby={`${hintId}-lnms`} />
            <p id={`${hintId}-lnms`} className={styles.hint}>Use the browser to select a device, group, or service</p>
            <button type="button" className={styles.browseBtn} onClick={() => setShowBrowser(true)}>
              Browse LibreNMS
            </button>
          </div>
        )}

        {serviceType === 'ellucian' && (
          <div className={styles.field}>
            <label htmlFor="svc-endpoint-ell">Health Check URL</label>
            <input id="svc-endpoint-ell" value={endpoint} onChange={e => setEndpoint(e.target.value)} placeholder="https://appnav.example.edu/applicationNavigator/actuator/health" aria-describedby={`${hintId}-ell`} />
            <p id={`${hintId}-ell`} className={styles.hint}>Full URL to an /actuator/health endpoint or any reachable page</p>
          </div>
        )}

        {service && serviceType !== 'manual' && serviceType !== 'librenms' && serviceType !== 'statuspage' && serviceType !== 'ellucian' && (
          <div className={styles.field}>
            <label htmlFor="svc-endpoint-other">API Endpoint</label>
            <input id="svc-endpoint-other" value={endpoint} onChange={e => setEndpoint(e.target.value)} />
          </div>
        )}

        <div className={styles.field}>
          <label htmlFor="svc-link">External Link</label>
          <input id="svc-link" value={externalLink} onChange={e => setExternalLink(e.target.value)} placeholder="https://..." />
        </div>

        <div className={styles.field}>
          <label htmlFor="svc-order">Display Order</label>
          <input id="svc-order" type="number" value={displayOrder} onChange={e => setDisplayOrder(parseInt(e.target.value) || 0)} />
        </div>

        {serviceType !== 'manual' && (
          <div className={styles.checkboxField}>
            <input type="checkbox" id="svc-enabled" checked={checkEnabled} onChange={e => setCheckEnabled(e.target.checked)} />
            <label htmlFor="svc-enabled">Enable automated checks</label>
          </div>
        )}

        <div className={styles.checkboxField}>
          <input type="checkbox" id="svc-visible" checked={visible} onChange={e => setVisible(e.target.checked)} />
          <label htmlFor="svc-visible">Visible on public status page</label>
        </div>

        {service && (
          <fieldset className={styles.depsSection}>
            <legend>Dependencies</legend>
            <p className={styles.hint}>When a dependency has an issue, this service will show a warning on the public page.</p>
            {depsLoading ? (
              <p className={styles.hint}>Loading...</p>
            ) : (
              <>
                {deps.length > 0 ? (
                  <ul className={styles.depsList}>
                    {deps.map(dep => (
                      <li key={dep.id}>
                        <span>{dep.depends_on_name}</span>
                        <button type="button" className={styles.depRemoveBtn} onClick={() => handleRemoveDep(dep.id)} aria-label={`Remove dependency on ${dep.depends_on_name}`}>Remove</button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className={styles.hint}>No dependencies configured.</p>
                )}
                <div className={styles.depAdd}>
                  <select value={depAddId} onChange={e => setDepAddId(e.target.value)} aria-label="Select service to add as dependency">
                    <option value="">— Add dependency —</option>
                    {allServices
                      .filter(s => s.id !== service.id && !deps.some(d => d.depends_on_service_id === s.id))
                      .map(s => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                  </select>
                  <button type="button" className={styles.depAddBtn} onClick={handleAddDep} disabled={!depAddId}>Add</button>
                </div>
              </>
            )}
          </fieldset>
        )}

        <div className={styles.actions}>
          <button type="button" className={styles.cancelBtn} onClick={onClose}>Cancel</button>
          <button type="submit" className={styles.saveBtn} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
        </div>
      </form>

      {showBrowser && (
        <LibreNMSBrowser onSelect={handleLibreNMSSelect} onClose={() => setShowBrowser(false)} />
      )}
    </AccessibleDialog>
  );
}
