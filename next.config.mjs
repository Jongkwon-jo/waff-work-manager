/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["firebase-admin"],
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
