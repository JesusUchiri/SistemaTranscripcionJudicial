/**
 * Servicio de análisis contextual con IA.
 * Llama al backend para obtener sugerencias de corrección usando Claude.
 */
import api from './api'

export interface Suggestion {
    word: string
    confidence: number
    reason: string
}

export interface WordAnalysisResult {
    is_correct: boolean
    suggestions: Suggestion[]
    corrected_sentence: string
    segment_type: 'pregunta' | 'afirmación' | 'respuesta' | 'declaración'
    explanation: string
}

export interface PhraseChange {
    from_word: string
    to_word: string
    reason: string
}

export interface PhraseAnalysisResult {
    original: string
    corrected: string
    segment_type: string
    changes: PhraseChange[]
    confidence: number
}

/**
 * Analiza una palabra en su contexto usando IA.
 */
export async function analyzeWordInContext(
    word: string,
    sentence: string,
    confidence: number = 0,
    previousContext?: string
): Promise<WordAnalysisResult> {
    try {
        const response = await api.post('/api/analysis/word', {
            word,
            sentence,
            confidence,
            previous_context: previousContext,
        })
        return response.data
    } catch (error) {
        console.error('Error analyzing word:', error)
        // Fallback
        return {
            is_correct: confidence > 0.7,
            suggestions: [],
            corrected_sentence: sentence,
            segment_type: 'afirmación',
            explanation: 'No se pudo conectar con el servicio de análisis',
        }
    }
}

/**
 * Analiza y corrige una frase completa usando IA.
 */
export async function analyzePhraseContext(
    sentence: string,
    previousContext?: string
): Promise<PhraseAnalysisResult> {
    try {
        const response = await api.post('/api/analysis/phrase', {
            sentence,
            previous_context: previousContext,
        })
        return response.data
    } catch (error) {
        console.error('Error analyzing phrase:', error)
        return {
            original: sentence,
            corrected: sentence,
            segment_type: 'afirmación',
            changes: [],
            confidence: 0.5,
        }
    }
}
