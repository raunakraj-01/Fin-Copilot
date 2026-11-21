from pathlib import Path
from docx import Document
from docx.text.paragraph import Paragraph as DocxParagraph
from docx.table import Table as DocxTable
from docx.oxml.ns import qn
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle,
)


SOURCE = Path(r"D:\el-sem-3\CashFlow_Copilot_Investor_Pitch.docx")
OUT = Path(r"D:\el-sem-3\CashFlow_Copilot_Investor_Pitch.pdf")
PAGE_W, PAGE_H = A4
LEFT = RIGHT = 0.72 * inch
TOP = 0.68 * inch
BOTTOM = 0.67 * inch
CONTENT_W = PAGE_W - LEFT - RIGHT
NAVY = colors.HexColor("#17324D")
TEAL = colors.HexColor("#147D83")
PALE = colors.HexColor("#EAF5F5")
PALE_BLUE = colors.HexColor("#EEF3F8")
LIGHT_GRAY = colors.HexColor("#F5F7F9")
GRID = colors.HexColor("#D4DDE5")
INK = colors.HexColor("#263442")
GRAY = colors.HexColor("#5D6873")

font_regular = Path(r"C:\Windows\Fonts\arial.ttf")
font_bold = Path(r"C:\Windows\Fonts\arialbd.ttf")
font_italic = Path(r"C:\Windows\Fonts\ariali.ttf")
font_bolditalic = Path(r"C:\Windows\Fonts\arialbi.ttf")
if font_regular.exists() and font_bold.exists():
    pdfmetrics.registerFont(TTFont("Arial", str(font_regular)))
    pdfmetrics.registerFont(TTFont("Arial-Bold", str(font_bold)))
    if font_italic.exists():
        pdfmetrics.registerFont(TTFont("Arial-Italic", str(font_italic)))
    if font_bolditalic.exists():
        pdfmetrics.registerFont(TTFont("Arial-BoldItalic", str(font_bolditalic)))
    pdfmetrics.registerFontFamily("Arial", normal="Arial", bold="Arial-Bold", italic="Arial-Italic", boldItalic="Arial-BoldItalic")
    BODY_FONT, BOLD_FONT = "Arial", "Arial-Bold"
else:
    BODY_FONT, BOLD_FONT = "Helvetica", "Helvetica-Bold"

styles = {
    "Normal": ParagraphStyle("Normal", fontName=BODY_FONT, fontSize=9.25, leading=11.35, textColor=INK, spaceAfter=4.4, alignment=TA_LEFT),
    "Title": ParagraphStyle("Title", fontName=BOLD_FONT, fontSize=23, leading=27, textColor=colors.black, spaceAfter=5),
    "Heading 1": ParagraphStyle("H1", fontName=BOLD_FONT, fontSize=15, leading=18, textColor=colors.black, spaceBefore=11, spaceAfter=4.5, keepWithNext=True),
    "Heading 2": ParagraphStyle("H2", fontName=BOLD_FONT, fontSize=10.8, leading=13, textColor=colors.black, spaceBefore=7, spaceAfter=2.4, keepWithNext=True),
    "Heading 3": ParagraphStyle("H3", fontName=BOLD_FONT, fontSize=10, leading=12, textColor=colors.black, spaceBefore=5, spaceAfter=2, keepWithNext=True),
    "Sub": ParagraphStyle("Sub", fontName=BODY_FONT, fontSize=9.7, leading=12, textColor=GRAY, spaceAfter=8),
    "Small": ParagraphStyle("Small", fontName=BODY_FONT, fontSize=8, leading=9.6, textColor=INK, spaceAfter=2),
    "Cell": ParagraphStyle("Cell", fontName=BODY_FONT, fontSize=8.1, leading=9.7, textColor=INK, spaceAfter=0),
    "CellHead": ParagraphStyle("CellHead", fontName=BOLD_FONT, fontSize=8.7, leading=10, textColor=colors.white, spaceAfter=0),
}


def rich_text(paragraph):
    pieces = []
    for run in paragraph.runs:
        txt = escape(run.text or "").replace("\n", "<br/>")
        if not txt:
            continue
        if run.bold and run.italic:
            txt = "<b><i>" + txt + "</i></b>"
        elif run.bold:
            txt = "<b>" + txt + "</b>"
        elif run.italic:
            txt = "<i>" + txt + "</i>"
        pieces.append(txt)
    return "".join(pieces) or escape(paragraph.text or "")


