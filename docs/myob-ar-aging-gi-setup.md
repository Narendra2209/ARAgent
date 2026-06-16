# MYOB Generic Inquiry setup — `AR-DashboardDocs`

**Purpose:** expose open AR documents (with MYOB's *real* open balance and due
date) over OData so the AR dashboard shows figures that match MYOB's AR Aging
report (AR631000) exactly, live.

**Who does this:** anyone with permission to create Generic Inquiries in MYOB
Advanced (a MYOB administrator or MYOB partner/consultant). ~10 minutes.

---

## 1. Create the inquiry

Screen: **Generic Inquiry (SM208000)** → add a new record.

- **Inquiry Title:** `AR-DashboardDocs`  (must match exactly)

## 2. Tables tab — add two tables

| Table (DAC) | Alias |
|---|---|
| `PX.Objects.AR.ARRegister` | ARRegister |
| `PX.Objects.AR.Customer` | Customer |

## 3. Relations tab — join them

| Left table | Field | Condition | Right table | Field |
|---|---|---|---|---|
| ARRegister | CustomerID | Equals | Customer | BAccountID |

## 4. Conditions tab — open, released documents only

| Field | Condition | Value |
|---|---|---|
| ARRegister.OpenDoc | Equals | True |
| ARRegister.Released | Equals | True |

## 5. Results Grid tab — columns (use these exact Display Names)

| Object.Field | Display Name |
|---|---|
| ARRegister.CustomerID | `CustomerID` |
| Customer.AcctName | `CustomerName` |
| ARRegister.DocType | `DocType` |
| ARRegister.RefNbr | `RefNbr` |
| ARRegister.DueDate | `DueDate` |
| **ARRegister.CuryDocBal** | `Balance` |
| ARRegister.BranchID | `Branch` |

> `CuryDocBal` is the key field — it is the document's true open balance (after
> applied payments), which is what the AR Aging report ages. Credit memos come
> out negative automatically; no sign handling needed.

## 6. Expose it via OData  ← the step people miss

At the **top of the Generic Inquiry form** (summary area, near the title), tick:

- ☑ **Expose via OData**

Then **Save**. (Saving the GI alone does NOT publish it — this checkbox does.)

## 7. Verify it's live

Open this URL in a browser (any user logged into MYOB):

```
https://metfoldsm.myobadvanced.com/OData/Metfold Sheet Metal/AR-DashboardDocs?$top=1&$format=json
```

- Returns JSON rows → success.
- 404 → not exposed (re-check step 6 and the exact title).
- Prompts for login → enter MYOB username/password, then it returns data.

---

## 8. Point the app at it

In `server/.env`:

```
AR_AGING_STRATEGY=odata
MYOB_GI_NAME=AR-DashboardDocs
```

Restart the server. The dashboard, KPI cards, and CSV export will then read
MYOB's live figures and match AR631000 — Current, 1–30, and total included.
