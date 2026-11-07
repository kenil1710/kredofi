import type { NextConfig } from 'next';

export const SECURITY_HEADERS = [
  { key: 'Content-Security-Policy', value: "frame-ancestors 'self' https://huggingface.co" },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Self-contained server for the Docker image (Dockerfile, docs/DEPLOY.md).
  output: 'standalone',
  // No next/image in KredoFi: skip sharp so the standalone build has no native modules.
  images: { unoptimized: true },
  poweredByHeader: false,
  // Safe headers (audit Nov 7). No full CSP before the freeze: it could break three, gsap or the wallet connector.
  // frame-ancestors keeps the Hugging Face Space page able to show the app; nothing else may frame it.
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
