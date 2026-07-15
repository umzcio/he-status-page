'use client';

import { useEffect, useRef } from 'react';

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || '';
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js';

// Minimal typing for the parts of the Turnstile JS API we use.
interface TurnstileRenderOptions {
  sitekey: string;
  action?: string;
  callback?: (token: string) => void;
  'error-callback'?: () => void;
  'expired-callback'?: () => void;
}

interface TurnstileApi {
  render: (el: HTMLElement, options: TurnstileRenderOptions) => string;
  remove: (widgetId: string) => void;
  reset: (widgetId?: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

// Load the api.js script exactly once, even across remounts. The module-level
// promise guards against a double-load; explicit rendering keeps us in control
// of when/where the widget mounts.
let scriptPromise: Promise<void> | null = null;

function loadTurnstileScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src^="${SCRIPT_SRC}"]`
    );
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () =>
        reject(new Error('Failed to load Turnstile'))
      );
      if (window.turnstile) resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = `${SCRIPT_SRC}?render=explicit`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Turnstile'));
    document.head.appendChild(script);
  });

  return scriptPromise;
}

interface TurnstileProps {
  // Called with the token when the challenge succeeds, or null when it errors,
  // expires, or the widget is torn down.
  onToken: (token: string | null) => void;
}

/**
 * Cloudflare Turnstile widget (subscribe-form spam prevention).
 *
 * Renders nothing when NEXT_PUBLIC_TURNSTILE_SITE_KEY is unset, so dev setups
 * work without a CAPTCHA (mirrors the backend's skip-if-unconfigured behavior).
 * To reset after a failed submit, remount this component with a new `key`.
 */
export default function Turnstile({ onToken }: TurnstileProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!SITE_KEY) return;
    let cancelled = false;

    loadTurnstileScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) return;
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: SITE_KEY,
          action: 'turnstile-spin-v1',
          callback: (token: string) => onToken(token),
          'error-callback': () => onToken(null),
          'expired-callback': () => onToken(null),
        });
      })
      .catch(() => {
        if (!cancelled) onToken(null);
      });

    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          // Widget may already be gone; ignore.
        }
        widgetIdRef.current = null;
      }
    };
  }, [onToken]);

  if (!SITE_KEY) return null;

  return <div ref={containerRef} />;
}
