'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { adminApi } from './adminApi';

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
}

type AuthProvider = 'cas' | 'oidc' | 'saml';

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (provider?: AuthProvider) => void;
  logout: () => void;
  error: string | null;
}

const AuthContext = createContext<AuthContextType | null>(null);

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

// Ask the backend who we are. The HttpOnly session cookie is sent automatically
// (credentials: 'include'); a 200 means an active session, 401 means none.
// The cookie — not any client-held token — is the source of truth.
async function fetchStatus(): Promise<User | null> {
  const res = await fetch(`${API_URL}/api/admin/auth/status`, { credentials: 'include' });
  if (!res.ok) return null;
  const data = await res.json();
  return (data.user as User) ?? null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // One-time, mount-only bootstrap of auth state. There is no token in JS or
  // localStorage anymore — the session lives entirely in an HttpOnly cookie, so
  // we always (re)validate against the backend:
  //   - ?error  -> show it, scrub the URL.
  //   - ?code   -> scrub the URL, POST the one-time code to /auth/exchange
  //                (which sets the cookie), then hydrate via /auth/status.
  //   - else    -> hydrate directly from /auth/status (existing cookie).
  // These setState calls initialize from external (non-React) sources and run
  // exactly once, so they cannot cause the render cascade the rule guards
  // against; the single async flow is guarded by `active` so a late response
  // can't set state after unmount.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    let active = true;

    const params = new URLSearchParams(window.location.search);
    const urlCode = params.get('code');
    const urlError = params.get('error');

    if (urlError) {
      setError(decodeURIComponent(urlError));
      window.history.replaceState({}, '', window.location.pathname);
      setIsLoading(false);
      return;
    }

    (async () => {
      try {
        if (urlCode) {
          // Scrub the code from the URL immediately so it never lingers in history.
          window.history.replaceState({}, '', window.location.pathname);
          const res = await fetch(`${API_URL}/api/admin/auth/exchange`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ code: urlCode }),
          });
          if (!active) return;
          if (!res.ok) {
            setError('Sign-in failed. Please try again.');
            return;
          }
        }

        const currentUser = await fetchStatus();
        if (!active) return;
        setUser(currentUser);
      } catch {
        if (active) setError('Failed to process authentication response');
      } finally {
        if (active) setIsLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const login = useCallback((provider: AuthProvider = 'cas') => {
    // Redirect to the chosen SSO provider's login via the backend.
    window.location.href = `${API_URL}/api/admin/${provider}/login`;
  }, []);

  const logout = useCallback(async () => {
    try {
      // Clears the HttpOnly cookies server-side. The CSRF header is attached
      // automatically by the shared axios instance.
      await adminApi.post(`${API_URL}/api/admin/auth/logout`, {});
    } catch {
      // Even if the request fails, drop local state so the UI returns to login.
    }
    setUser(null);
    setError(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, isLoading, login, logout, error }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
