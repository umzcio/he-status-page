/** @type {import('next').NextConfig} */

// Base path the app is served under (e.g. "/status"). Empty = served at root.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || ''

// CSP frame-ancestors: allow embedding from the configured frontend origin
// (set FRONTEND_URL, e.g. https://status.example.edu). Defaults to same-origin only.
const frameAncestors = process.env.FRONTEND_URL
  ? `'self' ${process.env.FRONTEND_URL}`
  : "'self'"

const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  ...(basePath ? { basePath } : {}),
  trailingSlash: true,
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || '',
  },
  headers: async () => [
    {
      source: '/:path*',
      headers: [
        { key: 'Content-Security-Policy', value: `frame-ancestors ${frameAncestors}` },
      ],
    },
  ],
}

module.exports = nextConfig
