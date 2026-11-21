from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_CELL_VERTICAL_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn


OUT = r"D:\el-sem-3\CashFlow_Copilot_Investor_Pitch.docx"
NAVY = "17324D"
TEAL = "147D83"
PALE = "EAF5F5"
PALE_BLUE = "EEF3F8"
GRAY = "5D6873"
LIGHT_GRAY = "F5F7F9"
GRID = "D4DDE5"
BLACK = "000000"


def set_cell_shading(cell, fill):
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:fill"), fill)
    tc_pr.append(shd)


def set_cell_margins(cell, top=100, start=115, bottom=100, end=115):
    tc = cell._tc
    tc_pr = tc.get_or_add_tcPr()
    tc_mar = tc_pr.first_child_found_in("w:tcMar")
    if tc_mar is None:
        tc_mar = OxmlElement("w:tcMar")
        tc_pr.append(tc_mar)
    for m, v in (("top", top), ("start", start), ("bottom", bottom), ("end", end)):
        node = tc_mar.find(qn("w:" + m))
        if node is None:
            node = OxmlElement("w:" + m)
            tc_mar.append(node)
        node.set(qn("w:w"), str(v))
        node.set(qn("w:type"), "dxa")


def set_table_borders(table, color=GRID, size="6"):
    tbl_pr = table._tbl.tblPr
    borders = tbl_pr.first_child_found_in("w:tblBorders")
    if borders is None:
        borders = OxmlElement("w:tblBorders")
        tbl_pr.append(borders)
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        tag = "w:" + edge
        element = borders.find(qn(tag))
        if element is None:
            element = OxmlElement(tag)
            borders.append(element)
        element.set(qn("w:val"), "single")
        element.set(qn("w:sz"), size)
        element.set(qn("w:space"), "0")
        element.set(qn("w:color"), color)


def set_repeat_table_header(row):
    tr_pr = row._tr.get_or_add_trPr()
    tbl_header = OxmlElement("w:tblHeader")
    tbl_header.set(qn("w:val"), "true")
    tr_pr.append(tbl_header)


def set_keep(paragraph, keep_next=False, keep_lines=True):
    p_pr = paragraph._p.get_or_add_pPr()
    if keep_lines:
        wc = OxmlElement("w:keepLines")
        p_pr.append(wc)
    if keep_next:
        kn = OxmlElement("w:keepNext")
        p_pr.append(kn)


def add_field(paragraph, name):
    run = paragraph.add_run()
    begin = OxmlElement("w:fldChar")
    begin.set(qn("w:fldCharType"), "begin")
    instr = OxmlElement("w:instrText")
    instr.set(qn("xml:space"), "preserve")
    instr.text = name
    separate = OxmlElement("w:fldChar")
    separate.set(qn("w:fldCharType"), "separate")
    text = OxmlElement("w:t")
    text.text = "1"
    end = OxmlElement("w:fldChar")
    end.set(qn("w:fldCharType"), "end")
    run._r.extend([begin, instr, separate, text, end])


def style_run(run, size=None, bold=None, color=BLACK, italic=None, font="Aptos"):
    run.font.name = font
    run._element.get_or_add_rPr().rFonts.set(qn("w:ascii"), font)
    run._element.get_or_add_rPr().rFonts.set(qn("w:hAnsi"), font)
    if size is not None:
        run.font.size = Pt(size)
    if bold is not None:
        run.bold = bold
    if italic is not None:
        run.italic = italic
    run.font.color.rgb = RGBColor.from_string(color)
    return run


def shade_paragraph(paragraph, fill=PALE, border=TEAL):
    p_pr = paragraph._p.get_or_add_pPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:fill"), fill)
    p_pr.append(shd)
    borders = OxmlElement("w:pBdr")
    left = OxmlElement("w:left")
    left.set(qn("w:val"), "single")
    left.set(qn("w:sz"), "20")
    left.set(qn("w:space"), "7")
    left.set(qn("w:color"), border)
    borders.append(left)
    p_pr.append(borders)
    ind = OxmlElement("w:ind")
    ind.set(qn("w:left"), "150")
    ind.set(qn("w:right"), "120")
    p_pr.append(ind)
    paragraph.paragraph_format.space_before = Pt(5)
    paragraph.paragraph_format.space_after = Pt(8)
    paragraph.paragraph_format.line_spacing = 1.12


