/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["@resvg/resvg-js"],
  outputFileTracingIncludes: {
    "/api/poster": ["./app/api/poster/fonts/DejaVuSans-Bold.ttf.gz"],
  },
};

export default nextConfig;
