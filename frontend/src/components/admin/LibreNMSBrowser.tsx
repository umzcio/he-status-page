'use client';

import React, { useEffect, useState } from 'react';
import { useAuth } from '../../lib/auth';
import {
  getLibreNMSDevices, getLibreNMSGroups, getLibreNMSServices,
  LibreNMSDevice, LibreNMSGroup, LibreNMSService,
} from '../../lib/adminApi';
import { apiErrorText, errorMessage } from '../../lib/errors';
import AccessibleDialog from '../AccessibleDialog';
import styles from './LibreNMSBrowser.module.css';

interface LibreNMSBrowserProps {
  onSelect: (endpoint: string) => void;
  onClose: () => void;
}

type BrowseTab = 'groups' | 'devices' | 'services';

export default function LibreNMSBrowser({ onSelect, onClose }: LibreNMSBrowserProps) {
  const { isAuthenticated } = useAuth();
  const [tab, setTab] = useState<BrowseTab>('groups');
  const [groups, setGroups] = useState<LibreNMSGroup[]>([]);
  const [devices, setDevices] = useState<LibreNMSDevice[]>([]);
  const [services, setServices] = useState<LibreNMSService[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);
  // Start loading if we'll fetch groups on mount (token present).
  const [loading, setLoading] = useState(!!isAuthenticated);
  const [error, setError] = useState('');

  // Reset to the loading state during render when the active tab changes, so the
  // fetching effect below never has to call setState synchronously.
  const [prevTab, setPrevTab] = useState(tab);
  if (tab !== prevTab) {
    setPrevTab(tab);
    setLoading(true);
    setError('');
  }

  useEffect(() => {
    if (!isAuthenticated) return;

    if (tab === 'groups') {
      getLibreNMSGroups()
        .then(setGroups)
        .catch(e => setError(apiErrorText(e) || errorMessage(e) || ''))
        .finally(() => setLoading(false));
    } else if (tab === 'devices') {
      getLibreNMSDevices()
        .then(setDevices)
        .catch(e => setError(apiErrorText(e) || errorMessage(e) || ''))
        .finally(() => setLoading(false));
    }
  }, [isAuthenticated, tab]);

  const loadServices = async (hostname: string) => {
    if (!isAuthenticated) return;
    setSelectedDevice(hostname);
    setTab('services');
    setLoading(true);
    setError('');
    try {
      const svc = await getLibreNMSServices(hostname);
      setServices(svc);
    } catch (e) {
      setError(apiErrorText(e) || errorMessage(e) || '');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AccessibleDialog
      title="Browse LibreNMS"
      onClose={onClose}
      overlayClassName={styles.overlay}
      dialogClassName={styles.modal}
    >
      <h3>Browse LibreNMS</h3>

      <div className={styles.tabs} role="tablist" aria-label="LibreNMS browser tabs">
        <button className={`${styles.tab} ${tab === 'groups' ? styles.tabActive : ''}`} role="tab" aria-selected={tab === 'groups'} onClick={() => setTab('groups')}>Groups</button>
        <button className={`${styles.tab} ${tab === 'devices' ? styles.tabActive : ''}`} role="tab" aria-selected={tab === 'devices'} onClick={() => setTab('devices')}>Devices</button>
        {selectedDevice && (
          <button className={`${styles.tab} ${tab === 'services' ? styles.tabActive : ''}`} role="tab" aria-selected={tab === 'services'} onClick={() => setTab('services')}>
            Services ({selectedDevice})
          </button>
        )}
      </div>

      {loading && <div className={styles.loading} role="status">Loading from LibreNMS...</div>}
      {error && <div className={styles.error} role="alert">{error}</div>}

      {!loading && !error && (
        <div className={styles.list} role="tabpanel">
          {tab === 'groups' && groups.map(g => (
            <div key={g.id} className={styles.item}>
              <div>
                <div className={styles.itemName}>{g.name}</div>
                {g.description && <div className={styles.itemDetail}>{g.description}</div>}
              </div>
              <button className={styles.selectBtn} onClick={() => onSelect(`group:${g.name}`)}>
                Select group {g.name}
              </button>
            </div>
          ))}

          {tab === 'devices' && devices.map(d => (
            <div key={d.device_id} className={styles.item}>
              <div>
                <div className={styles.itemName}>{d.hostname}</div>
                <div className={styles.itemDetail}>{d.sysName} — {d.os} {d.hardware || ''}</div>
              </div>
              <div style={{ display: 'flex', gap: '0.375rem' }}>
                <button className={styles.selectBtn} onClick={() => onSelect(`device:${d.hostname}`)}>Select device</button>
                <button className={styles.selectBtn} onClick={() => loadServices(d.hostname)}>View services</button>
              </div>
            </div>
          ))}

          {tab === 'services' && services.map(s => (
            <div key={s.service_id} className={styles.item}>
              <div>
                <div className={styles.itemName}>{s.service_type}</div>
                <div className={styles.itemDetail}>Status: {s.service_status === 0 ? 'OK' : s.service_status === 1 ? 'Warning' : s.service_status === 2 ? 'Critical' : 'Unknown'}</div>
              </div>
              <button className={styles.selectBtn} onClick={() => onSelect(`service:${selectedDevice}:${s.service_type}`)}>
                Select service {s.service_type}
              </button>
            </div>
          ))}

          {tab === 'groups' && !loading && groups.length === 0 && <div className={styles.loading}>No groups found</div>}
          {tab === 'devices' && !loading && devices.length === 0 && <div className={styles.loading}>No devices found</div>}
          {tab === 'services' && !loading && services.length === 0 && <div className={styles.loading}>No services found on this device</div>}
        </div>
      )}

      <button className={styles.closeBtn} onClick={onClose}>Close</button>
    </AccessibleDialog>
  );
}
