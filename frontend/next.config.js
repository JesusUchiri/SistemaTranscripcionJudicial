/** @type {import('next').NextConfig} */
const nextConfig = {
    reactStrictMode: true,
    eslint: {
        ignoreDuringBuilds: true,
    },
    env: {
        NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000',
        NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8000',
    },
    // Desarrollo: si el front pide al mismo origen (3000), Next reenvía /api al backend (8000) y se evita CORS.
    async rewrites() {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || ''
        if (apiUrl === 'http://localhost:3000') {
            return [{ source: '/api/:path*', destination: 'http://localhost:8000/api/:path*' }]
        }
        return []
    },
}

module.exports = nextConfig