def has_page_break(paragraph):
    return bool(paragraph._p.xpath(".//w:br[@w:type='page']"))


def is_callout(paragraph):
    ppr = paragraph._p.pPr
    shd = ppr.find(qn("w:shd")) if ppr is not None else None
    return shd.get(qn("w:fill")) if shd is not None else None


def docx_cell_text(cell):
    return "<br/>".join(rich_text(p) for p in cell.paragraphs if p.text)


def make_docx_table(src_table):
    rows = []
    for r_idx, row in enumerate(src_table.rows):
        cells = []
        for c_idx, cell in enumerate(row.cells):
            text = docx_cell_text(cell)
            if r_idx == 0:
                cells.append(Paragraph(text, styles["CellHead"]))
            else:
                if c_idx == 0:
                    text = "<b>" + text + "</b>"
                cells.append(Paragraph(text, styles["Cell"]))
        rows.append(cells)
    widths = [1.28 * inch, 2.50 * inch, CONTENT_W - (3.78 * inch)]
    tab = Table(rows, colWidths=widths, repeatRows=1, hAlign="LEFT", splitByRow=1)
    commands = [
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("GRID", (0, 0), (-1, -1), 0.45, GRID),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]
    for r in range(1, len(rows)):
        commands.append(("BACKGROUND", (0, r), (-1, r), colors.white if r % 2 else LIGHT_GRAY))
    tab.setStyle(TableStyle(commands))
    return tab


def make_callout(paragraph, fill):
    color = colors.HexColor("#FFF6E8") if fill == "FFF6E8" else (PALE_BLUE if fill == "EEF3F8" else PALE)
    border = colors.HexColor("#B7791F") if fill == "FFF6E8" else (NAVY if fill == "EEF3F8" else TEAL)
    pstyle = ParagraphStyle("Callout", parent=styles["Normal"], fontName=BODY_FONT, fontSize=9.6, leading=12.1, textColor=NAVY, spaceAfter=0, leftIndent=0, rightIndent=0)
    tab = Table([[Paragraph(rich_text(paragraph), pstyle)]], colWidths=[CONTENT_W])
    tab.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), color),
        ("BOX", (0, 0), (-1, -1), 0, color),
        ("LINEBEFORE", (0, 0), (0, 0), 2.2, border),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 9),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    return tab


def add_footer(canvas, doc):
    canvas.saveState()
    canvas.setFont(BODY_FONT, 7.7)
    canvas.setFillColor(GRAY)
    canvas.drawRightString(PAGE_W - RIGHT, 0.38 * inch, f"CashFlow Copilot  |  Investor discussion draft  |  {doc.page}")
    canvas.restoreState()


source_doc = Document(str(SOURCE))
story = []
body = source_doc.element.body
for child in body.iterchildren():
    tag = child.tag.rsplit("}", 1)[-1]
    if tag == "p":
        p = DocxParagraph(child, source_doc._body)
        if has_page_break(p):
            story.append(PageBreak())
            continue
        if not p.text.strip():
            continue
        style_name = p.style.name if p.style is not None else "Normal"
        if style_name not in styles:
            style_name = "Normal"
        if style_name.startswith("List Bullet"):
            text = rich_text(p)
            para = Paragraph(text, styles["Normal"], bulletText="•", bulletFontName=BODY_FONT, bulletFontSize=8)
            para.style.leftIndent = 13
            story.append(para)
            continue
        fill = is_callout(p)
        if fill:
            story.append(make_callout(p, fill))
            story.append(Spacer(1, 6))
        elif style_name == "Sub" or (style_name == "Normal" and p.paragraph_format.space_after and p.paragraph_format.space_after.pt and p.paragraph_format.space_after.pt >= 8 and p.text.startswith("Spoken pitch")):
            story.append(Paragraph(rich_text(p), styles["Sub"]))
        else:
            story.append(Paragraph(rich_text(p), styles[style_name]))
    elif tag == "tbl":
        table = DocxTable(child, source_doc._body)
        story.append(make_docx_table(table))
        story.append(Spacer(1, 9))

pdf = SimpleDocTemplate(
    str(OUT), pagesize=A4, leftMargin=LEFT, rightMargin=RIGHT,
    topMargin=TOP, bottomMargin=BOTTOM, title="CashFlow Copilot Investor Pitch",
    author="CashFlow Copilot", subject="Pitch narrative and investor Q&A",
)
pdf.build(story, onFirstPage=add_footer, onLaterPages=add_footer)
print(OUT)
