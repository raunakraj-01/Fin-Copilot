# Real-World Indian MSME Dataset: "Kalyani Industrial Packaging"

This dataset models an active Indian manufacturing supplier (**Kalyani Industrial Packaging Pvt Ltd**, Peenya Industrial Area, Bengaluru) operating under authentic Indian commercial, tax, and banking dynamics.

---

## 🏢 Business Snapshot
* **Company Name**: Kalyani Industrial Packaging Pvt Ltd
* **Sector**: Corrugated packaging & precision industrial packaging
* **As-Of Snapshot Date**: `2026-11-01`
* **Opening Liquid Cash in Bank**: ₹3,50,000.00
* **Target Minimum Safety Reserve**: ₹1,00,000.00
* **Workspace ID**: `650000000000000000000088`

---

## 🎯 Realistic Edge Cases Represented

### 1. The Chronic Corporate Late Payer (Delay Predictor Test)
* **Varun Beverages Ltd** (Pepsi Bottler) & **Reliance Retail Ltd** (JioMart Central DC).
* Contracts state 30–45 days credit, but corporate payment release cycles take 21–32 days past due dates.
* **Result**: The Payment Delay Predictor detects 5 verified historical settlements and auto-adjusts expected dates on open receivables (e.g. from Nov 15 to Dec 06).

### 2. Section 43B(h) MSME Tax Liability Trap
* **Aditi Corrugation Kraft Mills** (Micro enterprise): Raw paper bill of ₹4,20,000 due Nov 14. Under Section 43B(h) of the Income Tax Act, delaying past the statutory 15/45 day cutoff triggers an immediate 30% tax penalty (₹1.26 Lakhs disallowance!).
* **Prabhat Dies & Tooling** (Small enterprise): Tooling bill of ₹1,85,000 due Nov 24.

### 3. Partial Collections & Split Settlements
* **Kalyani Auto Components LLP**: ₹2,10,000 invoice with ₹70,000 already settled via NEFT, leaving ₹1,40,000 open.
* **Mahindra Logistics Ltd**: ₹3,10,000 invoice with ₹1,00,000 settled, leaving ₹2,10,000 open.
* **Finolex Industrial Cables**: ₹1,20,000 vendor bill partly paid with ₹40,000 settled.

### 4. Informal Overdue Debtors (WhatsApp / Telegram Collections)
* **Swastik Traders & Wholesalers** (Surat): ₹1,25,000 overdue since Oct 18. Requires proactive reminders with payment links.

### 5. Negotiable Suppliers vs. Non-Negotiable Overheads (Rescue Planner)
* **Negotiable**:
  * *Supreme Petrochem Granules*: ₹5,00,000 bill negotiable up to 25 days with ₹3,500 interest fee.
  * *Radhey Shyam Printing Inks*: ₹95,000 bill negotiable up to 15 days with ₹500 fee.
* **Non-Negotiable (Statutory / Operations)**:
  * Factory Staff & Labor Wages (Nov 07, ₹2,50,000)
  * Industrial Shed Lease Rent (Nov 03, ₹85,000)
  * EPFO & ESIC Compliance (Nov 15, ₹38,000)
  * GSTR-3B Monthly GST Liability (Nov 20, ₹1,45,000)
  * BESCOM HT Industrial Power (Nov 23, ₹62,500.50)

### 6. Early Collection Acceleration (Prompt Payment Discount)
* **Varun Beverages Ltd**: Invoice `INV/2026/101` allows collecting up to ₹3,00,000 from Nov 05 with a ₹4,500 fee (1.5% prompt discount).
* **Reliance Retail Ltd**: Invoice `INV/2026/088` allows collecting up to ₹2,50,000 from Nov 05 with a ₹4,000 fee.

---

## 🚀 How to Load and Test

1. **Seed the Workspace**:
   ```bash
   npm run seed:realworld
   ```

2. **Test Payment Delay Predictor**:
   ```bash
   npm run test:delay
   ```
   *Notice how Varun Beverages and Reliance Retail expected dates are updated based on median historical lateness.*

3. **Test Morning Brief**:
   ```bash
   npm run test:brief
   ```

4. **Test AI Copilot / Telegram**:
   ```bash
   npm run test:ai "Which suppliers are governed by Section 43B(h) and what is our tax risk?"
   npm run test:ai "What happens if Reliance Retail delays their ₹4.8 Lakh invoice past November?"
   npm run test:ai "Draft a WhatsApp follow-up for Swastik Traders."
   ```
