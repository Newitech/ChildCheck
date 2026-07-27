import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Keep dev/release artifacts + runtime data OUT of the standalone bundle.
  // Without this, Next's file tracing follows the runtime-resolved data dirs
  // (src/lib/paths.ts) and copies the whole project root into the bundle —
  // including dist/ itself (old tarballs → recursive 2GB bloat) and user
  // data (db/, config/ secrets) that must never ship in a release.
  outputFileTracingExcludes: {
    "*": [
      // Dev / release artifacts (dist/ contains previously built tarballs).
      "./dist/**",
      "./download/**",
      "./tool-results/**",
      "./agent-ctx/**",
      "./.zcode/**",
      "./.zscripts/**",
      "./.github/**",
      "./docs/**",
      "./examples/**",
      "./install/**",
      "./docker/**",
      "./mini-services/**",
      "./Elvanto Test Data/**",
      // Runtime dirs — created fresh by the installer/build; contents are
      // user data (DB, photos, secrets) that must never ship in the bundle.
      "./data/**",
      "./db/**",
      "./config/**",
      "./prisma/db/**",
      // Dev logs / planning docs.
      "./*.log",
      "./worklog.md",
      "./PLAN.md",
      "./MORNING-SUMMARY.md",
      "./tsconfig.tsbuildinfo",
    ],
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  allowedDevOrigins: ["*.space-z.ai"],
  // PWA: serve the manifest + icons from /public (default behaviour).
  async headers() {
    return [
      {
        source: "/manifest.webmanifest",
        headers: [{ key: "Content-Type", value: "application/manifest+json" }],
      },
    ];
  },
};

export default nextConfig;
