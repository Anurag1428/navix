import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  turbopack: {
    root: process.cwd(),
  },
  async rewrites() {
    return [
      {
        source: "/app/api/:path*",
        destination: "/api/:path*",
      },
    ]
  },
}

export default nextConfig
