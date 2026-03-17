import type { Metadata } from 'next'
import './globals.css'
import { AuthProvider } from '@/components/auth/AuthProvider'

export const metadata: Metadata = {
    title: 'JudiScribe — Transcripción Judicial Inteligente',
    description: 'Sistema de transcripción en tiempo real para audiencias judiciales del Distrito Judicial de Cusco, Perú.',
    icons: { icon: "/favicon.svg" },
}

export default function RootLayout({
    children,
}: {
    children: React.ReactNode
}) {
    return (
        <html lang="es">
            <body>
                <AuthProvider>
                    {children}
                </AuthProvider>
            </body>
        </html>
    )
}
