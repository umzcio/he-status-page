import React from 'react';
import styles from './Header.module.css';

const SITE_NAME = process.env.NEXT_PUBLIC_SITE_NAME || 'IT Status';
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || '';
const LOGO_PATH = process.env.NEXT_PUBLIC_LOGO_PATH || '/logo.svg';

export default function Header() {
  return (
    <header className={styles.header} role="banner">
      <div className={styles.content}>
        <div className={styles.titleRow}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`${BASE_PATH}${LOGO_PATH}`}
            alt={SITE_NAME}
            className={styles.logo}
          />
          <h1>{SITE_NAME}</h1>
        </div>
        <p className={styles.subtitle}>Real-time status of services and infrastructure.</p>
      </div>
    </header>
  );
}
