import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source.
  transpilePackages: ["@flossamer/core", "@flossamer/agents", "@flossamer/mail"],
};

export default nextConfig;
