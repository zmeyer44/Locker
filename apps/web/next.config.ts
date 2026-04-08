import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: [
    "@locker/common",
    "@locker/database",
    "@locker/email",
    "@locker/storage",
  ],
  serverExternalPackages: ["re2", "just-bash"],
};

export default nextConfig;
