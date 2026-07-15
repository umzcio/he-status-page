'use client';

import { AuthProvider } from '../../lib/auth';
import ErrorBoundary from '../../components/ErrorBoundary';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <ErrorBoundary>
        {children}
      </ErrorBoundary>
    </AuthProvider>
  );
}
