# Plan de Refinamiento UI/UX: Fase "Tinta y Oro"

## Objetivo
Elevar todos los componentes internos del sistema JudiScribe a una calidad de presentación formal (premium), asegurando coherencia visual, usabilidad (resolviendo problemas de scroll) y una experiencia fluida.

## Fases de Implementación

### 1. Corrección del Scroll en el Canvas de Transcripción
*   **Problema:** El documento de transcripción queda cortado o no permite hacer scroll correctamente hasta el final debido a un conflicto entre contenedores `flex` y `overflow-hidden`.
*   **Solución:** Reestructurar la jerarquía de contenedores en `frontend/src/app/audiencia/[id]/page.tsx` y `TranscriptionCanvas.tsx` para garantizar que el "papel digital" tenga su propio contexto de scroll fluido independiente de la barra lateral.

### 2. Renovación Estética de la Página de Actas (`ActaEditor.tsx`)
*   **Barra de Herramientas:** Reemplazar botones de texto genéricos por iconos minimalistas de `lucide-react` con fondos y bordes sutiles en color Tinta (`#1B3A5C`).
*   **Documento:** Mejorar el contraste, los márgenes (A4 feel) y la tipografía para que se perciba como un editor de documentos oficial del Poder Judicial.

### 3. Estandarización de Componentes Internos
*   **`ReproductorAudio.tsx`**: Eliminar los colores azules genéricos de Tailwind. La onda de audio y los controles utilizarán la paleta oficial (Tinta y Oro).
*   **`RevisionBatchPanel.tsx`**: Ajustar los modales flotantes y los colores de diff (verde/rojo) para que sean menos estridentes y más elegantes.
*   **`PanelHablantes.tsx`**: Refinar los selectores de rol y los inputs de identidad. Mejorar el indicador "Al aire" para que luzca profesional.
*   **`PanelMarcadores.tsx` y `AtajosFrases.tsx`**: Unificar botones, bordes y tipografía con el resto del sistema.

### 4. Consistencia Global
*   Verificar que todos los botones de acción secundaria y terciaria sigan los patrones de `btn-primary` y `btn-secondary`.
*   Asegurar que no queden rastros de componentes genéricos desalineados con la nueva visión del producto.