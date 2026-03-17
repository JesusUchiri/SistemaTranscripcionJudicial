"""
Servicio para la exportación de documentos oficiales: DOCX y PDF.
"""
import io
import datetime
from bs4 import BeautifulSoup

from docx import Document
from docx.shared import Pt, Inches
from docx.enum.text import WD_ALIGN_PARAGRAPH
from xhtml2pdf import pisa

from app.models.acta import Acta
from app.models.audiencia import Audiencia


def generate_pdf(audiencia: Audiencia, acta: Acta) -> bytes:
    """Extrae el contenido de un acta y genera un binario PDF usando xhtml2pdf."""
    html_content = acta.contenido_editado or acta.contenido_llm or ""
    
    # Preparamos una plantilla básica HTML
    template_html = f"""
    <!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="UTF-8">
        <title>Acta de Audiencia - {audiencia.expediente}</title>
        <style>
            @page {{
                size: a4 portrait;
                @frame header_frame {{
                    -pdf-frame-content: header_content;
                    left: 50pt; width: 512pt; top: 50pt; height: 40pt;
                }}
                @frame content_frame {{
                    left: 50pt; width: 512pt; top: 90pt; height: 632pt;
                }}
                @frame footer_frame {{
                    -pdf-frame-content: footer_content;
                    left: 50pt; width: 512pt; top: 772pt; height: 20pt;
                }}
            }}
            body {{
                font-family: Arial, sans-serif;
                font-size: 11pt;
                line-height: 1.5;
            }}
            h1, h2, h3 {{
                text-align: center;
                font-weight: bold;
            }}
            .text-center {{
                text-align: center;
            }}
        </style>
    </head>
    <body>
        <div id="header_content">
            <h3 class="text-center">{audiencia.juzgado or 'PODER JUDICIAL DEL PERÚ'}</h3>
        </div>
        <div id="footer_content">
            <p class="text-center">Página <pdf:pagenumber> de <pdf:pagecount></p>
        </div>

        {html_content}
    </body>
    </html>
    """

    pdf_buffer = io.BytesIO()
    pisa_status = pisa.CreatePDF(io.StringIO(template_html), dest=pdf_buffer)

    if pisa_status.err:
        raise Exception("Error generando el archivo PDF")

    return pdf_buffer.getvalue()


def generate_docx(audiencia: Audiencia, acta: Acta) -> bytes:
    """Extrae el contenido de un acta y genera un binario DOCX usando python-docx."""
    doc = Document()
    
    # Header del documento
    header = doc.sections[0].header
    header_para = header.paragraphs[0]
    header_para.text = audiencia.juzgado or "PODER JUDICIAL DEL PERÚ"
    header_para.alignment = WD_ALIGN_PARAGRAPH.CENTER
    
    html_content = acta.contenido_editado or acta.contenido_llm or ""
    soup = BeautifulSoup(html_content, 'html.parser')
    
    for element in soup.body.children if soup.body else soup.children:
        if element.name in ['h1', 'h2', 'h3', 'h4']:
            heading_level = int(element.name[1])
            # En word los títulos van típicamente de 1-9
            heading_level = max(1, min(heading_level, 9))
            p = doc.add_heading(element.get_text(), level=heading_level)
            continue
            
        if element.name == 'p':
            p = doc.add_paragraph()
            for child in element.children:
                if child.name == 'strong' or child.name == 'b':
                    p.add_run(child.get_text()).bold = True
                elif child.name == 'em' or child.name == 'i':
                    p.add_run(child.get_text()).italic = True
                elif child.name == 'u':
                    p.add_run(child.get_text()).underline = True
                elif isinstance(child, str):
                    p.add_run(child)
            continue
            
        # Fallback raw text si es otro tipo de nodo (ej span sin parsear)
        if element.name is not None and element.get_text().strip():
            doc.add_paragraph(element.get_text())

    # Formateo general a Arial 11
    style = doc.styles['Normal']
    font = style.font
    font.name = 'Arial'
    font.size = Pt(11)

    docx_buffer = io.BytesIO()
    doc.save(docx_buffer)
    
    return docx_buffer.getvalue()