def add_callout(doc, text, fill=PALE, border=TEAL, size=10.6):
    p = doc.add_paragraph()
    shade_paragraph(p, fill, border)
    style_run(p.add_run(text), size=size, color=NAVY)
    set_keep(p)
    return p


def add_bullet(doc, text, level=0):
    p = doc.add_paragraph(style="List Bullet" if level == 0 else "List Bullet 2")
    p.paragraph_format.left_indent = Inches(0.24 if level == 0 else 0.48)
    p.paragraph_format.first_line_indent = Inches(-0.14)
    p.paragraph_format.space_after = Pt(3)
    p.paragraph_format.line_spacing = 1.05
    style_run(p.add_run(text), size=9.7, color="263442")
    set_keep(p)
    return p


def add_qa(doc, number, question, answer):
    h = doc.add_paragraph(style="Heading 2")
    h.paragraph_format.space_before = Pt(8)
    h.paragraph_format.space_after = Pt(2)
    style_run(h.add_run(f"{number}. {question}"), size=11.3, bold=True, color=BLACK)
    set_keep(h, keep_next=True)
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(4)
    p.paragraph_format.line_spacing = 1.07
    style_run(p.add_run(answer), size=9.6, color="263442")
    set_keep(p)
    return p


doc = Document()
section = doc.sections[0]
section.page_width = Inches(8.27)
section.page_height = Inches(11.69)
section.top_margin = Inches(0.68)
section.bottom_margin = Inches(0.67)
section.left_margin = Inches(0.72)
section.right_margin = Inches(0.72)
section.header_distance = Inches(0.28)
section.footer_distance = Inches(0.32)

styles = doc.styles
normal = styles["Normal"]
normal.font.name = "Aptos"
normal._element.rPr.rFonts.set(qn("w:ascii"), "Aptos")
normal._element.rPr.rFonts.set(qn("w:hAnsi"), "Aptos")
normal.font.size = Pt(9.8)
normal.font.color.rgb = RGBColor.from_string("263442")
normal.paragraph_format.space_after = Pt(5)
normal.paragraph_format.line_spacing = 1.08

for name, size, before, after in (("Title", 25, 0, 5), ("Heading 1", 16, 13, 5), ("Heading 2", 12, 8, 3), ("Heading 3", 10.5, 6, 2)):
    st = styles[name]
    st.font.name = "Aptos Display" if name in ("Title", "Heading 1") else "Aptos"
    st._element.rPr.rFonts.set(qn("w:ascii"), st.font.name)
    st._element.rPr.rFonts.set(qn("w:hAnsi"), st.font.name)
    st.font.size = Pt(size)
    st.font.bold = True
    st.font.color.rgb = RGBColor.from_string(BLACK)
    st.paragraph_format.space_before = Pt(before)
    st.paragraph_format.space_after = Pt(after)
    st.paragraph_format.keep_with_next = True

for list_name in ("List Bullet", "List Bullet 2"):
    st = styles[list_name]
    st.font.name = "Aptos"
    st.font.size = Pt(9.7)
    st.font.color.rgb = RGBColor.from_string("263442")

# Minimal running footer with a real page field.
footer = section.footer.paragraphs[0]
footer.alignment = WD_ALIGN_PARAGRAPH.RIGHT
footer.paragraph_format.space_before = Pt(0)
footer.paragraph_format.space_after = Pt(0)
style_run(footer.add_run("CashFlow Copilot  |  Investor discussion draft  |  "), size=8, color=GRAY)
add_field(footer, "PAGE")

# Title and opening context.
p = doc.add_paragraph(style="Title")
style_run(p.add_run("CashFlow Copilot Investor Pitch"), size=25, bold=True, color=BLACK, font="Aptos Display")
p = doc.add_paragraph()
p.paragraph_format.space_after = Pt(9)
style_run(p.add_run("Spoken pitch, product positioning and investor Q&A  |  November 2026"), size=10.4, color=GRAY)

