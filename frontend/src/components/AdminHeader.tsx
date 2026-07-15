'use client';

import React from 'react';
import { useAuth } from '../lib/auth';
import styles from './AdminHeader.module.css';

const SITE_NAME = process.env.NEXT_PUBLIC_SITE_NAME || 'IT Status';
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || '';
const LOGO_PATH = process.env.NEXT_PUBLIC_LOGO_PATH || '/logo.svg';

export default function AdminHeader() {
  const { user, logout } = useAuth();

  return (
    <header className={styles.header} role="banner">
      <div className={styles.content}>
        <div className={styles.left}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`${BASE_PATH}${LOGO_PATH}`}
            alt={SITE_NAME}
            className={styles.logo}
          />
          <h1 className={styles.title}>{SITE_NAME} — Admin</h1>
        </div>
        <div className={styles.right}>
          <span className={styles.user}>{user?.name || user?.email}</span>
          <a href={`${BASE_PATH}/`} className={styles.link}>View Public Dashboard</a>
          <button onClick={logout} className={styles.logoutBtn}>Log Out</button>
        </div>
      </div>
    </header>
  );
}
