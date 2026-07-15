'use client';

import { useEffect } from 'react';
import { useAuth } from '../../lib/auth';
import LoginForm from '../../components/LoginForm';
import AdminTabs from '../../components/AdminTabs';
import styles from './page.module.css';

const SITE_NAME = process.env.NEXT_PUBLIC_SITE_NAME || 'IT Status';

export default function AdminPage() {
  const { isAuthenticated, isLoading } = useAuth();

  useEffect(() => {
    document.title = `Admin — ${SITE_NAME}`;
  }, []);

  if (isLoading) {
    return (
      <main id="main-content" className={styles.container}>
        <div className={styles.loading}>Loading...</div>
      </main>
    );
  }

  if (!isAuthenticated) {
    return <LoginForm />;
  }

  return <AdminTabs />;
}
