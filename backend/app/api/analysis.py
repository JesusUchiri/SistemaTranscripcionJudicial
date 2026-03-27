"""
API endpoints para análisis contextual con IA.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List

from app.services.context_analysis import get_context_service

router = APIRouter(prefix="/api/analysis", tags=["analysis"])


class WordAnalysisRequest(BaseModel):
    """Request para análisis de una palabra en contexto."""
    word: str
    sentence: str
    confidence: float = 0.0
    previous_context: Optional[str] = None


class SuggestionItem(BaseModel):
    """Una sugerencia de corrección."""
    word: str
    confidence: float
    reason: str


class WordAnalysisResponse(BaseModel):
    """Response del análisis de palabra."""
    is_correct: bool
    suggestions: List[SuggestionItem]
    corrected_sentence: str
    segment_type: str
    explanation: str


class PhraseAnalysisRequest(BaseModel):
    """Request para análisis de frase completa."""
    sentence: str
    previous_context: Optional[str] = None


class ChangeItem(BaseModel):
    """Un cambio realizado en la frase."""
    from_word: str
    to_word: str
    reason: str


class PhraseAnalysisResponse(BaseModel):
    """Response del análisis de frase."""
    original: str
    corrected: str
    segment_type: str
    changes: List[ChangeItem]
    confidence: float


@router.post("/word", response_model=WordAnalysisResponse)
async def analyze_word(request: WordAnalysisRequest):
    """
    Analiza una palabra en su contexto usando IA.

    Devuelve sugerencias de corrección basadas en el contexto judicial.
    """
    try:
        service = get_context_service()
        result = await service.analyze_word_in_context(
            word=request.word,
            sentence=request.sentence,
            confidence=request.confidence,
            previous_context=request.previous_context,
        )

        # Mapear la respuesta al modelo
        suggestions = [
            SuggestionItem(
                word=s.get("word", ""),
                confidence=s.get("confidence", 0.5),
                reason=s.get("reason", "")
            )
            for s in result.get("suggestions", [])
        ]

        return WordAnalysisResponse(
            is_correct=result.get("is_correct", True),
            suggestions=suggestions,
            corrected_sentence=result.get("corrected_sentence", request.sentence),
            segment_type=result.get("segment_type", "afirmación"),
            explanation=result.get("explanation", ""),
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error en análisis: {str(e)}")


@router.post("/phrase", response_model=PhraseAnalysisResponse)
async def analyze_phrase(request: PhraseAnalysisRequest):
    """
    Analiza y corrige una frase completa usando IA.

    Devuelve la frase corregida con explicación de cambios.
    """
    try:
        service = get_context_service()
        result = await service.get_phrase_corrections(
            sentence=request.sentence,
            previous_context=request.previous_context,
        )

        # Mapear cambios
        changes = [
            ChangeItem(
                from_word=c.get("from", ""),
                to_word=c.get("to", ""),
                reason=c.get("reason", "")
            )
            for c in result.get("changes", [])
        ]

        return PhraseAnalysisResponse(
            original=result.get("original", request.sentence),
            corrected=result.get("corrected", request.sentence),
            segment_type=result.get("segment_type", "afirmación"),
            changes=changes,
            confidence=result.get("confidence", 0.5),
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error en análisis: {str(e)}")
