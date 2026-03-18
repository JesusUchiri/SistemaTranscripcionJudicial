/**
 * Sistema de Variables de Acta Judicial.
 *
 * Define las variables de plantilla que se usan en el canvas y en las actas.
 * Cada variable tiene:
 *  - key:     Token de reemplazo (ej: {{EXPEDIENTE}})
 *  - field:   Campo del objeto Audiencia donde se guarda
 *  - pattern: Regex para auto-detectar el valor en la transcripción
 */

export interface VariableDef {
    key: string
    label: string
    field: string | null       // campo en Audiencia; null = derivado de hablantes
    pattern?: RegExp           // regex para auto-detectar en transcripción
    grupo: 'expediente' | 'personas' | 'tiempo' | 'datos'
}

export const VARIABLES_DEF: VariableDef[] = [
    // ── Expediente ─────────────────────────────────────────────────
    {
        key: 'EXPEDIENTE',
        label: 'N° Expediente',
        field: 'expediente',
        grupo: 'expediente',
        pattern: /expediente\s+(?:n[°oº.]\.?\s*)?([0-9]{3,4}[-–][0-9]{4,}[-–0-9a-z-]*)/i,
    },
    {
        key: 'JUZGADO',
        label: 'Juzgado',
        field: 'juzgado',
        grupo: 'expediente',
    },
    {
        key: 'TIPO_AUDIENCIA',
        label: 'Tipo de audiencia',
        field: 'tipo_audiencia',
        grupo: 'expediente',
    },
    {
        key: 'INSTANCIA',
        label: 'Instancia',
        field: 'instancia',
        grupo: 'expediente',
    },
    {
        key: 'SALA',
        label: 'Sala',
        field: 'sala',
        grupo: 'expediente',
        pattern: /\bsala\s+(?:de\s+audiencias?\s+)?(?:n[°oº]\.?\s*)?([A-Za-z0-9]+)\b/i,
    },
    {
        key: 'DELITO',
        label: 'Delito',
        field: 'delito',
        grupo: 'datos',
        pattern: /\bdelito\s+(?:de\s+)?([A-ZÁÉÍÓÚÑ][a-záéíóúñA-Z\s]{5,60}?)(?:\s*[,.])/i,
    },
    // ── Personas ───────────────────────────────────────────────────
    {
        key: 'JUEZ',
        label: 'Juez / Jueza',
        field: null, // derivado de hablante con rol=juez o juez_director
        grupo: 'personas',
    },
    {
        key: 'FISCAL',
        label: 'Fiscal',
        field: null,
        grupo: 'personas',
    },
    {
        key: 'DEFENSOR',
        label: 'Defensor/a',
        field: null,
        grupo: 'personas',
    },
    {
        key: 'IMPUTADO',
        label: 'Imputado/a',
        field: 'imputado_nombre',
        grupo: 'personas',
        pattern: /\b(?:acusado|imputado|procesado|sentenciado)[:\s]+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){1,3})/i,
    },
    {
        key: 'AGRAVIADO',
        label: 'Agraviado/a',
        field: 'agraviado_nombre',
        grupo: 'personas',
        pattern: /\b(?:agraviado|víctima|perjudicado)[:\s]+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){1,3})/i,
    },
    {
        key: 'ESPECIALISTA',
        label: 'Especialista',
        field: 'especialista_audiencia',
        grupo: 'personas',
    },
    // ── Tiempo ─────────────────────────────────────────────────────
    {
        key: 'FECHA',
        label: 'Fecha',
        field: 'fecha',
        grupo: 'tiempo',
    },
    {
        key: 'HORA_INICIO',
        label: 'Hora de inicio',
        field: 'hora_inicio',
        grupo: 'tiempo',
        pattern: /\b(?:siendo|iniciamos?|inicio[s]?|abrimos?|instalamos?)\s+(?:con\s+)?(?:la\s+audiencia\s+)?(?:siendo\s+)?las?\s+(\d{1,2}[:.hH]\s*\d{2})/i,
    },
    {
        key: 'HORA_FIN',
        label: 'Hora de cierre',
        field: 'hora_fin',
        grupo: 'tiempo',
        pattern: /\b(?:conclu[iy]|final[iz]|cierr|siendo las?)\s+(?:la\s+audiencia\s+)?(?:siendo\s+)?las?\s+(\d{1,2}[:.hH]\s*\d{2})/i,
    },
]

/** Token de reemplazo: {{KEY}} */
export function toToken(key: string) {
    return `{{${key}}}`
}

/** Reemplaza todos los tokens {{KEY}} en un texto usando el mapa dado */
export function reemplazarVariables(texto: string, valores: Record<string, string>): string {
    return Object.entries(valores).reduce((acc, [key, val]) => {
        if (!val) return acc
        return acc.replaceAll(toToken(key), val)
    }, texto)
}

/**
 * Extrae el valor de una audiencia para una variable.
 * `hablantes` opcional para derivar JUEZ, FISCAL, DEFENSOR.
 */
export function valorDeAudiencia(
    variable: VariableDef,
    audiencia: Record<string, any>,
    hablantes: Array<{ rol: string; nombre: string | null; etiqueta: string }> = [],
): string {
    if (variable.field) {
        const raw = audiencia[variable.field]
        if (!raw) return ''
        if (raw instanceof Date || (typeof raw === 'string' && raw.includes('T'))) {
            try { return new Date(raw).toLocaleDateString('es-PE', { day: '2-digit', month: 'long', year: 'numeric' }) } catch { return String(raw) }
        }
        return String(raw)
    }
    // Derivar de hablantes
    const rolMap: Record<string, string[]> = {
        JUEZ:     ['juez', 'juez_director', 'jueces_colegiado'],
        FISCAL:   ['fiscal'],
        DEFENSOR: ['defensa_imputado', 'defensa_agraviado'],
    }
    const roles = rolMap[variable.key] || []
    const h = hablantes.find(h => roles.includes(h.rol) && h.nombre)
    return h?.nombre || ''
}
