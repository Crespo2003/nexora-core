/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    cpus: 2,
    serverComponentsExternalPackages: ['openai']
  }
};

export default nextConfig;
