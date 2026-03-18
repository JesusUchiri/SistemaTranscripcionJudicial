'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import api from '@/lib/api'
import { AuthGuard } from '@/components/auth/AuthGuard'

export default function NuevoUsuarioPage() {
    const router = useRouter()
    const [formData, setFormData] = useState({
        email: '',
        nombre: '',
        password: '',
        rol: 'transcriptor'
    })
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setLoading(true)
        setError(null)
        try {
            await api.post('/api/auth/register', formData)
            router.push('/admin')
        } catch (err: any) {
            setError(err.response?.data?.detail || 'Error al crear usuario')
        } finally {
            setLoading(false)
        }
    }

    return (
        <AuthGuard requiredRole="admin">
            <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg-primary)' }}>
                <div className="w-full max-w-md p-8 rounded-2xl border border-subtle" style={{ background: 'var(--bg-surface)' }}>
                    <h1 className="text-2xl font-bold mb-6" style={{ color: 'var(--text-primary)' }}>Registrar Nuevo Usuario</h1>
                    
                    {error && (
                        <div className="p-3 mb-4 rounded-lg bg-red-50 text-red-600 text-sm border border-red-100">
                            {error}
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div>
                            <label className="block text-xs font-bold uppercase mb-1" style={{ color: 'var(--text-muted)' }}>Nombre Completo</label>
                            <input
                                type="text"
                                required
                                value={formData.nombre}
                                onChange={(e) => setFormData({ ...formData, nombre: e.target.value })}
                                className="w-full px-4 py-2 rounded-lg border border-subtle bg-black/5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold uppercase mb-1" style={{ color: 'var(--text-muted)' }}>Email</label>
                            <input
                                type="email"
                                required
                                value={formData.email}
                                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                className="w-full px-4 py-2 rounded-lg border border-subtle bg-black/5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold uppercase mb-1" style={{ color: 'var(--text-muted)' }}>Contraseña</label>
                            <input
                                type="password"
                                required
                                value={formData.password}
                                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                                className="w-full px-4 py-2 rounded-lg border border-subtle bg-black/5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold uppercase mb-1" style={{ color: 'var(--text-muted)' }}>Rol</label>
                            <select
                                value={formData.rol}
                                onChange={(e) => setFormData({ ...formData, rol: e.target.value })}
                                className="w-full px-4 py-2 rounded-lg border border-subtle bg-black/5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            >
                                <option value="transcriptor">Digitador / Transcriptor</option>
                                <option value="supervisor">Supervisor</option>
                                <option value="admin">Administrador</option>
                            </select>
                        </div>
                        
                        <div className="pt-4 flex gap-3">
                            <button
                                type="button"
                                onClick={() => router.back()}
                                className="btn-secondary flex-1"
                            >
                                Cancelar
                            </button>
                            <button
                                type="submit"
                                disabled={loading}
                                className="btn-primary flex-1"
                            >
                                {loading ? 'Creando...' : 'Crear Usuario'}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </AuthGuard>
    )
}
