'use client'

/**
 * Demo page — redirects to the demo audiencia record.
 * All functionality is handled by /audiencia/[id] — no duplicate implementation.
 */
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

const DEMO_AUDIENCIA_ID = '00000000-0000-0000-0000-000000000000'

export default function DemoPage() {
    const router = useRouter()

    useEffect(() => {
        router.replace(`/audiencia/${DEMO_AUDIENCIA_ID}`)
    }, [router])

    return (
        <div className="h-screen flex items-center justify-center" style={{ background: 'var(--bg-primary)' }}>
            <div className="w-8 h-8 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--accent-gold)', borderTopColor: 'transparent' }} />
        </div>
    )
}
