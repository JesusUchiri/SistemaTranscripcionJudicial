/**
 * Canvas store — manages transcription state, segments, and speakers.
 *
 * Incluye:
 * - Tracking de segmentos editados por el usuario
 * - Estado de seeking para sync audio-canvas
 * - Bookmarks
 */
import { create } from 'zustand'
import type { Segmento, TranscriptMessage, WordTimestamp } from '@/types'

interface Bookmark {
    id: string
    timestamp: number
    note: string
    segmentId?: string
    createdAt: string
}

interface CanvasState {
    segments: Segmento[]
    provisionalText: string | null
    provisionalSpeaker: string | null
    provisionalWords: WordTimestamp[]
    isTranscribing: boolean
    wordCount: number
    elapsedSeconds: number
    connectionStatus: 'disconnected' | 'connected' | 'reconnecting'
    segmentCount: number

    // Audio sync state
    currentAudioTime: number
    activeSegmentId: string | null
    isSeeking: boolean

    // Edited segments tracking (array for Zustand reactivity)
    editedSegmentIds: string[]

    // Bookmarks
    bookmarks: Bookmark[]

    // Actions
    addSegment: (segment: Segmento) => void
    updateSegment: (segmentId: string, newText: string) => void
    updateProvisional: (text: string, speaker: string, words?: WordTimestamp[]) => void
    clearProvisional: () => void
    setTranscribing: (value: boolean) => void
    setConnectionStatus: (status: 'disconnected' | 'connected' | 'reconnecting') => void
    setElapsedSeconds: (seconds: number) => void

    // Audio sync actions
    setCurrentAudioTime: (time: number) => void
    setActiveSegmentId: (segmentId: string | null) => void
    setIsSeeking: (seeking: boolean) => void
    getSegmentAtTime: (time: number) => Segmento | null

    // Bookmark actions
    addBookmark: (bookmark: Omit<Bookmark, 'id' | 'createdAt'>) => void
    removeBookmark: (id: string) => void

    setSegments: (segments: Segmento[]) => void
    reset: () => void
}

