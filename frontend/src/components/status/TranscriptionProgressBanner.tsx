'use client'

/**
 * Banner mostrado cuando una audiencia está siendo transcrita en background.
 * Componente aislado para que su re-render (cada 1s por el tick) no propague
 * cambios al árbol padre — evita loops infinitos al usar React.memo.
 */
import { memo } from 'react'
import { Loader2, RotateCw } from 'lucide-react'
import type { Audiencia } from '@/types'

interface Props {
    audiencia: Audiencia
    pollingElapsed: number
    onReintentar: () => void
    reintentando: boolean
    reintentoError: string | null
}

function TranscriptionProgressBannerImpl({
    audiencia,
    pollingElapsed,
    onReintentar,
    reintentando,
    reintentoError,
}: Props) {
    // Invariante: este banner SOLO existe mientras Deepgram batch procesa.
    // El caller (page.tsx) ya lo condiciona, pero hacemos guard defensivo para
    // garantizar que NUNCA aparezca en otros estados (pendiente, transcrita…).
    if (audiencia.estado !== 'en_curso') return null

    const audMin = audiencia.audio_duration_seconds
        ? Math.round(audiencia.audio_duration_seconds / 60)
        : null
    const audSec = audiencia.audio_duration_seconds || 0
    // Deepgram batch ~5s por cada minuto de audio + ~30s overhead
    const expectedSec = Math.max(60, 30 + Math.round(audSec * (5 / 60)))

    const rawPct = Math.min(100, (pollingElapsed / expectedSec) * 100)
    const pct =
        pollingElapsed >= expectedSec
            ? Math.min(95, 60 + (pollingElapsed - expectedSec) * 0.5)
            : rawPct

    const etaSec = Math.max(0, expectedSec - pollingElapsed)
    const etaMm = Math.floor(etaSec / 60)
    const etaSs = String(etaSec % 60).padStart(2, '0')
    const elapMm = Math.floor(pollingElapsed / 60)
    const elapSs = String(pollingElapsed % 60).padStart(2, '0')
    const overTime = pollingElapsed > expectedSec
    // Tras el early return de arriba, estado siempre es 'en_curso'. Mostramos reintentar
    // únicamente si la transcripción está tardando más de lo razonable.
    const tookTooLong = pollingElapsed > expectedSec + 60
    const showRetry = tookTooLong

    return (
        <div className="m-4 p-4 bg-amber-50 border border-amber-200 rounded-xl">
            <div className="flex items-start gap-3">
                <Loader2 className="w-5 h-5 animate-spin text-amber-600 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-3 flex-wrap mb-2">
                        <p className="text-[11px] font-bold text-amber-900 uppercase tracking-widest">
                            Transcribiendo en Deepgram
                        </p>
                        <p className="text-xs font-bold text-amber-900">
                            {Math.round(pct)}%
                            {!overTime && (
                                <span className="ml-2 font-normal text-amber-700/70">
                                    · falta ~{etaMm}:{etaSs}
                                </span>
                            )}
                            {overTime && (
                                <span className="ml-2 font-normal text-amber-700/70">
                                    · tomando más de lo esperado
                                </span>
                            )}
                        </p>
                    </div>

                    {/* Barra de progreso (CSS transition, sin framer-motion) */}
                    <div className="w-full h-2 bg-amber-100 rounded-full overflow-hidden mb-2">
                        <div
                            className={`h-full rounded-full transition-[width] duration-700 ease-out ${
                                overTime ? 'bg-amber-500' : 'bg-amber-600'
                            }`}
                            style={{ width: `${pct}%` }}
                        />
                    </div>

                    <div className="flex items-center gap-3 text-[10px] text-amber-700/70 flex-wrap">
                        <span>
                            ⏱ Transcurrido{' '}
                            <code className="bg-amber-100 px-1 rounded font-mono">
                                {elapMm}:{elapSs}
                            </code>
                        </span>
                        {audMin !== null && (
                            <span>
                                🎧 Audio <strong>{audMin} min</strong>
                            </span>
                        )}
                        <span>
                            ⏳ Estimado total <strong>~{Math.ceil(expectedSec / 60)} min</strong>
                        </span>
                        <span>
                            Estado: <code className="bg-amber-100 px-1 rounded">{audiencia.estado}</code>
                        </span>
                    </div>

                    {reintentoError && (
                        <p className="text-xs text-red-700 mt-2 font-bold">{reintentoError}</p>
                    )}
                    {showRetry && !reintentoError && (
                        <p className="text-[10px] text-amber-700/80 mt-2">
                            Está tardando más de lo esperado. Puedes Reintentar si crees que se atascó.
                        </p>
                    )}
                </div>
                {showRetry && (
                    <button
                        onClick={onReintentar}
                        disabled={reintentando}
                        className="shrink-0 px-3 py-2 bg-amber-600 text-white rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-amber-700 disabled:opacity-50 transition-all flex items-center gap-1.5"
                    >
                        {reintentando ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                            <RotateCw className="w-3 h-3" />
                        )}
                        {reintentando ? 'Disparando...' : 'Reintentar'}
                    </button>
                )}
            </div>
        </div>
    )
}

export const TranscriptionProgressBanner = memo(TranscriptionProgressBannerImpl)
export default TranscriptionProgressBanner
