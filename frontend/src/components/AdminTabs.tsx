'use client';

import React, { useState, useRef } from 'react';
import { useAuth } from '../lib/auth';
import AdminHeader from './AdminHeader';
import AdminDashboard from './AdminDashboard';
import CategoryManager from './admin/CategoryManager';
import ServiceManager from './admin/ServiceManager';
import IncidentManager from './admin/IncidentManager';
import UserManager from './admin/UserManager';
import NotificationManager from './admin/NotificationManager';
import ApiKeyManager from './admin/ApiKeyManager';
import WebhookManager from './admin/WebhookManager';
import MaintenanceManager from './admin/MaintenanceManager';
import styles from './AdminTabs.module.css';

type TabId = 'dashboard' | 'services' | 'incidents' | 'maintenance' | 'categories' | 'users' | 'notifications' | 'api-keys' | 'webhooks';

interface TabDef {
  id: TabId;
  label: string;
  superAdminOnly: boolean;
}

const tabs: TabDef[] = [
  { id: 'dashboard', label: 'Dashboard', superAdminOnly: false },
  { id: 'services', label: 'Services', superAdminOnly: true },
  { id: 'incidents', label: 'Incidents', superAdminOnly: false },
  { id: 'maintenance', label: 'Maintenance', superAdminOnly: false },
  { id: 'categories', label: 'Categories', superAdminOnly: true },
  { id: 'users', label: 'Users', superAdminOnly: true },
  { id: 'notifications', label: 'Notifications', superAdminOnly: true },
  { id: 'api-keys', label: 'API Keys', superAdminOnly: true },
  { id: 'webhooks', label: 'Webhooks', superAdminOnly: true },
];

export default function AdminTabs() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<TabId>('dashboard');
  const tabListRef = useRef<HTMLDivElement>(null);

  const isSuperAdmin = user?.role === 'super_admin';
  const visibleTabs = tabs.filter(t => !t.superAdminOnly || isSuperAdmin);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const currentIndex = visibleTabs.findIndex(t => t.id === activeTab);
    let nextIndex = currentIndex;

    if (e.key === 'ArrowRight') {
      nextIndex = (currentIndex + 1) % visibleTabs.length;
    } else if (e.key === 'ArrowLeft') {
      nextIndex = (currentIndex - 1 + visibleTabs.length) % visibleTabs.length;
    } else if (e.key === 'Home') {
      nextIndex = 0;
    } else if (e.key === 'End') {
      nextIndex = visibleTabs.length - 1;
    } else {
      return;
    }

    e.preventDefault();
    const nextTab = visibleTabs[nextIndex];
    setActiveTab(nextTab.id);

    // Focus the new tab button
    const tabList = tabListRef.current;
    if (tabList) {
      const buttons = tabList.querySelectorAll<HTMLButtonElement>('[role="tab"]');
      buttons[nextIndex]?.focus();
    }
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return <AdminDashboard />;
      case 'services':
        return <ServiceManager />;
      case 'incidents':
        return <IncidentManager />;
      case 'maintenance':
        return <MaintenanceManager />;
      case 'categories':
        return <CategoryManager />;
      case 'users':
        return <UserManager />;
      case 'notifications':
        return <NotificationManager />;
      case 'api-keys':
        return <ApiKeyManager />;
      case 'webhooks':
        return <WebhookManager />;
      default:
        return <AdminDashboard />;
    }
  };

  return (
    <div className={styles.wrapper}>
      <AdminHeader />
      <nav className={styles.tabBar} aria-label="Admin sections">
        <div className={styles.tabBarInner} role="tablist" ref={tabListRef} onKeyDown={handleKeyDown}>
          {visibleTabs.map(tab => (
            <button
              key={tab.id}
              role="tab"
              id={`tab-${tab.id}`}
              aria-selected={activeTab === tab.id}
              aria-controls={`panel-${tab.id}`}
              tabIndex={activeTab === tab.id ? 0 : -1}
              className={`${styles.tab} ${activeTab === tab.id ? styles.tabActive : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </nav>
      <main id="main-content">
        <div
          className={styles.content}
          role="tabpanel"
          id={`panel-${activeTab}`}
          aria-labelledby={`tab-${activeTab}`}
        >
          {renderContent()}
        </div>
      </main>
    </div>
  );
}
