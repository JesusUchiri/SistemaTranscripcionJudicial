'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuthStore } from '@/stores/authStore'
import { GoogleLogin } from '@react-oauth/google'
import { motion } from 'framer-motion'
import { Gavel, ShieldCheck, Mail, Lock, Loader2 } from 'lucide-react'

function LoginForm() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const { login, googleLogin, isLoading, error, user } = useAuthStore()
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')

    // Redirigir si ya está autenticado
    useEffect(() => {
        if (user) {
            if (user.rol === 'admin') {
                router.replace('/admin')
            } else {
                router.replace('/dashboard')
            }
        }
    }, [user, router])

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        const success = await login({ email, password })
        if (success) {
            const userState = useAuthStore.getState()
            if (userState.user?.rol === 'admin') {
                router.replace('/admin')
            } else {
                router.replace('/dashboard')
            }
        }
    }

    const handleGoogleSuccess = async (response: any) => {
        if (response.credential) {
            const success = await googleLogin(response.credential)
            if (success) {
                router.replace('/dashboard')
            }
        }
    }

    const usarCredencialesDemo = (tipo: 'digitador' | 'admin') => {
        if (tipo === 'digitador') {
            setEmail('digitador@judiscribe.pe')
            setPassword('Digitador2024!')
        } else {
            setEmail('admin@judiscribe.pe')
            setPassword('JudiScribe2024!')
        }
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-[#FDFCFB] p-6 relative overflow-hidden">
            {/* ── Background Elements ─────────────────────── */}
            <div className="absolute inset-0 -z-10">
                <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-[#A68246]/5 rounded-full blur-[120px]" />
                <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-[#1B3A5C]/5 rounded-full blur-[120px]" />
            </div>

            <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="w-full max-w-md"
            >
                {/* Logo & Header */}
                <div className="text-center mb-10">
                    <div className="inline-flex items-center justify-center w-16 h-16 bg-[#1B3A5C] text-white rounded-2xl shadow-xl mb-6">
                        <Gavel className="w-8 h-8" />
                    </div>
                    <h1 className="text-3xl font-bold text-[#1B3A5C] tracking-tight" style={{ fontFamily: 'var(--font-display)' }}>
                        Acceso Judicial
                    </h1>
                    <p className="text-[#1B3A5C]/60 mt-2 text-sm uppercase tracking-widest font-bold">
                        JudiScribe Cusco
                    </p>
                </div>

                {/* Main Card */}
                <div className="bg-white rounded-[32px] p-8 shadow-2xl shadow-[#1B3A5C]/5 border border-[#A68246]/10">
                    <form onSubmit={handleSubmit} className="space-y-5">
                        <div className="space-y-2">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-[#1B3A5C]/40 ml-1">
                                Correo Institucional
                            </label>
                            <div className="relative">
                                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[#1B3A5C]/30" />
                                <input
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    required
                                    placeholder="usuario@pj.gob.pe"
                                    className="w-full pl-11 pr-4 py-4 bg-[#1B3A5C]/5 border-none rounded-2xl text-sm focus:ring-2 focus:ring-[#A68246]/20 transition-all outline-none"
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-[#1B3A5C]/40 ml-1">
                                Contraseña
                            </label>
                            <div className="relative">
                                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[#1B3A5C]/30" />
                                <input
                                    type="password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    required
                                    placeholder="••••••••"
                                    className="w-full pl-11 pr-4 py-4 bg-[#1B3A5C]/5 border-none rounded-2xl text-sm focus:ring-2 focus:ring-[#A68246]/20 transition-all outline-none"
                                />
                            </div>
                        </div>

                        {error && (
                            <motion.div 
                                initial={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                className="p-4 bg-red-50 text-red-600 rounded-2xl text-xs font-medium border border-red-100"
                            >
                                {error}
                            </motion.div>
                        )}

                        <button
                            type="submit"
                            disabled={isLoading}
                            className="w-full py-4 bg-[#1B3A5C] text-white rounded-2xl font-bold text-sm hover:brightness-110 transition-all shadow-lg shadow-[#1B3A5C]/20 flex items-center justify-center gap-2"
                        >
                            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Entrar al Sistema'}
                        </button>
                    </form>

                    <div className="relative my-8 text-center">
                        <div className="absolute inset-0 flex items-center">
                            <div className="w-full border-t border-[#1B3A5C]/5" />
                        </div>
                        <span className="relative px-4 bg-white text-[10px] font-bold uppercase tracking-widest text-[#1B3A5C]/30">
                            O continuar con
                        </span>
                    </div>

                    <div className="flex justify-center">
                        {process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ? (
                            <GoogleLogin
                                onSuccess={handleGoogleSuccess}
                                onError={() => {}}
                                useOneTap
                                theme="outline"
                                shape="pill"
                                width="350"
                            />
                        ) : (
                            <p className="text-[10px] text-[#1B3A5C]/20 uppercase font-bold">Google Auth no configurado</p>
                        )}
                    </div>

                    {/* Quick Access */}
                    <div className="mt-8 grid grid-cols-2 gap-3">
                        <button
                            onClick={() => usarCredencialesDemo('digitador')}
                            className="p-3 bg-[#A68246]/5 border border-[#A68246]/10 rounded-2xl text-[10px] font-bold text-[#A68246] hover:bg-[#A68246]/10 transition-all"
                        >
                            Digitador Demo
                        </button>
                        <button
                            onClick={() => usarCredencialesDemo('admin')}
                            className="p-3 bg-[#1B3A5C]/5 border border-[#1B3A5C]/10 rounded-2xl text-[10px] font-bold text-[#1B3A5C] hover:bg-[#1B3A5C]/10 transition-all"
                        >
                            Admin Demo
                        </button>
                    </div>
                </div>

                <div className="mt-10 text-center space-y-4">
                    <div className="flex items-center justify-center gap-2 text-[#1B3A5C]/40">
                        <ShieldCheck className="w-4 h-4" />
                        <span className="text-[10px] font-bold uppercase tracking-widest">Conexión Segura SSL</span>
                    </div>
                    <p className="text-[10px] text-[#1B3A5C]/30 leading-relaxed max-w-[280px] mx-auto uppercase tracking-tighter">
                        Propiedad de la Corte Superior de Justicia del Cusco. Uso restringido a personal autorizado.
                    </p>
                </div>
            </motion.div>
        </div>
    )
}

export default function LoginPage() {
    return (
        <Suspense fallback={null}>
            <LoginForm />
        </Suspense>
    )
}
