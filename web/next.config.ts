import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Self-contained server for the Docker image (Dockerfile, docs/DEPLOY.md).
  output: 'standalone',
  // No next/image in KredoFi: skip sharp so the standalone build has no native modules.
  images: { unoptimized: true },
};

export default nextConfig;
