"""
Servicio de exportación de documentos oficiales: DOCX y PDF.
Formato judicial estándar — Poder Judicial del Perú, Distrito de Cusco.
"""
import io
from bs4 import BeautifulSoup

from docx import Document as DocxDocument
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.style import WD_STYLE_TYPE
from docx.oxml.ns import qn
from docx.oxml import OxmlElement
from xhtml2pdf import pisa

from app.models.acta import Acta
from app.models.audiencia import Audiencia


# ── Helpers DOCX ────────────────────────────────────────────────────

def _set_cell_border(cell, **kwargs):
    """No usada actualmente — disponible si se agregan tablas."""
    pass


def _add_horizontal_line(doc):
    """Agrega una línea horizontal fina al documento Word."""
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(2)
    p.paragraph_format.space_after = Pt(2)
    pPr = p._p.get_or_add_pPr()
    pBdr = OxmlElement('w:pBdr')
    bottom = OxmlElement('w:bottom')
    bottom.set(qn('w:val'), 'single')
    bottom.set(qn('w:sz'), '6')
    bottom.set(qn('w:space'), '1')
    bottom.set(qn('w:color'), '999999')
    pBdr.append(bottom)
    pPr.append(pBdr)


def _add_page_number(doc):
    """Agrega número de página al footer en formato 'Página X de Y'."""
    section = doc.sections[0]
    footer = section.footer
    footer_para = footer.paragraphs[0] if footer.paragraphs else footer.add_paragraph()
    footer_para.alignment = WD_ALIGN_PARAGRAPH.CENTER
    footer_para.clear()

    run = footer_para.add_run("Página ")
    run.font.size = Pt(9)
    run.font.color.rgb = RGBColor(0x80, 0x80, 0x80)

    # Campo PAGE
    fld_begin = OxmlElement('w:fldChar')
    fld_begin.set(qn('w:fldCharType'), 'begin')
    instr = OxmlElement('w:instrText')
    instr.text = 'PAGE'
    fld_end = OxmlElement('w:fldChar')
    fld_end.set(qn('w:fldCharType'), 'end')
    r_page = OxmlElement('w:r')
    r_page.append(fld_begin)
    r_page.append(instr)
    r_page.append(fld_end)
    footer_para._p.append(r_page)

    run2 = footer_para.add_run(" de ")
    run2.font.size = Pt(9)
    run2.font.color.rgb = RGBColor(0x80, 0x80, 0x80)

    # Campo NUMPAGES
    fld_begin2 = OxmlElement('w:fldChar')
    fld_begin2.set(qn('w:fldCharType'), 'begin')
    instr2 = OxmlElement('w:instrText')
    instr2.text = 'NUMPAGES'
    fld_end2 = OxmlElement('w:fldChar')
    fld_end2.set(qn('w:fldCharType'), 'end')
    r_pages = OxmlElement('w:r')
    r_pages.append(fld_begin2)
    r_pages.append(instr2)
    r_pages.append(fld_end2)
    footer_para._p.append(r_pages)