p = doc.add_paragraph()
style_run(p.add_run("Investment thesis  "), size=10.2, bold=True, color=NAVY)
style_run(p.add_run("CashFlow Copilot is an early cash decision-support product for Indian small suppliers. It turns dated invoices and bills into a source-linked cash outlook, then lets owners test practical responses and new-order cash requirements before changing their books."), size=10.2, color="263442")

doc.add_heading("Pitch to deliver", level=1)
add_callout(doc,
    "Small suppliers can be profitable on paper and still struggle to pay wages or suppliers because customer money arrives later than expected. CashFlow Copilot turns invoices, bills and a cash balance into a dated 90-day outlook. When a shortfall appears, the owner can see which records drive it and compare practical options: request an early partial payment, defer a bill only if the supplier agrees, or calculate the advance needed to safely accept a new order. Each option is tested against the full cash timeline and stays hypothetical until the owner acts. The calculations are deterministic; AI helps owners ask questions and understand evidence. We are building a cash decision tool for suppliers who already use accounting software, and our next step is to validate repeated use and willingness to pay with real businesses.",
    fill=PALE, border=TEAL, size=10.4)

h = doc.add_paragraph(style="Heading 2")
style_run(h.add_run("Short version for a quick introduction"), size=11.5, bold=True, color=BLACK)
add_callout(doc,
    "CashFlow Copilot helps Indian suppliers see when cash may fall short, understand which invoices and bills cause the gap, and test what they can safely do about it before committing to a new order.",
    fill=PALE_BLUE, border=NAVY, size=10.3)

doc.add_heading("What the product does today", level=1)
add_bullet(doc, "Builds a dated, up-to-90-day cash outlook from approved records and an opening cash snapshot, with source-linked movements and visible date assumptions.")
add_bullet(doc, "Tests rescue options such as permitted early collections or negotiable bill deferrals, including known fees and full-horizon feasibility.")
add_bullet(doc, "Stress-tests delayed customer receipts and analyzes whether a proposed order needs a minimum advance to protect the selected reserve.")
add_bullet(doc, "Saves rescue plans and order scenarios as hypothetical records; analysis does not silently alter actual cash records.")
add_bullet(doc, "Supports reviewed CSV/XLSX and manual setup. The current project does not have an installed Tally desktop sync daemon, live bank feeds or a live WhatsApp sender.")

doc.add_page_break()
doc.add_heading("Positioning against accounting software", level=1)
p = doc.add_paragraph("Do not claim that cash forecasting is missing from Tally or Zoho Books. The product case is the decision workflow around a forecast: explain the shortfall, test constrained responses and check order cash requirements in one place. Validate that distinction with buyers and against the exact product plans they use.")
set_keep(p)

table = doc.add_table(rows=1, cols=3)
table.alignment = WD_TABLE_ALIGNMENT.CENTER
table.autofit = False
widths = [Inches(1.28), Inches(2.52), Inches(3.05)]
headers = ["Product", "Existing capability", "CashFlow Copilot focus"]
for idx, (cell, label) in enumerate(zip(table.rows[0].cells, headers)):
    cell.width = widths[idx]
    set_cell_shading(cell, NAVY)
    set_cell_margins(cell, 115, 110, 115, 110)
    cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
    p = cell.paragraphs[0]
    p.paragraph_format.space_after = Pt(0)
    style_run(p.add_run(label), size=9.1, bold=True, color="FFFFFF")
set_repeat_table_header(table.rows[0])

