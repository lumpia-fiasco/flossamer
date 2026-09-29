import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source.
  transpilePackages: ["@flossamer/core", "@flossamer/agents", "@flossamer/mail", "@flossamer/db", "@flossamer/radar"],
  experimental: {
    // LinkedIn's Connections.csv is sent as text (the zip is opened in the browser); large networks exceed the 1 MB default.
    serverActions: { bodySizeLimit: "4mb" },
  },
};

export default nextConfig;