def _parse_html_to_docx(doc, html_content: str):
    """
    Convierte HTML del acta (generado por Claude) a párrafos Word formateados.
    Maneja: h1, h2, h3, p, strong/b, em/i, u, ul/ol, li.
    """
    soup = BeautifulSoup(html_content, 'html.parser')
    root = soup.body if soup.body else soup

    for element in root.children:
        if not hasattr(element, 'name') or element.name is None:
            # Texto suelto
            text = str(element).strip()
            if text:
                p = doc.add_paragraph(text)
                p.paragraph_format.space_after = Pt(4)
            continue

        tag = element.name.lower()

        if tag in ('h1', 'h2', 'h3'):
            level = int(tag[1])
            p = doc.add_paragraph()
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            p.paragraph_format.space_before = Pt(12 if level == 1 else 8)
            p.paragraph_format.space_after = Pt(6)
            run = p.add_run(element.get_text(strip=True).upper())
            run.bold = True
            run.font.size = Pt(14 if level == 1 else 12 if level == 2 else 11)
            run.font.color.rgb = RGBColor(0x00, 0x00, 0x00)

        elif tag == 'p':
            p = doc.add_paragraph()
            p.paragraph_format.space_after = Pt(4)
            p.paragraph_format.first_line_indent = Cm(0)
            p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY

            for child in element.children:
                if not hasattr(child, 'name') or child.name is None:
                    text = str(child)
                    if text:
                        run = p.add_run(text)
                        run.font.size = Pt(11)
                elif child.name in ('strong', 'b'):
                    run = p.add_run(child.get_text())
                    run.bold = True
                    run.font.size = Pt(11)
                elif child.name in ('em', 'i'):
                    run = p.add_run(child.get_text())
                    run.italic = True
                    run.font.size = Pt(11)
                elif child.name == 'u':
                    run = p.add_run(child.get_text())
                    run.underline = True
                    run.font.size = Pt(11)
                else:
                    run = p.add_run(child.get_text())
                    run.font.size = Pt(11)

        elif tag in ('ul', 'ol'):
            for li in element.find_all('li', recursive=False):
                p = doc.add_paragraph(style='List Bullet' if tag == 'ul' else 'List Number')
                p.paragraph_format.space_after = Pt(2)
                run = p.add_run(li.get_text(strip=True))
                run.font.size = Pt(11)

        elif element.get_text(strip=True):
            p = doc.add_paragraph(element.get_text(strip=True))
            p.paragraph_format.space_after = Pt(4)


# ── PDF ─────────────────────────────────────────────────────────────