rows = [
    ("TallyPrime", "Cash Flow Projection; can include receivables, payables, overdue items and scenarios, with configurable daily or weekly views.", "A focused workflow that links the projected gap to conditional rescue plans, delayed-receipt stress tests and minimum-advance analysis for a proposed order."),
    ("Zoho Books", "Cash Flow Forecasting based on recurring invoices, bills, journals and expenses; availability depends on plan.", "A scenario-first workflow for dated owner-reviewed cash items, constrained actions and order decisions. Treat this as a hypothesis to test, not a claim that Zoho cannot model scenarios."),
    ("CashFlow Copilot MVP", "Imports and manual entry feed a shared forecast engine. The current product is an MVP with synthetic demo data.", "Prove that suppliers use the decision loop repeatedly, trust its assumptions and pay for the time or risk reduction it provides."),
]
for r_idx, row in enumerate(rows):
    cells = table.add_row().cells
    for idx, (cell, text) in enumerate(zip(cells, row)):
        cell.width = widths[idx]
        cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
        set_cell_margins(cell, 110, 110, 110, 110)
        set_cell_shading(cell, "FFFFFF" if r_idx % 2 == 0 else LIGHT_GRAY)
        p = cell.paragraphs[0]
        p.paragraph_format.space_after = Pt(0)
        p.paragraph_format.line_spacing = 1.02
        style_run(p.add_run(text), size=8.65, color=NAVY if idx == 0 else "263442", bold=(idx == 0))
set_table_borders(table)

doc.add_heading("Suggested live demo", level=1)
p = doc.add_paragraph("Use one short supplier story. Keep each step tied to the same workspace so the investor sees the decision flow, not a tour of screens.")
set_keep(p)
for item in [
    "Show the opening cash, upcoming customer receipts and supplier/payroll outflows. Point to the first reserve breach and the source records behind it.",
    "Delay one customer's receipt by seven days in Cash Shock Lab. Show how the gap changes and which collection actions have the most modeled cash impact.",
    "Open Rescue Planner. Compare a conditional early-collection proposal or a negotiable supplier deferral, including fees and any remaining shortfall.",
    "Open New Order Analyzer. Enter a new order's material cost and payment dates; show whether it is feasible and the minimum advance required under the selected reserve.",
    "Save a scenario and show that it remains hypothetical and leaves the underlying cash ledger unchanged.",
]:
    add_bullet(doc, item)

add_callout(doc,
    "Synthetic demo example from the current walkthrough: a ₹2,00,000 projected gap grows to ₹2,50,000 when one customer's receipt is delayed seven days; an early-collection scenario reduces the original gap to ₹3,000 after its modeled fee. Label every figure as synthetic and conditional, not a customer result or guarantee.",
    fill="FFF6E8", border="B7791F", size=9.9)

doc.add_page_break()
doc.add_heading("Questions a seasoned VC is likely to ask", level=1)
p = doc.add_paragraph("Use the answers as a truthful starting point. Replace bracketed fields with evidence before a meeting; do not present a plan, synthetic example or technical capability as customer traction.")
set_keep(p)

