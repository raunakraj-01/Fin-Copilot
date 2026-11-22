# Presentation sample data

All names and amounts are synthetic. Amounts are in rupees (INR); dates use YYYY-MM-DD. These files use the application's recognized import headers.

## Set up the demonstration

1. Create a new workspace named `Presentation Demo` in Setup. Use snapshot date **2026-11-01**, opening cash **200000**, and minimum reserve **50000**.
2. Import `demo_receivables.csv` as **Receivables** and approve all 12 rows.
3. Import `demo_payables.csv` as **Payables** and approve all 14 rows.
4. Open Cash Outlook, then Rescue Planner and Cash Shock Lab.

Use a new workspace for this scenario rather than importing into the seeded workspace: combining the datasets changes the forecast. Settlements already made before the snapshot are reflected in the opening cash; only outstanding balances generate future movements. No recurring expense rules are needed for this example.

## What to show

| Example | Record IDs | Demonstration |
| --- | --- | --- |
| Large delayed customer receipt | DEMO-R001 | Acme owes 400000, due November 15 but expected November 26. Early collection is capped at 200000 with a 3000 fee on November 4. |
| Partially collected invoices | DEMO-R002, DEMO-R007 | Only 180000 and 60000 remain outstanding, respectively. |
| Overdue customer invoice | DEMO-R004 | Due October 25; expected November 8. An early collection of up to 20000 is permitted from November 3. |
| On-time customer receipts | DEMO-R003, DEMO-R006 | Compare scheduled dates with the delayed invoices. |
| Multiple invoices for one customer | DEMO-R001, DEMO-R005 | Select Acme Retail Pvt Ltd in Cash Shock Lab to delay that customer's receipts. |
| Negotiable supplier payment | DEMO-P002 | A 300000 payment can move up to 20 days, with a known 2000 fee on November 26. |
| Partly paid supplier bill | DEMO-P004 | The 50000 bill has 25000 outstanding, with a 14-day extension permitted. |
| Mandatory payments | DEMO-P001, DEMO-P003, DEMO-P006, DEMO-P008, DEMO-P009, DEMO-P012 | Rent, electricity, and payroll have no permitted extension. |
| Optional spending | DEMO-P005, DEMO-P011 | Marketing and trade fair spending are discretionary and negotiable; CSV imports classify them as payables. |
| Unknown action fees | DEMO-R007, DEMO-P007 | A blank fee means unknown. Zero means explicitly no estimated fee. |
| Paid and cancelled records | DEMO-R010, DEMO-R011, DEMO-P013, DEMO-P014 | These records create no future cash movements. |
| Decimal amounts | DEMO-R008, DEMO-P006 | Demonstrate rupees and paise. |
| Receipt outside the outlook | DEMO-R012 | Expected February 15, 2027; it is outside the 90-day outlook starting November 1. |

## Verified baseline

With exactly the setup above, no extra records, and a 90-day horizon:

- Cash first becomes negative on **2026-11-06**.
- Worst closing cash is **-240000 INR** on **2026-11-15**.
- Ending cash is **457000 INR** on **2027-01-29**.

These values were checked using the project's CSV parser, import normalizer, item validator, and forecast engine. All 26 main-file rows are accepted with no import issues. Rescue results depend on the selected objective and permitted actions; fees apply when an action is modeled.

## Optional import-validation demonstration

Use `validation_practice_receivables.csv` separately, preferably in another disposable workspace. It deliberately contains errors; it is not part of the baseline scenario.

| CSV row | Example | Expected result |
| --- | --- | --- |
| 2 | Missing expected date | Needs review; enter a future expected date before committing. |
| 3 | Negative invoice amount | Rejected; enter a positive amount. |
| 4 | Settlement greater than invoice amount | Rejected; correct the settlement and status. |
| 5 | November 31 | Rejected; correct the invalid calendar date. |
| 6 | First occurrence of CHECK-R005 | Accepted. |
| 7 | Repeated CHECK-R005 | Rejected; use a unique source ID. |

Initial result: **1 accepted, 1 needs review, 4 rejected**. The app may show multiple related issues for an invalid amount or settlement.
