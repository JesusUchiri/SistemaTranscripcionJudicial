'use client'

/**
 * Panel de Administración — Solo para administradores.
 * Permite gestionar usuarios y ver estadísticas de uso.
 */
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import api from '@/lib/api'
import { AuthGuard } from '@/components/auth/AuthGuard'
import { useAuthStore } from '@/stores/authStore'
import { motion } from 'framer-motion'
import { 
    Users, 
    Zap, 
    Cpu, 
    DollarSign, 
    Trash2, 
    Shield, 
    UserCircle,
    CheckCircle,
    XCircle,
    ChevronDown,
    Loader2
} from 'lucide-react'

interface UsuarioStats {
    id: string
    email: string
    nombre: string
    rol: string
    activo: boolean
    created_at: string
    transcripciones_count: number
    duracion_total_segundos: number
    costo_deepgram_usd: number
    costo_claude_usd: number
    costo_total_usd: number
}

const ROLES = [
    { value: 'transcriptor', label: 'Digitador' },
    { value: 'supervisor', label: 'Supervisor' },
    { value: 'admin', label: 'Administrador' },
]

export default function AdminDashboard() {
    const router = useRouter()
    const { logout, user } = useAuthStore()
    const [usuarios, setUsuarios] = useState<UsuarioStats[]>([])
    const [loading, setLoading] = useState(true)
    const [updatingId, setUpdatingId] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (user && user.rol === 'admin') {
            fetchUsuarios()
        }
    }, [user])

    const fetchUsuarios = async () => {
        try {
            setLoading(true)
            const { data } = await api.get('/api/users')
            setUsuarios(data.items || [])
            setError(null)
        } catch (err: any) {
            setError(err.response?.data?.detail || 'Error al cargar usuarios')
        } finally {
            setLoading(false)
        }
    }

    const handleToggleActive = async (userId: string) => {
        try {
            setUpdatingId(userId)
            const { data } = await api.patch(`/api/users/${userId}/toggle-active`)
            setUsuarios(prev => prev.map(u => u.id === userId ? data : u))
        } catch (err: any) {
            alert(err.response?.data?.detail || 'Error al cambiar estado')
        } finally {
            setUpdatingId(null)
        }
    }

    const handleChangeRole = async (userId: string, newRole: string) => {
        try {
            setUpdatingId(userId)
            const { data } = await api.patch(`/api/users/${userId}/role`, { rol: newRole })
            setUsuarios(prev => prev.map(u => u.id === userId ? data : u))
        } catch (err: any) {
            alert(err.response?.data?.detail || 'Error al cambiar rol')
        } finally {
            setUpdatingId(null)
        }
    }

    const handleDeleteUser = async (userId: string) => {
        if (!confirm('¿Estás seguro de eliminar este usuario? Esta acción no se puede deshacer.')) return
        try {
            await api.delete(`/api/users/${userId}`)
            setUsuarios(prev => prev.filter(u => u.id !== userId))
        } catch (err: any) {
            alert(err.response?.data?.detail || 'Error al eliminar usuario')
        }
    }

    const handleLogout = async () => {
        await logout()
        router.replace('/login')
    }

    // Totales globales
    const noAdmins = usuarios.filter(u => u.rol !== 'admin')
    const totalTranscripciones = noAdmins.reduce((acc, u) => acc + u.transcripciones_count, 0)
    const totalDeepgram = noAdmins.reduce((acc, u) => acc + u.costo_deepgram_usd, 0)
    const totalClaude = noAdmins.reduce((acc, u) => acc + u.costo_claude_usd, 0)
    const totalUsuarios = usuarios.length

    return (
        <AuthGuard requiredRole="admin">
            <div className="min-h-screen bg-[#FDFCFB] text-[#1A1A1A]">
                {/* Header Custom para Admin */}
                <header className="px-8 py-4 bg-white border-b border-[#1B3A5C]/10 flex items-center justify-between sticky top-0 z-30">
                    <div className="flex items-center gap-4">
                        <div className="w-10 h-10 bg-[#1B3A5C] text-white flex items-center justify-center rounded-xl font-bold text-xl">
                            A
                        </div>
                        <div>
                            <h1 className="text-lg font-bold text-[#1B3A5C] tracking-tight">Consola de Administración</h1>
                            <p className="text-[10px] uppercase tracking-widest text-[#A68246] font-bold">JudiScribe Control</p>
                        </div>
                    </div>
                    
                    <div className="flex items-center gap-6">
                        <div className="hidden sm:flex items-center gap-3 pr-6 border-r border-[#1B3A5C]/10">
                            <div className="text-right">
                                <p className="text-xs font-bold text-[#1B3A5C]">{user?.nombre}</p>
                                <p className="text-[10px] text-[#A68246] font-bold uppercase tracking-tighter">Super Admin</p>
                            </div>
                            <div className="w-8 h-8 bg-[#1B3A5C]/5 rounded-full flex items-center justify-center">
                                <Shield className="w-4 h-4 text-[#1B3A5C]/40" />
                            </div>
                        </div>
                        <button 
                            onClick={handleLogout}
                            className="text-xs font-bold text-[#1B3A5C]/40 hover:text-red-500 transition-colors uppercase tracking-widest"
                        >
                            Salir
                        </button>
                    </div>
                </header>

                <main className="max-w-7xl mx-auto px-8 py-10">
                    {/* Stat Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-12">
                        {[
                            { label: 'Usuarios', value: totalUsuarios, icon: <Users className="w-4 h-4" /> },
                            { label: 'Transcripciones', value: totalTranscripciones, icon: <Zap className="w-4 h-4" /> },
                            { label: 'Costo Deepgram', value: `$${totalDeepgram.toFixed(3)}`, icon: <Cpu className="w-4 h-4" /> },
                            { label: 'Costo Claude', value: `$${totalClaude.toFixed(3)}`, icon: <DollarSign className="w-4 h-4" /> },
                        ].map((stat, i) => (
                            <motion.div 
                                key={stat.label}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: i * 0.1 }}
                                className="bg-white p-6 rounded-3xl border border-[#1B3A5C]/5 shadow-sm hover:shadow-md transition-all group"
                            >
                                <div className="flex items-center justify-between mb-4">
                                    <div className="w-8 h-8 bg-[#1B3A5C]/5 text-[#1B3A5C]/40 rounded-lg flex items-center justify-center group-hover:bg-[#A68246]/10 group-hover:text-[#A68246] transition-colors">
                                        {stat.icon}
                                    </div>
                                    <span className="text-[10px] font-bold text-[#1B3A5C]/20 uppercase tracking-widest">Global</span>
                                </div>
                                <div className="text-2xl font-bold text-[#1B3A5C] mb-1">{stat.value}</div>
                                <div className="text-[10px] font-bold text-[#1B3A5C]/40 uppercase tracking-widest">{stat.label}</div>
                            </motion.div>
                        ))}
                    </div>

                    {/* Table Section */}
                    <div className="bg-white rounded-[32px] border border-[#1B3A5C]/5 shadow-xl shadow-[#1B3A5C]/5 overflow-hidden">
                        <div className="px-8 py-6 border-b border-[#1B3A5C]/5 flex items-center justify-between">
                            <h2 className="text-sm font-bold text-[#1B3A5C] uppercase tracking-widest">Listado de Usuarios</h2>
                            <button 
                                onClick={() => router.push('/admin/nuevo-usuario')}
                                className="px-4 py-2 bg-[#1B3A5C] text-white rounded-xl text-[10px] font-bold uppercase tracking-widest hover:brightness-110 transition-all shadow-lg shadow-[#1B3A5C]/10"
                            >
                                + Nuevo Usuario
                            </button>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="bg-[#1B3A5C]/[0.02]">
                                        <th className="px-8 py-4 text-left text-[10px] font-bold text-[#1B3A5C]/30 uppercase tracking-widest">Usuario</th>
                                        <th className="px-8 py-4 text-left text-[10px] font-bold text-[#1B3A5C]/30 uppercase tracking-widest">Estado</th>
                                        <th className="px-8 py-4 text-left text-[10px] font-bold text-[#1B3A5C]/30 uppercase tracking-widest">Rol del Sistema</th>
                                        <th className="px-8 py-4 text-right text-[10px] font-bold text-[#1B3A5C]/30 uppercase tracking-widest">Costo Acumulado</th>
                                        <th className="px-8 py-4 text-right text-[10px] font-bold text-[#1B3A5C]/30 uppercase tracking-widest">Acciones</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-[#1B3A5C]/5">
                                    {usuarios.map((u) => (
                                        <tr key={u.id} className="hover:bg-[#1B3A5C]/[0.01] transition-colors group">
                                            <td className="px-8 py-5">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-9 h-9 bg-gradient-to-br from-[#1B3A5C]/5 to-[#A68246]/5 rounded-xl flex items-center justify-center font-bold text-[#1B3A5C]/40 text-xs">
                                                        {u.nombre.charAt(0)}
                                                    </div>
                                                    <div>
                                                        <div className="text-xs font-bold text-[#1B3A5C]">{u.nombre}</div>
                                                        <div className="text-[10px] text-[#1B3A5C]/40">{u.email}</div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-8 py-5">
                                                <button 
                                                    onClick={() => handleToggleActive(u.id)}
                                                    disabled={u.id === user?.id || updatingId === u.id}
                                                    className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold transition-all ${
                                                        u.activo 
                                                        ? 'bg-green-50 text-green-600 hover:bg-green-100' 
                                                        : 'bg-red-50 text-red-600 hover:bg-red-100'
                                                    } disabled:opacity-50`}
                                                >
                                                    {updatingId === u.id ? <Loader2 className="w-3 h-3 animate-spin" /> : (u.activo ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />)}
                                                    {u.activo ? 'ACTIVO' : 'INACTIVO'}
                                                </button>
                                            </td>
                                            <td className="px-8 py-5">
                                                <div className="relative inline-block">
                                                    <select 
                                                        value={u.rol}
                                                        onChange={(e) => handleChangeRole(u.id, e.target.value)}
                                                        disabled={u.id === user?.id || updatingId === u.id}
                                                        className="appearance-none bg-[#1B3A5C]/5 border-none rounded-xl px-4 py-2 pr-10 text-[10px] font-bold text-[#1B3A5C] focus:ring-2 focus:ring-[#A68246]/20 transition-all outline-none disabled:opacity-50"
                                                    >
                                                        {ROLES.map(r => (
                                                            <option key={r.value} value={r.value}>{r.label.toUpperCase()}</option>
                                                        ))}
                                                    </select>
                                                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 text-[#1B3A5C]/30 pointer-events-none" />
                                                </div>
                                            </td>
                                            <td className="px-8 py-5 text-right">
                                                <div className="text-xs font-mono font-bold text-[#1B3A5C]">
                                                    ${u.rol === 'admin' ? '0.000' : u.costo_total_usd.toFixed(3)}
                                                </div>
                                                <div className="text-[9px] text-[#1B3A5C]/30 uppercase font-bold tracking-tighter">
                                                    {u.transcripciones_count} transcripciones
                                                </div>
                                            </td>
                                            <td className="px-8 py-5 text-right">
                                                <button 
                                                    onClick={() => handleDeleteUser(u.id)}
                                                    disabled={u.id === user?.id || updatingId === u.id}
                                                    className="p-2 text-[#1B3A5C]/20 hover:text-red-500 transition-colors disabled:opacity-10"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </main>
            </div>
        </AuthGuard>
    )
}
