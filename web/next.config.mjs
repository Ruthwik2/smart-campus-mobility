/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone', // slim runtime image for the Docker stage
  reactStrictMode: true,
};

export default nextConfig;
