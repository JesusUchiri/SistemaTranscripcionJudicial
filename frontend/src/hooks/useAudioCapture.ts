/**
 * useAudioCapture — captures audio from browser using Web Audio API.
 * Sends raw PCM (linear16 @ 16kHz) chunks — formato que Deepgram soporta en streaming.
 */
'use client'

import { useRef, useCallback, useState } from 'react'

interface AudioCaptureOptions {
    onAudioChunk: (base64Data: string, sequence: number) => void
    sampleRate?: number
    chunkIntervalMs?: number
    /** Multiplicador de ganancia de software (1 = sin boost, 15 = útil para audio de sistema/video) */
    gainValue?: number
}

// Convierte Float32 PCM a Int16 PCM (linear16)
function float32ToInt16Base64(float32: Float32Array): string {
    const int16 = new Int16Array(float32.length)
    for (let i = 0; i < float32.length; i++) {
        const s = Math.max(-1, Math.min(1, float32[i]))
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff
    }
    const bytes = new Uint8Array(int16.buffer)
    let binary = ''
    // Procesar en bloques para evitar stack overflow en strings largas
    const chunkSize = 8192
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunkSize)))
    }
    return btoa(binary)
}

export function useAudioCapture({
    onAudioChunk,
    sampleRate = 16000,
    chunkIntervalMs = 250,
    gainValue = 1,
}: AudioCaptureOptions) {
    const [isCapturing, setIsCapturing] = useState(false)
    const [isPaused, setIsPaused] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [devices, setDevices] = useState<MediaDeviceInfo[]>([])

    const mediaStreamRef = useRef<MediaStream | null>(null)
    const audioContextRef = useRef<AudioContext | null>(null)
    const gainNodeRef = useRef<GainNode | null>(null)
    const processorRef = useRef<ScriptProcessorNode | null>(null)
    const sequenceRef = useRef(0)
    // Buffer acumulador: recoge muestras hasta completar chunkIntervalMs
    const bufferRef = useRef<Float32Array[]>([])
    const samplesPerChunk = useRef(0)
    const samplesAccumRef = useRef(0)
    // Nivel RMS del audio capturado (0-1) — actualizado en cada chunk
    const [audioLevel, setAudioLevel] = useState(0)

    const listDevices = useCallback(async () => {
        try {
            const deviceList = await navigator.mediaDevices.enumerateDevices()
            const audioInputs = deviceList.filter((d) => d.kind === 'audioinput')
            setDevices(audioInputs)
            return audioInputs
        } catch {
            setError('No se pueden listar dispositivos de audio')
            return []
        }
    }, [])

    const startCapture = useCallback(
        async (source: 'microphone' | 'system' | string) => {
            try {
                setError(null)
                console.log('startCapture source:', source)
                let stream: MediaStream

                if (source === 'system') {
                    stream = await navigator.mediaDevices.getDisplayMedia({
                        audio: true,
                        video: false,
                    } as any)
                } else if (source === 'microphone') {
                    stream = await navigator.mediaDevices.getUserMedia({
                        audio: {
                            echoCancellation: false,
                            noiseSuppression: false,
                            autoGainControl: false,
                            sampleRate,
                        },
                    })
                } else {
                    stream = await navigator.mediaDevices.getUserMedia({
                        audio: { deviceId: { exact: source }, sampleRate },
                    })
                }

                console.log('Stream OK, tracks:', stream.getTracks().length)
                mediaStreamRef.current = stream

                // AudioContext a 16kHz para Deepgram linear16
                const ctx = new AudioContext({ sampleRate })
                audioContextRef.current = ctx
                console.log('AudioContext sampleRate:', ctx.sampleRate)

                // bufferSize=4096 → ~256ms a 16kHz; bueno para streaming
                const bufferSize = 4096
                samplesPerChunk.current = Math.floor((sampleRate * chunkIntervalMs) / 1000)
                samplesAccumRef.current = 0
                bufferRef.current = []

                const sourceNode = ctx.createMediaStreamSource(stream)

                // GainNode para amplificar señales débiles (audio de sistema/video suele llegar a <5% RMS)
                const gainNode = ctx.createGain()
                gainNode.gain.value = gainValue
                gainNodeRef.current = gainNode

                // ScriptProcessorNode: funcional aunque marcado como deprecated.
                // AudioWorklet requiere archivo JS separado — se migrará en sprint posterior.
                const processor = ctx.createScriptProcessor(bufferSize, 1, 1)
                processorRef.current = processor

                processor.onaudioprocess = (e) => {
                    const inputData = e.inputBuffer.getChannelData(0)
                    bufferRef.current.push(new Float32Array(inputData))
                    samplesAccumRef.current += inputData.length

                    if (samplesAccumRef.current >= samplesPerChunk.current) {
                        // Concatenar muestras acumuladas
                        const total = samplesAccumRef.current
                        const merged = new Float32Array(total)
                        let offset = 0
                        for (const chunk of bufferRef.current) {
                            merged.set(chunk, offset)
                            offset += chunk.length
                        }
                        bufferRef.current = []
                        samplesAccumRef.current = 0

                        const base64 = float32ToInt16Base64(merged)
                        sequenceRef.current++
                        // Calcular RMS para el medidor de nivel
                        let sumSq = 0
                        for (let k = 0; k < merged.length; k++) sumSq += merged[k] * merged[k]
                        const rms = Math.sqrt(sumSq / merged.length)
                        setAudioLevel(rms)
                        if (sequenceRef.current <= 5 || sequenceRef.current % 20 === 0) {
                            console.log('PCM chunk seq', sequenceRef.current, '— RMS:', rms.toFixed(4), 'gain:', gainValue)
                        }
                        onAudioChunk(base64, sequenceRef.current)
                    }
                }

                // Pipeline: source → gain → processor → silentGain → destination
                // El silentGain (gain=0) satisface el requisito de Chrome para que
                // onaudioprocess se dispare, sin reproducir el audio capturado por los parlantes.
                const silentGain = ctx.createGain()
                silentGain.gain.value = 0
                sourceNode.connect(gainNode)
                gainNode.connect(processor)
                processor.connect(silentGain)
                silentGain.connect(ctx.destination)

                setIsCapturing(true)
                console.log('Audio capture started (PCM linear16 @', sampleRate, 'Hz)')
            } catch (err: any) {
                const msg = err.message || 'Error al capturar audio'
                setError(msg)
                console.error('Audio capture error:', msg, err)
            }
        },
        [onAudioChunk, sampleRate, chunkIntervalMs, gainValue]
    )

    const pauseCapture = useCallback(() => {
        if (!isCapturing || isPaused) return
        // Disconnect the processor node to stop sending audio, but keep AudioContext + stream alive
        if (processorRef.current) {
            processorRef.current.disconnect()
        }
        bufferRef.current = []
        samplesAccumRef.current = 0
        setIsPaused(true)
    }, [isCapturing, isPaused])

    const resumeCapture = useCallback(() => {
        if (!isCapturing || !isPaused) return
        const ctx = audioContextRef.current
        const stream = mediaStreamRef.current
        const processor = processorRef.current
        const gainNode = gainNodeRef.current
        if (!ctx || !stream || !processor || !gainNode) return

        // Resume AudioContext if it was suspended
        if (ctx.state === 'suspended') ctx.resume()

        // Reconnect: source → gain → processor → silentGain → destination
        const sourceNode = ctx.createMediaStreamSource(stream)
        const silentGain = ctx.createGain()
        silentGain.gain.value = 0
        sourceNode.connect(gainNode)
        gainNode.connect(processor)
        processor.connect(silentGain)
        silentGain.connect(ctx.destination)
        setIsPaused(false)
    }, [isCapturing, isPaused])

    const stopCapture = useCallback(() => {
        if (processorRef.current) {
            processorRef.current.disconnect()
            processorRef.current = null
        }
        gainNodeRef.current = null
        if (audioContextRef.current) {
            audioContextRef.current.close()
            audioContextRef.current = null
        }
        if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach((t) => t.stop())
            mediaStreamRef.current = null
        }
        bufferRef.current = []
        samplesAccumRef.current = 0
        sequenceRef.current = 0
        setIsCapturing(false)
        setIsPaused(false)
        setAudioLevel(0)
    }, [])

    return {
        isCapturing,
        isPaused,
        audioLevel,
        error,
        devices,
        listDevices,
        startCapture,
        pauseCapture,
        resumeCapture,
        stopCapture,
    }
}
