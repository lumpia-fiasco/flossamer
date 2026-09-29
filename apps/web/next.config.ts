import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source.
  transpilePackages: ["@flossamer/core", "@flossamer/agents", "@flossamer/mail", "@flossamer/db", "@flossamer/radar"],
};

export default nextConfig;
