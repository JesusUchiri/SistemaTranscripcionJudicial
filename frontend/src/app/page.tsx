'use client'

import { motion } from 'framer-motion'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/stores/authStore'
import { 
    Mic2, 
    Zap, 
    ShieldCheck, 
    ArrowRight,
    Cpu,
    CheckCircle2
} from 'lucide-react'

export default function LandingPage() {
    const router = useRouter()
    const { user } = useAuthStore()

    // Si ya está logueado, permitir ir al dashboard
    const handleAction = () => {
        if (user) {
            router.push('/dashboard')
        } else {
            router.push('/login')
        }
    }

    const fadeInUp = {
        initial: { opacity: 0, y: 20 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.6 }
    }

    return (
        <div className="min-h-screen bg-[#FDFCFB] text-[#1A1A1A] selection:bg-[#A68246]/20">
            {/* ── Navigation ──────────────────────────────── */}
            <nav className="fixed top-0 w-full z-50 bg-white/80 backdrop-blur-md border-b border-[#A68246]/10">
                <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-[#1B3A5C] text-[#FDFCFB] flex items-center justify-center rounded-xl font-bold text-xl shadow-lg shadow-[#1B3A5C]/20">
                            J
                        </div>
                        <div>
                            <span className="text-xl font-bold tracking-tight text-[#1B3A5C]" style={{ fontFamily: 'var(--font-display)' }}>
                                JudiScribe
                            </span>
                            <span className="block text-[10px] uppercase tracking-widest text-[#A68246] font-bold">
                                Justicia Inteligente
                            </span>
                        </div>
                    </div>
                    
                    <div className="hidden md:flex items-center gap-8 text-sm font-medium text-[#1B3A5C]/70">
                        <a href="#proceso" className="hover:text-[#A68246] transition-colors">Proceso</a>
                        <a href="#tecnologia" className="hover:text-[#A68246] transition-colors">Tecnología</a>
                        <a href="#seguridad" className="hover:text-[#A68246] transition-colors">Seguridad</a>
                    </div>

                    <button 
                        onClick={handleAction}
                        className="px-6 py-2.5 bg-[#1B3A5C] text-white rounded-full text-sm font-semibold hover:bg-[#1B3A5C]/90 transition-all shadow-md shadow-[#1B3A5C]/20"
                    >
                        {user ? 'Ir al Dashboard' : 'Acceso Judicial'}
                    </button>
                </div>
            </nav>

            {/* ── Hero Section ────────────────────────────── */}
            <section className="relative pt-40 pb-20 overflow-hidden">
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[600px] bg-gradient-to-b from-[#A68246]/5 to-transparent rounded-full blur-3xl -z-10" />
                
                <div className="max-w-7xl mx-auto px-6 text-center">
                    <motion.div 
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.8 }}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#1B3A5C]/5 border border-[#1B3A5C]/10 text-[#1B3A5C] text-xs font-bold uppercase tracking-widest mb-8"
                    >
                        <Zap className="w-3 h-3 text-[#A68246]" />
                        Deepgram Nova-3 & Claude Sonnet
                    </motion.div>

                    <motion.h1 
                        {...fadeInUp}
                        className="text-5xl md:text-7xl font-bold text-[#1B3A5C] leading-[1.1] mb-8"
                        style={{ fontFamily: 'var(--font-display)' }}
                    >
                        La voz de la justicia,<br />
                        <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#A68246] to-[#1B3A5C]">transcrita con precisión.</span>
                    </motion.h1 >

                    <motion.p 
                        {...fadeInUp}
                        transition={{ delay: 0.2 }}
                        className="max-w-2xl mx-auto text-lg md:text-xl text-[#1B3A5C]/60 leading-relaxed mb-12"
                    >
                        Sistema especializado de transcripción en tiempo real y generación de actas para la Corte Superior de Justicia del Cusco. 
                        Reduzca el tiempo de redacción en un 80%.
                    </motion.p>

                    <motion.div 
                        {...fadeInUp}
                        transition={{ delay: 0.3 }}
                        className="flex flex-col sm:flex-row items-center justify-center gap-4"
                    >
                        <button 
                            onClick={handleAction}
                            className="w-full sm:w-auto px-8 py-4 bg-[#A68246] text-white rounded-2xl font-bold text-lg hover:brightness-110 transition-all shadow-xl shadow-[#A68246]/20 flex items-center justify-center gap-2"
                        >
                            Comenzar ahora <ArrowRight className="w-5 h-5" />
                        </button>
                        <a 
                            href="#proceso"
                            className="w-full sm:w-auto px-8 py-4 bg-white text-[#1B3A5C] border border-[#1B3A5C]/10 rounded-2xl font-bold text-lg hover:bg-[#1B3A5C]/5 transition-all"
                        >
                            Ver demostración
                        </a>
                    </motion.div>

                    {/* Dashboard Preview */}
                    <motion.div 
                        initial={{ opacity: 0, y: 40 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.5, duration: 1 }}
                        className="mt-20 relative mx-auto max-w-5xl rounded-3xl border border-[#A68246]/20 shadow-2xl overflow-hidden bg-white"
                    >
                        <div className="absolute inset-0 bg-gradient-to-tr from-[#1B3A5C]/5 to-transparent" />
                        <img 
                            src="https://images.unsplash.com/photo-1589829545856-d10d557cf95f?auto=format&fit=crop&q=80&w=2000" 
                            alt="Justicia Cusco"
                            className="w-full h-auto opacity-20 grayscale"
                        />
                        <div className="absolute inset-0 flex items-center justify-center">
                            <div className="w-[80%] h-[70%] bg-[#FDFCFB] rounded-xl shadow-2xl border border-[#A68246]/10 flex flex-col p-4">
                                <div className="flex items-center gap-2 mb-4 border-b pb-2">
                                    <div className="w-3 h-3 rounded-full bg-red-400" />
                                    <div className="w-3 h-3 rounded-full bg-yellow-400" />
                                    <div className="w-3 h-3 rounded-full bg-green-400" />
                                </div>
                                <div className="space-y-3">
                                    <div className="h-4 w-[40%] bg-[#1B3A5C]/10 rounded" />
                                    <div className="h-4 w-full bg-[#1B3A5C]/5 rounded" />
                                    <div className="h-4 w-[90%] bg-[#1B3A5C]/5 rounded" />
                                    <div className="h-4 w-[95%] bg-[#1B3A5C]/5 rounded" />
                                    <div className="flex gap-2">
                                        <div className="h-8 w-24 bg-[#A68246]/20 rounded-lg" />
                                        <div className="h-8 w-24 bg-[#1B3A5C]/10 rounded-lg" />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </motion.div>
                </div>
            </section>

            {/* ── Features Grid ───────────────────────────── */}
            <section id="tecnologia" className="py-24 bg-[#1B3A5C]">
                <div className="max-w-7xl mx-auto px-6">
                    <div className="text-center mb-20">
                        <h2 className="text-3xl md:text-5xl font-bold text-white mb-6" style={{ fontFamily: 'var(--font-display)' }}>
                            Potencia Tecnológica al Servicio de la Ley
                        </h2>
                        <p className="text-white/60 text-lg max-w-2xl mx-auto">
                            Combinamos los modelos de IA más avanzados para garantizar la fidelidad absoluta de cada palabra pronunciada en sala.
                        </p>
                    </div>

                    <div className="grid md:grid-cols-3 gap-8">
                        {[
                            {
                                icon: <Mic2 className="w-8 h-8 text-[#A68246]" />,
                                title: "Transcripción Nova-3",
                                desc: "Detección de voz de última generación con diarización de hablantes y latencia menor a 1 segundo."
                            },
                            {
                                icon: <Cpu className="w-8 h-8 text-[#A68246]" />,
                                title: "Claude AI Integration",
                                desc: "Generación de actas estructuradas siguiendo los formatos oficiales del Poder Judicial peruano."
                            },
                            {
                                icon: <ShieldCheck className="w-8 h-8 text-[#A68246]" />,
                                title: "Seguridad Judicial",
                                desc: "Encriptación de grado bancario y cumplimiento estricto de la ley de protección de datos personales."
                            }
                        ].map((f, i) => (
                            <motion.div 
                                key={i}
                                initial={{ opacity: 0, y: 20 }}
                                whileInView={{ opacity: 1, y: 0 }}
                                viewport={{ once: true }}
                                transition={{ delay: i * 0.1 }}
                                className="p-8 rounded-3xl bg-white/5 border border-white/10 hover:bg-white/10 transition-all group"
                            >
                                <div className="mb-6 group-hover:scale-110 transition-transform">{f.icon}</div>
                                <h3 className="text-xl font-bold text-white mb-4">{f.title}</h3>
                                <p className="text-white/60 leading-relaxed">{f.desc}</p>
                            </motion.div>
                        ))}
                    </div>
                </div>
            </section>

            {/* ── Process Section ─────────────────────────── */}
            <section id="proceso" className="py-24">
                <div className="max-w-7xl mx-auto px-6">
                    <div className="grid lg:grid-cols-2 gap-20 items-center">
                        <div>
                            <span className="text-[#A68246] font-bold text-sm uppercase tracking-widest mb-4 block">El Flujo Judicial</span>
                            <h2 className="text-4xl md:text-5xl font-bold text-[#1B3A5C] mb-8" style={{ fontFamily: 'var(--font-display)' }}>
                                Diseñado por y para digitadores.
                            </h2>
                            
                            <div className="space-y-8">
                                {[
                                    { step: "01", title: "Captura en Vivo", desc: "Grabe el audio directamente desde Meet o consola física." },
                                    { step: "02", title: "Edición Inteligente", desc: "Corrija en tiempo real sobre un Canvas optimizado para la ley." },
                                    { step: "03", title: "Generación de Acta", desc: "Un clic para transformar la transcripción en un documento oficial." }
                                ].map((s, i) => (
                                    <div key={i} className="flex gap-6">
                                        <span className="text-3xl font-bold text-[#A68246]/30">{s.step}</span>
                                        <div>
                                            <h4 className="text-xl font-bold text-[#1B3A5C] mb-2">{s.title}</h4>
                                            <p className="text-[#1B3A5C]/60">{s.desc}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                        
                        <div className="relative">
                            <div className="absolute inset-0 bg-[#A68246]/10 rounded-full blur-3xl" />
                            <div className="relative p-8 bg-white rounded-3xl border border-[#A68246]/20 shadow-2xl">
                                <div className="space-y-4">
                                    <div className="flex items-center gap-3 p-3 bg-[#1B3A5C]/5 rounded-xl border border-[#1B3A5C]/10">
                                        <CheckCircle2 className="w-5 h-5 text-[#A68246]" />
                                        <span className="text-sm font-medium text-[#1B3A5C]">Diccionario Jurídico Cusco v4.2</span>
                                    </div>
                                    <div className="flex items-center gap-3 p-3 bg-[#1B3A5C]/5 rounded-xl border border-[#1B3A5C]/10">
                                        <CheckCircle2 className="w-5 h-5 text-[#A68246]" />
                                        <span className="text-sm font-medium text-[#1B3A5C]">Plantillas Oficiales (Unipersonal/Sala)</span>
                                    </div>
                                    <div className="flex items-center gap-3 p-3 bg-[#1B3A5C]/5 rounded-xl border border-[#1B3A5C]/10">
                                        <CheckCircle2 className="w-5 h-5 text-[#A68246]" />
                                        <span className="text-sm font-medium text-[#1B3A5C]">Exportación DOCX/PDF Instantánea</span>
                                    </div>
                                </div>
                                
                                <div className="mt-8 pt-8 border-t border-[#A68246]/10 flex items-center justify-between">
                                    <div className="flex -space-x-2">
                                        {[1,2,3,4].map(i => (
                                            <div key={i} className="w-8 h-8 rounded-full border-2 border-white bg-gray-200" />
                                        ))}
                                    </div>
                                    <span className="text-xs text-[#1B3A5C]/40 font-bold uppercase tracking-wider">
                                        +50 Digitadores activos
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* ── Footer ──────────────────────────────────── */}
            <footer className="py-20 bg-[#1A1A1A] text-white">
                <div className="max-w-7xl mx-auto px-6">
                    <div className="flex flex-col md:flex-row justify-between items-center gap-10">
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-white text-[#1A1A1A] flex items-center justify-center rounded-lg font-bold">
                                J
                            </div>
                            <span className="text-lg font-bold tracking-tight">
                                JudiScribe
                            </span>
                        </div>
                        
                        <div className="flex gap-8 text-sm text-white/40">
                            <p>© 2026 JudiScribe Judicial.</p>
                            <p>Distrito Judicial de Cusco.</p>
                        </div>

                        <div className="flex gap-4">
                            <button 
                                onClick={handleAction}
                                className="px-6 py-2 bg-white text-[#1A1A1A] rounded-full text-sm font-bold hover:bg-white/90 transition-all"
                            >
                                Iniciar Sesión
                            </button>
                        </div>
                    </div>
                </div>
            </footer>
        </div>
    )
}
