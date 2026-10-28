from pathlib import Path
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


ROOT = Path(r"D:\el-sem-3")
OUT = ROOT / "output" / "pdf" / "cashflow_copilot_project_overview.pdf"
OUT.parent.mkdir(parents=True, exist_ok=True)

pdfmetrics.registerFont(TTFont("Segoe", r"C:\Windows\Fonts\segoeui.ttf"))
pdfmetrics.registerFont(TTFont("SegoeBold", r"C:\Windows\Fonts\segoeuib.ttf"))

W, H = A4
ink = colors.HexColor("#172B38")
muted = colors.HexColor("#536674")
teal = colors.HexColor("#087C83")
pale = colors.HexColor("#EAF5F4")
line = colors.HexColor("#DAE4E7")
white = colors.white

c = canvas.Canvas(str(OUT), pagesize=A4)
c.setTitle("CashFlow Copilot | One-page project overview")
c.setAuthor("CashFlow Copilot project")


def txt(x, y, value, size=9, bold=False, color=ink):
    c.setFillColor(color)
    c.setFont("SegoeBold" if bold else "Segoe", size)
    c.drawString(x, y, value)


def wrap(value, width, size=9, bold=False):
    font = "SegoeBold" if bold else "Segoe"
    lines, current = [], ""
    for word in value.split():
        candidate = f"{current} {word}".strip()
        if pdfmetrics.stringWidth(candidate, font, size) <= width:
            current = candidate
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def para(x, y, value, width, size=9, leading=13, color=ink):
    for row in wrap(value, width, size):
        txt(x, y, row, size, color=color)
        y -= leading
    return y


def section(y, heading):
    txt(42, y, heading.upper(), 9, True, teal)
    c.setStrokeColor(line)
    c.line(42, y - 7, W - 42, y - 7)


# Header
c.setFillColor(ink)
c.rect(0, H - 126, W, 126, fill=1, stroke=0)
c.setFillColor(colors.HexColor("#4AC8C1"))
c.roundRect(42, H - 42, 98, 18, 8, fill=1, stroke=0)
txt(53, H - 36, "STUDENT MVP", 8, True, ink)
txt(42, H - 77, "CashFlow Copilot", 26, True, white)
txt(42, H - 103, "Know when cash gets tight. Test a practical response before committing.", 10, color=white)

# Problem and promise
section(687, "The idea")
para(42, 663, "Small Indian B2B suppliers often pay vendors and staff before customers pay them. A healthy order book can still leave too little cash on a critical day. CashFlow Copilot turns existing receivables, payables and expenses into a dated 90-day view, explains shortages, and tests possible next steps.", W - 84, 9.2, 14)

# Four-step journey
section(584, "How it works")
steps = [
    ("1", "Set up & review", "Enter opening cash and a safety reserve. Import CSV/XLSX records or add them manually; check dates, amounts and flagged rows before approval."),
    ("2", "See the outlook", "View daily projected cash, the first negative or reserve-breach date, the worst balance, and the exact records driving the gap."),
    ("3", "Plan a rescue", "Test earlier customer collections or allowed payment delays. Compare before/after cash and save a proposed plan for tracking."),
    ("4", "Check a new order", "Add expected order receipts and costs. Calculate the minimum customer advance needed to protect the reserve across the timeline."),
]
top = 558
for i, (num, title, body) in enumerate(steps):
    x = 42 + (i % 2) * 260
    y = top - (i // 2) * 105
    c.setFillColor(pale)
    c.roundRect(x, y - 90, 250, 92, 8, fill=1, stroke=0)
    c.setFillColor(teal)
    c.circle(x + 18, y - 18, 11, fill=1, stroke=0)
    txt(x + 14.9, y - 21.5, num, 9, True, white)
    txt(x + 36, y - 21, title, 10.2, True)
    para(x + 14, y - 41, body, 222, 8.2, 11.5, muted)

# Example
section(337, "Synthetic demo example")
txt(42, 310, "₹2,00,000", 17, True, ink)
txt(42, 293, "opening cash", 8.2, color=muted)
txt(207, 310, "6 Nov", 17, True, ink)
txt(207, 293, "first negative day", 8.2, color=muted)
txt(370, 310, "−₹2,00,000", 17, True, ink)
txt(370, 293, "worst balance on 11 Nov", 8.2, color=muted)
para(42, 270, "A ₹3,00,000 supplier bill and ₹1,00,000 payroll arrive before an expected ₹4,00,000 customer receipt on 26 Nov. The planner can test collecting part of that invoice earlier, while keeping the total receipt unchanged.", W - 84, 8.8, 13)

# Implementation and boundaries
section(203, "What powers it")
para(42, 179, "React app  →  Express API  →  MongoDB records and saved scenarios. A deterministic finance engine computes daily balances; rescue and order tools rerun that same engine with hypothetical changes. Money is handled in integer paise, and each movement remains traceable to its source.", W - 84, 8.6, 12.5)
c.setFillColor(colors.HexColor("#F4F7F8"))
c.roundRect(42, 63, W - 84, 56, 7, fill=1, stroke=0)
txt(54, 101, "DECISION SUPPORT, NOT A PAYMENT PREDICTION", 8.3, True, teal)
para(54, 85, "Dates are entered assumptions. Rescue actions need customer or supplier agreement. Saved plans and order scenarios do not alter approved cash records. This is a synthetic, single-workspace demo without authentication.", W - 108, 8, 11, muted)

c.setStrokeColor(line)
c.line(42, 46, W - 42, 46)
txt(42, 30, "CashFlow Copilot  |  Project overview", 7.5, color=muted)
txt(W - 73, 30, "1 / 1", 7.5, color=muted)
c.showPage()
c.save()
print(OUT)
