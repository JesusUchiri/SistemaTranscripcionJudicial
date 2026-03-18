'use client'

/**
 * BarraEstado — Barra inferior del Canvas con métricas en tiempo real.
 *
 * Muestra: palabras, tiempo transcurrido, segmentos, estado de conexión,
 * fuente de audio, y confianza promedio.
 */
import { useCanvasStore } from '@/stores/canvasStore'

export default function BarraEstado() {
    const {
        wordCount,
        elapsedSeconds,
        segmentCount,
        connectionStatus,
        isTranscribing,
        segments,
    } = useCanvasStore()

    // Confianza promedio
    const confianzaPromedio =
        segments.length > 0
            ? segments.reduce((acc, s) => acc + s.confianza, 0) / segments.length
            : 0

    const formatearTiempo = (seg: number) => {
        const h = Math.floor(seg / 3600).toString().padStart(2, '0')
        const m = Math.floor((seg % 3600) / 60).toString().padStart(2, '0')
        const s = (seg % 60).toString().padStart(2, '0')
        return `${h}:${m}:${s}`
    }

    // Calcula la duración en segundos para el costo. Si hay un audio ya subido o se streaméo, usa el max timestamp o el tiempo real.
    const duracionEvaluar = elapsedSeconds > 0 
        ? elapsedSeconds 
        : segments.length > 0 ? segments[segments.length - 1].timestamp_fin : 0;

    const colorConexion = {
        connected: '#059669',
        reconnecting: '#D97706',
        disconnected: '#718096',
    }[connectionStatus]

    const textoConexion = {
        connected: 'Conectado',
        reconnecting: 'Reconectando...',
        disconnected: 'Desconectado',
    }[connectionStatus]

    return (
        <div
            className="px-4 sm:px-6 py-2 flex items-center gap-3 sm:gap-6 shrink-0 text-[10px] sm:text-xs select-none overflow-hidden"
            style={{
                borderTop: '1px solid var(--border-subtle)',
                background: 'var(--bg-secondary)',
                color: 'var(--text-muted)',
            }}
        >
            {/* Indicador de grabación */}
            {isTranscribing && (
                <div className="flex items-center gap-1.5 shrink-0">
                    <span
                        className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full animate-pulse"
                        style={{ background: 'var(--danger)' }}
                    />
                    <span className="font-bold" style={{ color: 'var(--danger)' }}>REC</span>
                </div>
            )}

            {/* Tiempo */}
            <span className="font-mono tabular-nums shrink-0">{formatearTiempo(elapsedSeconds)}</span>

            {/* Separador */}
            <span className="opacity-30 hidden sm:inline">│</span>

            {/* Palabras */}
            <span className="truncate hidden sm:inline">{wordCount.toLocaleString()} pal.</span>

            {/* Separador */}
            <span className="opacity-30 hidden md:inline">│</span>

            {/* Segmentos */}
            <span className="truncate hidden md:inline">{segmentCount} seg.</span>

            {/* Separador */}
            <span className="opacity-30">│</span>

            {/* Precisión promedio con barra visual */}
            <div className="confidence-meter shrink-0">
                <span className="hidden xs:inline">Precisión:</span>
                <div className="confidence-meter__bar w-10 sm:w-12">
                    <div
                        className={`confidence-meter__fill ${confianzaPromedio >= 0.85
                                ? 'confidence-meter__fill--high'
                                : confianzaPromedio >= 0.7
                                    ? 'confidence-meter__fill--medium'
                                    : 'confidence-meter__fill--low'
                            }`}
                        style={{ width: `${confianzaPromedio * 100}%` }}
                    />
                </div>
                <span
                    className="font-bold"
                    style={{
                        color:
                            confianzaPromedio >= 0.85
                                ? '#059669'
                                : confianzaPromedio >= 0.7
                                    ? '#D97706'
                                    : '#DC2626',
                    }}
                >
                    {(confianzaPromedio * 100).toFixed(0)}%
                </span>
            </div>

            {/* Espaciador */}
            <div className="flex-1" />

            {/* Costo IA */}
            {duracionEvaluar > 0 && (
                <div className="flex items-center gap-2 shrink-0 bg-[#A68246]/10 px-2 py-1 rounded" style={{ color: '#C49640' }}>
                    <span className="opacity-80">Costo IA:</span>
                    <span className="font-mono font-bold">${((duracionEvaluar / 60) * 0.0043).toFixed(4)} USD</span>
                    <span className="hidden sm:inline opacity-70">({(duracionEvaluar / 60).toFixed(1)} min)</span>
                </div>
            )}

            {/* Separador */}
            {duracionEvaluar > 0 && <span className="opacity-30">│</span>}

            {/* Estado de conexión */}
            <div className="flex items-center gap-1.5 shrink-0">
                <span
                    className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full"
                    style={{ background: colorConexion }}
                />
                <span className="hidden sm:inline">{textoConexion}</span>
            </div>
        </div>
    )
}
