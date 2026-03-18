/**
 * useDeepgramSocket — WebSocket connection to backend for real-time transcription.
 * Sends audio chunks and receives transcript messages.
 */
'use client'

import { useRef, useCallback, useState, useEffect } from 'react'
import { useCanvasStore } from '@/stores/canvasStore'
import { wsBaseUrl } from '@/lib/urls'
import type { TranscriptMessage, Segmento, SuggestionMessage } from '@/types'
import { VARIABLES_DEF } from '@/lib/variables'

export function useDeepgramSocket(audienciaId: string) {
    const [isConnected, setIsConnected] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [suggestions, setSuggestions] = useState<SuggestionMessage[]>([])
    const wsRef = useRef<WebSocket | null>(null)
    const reconnectAttemptsRef = useRef(0)
    const maxReconnectAttempts = 10
    const reconnectIntervalMs = 2000

    const {
        addSegment,
        updateProvisional,
        setConnectionStatus,
        setTranscribing,
        addVarDeteccion,
    } = useCanvasStore()

    /** Intenta detectar variables en el texto de un segmento final */
    const detectarVariables = useCallback((texto: string, timestamp: number) => {
        for (const v of VARIABLES_DEF) {
            if (!v.pattern) continue
            const match = v.pattern.exec(texto)
            if (match?.[1]) {
                const valorDetectado = match[1].trim()
                if (valorDetectado.length < 2) continue
                // Fragmento de contexto (máx 50 chars)
                const idx = texto.indexOf(match[0])
                const fragmento = texto.slice(Math.max(0, idx - 10), idx + match[0].length + 10)
                addVarDeteccion({ key: v.key, valorDetectado, texto: fragmento, timestamp })
            }
        }
    }, [addVarDeteccion])

    const connect = useCallback(() => {
        if (wsRef.current?.readyState === WebSocket.OPEN) return

        const token =
            typeof window !== 'undefined' ? localStorage.getItem('access_token') : null
        const path = `/ws/transcripcion/${audienciaId}`
        const base = typeof window !== 'undefined' ? wsBaseUrl() : (process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8000')
        const url = token
            ? `${base}${path}?token=${encodeURIComponent(token)}`
            : `${base}${path}`
        const ws = new WebSocket(url)
        wsRef.current = ws

        ws.onopen = () => {
            setIsConnected(true)
            setError(null)
            setConnectionStatus('connected')
            reconnectAttemptsRef.current = 0
            console.log('WebSocket connected')
        }

        ws.onmessage = (event) => {
            try {
                console.log('WS msg from backend:', event.data.substring(0, 120))
                const data = JSON.parse(event.data)

                switch (data.type) {
                    case 'transcript': {
                        const msg = data as TranscriptMessage
                        if (msg.is_final) {
                            // Detectar variables en el texto transcrito
                            detectarVariables(msg.texto_mejorado || msg.text, msg.start)

                            const textoFinal = msg.texto_mejorado || msg.text

                            const segment: Segmento = {
                                id: crypto.randomUUID(),
                                audiencia_id: audienciaId,
                                speaker_id: msg.speaker,
                                texto_ia: msg.text,
                                texto_editado: null,
                                texto_mejorado: msg.texto_mejorado,
                                timestamp_inicio: msg.start,
                                timestamp_fin: msg.end,
                                confianza: msg.confidence,
                                es_provisional: false,
                                editado_por_usuario: false,
                                fuente: 'streaming',
                                orden: useCanvasStore.getState().segmentCount + 1,
                                palabras_json: msg.words,
                            }
                            addSegment(segment)
                        } else {
                            // Provisional — update the floating text with word-level data
                            updateProvisional(msg.text, msg.speaker, msg.words || [])
                        }
                        break
                    }

                    case 'status':
                        if (data.status === 'connected') {
                            setConnectionStatus('connected')
                        }
                        break

                    case 'speech_started':
                        // Could show "speaking now" indicator
                        break

                    case 'utterance_end':
                        // End of utterance — handled by segment ordering
                        break

                    case 'error':
                        setError(data.message)
                        break

                    case 'suggestion': {
                        const suggestion = data as SuggestionMessage
                        setSuggestions(prev => [...prev, suggestion])
                        break
                    }
                }
            } catch (e) {
                console.error('Error parsing WebSocket message:', e)
            }
        }

        ws.onclose = (event) => {
            setIsConnected(false)
            setConnectionStatus('disconnected')
            console.log(`WebSocket closed — code: ${event.code}, reason: "${event.reason}", wasClean: ${event.wasClean}`)

            // Auto-reconnect
            if (reconnectAttemptsRef.current < maxReconnectAttempts) {
                reconnectAttemptsRef.current++
                setConnectionStatus('reconnecting')
                setTimeout(connect, reconnectIntervalMs)
            }
        }

        ws.onerror = (e) => {
            console.error('WebSocket error event:', e)
            setError('Error de conexión WebSocket')
        }
    }, [audienciaId, addSegment, updateProvisional, setConnectionStatus, detectarVariables])

    const sendAudio = useCallback(
        (base64Data: string, sequence: number) => {
            if (wsRef.current?.readyState === WebSocket.OPEN) {
                wsRef.current.send(
                    JSON.stringify({
                        type: 'audio_chunk',
                        data: base64Data,
                        sequence,
                        timestamp: Date.now() / 1000,
                    })
                )
            }
        },
        []
    )

    const stop = useCallback(() => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: 'stop' }))
        }
        setTranscribing(false)
    }, [setTranscribing])

    const disconnect = useCallback(() => {
        reconnectAttemptsRef.current = maxReconnectAttempts // Prevent reconnection
        wsRef.current?.close()
        wsRef.current = null
        setIsConnected(false)
        setConnectionStatus('disconnected')
    }, [setConnectionStatus])

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            reconnectAttemptsRef.current = maxReconnectAttempts
            wsRef.current?.close()
        }
    }, [])

    return {
        isConnected,
        error,
        suggestions,
        setSuggestions,
        connect,
        sendAudio,
        stop,
        disconnect,
    }
}
