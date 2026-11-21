# CashFlow Copilot Investor Pitch

## One-line pitch

CashFlow Copilot helps small suppliers see when cash may run short, understand what is driving the gap, and test what they can safely do about it.

## 90-second pitch

Small suppliers can be profitable on paper and still struggle to pay wages or suppliers because customer payments arrive later than expected. Owners often have invoices and bills recorded somewhere, but they still have to piece together the timing, judge which commitments might be negotiable, and decide whether there is enough cash to accept a new order.

CashFlow Copilot turns reviewed invoices, bills and cash balances into a dated, 90-day cash outlook. It shows which records drive a projected shortfall, then lets an owner test options such as requesting an early partial payment, deferring a bill if the supplier agrees, or calculating the advance needed to safely take a new order.

The scenarios stay separate from the actual books until the owner acts. Financial calculations are deterministic; AI helps owners ask questions, understand the evidence and draft collection messages.

We’re not claiming that cash forecasting is missing from accounting software. Our product hypothesis is that suppliers need a clearer path from a forecast to a practical decision. We have an MVP with reviewed file imports and manual setup. Our next step is to test it with [number] supplier businesses and measure forecast accuracy, repeat use and willingness to pay. We’re raising ₹[amount] to reach [specific milestones].

## Short version

CashFlow Copilot helps Indian suppliers see a possible cash shortfall early, trace it to invoices and bills, and test ways to respond before committing to a new order.

# Questions a VC may ask

### What is new compared with Tally or Zoho Books?

Forecasting itself is not our claim. TallyPrime has cash flow projections with configurable time periods, overdue items and scenarios. Zoho Books offers cash flow forecasting based on recurring transactions, with availability depending on the plan. (TallyPrime, Zoho Books, Zoho Books plans)

Our hypothesis is that small suppliers need help with the decision after the forecast: identifying the records behind a gap, testing conditional rescue options and checking whether a new order needs an advance. We need to prove customers value and repeatedly use that workflow.

### Who is the first customer?

Our initial customer is an owner-managed Indian supplier that pays for materials or operating costs before collecting from business customers. We’ll focus first on [specific supplier segment] in [city or region], where the owner or finance lead currently checks cash manually.

### How painful is the problem, and how often does it happen?

The problem is a timing mismatch: bills can come due before expected receipts arrive. We’re testing how often this causes owners to delay payments, use short-term finance, reject orders or spend time reconciling spreadsheets. So far, we have [number of interviews or pilots] and observed [specific evidence]. We’ll quantify the cost through pilots rather than claim savings before measuring them.

### How accurate is the forecast?

The current forecast calculates dated cash scenarios from recorded items, expected dates, recurring rules and owner-approved assumptions. It does not claim to know the probability that a customer will pay on a particular day. We’ll compare forecasts with actual receipts and payments in pilots, and report accuracy by forecast horizon and data completeness.

### What does AI do here?

AI helps owners ask questions in plain language, understand source-backed explanations and draft collection messages. The finance engine calculates balances, dates, fees and scenario feasibility. AI cannot discover obligations missing from the records, know a buyer’s true intent, make a customer pay or secure a supplier’s agreement. The owner reviews assumptions and decides whether to act.

### How do you get data into the product?

The MVP uses reviewed CSV/XLSX imports and manual entry. Imported rows are reviewed before they affect the forecast. The current project has a Tally connection enrollment flow, but the desktop sync daemon is not installed. We should describe live integrations only when they are implemented and verified.

### Why won’t Tally or Zoho build this?

They could. We’re not claiming a permanent feature moat. We’re testing whether a focused supplier workflow can deliver a faster, more useful answer. Over time, defensibility would need to come from trusted integrations, repeated use and an embedded workflow. Those are goals to earn, not assets we claim today.

### What traction do you have?

The current product is an MVP with a repeatable synthetic supplier demo. We’ll report verified live evidence: [businesses onboarded], [weekly active users], [retention], [paid conversions] and [forecast performance]. If we are still pre-pilot, we’ll say that and show the next validation milestone.

### How will you acquire customers?

We’ll start with founder-led pilots in one supplier segment and one geography. We plan to test referrals through accountants, bookkeepers or supplier networks, then compare which channel brings active, retained customers. These are channel hypotheses until we measure conversion and acquisition cost.

### What will customers pay?

Pricing is not yet established. We’ll test willingness to pay against the value customers report: time saved, earlier visibility into cash risks and better order decisions. Our first pricing test is [price and billing basis] with [number] active businesses.

### How large is the market?

We’ll build a bottom-up estimate: eligible businesses in [chosen segment and geography] multiplied by a validated annual price of ₹[price]. We’ll source the business count from [credible dataset] and separate the reachable market from the larger MSME population.

### What is your moat?

Today, we don’t claim a durable moat. We’re testing whether we can build a trusted workflow that suppliers use repeatedly. Potential defensibility would come from integrations, adoption inside daily cash decisions and permissioned outcome data, if customers use the product and consent to that data use.

### How will you keep financial data safe?

The MVP includes signed-in sessions and business-level access checks. That is not the same as production security certification. Before broad deployment, we need documented retention and deletion practices, encrypted transport, backups, incident response and a security review.

### What is the biggest risk?

The biggest product risk is that an owner acts on a forecast built from incomplete or stale data. The biggest adoption risk is that existing accounting reports are enough and owners don’t return to a separate workflow. We’ll test both by measuring data completeness, forecast accuracy and repeat use in pilots.

### What would make you change direction?

If owners can’t provide complete enough data quickly, if forecast results don’t match actual cash movement, or if they don’t return and pay after a pilot, we should narrow the segment or rethink the workflow. Our pilot success measures are [activation target], [forecast accuracy target], [repeat-use target] and [paid conversion target] by [date].

### How much are you raising, and what will it prove?

We’re raising ₹[amount] for [runway] to reach [three measurable milestones]. The milestones should prove customer demand, forecast reliability and a repeatable acquisition path—not just deliver more features.

## Suggested demo

1. Show opening cash and dated customer receipts, supplier bills and payroll.
2. Point out the first projected reserve breach and the records behind it.
3. Delay one receipt by seven days and show how the cash gap changes.
4. Test a conditional rescue option, including any modeled fee.
5. Analyze a new order and show the advance needed to protect the chosen reserve.
6. Show that saving the scenario does not change the actual cash records.

The current demo uses synthetic figures: a ₹2,00,000 projected gap grows to ₹2,50,000 after a seven-day receipt delay; an early-collection scenario reduces the original gap to ₹3,000 after its modeled fee. Present these as demo calculations, not customer results or guarantees.