/**
 * useAudioCapture — captures audio from browser using MediaRecorder API.
 * Sends WAV/PCM chunks via callback.
 */
'use client'

import { useRef, useCallback, useState } from 'react'

interface AudioCaptureOptions {
    onAudioChunk: (base64Data: string, sequence: number) => void
    sampleRate?: number
    chunkIntervalMs?: number
}

export function useAudioCapture({
    onAudioChunk,
    sampleRate = 16000,
    chunkIntervalMs = 250,
}: AudioCaptureOptions) {
    const [isCapturing, setIsCapturing] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [devices, setDevices] = useState<MediaDeviceInfo[]>([])

    const mediaStreamRef = useRef<MediaStream | null>(null)
    const recorderRef = useRef<MediaRecorder | null>(null)
    const sequenceRef = useRef(0)
    const chunksRef = useRef<Blob[]>([])
    const timerRef = useRef<NodeJS.Timeout | null>(null)

    const listDevices = useCallback(async () => {
        try {
            const deviceList = await navigator.mediaDevices.enumerateDevices()
            const audioInputs = deviceList.filter((d) => d.kind === 'audioinput')
            setDevices(audioInputs)
            return audioInputs
        } catch (err) {
            setError('No se pueden listar dispositivos de audio')
            return []
        }
    }, [])

    const startCapture = useCallback(
        async (source: 'microphone' | 'system' | string) => {
            try {
                setError(null)
                console.log('🎤 startCapture called with source:', source)
                let stream: MediaStream

                if (source === 'system') {
                    console.log('📺 Requesting system audio...')
                    stream = await navigator.mediaDevices.getDisplayMedia({
                        audio: true,
                        video: false,
                    } as any)
                } else if (source === 'microphone') {
                    console.log('🎙️ Requesting microphone...')
                    stream = await navigator.mediaDevices.getUserMedia({
                        audio: {
                            echoCancellation: true,
                            noiseSuppression: true,
                            autoGainControl: true,
                        },
                    })
                } else {
                    console.log('🎧 Requesting specific device:', source)
                    stream = await navigator.mediaDevices.getUserMedia({
                        audio: { deviceId: { exact: source } },
                    })
                }

                console.log('✅ Stream obtained:', stream.getTracks().length, 'tracks')
                mediaStreamRef.current = stream

                // Use MediaRecorder API (no deprecation warnings)
                const mimeType = MediaRecorder.isTypeSupported('audio/webm')
                    ? 'audio/webm'
                    : 'audio/mp4'
                console.log('📁 MIME type:', mimeType)

                const recorder = new MediaRecorder(stream, { mimeType })
                recorderRef.current = recorder

                recorder.ondataavailable = (e) => {
                    console.log('📦 ondataavailable fired, size:', e.data.size, 'bytes')
                    if (e.data.size > 0) {
                        // Convert blob to base64 immediately when data is available
                        const reader = new FileReader()
                        reader.onloadend = () => {
                            const base64 = reader.result as string
                            const base64Data = base64.split(',')[1] || base64
                            console.log('🔼 Sending audio chunk:', base64Data.length, 'chars, sequence:', sequenceRef.current + 1)

                            sequenceRef.current++
                            onAudioChunk(base64Data, sequenceRef.current)
                        }
                        reader.readAsDataURL(e.data)
                    }
                }

                // Start recording with timeslice — ondataavailable fires every chunkIntervalMs
                console.log('▶️ Starting recorder with timeslice:', chunkIntervalMs, 'ms')
                recorder.start(chunkIntervalMs)

                setIsCapturing(true)
                console.log('✅ Audio capture started')
            } catch (err: any) {
                const errMsg = err.message || 'Error al capturar audio'
                setError(errMsg)
                console.error('❌ Audio capture error:', errMsg, err)
            }
        },
        [onAudioChunk, chunkIntervalMs]
    )

    const stopCapture = useCallback(() => {
        if (timerRef.current) {
            clearInterval(timerRef.current)
            timerRef.current = null
        }
        if (recorderRef.current && recorderRef.current.state !== 'inactive') {
            recorderRef.current.stop()
            recorderRef.current = null
        }
        if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach((t) => t.stop())
            mediaStreamRef.current = null
        }
        chunksRef.current = []
        sequenceRef.current = 0
        setIsCapturing(false)
    }, [])

    return {
        isCapturing,
        error,
        devices,
        listDevices,
        startCapture,
        stopCapture,
    }
}