export const useCanvasStore = create<CanvasState>((set, get) => ({
    segments: [],
    provisionalText: null,
    provisionalSpeaker: null,
    provisionalWords: [],
    isTranscribing: false,
    wordCount: 0,
    elapsedSeconds: 0,
    connectionStatus: 'disconnected',
    segmentCount: 0,

    // Audio sync state
    currentAudioTime: 0,
    activeSegmentId: null,
    isSeeking: false,

    // Edited segments tracking (array for Zustand reactivity)
    editedSegmentIds: [],

    // Bookmarks
    bookmarks: [],

    addSegment: (segment) =>
        set((state) => {
            // Detectar si este segmento es una extensión/actualización/consolidación de uno anterior
            // (mismo speaker, timestamp de inicio muy cercano o contenido que se extiende)
            const extensionIndex = state.segments.findIndex(s => {
                const sameSpeaker = s.speaker_id === segment.speaker_id

                // Caso 1: Mismo timestamp de inicio (update)
                const startTimeClose = Math.abs((s.timestamp_inicio || 0) - (segment.timestamp_inicio || 0)) < 0.5

                // Caso 2: El nuevo segmento contiene el texto del anterior (consolidación)
                const isConsolidation = sameSpeaker && segment.texto_ia.includes(s.texto_ia)

                // Caso 3: El anterior es subconjunto del nuevo
                const isExtension = sameSpeaker && (startTimeClose || isConsolidation)

                return isExtension
            })

            let newSegments: Segmento[]

            if (extensionIndex !== -1) {
                // Es una extensión/actualización/consolidación - reemplazar el segmento anterior
                const prevSegment = state.segments[extensionIndex]
                console.log('Consolidating segments:',
                    prevSegment.texto_ia.substring(0, 40),
                    '→',
                    segment.texto_ia.substring(0, 60))

                newSegments = [...state.segments]
                newSegments[extensionIndex] = {
                    ...newSegments[extensionIndex],
                    texto_ia: segment.texto_ia,
                    texto_mejorado: segment.texto_mejorado,
                    timestamp_fin: segment.timestamp_fin,
                    confianza: segment.confianza,
                    palabras_json: segment.palabras_json,
                }
            } else {
                // Nuevo segmento - verificar duplicación exacta
                const isDuplicate = state.segments.some(s => {
                    const sameText = s.texto_ia.trim() === segment.texto_ia.trim()
                    const sameSpeaker = s.speaker_id === segment.speaker_id
                    const timeClose = Math.abs((s.timestamp_inicio || 0) - (segment.timestamp_inicio || 0)) < 1.0
                    return sameText && sameSpeaker && timeClose
                })

                if (isDuplicate) {
                    console.log('Duplicate segment ignored:', segment.texto_ia.substring(0, 50))
                    return {
                        provisionalText: null,
                        provisionalSpeaker: null,
                    }
                }

                // Agregar como nuevo segmento
                newSegments = [...state.segments, segment]
            }

            const totalWords = newSegments.reduce(
                (acc, s) => acc + (s.texto_editado || s.texto_mejorado || s.texto_ia).split(/\s+/).length,
                0
            )
            return {
                segments: newSegments,
                segmentCount: newSegments.length,
                wordCount: totalWords,
                provisionalText: null,
                provisionalSpeaker: null,
            }
        }),

    updateSegment: (segmentId, newText) =>
        set((state) => {
            const newSegments = state.segments.map((seg) => {
                if (seg.id === segmentId) {
                    return { ...seg, texto_editado: newText }
                }
                return seg
            })

            // Track this segment as edited by user (avoid duplicates)
            const newEditedIds = state.editedSegmentIds.includes(segmentId)
                ? state.editedSegmentIds
                : [...state.editedSegmentIds, segmentId]

            const totalWords = newSegments.reduce(
                (acc, s) => acc + (s.texto_editado || s.texto_ia).split(/\s+/).length,
                0
            )

            return {
                segments: newSegments,
                editedSegmentIds: newEditedIds,
                wordCount: totalWords,
            }
        }),

    updateProvisional: (text, speaker, words) =>
        set({ provisionalText: text, provisionalSpeaker: speaker, provisionalWords: words || [] }),

    clearProvisional: () =>
        set({ provisionalText: null, provisionalSpeaker: null, provisionalWords: [] }),

    setTranscribing: (value) => set({ isTranscribing: value }),

    setConnectionStatus: (status) => set({ connectionStatus: status }),

    setElapsedSeconds: (seconds) => set({ elapsedSeconds: seconds }),

    // Audio sync actions
    setCurrentAudioTime: (time) => {
        const state = get()
        const activeSegment = state.getSegmentAtTime(time)
        set({
            currentAudioTime: time,
            activeSegmentId: activeSegment?.id || null,
        })
    },

    setActiveSegmentId: (segmentId) => set({ activeSegmentId: segmentId }),

    setIsSeeking: (seeking) => set({ isSeeking: seeking }),

    getSegmentAtTime: (time) => {
        const { segments } = get()
        // Find segment that contains this timestamp
        return segments.find((seg) => {
            const start = seg.timestamp_inicio || 0
            const end = seg.timestamp_fin || start + 5 // Default 5 second segments if no end
            return time >= start && time < end
        }) || null
    },

    // Bookmark actions
    addBookmark: (bookmark) =>
        set((state) => ({
            bookmarks: [
                ...state.bookmarks,
                {
                    ...bookmark,
                    id: `bm-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                    createdAt: new Date().toISOString(),
                },
            ],
        })),

    removeBookmark: (id) =>
        set((state) => ({
            bookmarks: state.bookmarks.filter((b) => b.id !== id),
        })),

    setSegments: (segments) => set({ 
        segments,
        segmentCount: segments.length,
        wordCount: segments.reduce((acc, s) => acc + (s.texto_editado || s.texto_mejorado || s.texto_ia).split(/\s+/).length, 0)
    }),

    reset: () =>
        set({
            segments: [],
            provisionalText: null,
            provisionalSpeaker: null,
            provisionalWords: [],
            isTranscribing: false,
            wordCount: 0,
            elapsedSeconds: 0,
            connectionStatus: 'disconnected',
            segmentCount: 0,
            currentAudioTime: 0,
            activeSegmentId: null,
            isSeeking: false,
            editedSegmentIds: [],
            bookmarks: [],
        }),
}))
