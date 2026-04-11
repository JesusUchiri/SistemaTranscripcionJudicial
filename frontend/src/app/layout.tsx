import type { Metadata } from 'next'
import { Inter, Playfair_Display } from 'next/font/google'
import './globals.css'
import { GoogleOAuthProvider } from '@react-oauth/google'

const inter = Inter({ 
  subsets: ['latin'],
  variable: '--font-sans',
})

const playfair = Playfair_Display({
  subsets: ['latin'],
  variable: '--font-display',
})

export const metadata: Metadata = {
  title: 'JudiScribe — Transcripción Judicial Inteligente',
  description: 'Sistema especializado de transcripción en tiempo real y generación de actas para la Corte Superior de Justicia del Cusco.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // En desarrollo puedes usar un ID de prueba o dejarlo vacío si no tienes el .env aún
  const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || ""

  return (
    <html lang="es" className={`${inter.variable} ${playfair.variable}`}>
      <body className="antialiased font-sans">
        <GoogleOAuthProvider clientId={googleClientId}>
          {children}
        </GoogleOAuthProvider>
       body>
    </html>
  )
}