def generate_pdf(audiencia: Audiencia, acta: Acta) -> bytes:
    """Genera PDF con formato judicial oficial peruano."""
    html_content = acta.contenido_editado or acta.contenido_llm or ""
    expediente = audiencia.expediente or "S/N"
    juzgado = audiencia.juzgado or "PODER JUDICIAL DEL PERÚ"
    fecha = audiencia.fecha.strftime('%d de %B de %Y').upper() if audiencia.fecha else ""
    tipo = (audiencia.tipo_audiencia or "AUDIENCIA").upper()
    version = getattr(acta, 'version', 1)
    estado = (acta.estado or "borrador").upper()

    template_html = f"""<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Acta {expediente}</title>
<style>
  @page {{
    size: A4 portrait;
    margin: 2.5cm 2.5cm 2.5cm 3cm;
    @frame footer_frame {{
      -pdf-frame-content: footer_content;
      left: 50pt; width: 512pt; top: 800pt; height: 20pt;
    }}
  }}
  body {{
    font-family: "Times New Roman", Times, serif;
    font-size: 12pt;
    line-height: 1.6;
    color: #000;
  }}
  /* Membrete superior */
  .membrete {{
    text-align: center;
    margin-bottom: 18pt;
    border-bottom: 2px solid #000;
    padding-bottom: 10pt;
  }}
  .membrete .institucion {{
    font-size: 13pt;
    font-weight: bold;
    letter-spacing: 1px;
    text-transform: uppercase;
  }}
  .membrete .juzgado {{
    font-size: 11pt;
    font-weight: bold;
    text-transform: uppercase;
    margin-top: 4pt;
  }}
  .membrete .subtitulo {{
    font-size: 10pt;
    margin-top: 4pt;
    color: #444;
  }}
  /* Metadatos */
  .metadatos {{
    margin: 12pt 0;
    font-size: 11pt;
    border: 1px solid #ccc;
    padding: 8pt 12pt;
    background: #f9f9f9;
  }}
  .metadatos table {{
    width: 100%;
    border-collapse: collapse;
  }}
  .metadatos td {{
    padding: 2pt 4pt;
    vertical-align: top;
  }}
  .metadatos .label {{
    font-weight: bold;
    width: 35%;
    text-transform: uppercase;
    font-size: 10pt;
  }}
  /* Contenido del acta */
  h1 {{ font-size: 13pt; text-align: center; font-weight: bold; text-transform: uppercase; margin: 16pt 0 8pt; }}
  h2 {{ font-size: 12pt; text-align: center; font-weight: bold; text-transform: uppercase; margin: 14pt 0 6pt; }}
  h3 {{ font-size: 11pt; font-weight: bold; text-transform: uppercase; margin: 10pt 0 4pt; }}
  p  {{ text-align: justify; margin: 4pt 0; font-size: 11pt; line-height: 1.7; }}
  strong, b {{ font-weight: bold; }}
  ul, ol {{ margin: 6pt 0 6pt 20pt; }}
  li {{ margin: 2pt 0; font-size: 11pt; }}
  /* Badge estado */
  .badge-estado {{
    display: inline-block;
    font-size: 9pt;
    font-weight: bold;
    padding: 2pt 8pt;
    border: 1px solid #999;
    color: #555;
    text-transform: uppercase;
    letter-spacing: 1px;
  }}
  /* Footer */
  #footer_content {{
    text-align: center;
    font-size: 9pt;
    color: #777;
    border-top: 1px solid #ccc;
    padding-top: 4pt;
  }}
</style>
</head>
<body>

<!-- Membrete institucional -->
<div class="membrete">
  <div class="institucion">Corte Superior de Justicia de Cusco</div>
  <div class="juzgado">{juzgado}</div>
  <div class="subtitulo">Acta de Registro · {tipo} · {fecha}</div>
</div>

<!-- Metadatos del expediente -->
<div class="metadatos">
  <table>
    <tr>
      <td class="label">Expediente:</td>
      <td>{expediente}</td>
      <td class="label">Estado:</td>
      <td><span class="badge-estado">{estado}</span></td>
    </tr>
    <tr>
      <td class="label">Tipo:</td>
      <td>{tipo}</td>
      <td class="label">Versión:</td>
      <td>v{version}</td>
    </tr>
    <tr>
      <td class="label">Instancia:</td>
      <td>{(audiencia.instancia or '').upper()}</td>
      <td class="label">Sala:</td>
      <td>{audiencia.sala or '—'}</td>
    </tr>
  </table>
</div>

<!-- Contenido del acta generado por IA -->
{html_content}

<!-- Footer con número de página -->
<div id="footer_content">
  Corte Superior de Justicia de Cusco &nbsp;·&nbsp; Exp. {expediente} &nbsp;·&nbsp;
  Página <pdf:pagenumber> de <pdf:pagecount>
</div>

</body>
</html>"""

    buf = io.BytesIO()
    status = pisa.CreatePDF(io.StringIO(template_html), dest=buf)
    if status.err:
        raise Exception("Error generando PDF")
    return buf.getvalue()


# ── DOCX ─────────────────────────────────────────────────────────────

