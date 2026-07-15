'use client';

import React, { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import styles from './LoginForm.module.css';

const SITE_NAME = process.env.NEXT_PUBLIC_SITE_NAME || 'IT Status';
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || '';
const LOGO_PATH = process.env.NEXT_PUBLIC_LOGO_PATH || '/logo.svg';
const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

interface Providers {
  password: boolean;
  cas: boolean;
  oidc: boolean;
  saml: boolean;
}

export default function LoginForm() {
  const { login, error } = useAuth();
  const [providers, setProviders] = useState<Providers | null>(null);

  // Mount-only fetch of the configured SSO providers so we only render the
  // buttons an operator has actually enabled. Guarded by `active` so a late
  // response cannot set state after unmount. (setState here lives inside the
  // async callback, not the effect body, so no set-state-in-effect suppression
  // is needed.)
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/admin/auth/providers`);
        if (!active) return;
        if (res.ok) {
          setProviders(await res.json());
        }
      } catch {
        // Leave providers null; the fallback note is shown below.
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const hasSso = !!providers && (providers.cas || providers.oidc || providers.saml);

  return (
    <main id="main-content" className={styles.wrapper}>
      <div className={styles.card}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`${BASE_PATH}${LOGO_PATH}`}
          alt={SITE_NAME}
          className={styles.logo}
        />
        <h1 className={styles.title}>Admin Login</h1>
        <p className={styles.subtitle}>{SITE_NAME} Dashboard</p>

        {error && (
          <div className={styles.error} role="alert">
            {error}
          </div>
        )}

        {providers?.cas && (
          <button
            type="button"
            className={styles.button}
            onClick={() => login('cas')}
          >
            Sign in with CAS
          </button>
        )}

        {providers?.oidc && (
          <button
            type="button"
            className={styles.button}
            onClick={() => login('oidc')}
          >
            Sign in with SSO
          </button>
        )}

        {providers?.saml && (
          <button
            type="button"
            className={styles.button}
            onClick={() => login('saml')}
          >
            Sign in with SAML
          </button>
        )}

        {providers && !hasSso && (
          <p className={styles.subtitle}>
            No single sign-on provider is configured. Contact your administrator.
          </p>
        )}

        <a href={`${BASE_PATH}/`} className={styles.backLink}>
          View Public Dashboard
        </a>
      </div>
    </main>
  );
}