qas = [
    ("Who is the first customer, exactly?", "Our initial customer is an owner-managed Indian supplier that buys materials or pays operating costs before collecting from business customers. We should narrow the first market to [supplier segment], in [geography], where the owner or finance lead currently checks cash manually. We will choose that beachhead from interviews and pilot conversion, not from a broad MSME label."),
    ("How painful is this, and how often does it happen?", "The core problem is timing: a profitable business can still face a cash shortfall when bills clear before receivables. We are testing how often this forces owners to delay payments, use expensive short-term finance, reject orders or spend time reconciling spreadsheets. Our evidence today is [number of interviews/pilots] and [observed frequency or cost]. We will not claim a quantified saving until pilots measure it."),
    ("What is new if Tally and Zoho already forecast cash?", "Forecasting alone is not our claim. TallyPrime supports cash projections with overdues and scenarios, and Zoho Books offers cash flow forecasting on eligible plans. Our product hypothesis is that small suppliers need a faster bridge from a forecast to a conditional action: identify the records behind a gap, test a rescue option and check the cash timing of a new order. We need to show that owners use this workflow and value it beyond their current tools."),
    ("Why won't Tally or Zoho add this?", "They could add more decision workflows, so we do not claim a permanent feature moat. We are testing whether a focused supplier workflow can win on time-to-answer and day-to-day usefulness. Defensibility would have to come from trusted integrations, repeat usage, an embedded workflow and permissioned outcome data over time. Those are goals to earn, not assets we claim today."),
    ("Is this a standalone accounting system or a layer on top?", "It is a decision-support layer, not a replacement ledger. The MVP accepts reviewed file imports and manual records and runs scenarios without posting them as actual transactions. A Tally desktop sync daemon is not currently installed, and we should describe live integrations only after they are working and tested."),
    ("How accurate is the forecast?", "The current forecast is a dated calculation from cash records, expected dates, recurring rules and owner-approved assumptions. It is not a learned probability that a customer will pay on a particular day. We are measuring forecast error against actual cash movement in pilots, by horizon and by data completeness. Until we have that evidence, we describe a transparent scenario outlook rather than a guarantee."),
    ("What does AI do, and what can it not do?", "AI can help an owner ask questions in plain language, select source-backed explanations and draft a collection message. Deterministic finance code calculates balances, dates, feasibility and fees. AI cannot discover obligations missing from the ledger, know a buyer's true intent, make a customer pay, secure a supplier's agreement or authorize the owner's risk decision. A human reviews assumptions and decides whether to act."),
    ("What happens when the ledger is incomplete or dates are wrong?", "The product needs to make uncertainty visible. Missing or unapproved dates should be reviewed, assumptions should be labeled, and unresolved records should warn the owner instead of silently becoming certain receipts. We will track import corrections, excluded items and forecast accuracy so we can identify when a workspace is not reliable enough for a decision."),
    ("How will you get the data into the product?", "The current route is reviewed CSV/XLSX imports and manual entry. Imported rows are previewed and approved before use. We have a Tally connection enrollment flow, but the desktop sync daemon is not installed; we do not currently offer live bank feeds. We will prioritize integrations based on pilot demand and only after we can preserve consent, business-level isolation and reconciliation quality."),
    ("Why will a business trust you with sensitive financial data?", "The MVP includes signed-in sessions and server-enforced business membership checks. That is a product control, not a claim of production certification. Before broad deployment, we need documented retention and deletion practices, encrypted transport, backups, incident response and a security review. Pilots should use explicit consent and only the data needed to validate the workflow."),
    ("How will you acquire customers without expensive sales?", "We should begin with founder-led pilots in one supplier segment and one geography, then compare referral routes such as accountants, bookkeepers and supplier networks. Those channels are hypotheses until measured. Our next test is [pilot source], with [number] qualified businesses, tracking onboarding effort, activation, repeat weekly use and conversion to paid use."),
    ("What will customers pay, and why?", "Pricing is not yet established. We will test willingness to pay against the value customers report: time saved, fewer missed cash risks and better order decisions. Our initial pricing experiment is [price and billing basis], tested with [number] active businesses. We should not state a price or ROI until buyers accept it and continue using the product."),
    ("How large is the market?", "We will build a bottom-up estimate for the chosen supplier segment: eligible businesses in [geography] × a validated annual price of ₹[price]. We will source the business count from [credible source], remove businesses that do not fit our data and workflow requirements, and report the reachable serviceable market separately. A broad MSME headline is not our obtainable market."),
    ("What traction do you have?", "The current repository describes a working student MVP with a repeatable synthetic supplier demo. In the meeting, we will report only verified live evidence: [businesses onboarded], [weekly active users], [retention period], [paid conversions] and [forecast performance]. If those are zero, we will say we are pre-pilot and show the next validation milestone instead of implying product-market fit."),
    ("What is the business model and can the unit economics work?", "The leading hypothesis is a recurring per-business subscription, but we have not validated pricing or acquisition costs yet. We will measure onboarding and support time, hosting and model costs, gross margin, sales cycle and retention by cohort. If the product requires heavy bookkeeping support for each account, we will need a different channel or operating model."),
    ("What is the hardest risk in the business?", "The largest product risk is that an owner acts on a forecast built from incomplete or stale data. The largest adoption risk is that accounting reports are sufficient and the owner will not open a separate workflow. We are addressing both through source-linked calculations, visible assumptions, reviewed imports and pilots that measure repeated use, accuracy and willingness to pay."),
    ("What would make you stop or change direction?", "If owners cannot provide complete enough data quickly, if forecast results do not match actual cash movements, or if they do not revisit the tool and pay after a short pilot, we should narrow the segment or workflow. Our pilot success bar is [activation], [forecast error threshold], [repeat-use target] and [paid conversion target] by [date]."),
    ("Why is this the right team to build it?", "We combine [relevant founder experience] with a working finance engine and supplier workflow. The team still needs to demonstrate direct access to the chosen customer segment and operating experience with accounting integrations. We will be specific about who owns product, finance correctness, customer discovery and distribution."),
    ("How much are you raising, and what will it prove?", "We are raising ₹[amount] for [runway] to reach [three measurable milestones]. The milestones should prove customer demand, forecast reliability and repeatable distribution, not just add features. Use of funds: [engineering], [pilots/customer success], [integrations/security], with monthly success measures and a clear decision point if validation misses the target."),
]
for i, (q, a) in enumerate(qas, 1):
    add_qa(doc, i, q, a)

