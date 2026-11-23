import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    root: dirname(fileURLToPath(import.meta.url)),
  },
  transpilePackages: ["firebase-admin"],
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
