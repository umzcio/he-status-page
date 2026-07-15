import type { Metadata } from 'next'
import type { CSSProperties } from 'react'
import '../styles/globals.css'
import ErrorBoundary from '../components/ErrorBoundary'

const SITE_NAME = process.env.NEXT_PUBLIC_SITE_NAME || 'IT Status'
const ORG_NAME = process.env.NEXT_PUBLIC_ORG_NAME || 'Example University'

export const metadata: Metadata = {
  title: SITE_NAME,
  description: `${ORG_NAME} service status dashboard`,
  icons: {
    icon: '/favicon.svg',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Allow the primary brand color to be overridden at runtime; the CSS
  // default (--color-primary in globals.css) is used when the env is unset.
  const primaryColor = process.env.NEXT_PUBLIC_PRIMARY_COLOR
  const htmlStyle = primaryColor
    ? ({ '--color-primary': primaryColor } as CSSProperties)
    : undefined

  return (
    <html lang="en" style={htmlStyle}>
      <body>
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        <ErrorBoundary>
          {children}
        </ErrorBoundary>
      </body>
    </html>
  )
}
