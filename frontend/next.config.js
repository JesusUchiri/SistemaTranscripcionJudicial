/** @type {import('next').NextConfig} */
// build: 2026-03-18
const nextConfig = {
    reactStrictMode: true,
    eslint: {
        ignoreDuringBuilds: true,
    },
    // Aumentar timeout del proxy para transcripciones largas (hasta 30 min)
    experimental: {
        proxyTimeout: 1800000,
    },
    env: {
        NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000',
        NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8000',
    },
    async rewrites() {
        return [
            {
                source: '/api/:path*',
                destination: 'http://localhost:8000/api/:path*'
            }
        ]
    },
}

module.exports = nextConfig

