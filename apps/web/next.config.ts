import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  transpilePackages: ["@octoseq/mir", "@octoseq/visualiser"],
  experimental: {},
  // In Next.js 16+, turbopack is a top-level config.
  // We opt-in to it (even with empty config) to silence the webpack warning if using `next dev --turbopack`.
  // Note: The `NextConfig` type might not yet fully reflect this if using older types, but it functions at runtime.
  // Actually, per Next 16 docs, it is just `experimental` or root?
  // Search results said top level. Let's try root.
  // However, TS might complain if types aren't updated.
  // Let's use `experimental: { turbo: ... }` for compat or check if `turbopack` is key?
  // Search result says "top-level key in next.config.ts ... moving it out from the experimental field".
  // So validation:
  turbopack: {},

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              // Monaco Editor requires unsafe-eval and (by default) loads from jsdelivr
              "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://cdn.jsdelivr.net https://*.clerk.accounts.dev https://clerk.octoseq.xyz",
              "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net", // Tailwind requires unsafe-inline
              "img-src 'self' data: blob: https:",
              "font-src 'self' data: https://cdn.jsdelivr.net",
              "connect-src 'self' https://*.clerk.accounts.dev https://clerk.octoseq.xyz https://*.r2.cloudflarestorage.com https://cdn.jsdelivr.net",
              "media-src 'self' blob:",
              "worker-src 'self' blob:",
              "frame-ancestors 'none'",
            ].join('; '),
          },
        ],
      },
    ];
  },

  webpack: (config) => {
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
      layers: true,
    };
    return config;
  },
};

export default nextConfig;
