/**
 * TypeScript types for JudiScribe frontend.
 */

// ── Auth ──────────────────────────────────────────────
export interface User {
    id: string
    email: string
    nombre: string
    rol: 'admin' | 'transcriptor' | 'supervisor'
    activo: boolean
}

export interface LoginRequest {
    email: string
    password: string
}

export interface TokenResponse {
    access_token: string
    token_type: string
}

// ── Audiencia ─────────────────────────────────────────
export type EstadoAudiencia = 'pendiente' | 'en_curso' | 'transcrita' | 'en_revision' | 'finalizada'

export interface Audiencia {
    id: string
    expediente: string
    juzgado: string
    tipo_audiencia: string
    instancia: string
    fecha: string
    hora_inicio: string
    hora_fin: string | null
    sala: string | null
    delito: string | null
    imputado_nombre: string | null
    agraviado_nombre: string | null
    especialista_causa: string | null
    especialista_audiencia: string | null
    estado: EstadoAudiencia
    audio_path: string | null
    audio_duration_seconds: number | null
    deepgram_session_id: string | null
    created_by: string
    created_at: string
    updated_at: string
}

export interface AudienciaCreate {
    expediente: string
    juzgado: string
    tipo_audiencia: string
    instancia: string
    fecha: string
    hora_inicio: string
    hora_fin?: string
    sala?: string
    delito?: string
    imputado_nombre?: string
    agraviado_nombre?: string
    especialista_causa?: string
    especialista_audiencia?: string
}

// ── Segmento ──────────────────────────────────────────
export interface WordAlternative {
    word: string
    confidence: number
}

export interface WordTimestamp {
    word: string
    start: number
    end: number
    confidence: number
    alternatives?: WordAlternative[]
}

export interface Segmento {
    id: string
    audiencia_id: string
    speaker_id: string
    texto_ia: string
    texto_editado: string | null
    texto_mejorado?: string | null  // Texto mejorado por Claude en tiempo real
    texto_batch?: string | null     // Texto sugerido de procesamiento batch
    timestamp_inicio: number
    timestamp_fin: number
    confianza: number
    es_provisional: boolean
    editado_por_usuario: boolean
    fuente: 'streaming' | 'batch'
    orden: number
    palabras_json: WordTimestamp[] | null
}

// ── WebSocket Messages ────────────────────────────────
export interface TranscriptMessage {
    type: 'transcript'
    is_final: boolean
    speaker: string
    text: string
    texto_mejorado?: string  // Texto mejorado por Claude
    is_question?: boolean  // Si es una pregunta
    enhancement_confidence?: number  // Confianza del mejoramiento
    confidence: number
    start: number
    end: number
    words: WordTimestamp[]
}

export interface StatusMessage {
    type: 'status'
    status: 'connected' | 'reconnecting' | 'disconnected'
    message: string
}

export interface SuggestionMessage {
    type: 'suggestion'
    segment_order: number
    original_word: string
    suggested_word: string
    position: { start: number; end: number }
    confidence: number
    category: string
}

export type WSMessage = TranscriptMessage | StatusMessage | SuggestionMessage

// ── Speaker Roles ─────────────────────────────────────
export interface SpeakerRole {
    id: number
    /** Clave exacta que el backend acepta (Enum rol_hablante) */
    key: string
    /** Nombre legible para mostrar en la UI */
    rol: string
    etiqueta: string
    color: string
}

// key DEBE coincidir exactamente con el Enum "rol_hablante" en backend/models/hablante.py
export const SPEAKER_ROLES: SpeakerRole[] = [
    { id: 1,  key: 'juez',              rol: 'Juez',                    etiqueta: 'JUEZ:',                                            color: '#2563EB' },
    { id: 2,  key: 'juez_director',     rol: 'Juez Director de Debates', etiqueta: 'JUEZ SUPERIOR – DIRECTOR DE DEBATES:',             color: '#1D4ED8' },
    { id: 3,  key: 'jueces_colegiado',  rol: 'Jueces del Colegiado',    etiqueta: 'JUECES SUPERIORES:',                               color: '#3B82F6' },
    { id: 4,  key: 'fiscal',            rol: 'Fiscal',                  etiqueta: 'REPRESENTANTE DEL MINISTERIO PÚBLICO:',             color: '#059669' },
    { id: 5,  key: 'defensa_imputado',  rol: 'Defensa del imputado',    etiqueta: 'DEFENSA DEL SENTENCIADO (A):',                      color: '#DC2626' },
    { id: 6,  key: 'defensa_agraviado', rol: 'Defensa del agraviado',   etiqueta: 'DEFENSA DE LA PARTE AGRAVIADA:',                    color: '#EA580C' },
    { id: 7,  key: 'imputado',          rol: 'Imputado/Acusado',        etiqueta: 'IMPUTADO:',                                         color: '#D97706' },
    { id: 8,  key: 'agraviado',         rol: 'Agraviado/Víctima',       etiqueta: 'AGRAVIADO:',                                        color: '#7C3AED' },
    { id: 9,  key: 'victima',           rol: 'Víctima',                 etiqueta: 'VÍCTIMA:',                                          color: '#8B5CF6' },
    { id: 10, key: 'asesor_victimas',   rol: 'Asesor de Víctimas',      etiqueta: 'ASESOR JURÍDICO DE VÍCTIMAS:',                      color: '#BE185D' },
    { id: 11, key: 'perito',            rol: 'Perito',                  etiqueta: 'PERITO:',                                            color: '#0891B2' },
    { id: 12, key: 'testigo',           rol: 'Testigo',                 etiqueta: 'TESTIGO:',                                           color: '#16A34A' },
    { id: 13, key: 'asistente',         rol: 'Asistente/Especialista',  etiqueta: 'ASISTENTE DE AUDIENCIA:',                            color: '#64748B' },
    { id: 14, key: 'partes_general',    rol: 'Partes en general',       etiqueta: 'PARTES PROCESALES:',                                 color: '#78716C' },
    { id: 15, key: 'otro',              rol: 'Otro',                    etiqueta: 'OTRO:',                                              color: '#6B7280' },
]

// ── Acta ──────────────────────────────────────────────
export interface Acta {
    id: string
    audiencia_id: string
    version: number
    formato: string
    estado: 'borrador' | 'en_revision' | 'aprobada' | 'exportada'
    contenido_llm: string | null
    contenido_editado: string | null
    modelo_llm: string | null
    tokens_used: number | null
    confianza: number | null
    generado_por: string
    aprobada_por?: string | null
    aprobada_at?: string | null
    created_at: string
    updated_at: string
}
