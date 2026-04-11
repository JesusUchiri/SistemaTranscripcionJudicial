'use client'

import { AuthGuard } from '@/components/auth/AuthGuard'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/stores/authStore'

export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode
}) {
    const { logout, user } = useAuthStore()
    const router = useRouter()

    const handleLogout = async () => {
        await logout()
        router.replace('/login')
    }

    const rolLabel = user?.rol === 'admin' ? 'Administrador'
        : user?.rol === 'transcriptor' ? 'Digitador Judicial'
        : user?.rol === 'supervisor' ? 'Supervisor'
        : user?.rol ?? ''

    return (
        <AuthGuard>
            <div className="h-screen flex flex-col" style={{ background: 'var(--bg-primary)' }}>
                {/* Header Global del Dashboard */}
                <header
                    className="shrink-0 px-6 sm:px-8 py-3 flex items-center justify-between gap-4"
                    style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-surface)' }}
                >
                    <div className="flex items-center gap-3 cursor-pointer" onClick={() => router.push('/')}>
                        <div className="logo-monogram shrink-0">J</div>
                        <div>
                            <h1 className="text-sm font-bold tracking-tight"
                                style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
                                JudiScribe
                            </h1>
                            <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                                Sistema de Transcripción Judicial · Cusco
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <div className="hidden sm:block text-right">
                            <p className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                                {user?.nombre}
                            </p>
                            <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                                {rolLabel}
                            </p>
                        </div>
                        <button
                            onClick={handleLogout}
                            className="px-3 py-1.5 rounded-lg text-xs transition-colors"
                            style={{
                                background: 'var(--bg-secondary)',
                                border: '1px solid var(--border-subtle)',
                                color: 'var(--text-muted)',
                            }}
                        >
                            Cerrar sesión
                        </button>
                    </div>
                </header>

                <main className="flex-1 min-h-0 overflow-y-auto">
                    {children}
                </main>
            </div>
        </AuthGuard>
    )
}