doc.add_page_break()
doc.add_heading("Founder facts to prepare before the meeting", level=1)
p = doc.add_paragraph("Fill these from evidence. Keep a one-page source sheet so every number in the pitch can be traced to a customer record, experiment or public dataset.")
set_keep(p)
for item in [
    "First customer segment, city/region and the reason this group is the initial beachhead.",
    "Customer discovery: interviews completed, repeated pain points, current workarounds and willingness-to-pay evidence.",
    "Pilot funnel: invited, onboarded, active weekly, retained, paying; include dates and cohort size.",
    "Forecast quality: sample size, forecast horizon, error measure, data completeness and comparison with actual receipts/payments.",
    "Pricing experiment, onboarding/support cost, cloud/model cost, sales cycle and gross-margin assumptions.",
    "Bottom-up market count and source, reachable segment and annual price assumption.",
    "Founder roles and relevant experience; one person accountable for financial correctness and one for customer learning.",
    "Fundraising amount, runway, hiring or build plan, milestones and the decision gate at the end of the round.",
]:
    add_bullet(doc, item)

doc.add_heading("Claims to avoid", level=1)
for item in [
    "Do not say Tally or Zoho have no cash forecasting.",
    "Do not say AI predicts payments or prevents cash shortages with certainty.",
    "Do not call synthetic demo numbers customer outcomes, revenue, savings or traction.",
    "Do not say Tally sync, live bank feeds, WhatsApp sending or production-grade security are complete unless they have been implemented and verified.",
    "Do not present a large MSME count as the market you can actually reach.",
]:
    add_bullet(doc, item)

doc.add_heading("Reference sources", level=1)
sources = [
    "TallyHelp, How to View Cash Flow and Cash Flow Projection Reports in TallyPrime: https://help.tallysolutions.com/tally-prime/accounting-financial-reports/cash-flow-and-projection-report-tally/",
    "TallyHelp, Managing Receivables and Payables in TallyPrime: https://help.tallysolutions.com/managing-receivables-and-payables-in-tallyprime/",
    "Zoho Books Help, Business Overview Reports and Cash Flow Forecasting: https://www.zoho.com/in/books/help/reports/business-overview.html",
    "Zoho Books India pricing and plan comparison: https://www.zoho.com/in/books/pricing/",
    "Product scope and synthetic demo details checked against the CashFlow Copilot project README and acceptance test checklist, November 2026.",
]
for s in sources:
    p = doc.add_paragraph(style="List Bullet")
    p.paragraph_format.space_after = Pt(3)
    p.paragraph_format.line_spacing = 1.0
    style_run(p.add_run(s), size=8.5, color="263442")
    set_keep(p)

doc.core_properties.title = "CashFlow Copilot Investor Pitch"
doc.core_properties.subject = "Spoken pitch, positioning and investor diligence Q&A"
doc.core_properties.keywords = "CashFlow Copilot, investor pitch, cash planning, India"
doc.core_properties.author = "CashFlow Copilot"
doc.save(OUT)
print(OUT)