def generate_docx(audiencia: Audiencia, acta: Acta) -> bytes:
    """Genera DOCX con formato judicial oficial peruano."""
    doc = DocxDocument()

    # ── Márgenes A4 (3cm izq, 2.5cm resto — margen judicial) ────────
    section = doc.sections[0]
    section.page_width  = Cm(21)
    section.page_height = Cm(29.7)
    section.left_margin   = Cm(3.0)
    section.right_margin  = Cm(2.5)
    section.top_margin    = Cm(2.5)
    section.bottom_margin = Cm(2.5)

    # ── Fuente base: Times New Roman 12pt ───────────────────────────
    style = doc.styles['Normal']
    style.font.name = 'Times New Roman'
    style.font.size = Pt(12)

    # ── Header institucional ─────────────────────────────────────────
    header = section.header
    header.is_linked_to_previous = False
    for p in header.paragraphs:
        p.clear()
    hp = header.paragraphs[0]
    hp.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r1 = hp.add_run("CORTE SUPERIOR DE JUSTICIA DE CUSCO")
    r1.bold = True
    r1.font.size = Pt(11)
    r1.font.name = 'Times New Roman'
    hp.add_run("\n")
    r2 = hp.add_run((audiencia.juzgado or "PODER JUDICIAL DEL PERÚ").upper())
    r2.font.size = Pt(10)
    r2.font.name = 'Times New Roman'
    _add_horizontal_line(doc) if False else None  # se hace abajo manualmente

    # ── Título del acta ──────────────────────────────────────────────
    tipo = (audiencia.tipo_audiencia or "AUDIENCIA").upper()
    expediente = audiencia.expediente or "S/N"
    fecha_str = audiencia.fecha.strftime('%d de %B de %Y').upper() if audiencia.fecha else "S/F"

    # Línea decorativa
    p_line = doc.add_paragraph()
    p_line.paragraph_format.space_before = Pt(0)
    p_line.paragraph_format.space_after = Pt(0)
    pPr = p_line._p.get_or_add_pPr()
    pBdr = OxmlElement('w:pBdr')
    for side in ('top',):
        b = OxmlElement(f'w:{side}')
        b.set(qn('w:val'), 'single')
        b.set(qn('w:sz'), '12')
        b.set(qn('w:space'), '1')
        b.set(qn('w:color'), '000000')
        pBdr.append(b)
    pPr.append(pBdr)

    p_titulo = doc.add_paragraph()
    p_titulo.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p_titulo.paragraph_format.space_before = Pt(10)
    p_titulo.paragraph_format.space_after = Pt(4)
    r = p_titulo.add_run(f"ACTA DE REGISTRO DE AUDIENCIA DE {tipo}")
    r.bold = True
    r.font.size = Pt(13)
    r.font.name = 'Times New Roman'

    # ── Bloque de datos del expediente ──────────────────────────────
    for label, valor in [
        ("EXPEDIENTE", expediente),
        ("FECHA", fecha_str),
        ("INSTANCIA", (audiencia.instancia or "").upper()),
        ("SALA", audiencia.sala or "—"),
        ("DELITO", audiencia.delito or "—"),
        ("IMPUTADO/A", audiencia.imputado_nombre or "—"),
        ("AGRAVIADO/A", audiencia.agraviado_nombre or "—"),
        ("ESPECIALISTA", audiencia.especialista_audiencia or audiencia.especialista_causa or "—"),
    ]:
        p = doc.add_paragraph()
        p.paragraph_format.space_before = Pt(1)
        p.paragraph_format.space_after = Pt(1)
        r_lbl = p.add_run(f"{label}: ")
        r_lbl.bold = True
        r_lbl.font.size = Pt(11)
        r_lbl.font.name = 'Times New Roman'
        r_val = p.add_run(valor)
        r_val.font.size = Pt(11)
        r_val.font.name = 'Times New Roman'

    # Línea separadora
    p_sep = doc.add_paragraph()
    p_sep.paragraph_format.space_before = Pt(8)
    p_sep.paragraph_format.space_after = Pt(8)
    pPr2 = p_sep._p.get_or_add_pPr()
    pBdr2 = OxmlElement('w:pBdr')
    b2 = OxmlElement('w:bottom')
    b2.set(qn('w:val'), 'single')
    b2.set(qn('w:sz'), '6')
    b2.set(qn('w:space'), '1')
    b2.set(qn('w:color'), '444444')
    pBdr2.append(b2)
    pPr2.append(pBdr2)

    # ── Contenido del acta (HTML → DOCX) ────────────────────────────
    html_content = acta.contenido_editado or acta.contenido_llm or ""
    _parse_html_to_docx(doc, html_content)

    # ── Footer con número de página ──────────────────────────────────
    _add_page_number(doc)

    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()
