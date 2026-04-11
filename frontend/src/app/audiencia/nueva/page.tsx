'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import api from '@/lib/api'
import type { AudienciaCreate } from '@/types'
import { AuthGuard } from '@/components/auth/AuthGuard'
import { useAuthStore } from '@/stores/authStore'
import { motion } from 'framer-motion'
import { ChevronLeft, Gavel, Scale, Clock, MapPin, User, ShieldAlert, Loader2 } from 'lucide-react'

const TIPOS_AUDIENCIA = [
    'Juicio oral',
    'Apelación de sentencia',
    'Prisión preventiva',
    'Lectura de sentencia',
    'Control de acusación',
    'Tutela de derechos',
    'Otro',
]

const INSTANCIAS = [
    { value: 'juzgado_unipersonal', label: 'Juzgado Penal Unipersonal' },
    { value: 'sala_apelaciones', label: 'Sala Penal de Apelaciones' },
]

export default function NuevaAudienciaPage() {
    const router = useRouter()
    const { user } = useAuthStore()
    const [loading, setLoading] = useState(false)

    useEffect(() => {
        if (user?.rol === 'admin') {
            router.replace('/admin')
        }
    }, [user, router])

    const [form, setForm] = useState<AudienciaCreate>({
        expediente: '',
        juzgado: '',
        tipo_audiencia: 'Juicio oral',
        instancia: 'juzgado_unipersonal',
        fecha: new Date().toISOString().split('T')[0],
        hora_inicio: new Date().toTimeString().slice(0, 5),
        sala: '',
        delito: '',
        imputado_nombre: '',
        agraviado_nombre: '',
        especialista_causa: '',
        especialista_audiencia: '',
    })

    const updateField = (field: keyof AudienciaCreate, value: string) => {
        setForm((prev) => ({ ...prev, [field]: value }))
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setLoading(true)
        try {
            const { data } = await api.post('/api/audiencias', form)
            router.push(`/audiencia/${data.id}`)
        } catch (err) {
            console.error('Error creating audiencia:', err)
            setLoading(false)
        }
    }

    return (
        <AuthGuard>
            <div className="min-h-screen bg-[#FDFCFB] flex flex-col overflow-y-auto custom-scrollbar">
                {/* ── Header ─────────────────────────────────── */}
                <header className="px-8 py-6 bg-white border-b border-[#1B3A5C]/5 flex items-center justify-between sticky top-0 z-30">
                    <div className="flex items-center gap-6">
                        <button
                            onClick={() => router.push('/dashboard')}
                            className="w-10 h-10 flex items-center justify-center rounded-xl bg-[#1B3A5C]/5 text-[#1B3A5C] hover:bg-[#1B3A5C]/10 transition-all"
                        >
                            <ChevronLeft className="w-5 h-5" />
                        </button>
                        <div>
                            <h1 className="text-xl font-bold text-[#1B3A5C] tracking-tight" style={{ fontFamily: 'var(--font-display)' }}>
                                Nueva Audiencia
                            </h1>
                            <p className="text-[10px] uppercase tracking-widest text-[#A68246] font-bold">Registro de Sesión Judicial</p>
                        </div>
                    </div>
                </header>

                <main className="flex-1 max-w-4xl mx-auto w-full px-8 py-12">
                    <form onSubmit={handleSubmit} className="space-y-10">
                        {/* Section: Identificación */}
                        <motion.section 
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="space-y-6"
                        >
                            <div className="flex items-center gap-3 pb-2 border-b border-[#1B3A5C]/5">
                                <div className="w-8 h-8 bg-[#1B3A5C]/5 text-[#1B3A5C] rounded-lg flex items-center justify-center">
                                    <Scale className="w-4 h-4" />
                                </div>
                                <h2 className="text-sm font-bold text-[#1B3A5C] uppercase tracking-widest">Identificación del Proceso</h2>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-2">
                                    <label className="text-[10px] font-bold uppercase tracking-widest text-[#1B3A5C]/40 ml-1">N° Expediente *</label>
                                    <input 
                                        type="text" 
                                        value={form.expediente}
                                        onChange={(e) => updateField('expediente', e.target.value)}
                                        required 
                                        placeholder="00XXX-202X-0-1001-JR-PE-XX"
                                        className="w-full px-4 py-3.5 bg-white border border-[#1B3A5C]/10 rounded-2xl text-sm focus:ring-2 focus:ring-[#A68246]/20 focus:border-[#A68246] transition-all outline-none" 
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-bold uppercase tracking-widest text-[#1B3A5C]/40 ml-1">Juzgado / Dependencia *</label>
                                    <input 
                                        type="text" 
                                        value={form.juzgado}
                                        onChange={(e) => updateField('juzgado', e.target.value)}
                                        required 
                                        placeholder="Ej. Quinto Juzgado Penal Unipersonal"
                                        className="w-full px-4 py-3.5 bg-white border border-[#1B3A5C]/10 rounded-2xl text-sm focus:ring-2 focus:ring-[#A68246]/20 focus:border-[#A68246] transition-all outline-none" 
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-bold uppercase tracking-widest text-[#1B3A5C]/40 ml-1">Tipo de Audiencia *</label>
                                    <select 
                                        value={form.tipo_audiencia}
                                        onChange={(e) => updateField('tipo_audiencia', e.target.value)}
                                        className="w-full px-4 py-3.5 bg-white border border-[#1B3A5C]/10 rounded-2xl text-sm focus:ring-2 focus:ring-[#A68246]/20 transition-all outline-none appearance-none"
                                    >
                                        {TIPOS_AUDIENCIA.map((t) => <option key={t} value={t}>{t}</option>)}
                                    </select>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-bold uppercase tracking-widest text-[#1B3A5C]/40 ml-1">Instancia *</label>
                                    <select 
                                        value={form.instancia}
                                        onChange={(e) => updateField('instancia', e.target.value)}
                                        className="w-full px-4 py-3.5 bg-white border border-[#1B3A5C]/10 rounded-2xl text-sm focus:ring-2 focus:ring-[#A68246]/20 transition-all outline-none appearance-none"
                                    >
                                        {INSTANCIAS.map((i) => <option key={i.value} value={i.value}>{i.label}</option>)}
                                    </select>
                                </div>
                            </div>
                        </motion.section>

                        {/* Section: Programación */}
                        <motion.section 
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.1 }}
                            className="space-y-6"
                        >
                            <div className="flex items-center gap-3 pb-2 border-b border-[#1B3A5C]/5">
                                <div className="w-8 h-8 bg-[#1B3A5C]/5 text-[#1B3A5C] rounded-lg flex items-center justify-center">
                                    <Clock className="w-4 h-4" />
                                </div>
                                <h2 className="text-sm font-bold text-[#1B3A5C] uppercase tracking-widest">Programación y Ubicación</h2>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                <div className="space-y-2">
                                    <label className="text-[10px] font-bold uppercase tracking-widest text-[#1B3A5C]/40 ml-1">Fecha *</label>
                                    <input 
                                        type="date" 
                                        value={form.fecha}
                                        onChange={(e) => updateField('fecha', e.target.value)}
                                        required 
                                        className="w-full px-4 py-3.5 bg-white border border-[#1B3A5C]/10 rounded-2xl text-sm focus:ring-2 focus:ring-[#A68246]/20 transition-all outline-none" 
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-bold uppercase tracking-widest text-[#1B3A5C]/40 ml-1">Hora Inicio *</label>
                                    <input 
                                        type="time" 
                                        value={form.hora_inicio}
                                        onChange={(e) => updateField('hora_inicio', e.target.value)}
                                        required 
                                        className="w-full px-4 py-3.5 bg-white border border-[#1B3A5C]/10 rounded-2xl text-sm focus:ring-2 focus:ring-[#A68246]/20 transition-all outline-none" 
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-bold uppercase tracking-widest text-[#1B3A5C]/40 ml-1">Sala / Link Meet</label>
                                    <div className="relative">
                                        <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[#1B3A5C]/20" />
                                        <input 
                                            type="text" 
                                            value={form.sala || ''}
                                            onChange={(e) => updateField('sala', e.target.value)}
                                            placeholder="Ej. Sala 01 / virtual"
                                            className="w-full pl-11 pr-4 py-3.5 bg-white border border-[#1B3A5C]/10 rounded-2xl text-sm focus:ring-2 focus:ring-[#A68246]/20 transition-all outline-none" 
                                        />
                                    </div>
                                </div>
                            </div>
                        </motion.section>

                        {/* Section: Partes Procesales */}
                        <motion.section 
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.2 }}
                            className="space-y-6"
                        >
                            <div className="flex items-center gap-3 pb-2 border-b border-[#1B3A5C]/5">
                                <div className="w-8 h-8 bg-[#1B3A5C]/5 text-[#1B3A5C] rounded-lg flex items-center justify-center">
                                    <User className="w-4 h-4" />
                                </div>
                                <h2 className="text-sm font-bold text-[#1B3A5C] uppercase tracking-widest">Partes Procesales y Delito</h2>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-2">
                                    <label className="text-[10px] font-bold uppercase tracking-widest text-[#1B3A5C]/40 ml-1">Delito Imputado</label>
                                    <div className="relative">
                                        <ShieldAlert className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[#1B3A5C]/20" />
                                        <input 
                                            type="text" 
                                            value={form.delito || ''}
                                            onChange={(e) => updateField('delito', e.target.value)}
                                            placeholder="Ej. Robo agravado"
                                            className="w-full pl-11 pr-4 py-3.5 bg-white border border-[#1B3A5C]/10 rounded-2xl text-sm focus:ring-2 focus:ring-[#A68246]/20 transition-all outline-none" 
                                        />
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-bold uppercase tracking-widest text-[#1B3A5C]/40 ml-1">Nombre del Imputado</label>
                                    <input 
                                        type="text" 
                                        value={form.imputado_nombre || ''}
                                        onChange={(e) => updateField('imputado_nombre', e.target.value)}
                                        className="w-full px-4 py-3.5 bg-white border border-[#1B3A5C]/10 rounded-2xl text-sm focus:ring-2 focus:ring-[#A68246]/20 transition-all outline-none" 
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-bold uppercase tracking-widest text-[#1B3A5C]/40 ml-1">Nombre del Agraviado</label>
                                    <input 
                                        type="text" 
                                        value={form.agraviado_nombre || ''}
                                        onChange={(e) => updateField('agraviado_nombre', e.target.value)}
                                        className="w-full px-4 py-3.5 bg-white border border-[#1B3A5C]/10 rounded-2xl text-sm focus:ring-2 focus:ring-[#A68246]/20 transition-all outline-none" 
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-bold uppercase tracking-widest text-[#1B3A5C]/40 ml-1">Especialista Judicial</label>
                                    <input 
                                        type="text" 
                                        value={form.especialista_audiencia || ''}
                                        onChange={(e) => updateField('especialista_audiencia', e.target.value)}
                                        className="w-full px-4 py-3.5 bg-white border border-[#1B3A5C]/10 rounded-2xl text-sm focus:ring-2 focus:ring-[#A68246]/20 transition-all outline-none" 
                                    />
                                </div>
                            </div>
                        </motion.section>

                        {/* Submit Button */}
                        <motion.div 
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ delay: 0.3 }}
                            className="pt-6"
                        >
                            <button 
                                type="submit" 
                                disabled={loading}
                                className="w-full py-5 bg-[#1B3A5C] text-white rounded-[20px] font-bold text-sm uppercase tracking-widest hover:brightness-110 transition-all shadow-xl shadow-[#1B3A5C]/20 flex items-center justify-center gap-3 disabled:opacity-50"
                            >
                                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Gavel className="w-5 h-5" />}
                                {loading ? 'Registrando Audiencia...' : 'Crear Expediente e Iniciar'}
                            </button>
                        </motion.div>
                    </form>
                </main>
            </div>
        </AuthGuard>
    )
}
