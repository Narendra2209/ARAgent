# MYOB AR Aging Dashboard

Pulls the **AR Aging (Summary)** report from **MYOB Acumatica / Advanced**
(Receivables → Reports → AR Aging) and shows it as KPI cards, an aging-bucket chart, and a
per-customer summary table — with **Run Report** and **Export CSV**.

The frontend and backend are **two completely separate projects** — each has its own
`package.json`, its own dependencies, and runs on its own. There is no shared root package.

```
.
├── server/   Backend — Express API. Authenticates to MYOB and computes the AR Aging summary.
│   └── .env  Backend config (MYOB keys live here)
└── client/   Frontend — React (Vite) dashboard UI.
```

---

## Backend (`server/`)

```powershell
cd server
npm install
Copy-Item .env.example .env   # first time only
npm run dev                   # http://localhost:4000
```

The backend owns all MYOB configuration in `server/.env`. It ships with `USE_MOCK_DATA=true`,
so it serves built-in **sample data** until you add your keys.

### `server/.env`

| Variable | What it is |
|---|---|
| `USE_MOCK_DATA` | `true` = sample data (no MYOB calls); `false` = live MYOB |
| `MYOB_BASE_URL` | Instance URL, e.g. `https://yourco.myob.acumatica.com` (no trailing slash) |
| `MYOB_ENDPOINT_NAME` / `MYOB_ENDPOINT_VERSION` | Contract REST endpoint (System → Integration → Web Service Endpoints). MYOB default is usually `Default`. |
| `MYOB_USERNAME` / `MYOB_PASSWORD` | API user credentials |
| `MYOB_COMPANY` | Tenant/company login name (blank if single-company) |
| `AR_AGING_STRATEGY` | `computed` (default) or `odata` — see below |
| `AR_AS_OF_DATE` | Aging as-of date `YYYY-MM-DD` (blank = today) |

**Data source strategies**
- **`computed`** (default): calls the contract-based REST `Invoice` resource for open documents and
  computes the buckets (Current, 1-30, 31-60, 61-90, 90+) here. No Generic Inquiry needed.
- **`odata`**: reads a Generic Inquiry exposed via OData. Set `MYOB_GI_NAME`. Columns are matched
  case-insensitively (Customer / CustomerName / DueDate / Balance).

**Endpoints**

| Endpoint | Description |
|---|---|
| `GET /api/health` | Mode + whether MYOB is configured |
| `GET /api/ar-aging` | AR Aging Summary as JSON (customers, totals, KPIs) |
| `GET /api/ar-aging/export.csv` | Same data as a CSV download |
| `GET /api/customers` | Customer list: ID, name, credit limit, email (default email when missing) |
| `POST /api/reminders/send` | Email customers 31+ days overdue. Body: `{ "testMode": bool, "dryRun": bool }` |

---

## Overdue reminder emails (sent from Outlook via Microsoft Graph)

The **Overdue Reminders** tab emails every customer who is **31+ days overdue** a
summary of their balance. Mail is sent from a Microsoft 365 mailbox using the Graph
app-only (client-credentials) flow.

**Test mode (default ON):** every reminder goes to `MAIL_TEST_RECIPIENT`
(`narendrareddy2209@gmail.com`) instead of the real customer — so you can test safely.
Turn the toggle off (or set `MAIL_TEST_MODE=false`) to send to each customer's own email.
**Preview** composes the full list (recipients + amounts) without sending anything and
needs no Graph credentials.

### Azure setup (one time)
1. Entra ID (Azure AD) → **App registrations** → New registration → note **Tenant ID** + **Client ID**.
2. **Certificates & secrets** → new client secret → `GRAPH_CLIENT_SECRET`.
3. **API permissions** → Microsoft Graph → **Application** → `Mail.Send` → **Grant admin consent**.
4. `GRAPH_SENDER` = a licensed mailbox the app may send as.

Fill `GRAPH_TENANT_ID` / `GRAPH_CLIENT_ID` / `GRAPH_CLIENT_SECRET` / `GRAPH_SENDER` in `server/.env`.

---

## Frontend (`client/`)

```powershell
cd client
npm install
npm run dev                   # http://localhost:5173
```

In dev, Vite proxies `/api` → `http://localhost:4000` (see `client/vite.config.js`), so the
frontend talks to the backend with same-origin requests. The backend also enables CORS, so you can
host the two anywhere. If you deploy them on different hosts, change the proxy target (dev) or point
the frontend at the backend URL.

---

## Running both

Open **two terminals** — one for each project:

```powershell
# terminal 1
cd server; npm run dev

# terminal 2
cd client; npm run dev
```

Then open the dashboard at **http://localhost:5173**.

---

## Notes
- Aging is bucketed by **days past due date** relative to the as-of date.
- If a live call fails, the dashboard shows the MYOB error; set `USE_MOCK_DATA=true` to keep working
  with sample data while you sort credentials.
- Field names in `fetchComputedDocuments` (`server/src/arAgingService.js`) reflect the standard MYOB
  Acumatica `Default` endpoint. Adjust the `$select` if your endpoint differs.
- Auth uses **cookie-based login** (`/entity/auth/login`). If your instance uses OAuth2, that path
  can be added to `server/src/myobClient.js`.
