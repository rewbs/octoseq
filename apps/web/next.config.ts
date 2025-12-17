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
