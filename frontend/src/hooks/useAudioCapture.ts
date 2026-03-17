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
                let stream: MediaStream

                if (source === 'system') {
                    // Capture system audio via getDisplayMedia
                    stream = await navigator.mediaDevices.getDisplayMedia({
                        audio: true,
                        video: false,
                    } as any)
                } else if (source === 'microphone') {
                    stream = await navigator.mediaDevices.getUserMedia({
                        audio: {
                            echoCancellation: true,
                            noiseSuppression: true,
                            autoGainControl: true,
                        },
                    })
                } else {
                    // Specific device ID
                    stream = await navigator.mediaDevices.getUserMedia({
                        audio: { deviceId: { exact: source } },
                    })
                }

                mediaStreamRef.current = stream

                // Use MediaRecorder API (no deprecation warnings)
                const mimeType = MediaRecorder.isTypeSupported('audio/webm')
                    ? 'audio/webm'
                    : 'audio/mp4'

                const recorder = new MediaRecorder(stream, { mimeType })
                recorderRef.current = recorder

                recorder.ondataavailable = (e) => {
                    if (e.data.size > 0) {
                        // Convert blob to base64 immediately when data is available
                        const reader = new FileReader()
                        reader.onloadend = () => {
                            const base64 = reader.result as string
                            const base64Data = base64.split(',')[1] || base64

                            sequenceRef.current++
                            onAudioChunk(base64Data, sequenceRef.current)
                        }
                        reader.readAsDataURL(e.data)
                    }
                }

                // Start recording with timeslice — ondataavailable fires every chunkIntervalMs
                recorder.start(chunkIntervalMs)

                setIsCapturing(true)
            } catch (err: any) {
                setError(err.message || 'Error al capturar audio')
                console.error('Audio capture error:', err)
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
