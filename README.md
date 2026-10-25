# Skyroad Holidays – Sales CRM

A private web app that tracks every enquiry from **new query → supplier mail → quote → follow-up → booking → payments → travel → completed**. It works on Mac, Windows, iPad and phone in any browser, with no installation.

It is built the same way as your Cash Management System (Next.js + Supabase/PostgreSQL + Vercel), but it is a **separate site with its own database and its own password**.

---

## 1. What it does

| Area | What you get |
|---|---|
| **Dashboard** | 10 stage cards (+ Lost) with counts, open enquiries, new and confirmed this month, conversion %, client balances due, follow-ups due, suppliers keeping you waiting (24 hrs+), departures in the next 30 days, who is travelling now, enquiries vs bookings chart, lead sources, recent activity |
| **Pipeline** | Kanban board – one column per stage, one card per enquiry, with a "Move to next stage" button |
| **New enquiry** | **Quick add**: paste the client's message (e.g. `Thailand / 1 dec to 6 Dec / 2 adults / 2N Krabi, 3N Phuket`) and press **Fill the form**. It fills destination, dates, travellers, nights split, hotel category, budget, package and inclusions. It also captures lead source, priority, hotel category, budget, the **Tour / Land package (hotel + transfers + full sightseeing)** option, inclusions and the follow-up date |
| **Enquiry page** | Progress stepper with a "next step" hint, trip details, **suppliers & quotes side by side** (with Gmail / WhatsApp / Copy buttons that open a ready-made standard rate request), your selling price vs the selected supplier's cost = **margin**, share quote and itinerary link (Canva), confirm booking, client payments with balance due, follow-up, a log for calls and WhatsApps, and a full timeline |
| **Follow-ups** | Overdue / today / next 7 days / open enquiries with no follow-up. One-tap WhatsApp follow-up or payment-reminder message, and "Done → next date" |
| **Suppliers** | Your DMCs and hotels with email, WhatsApp, destinations covered, response rate and the enquiries sent to each |
| **Reports** | Pipeline by stage, lead sources & conversion, destinations (with margin), monthly enquiries vs bookings, lost reasons, client balances due, supplier response times, and the full enquiry register. All export to Excel/CSV or print/PDF |
| **Settings** | Change password, signed-in devices, full backup download, deleted-enquiry trash with restore, audit trail |

### Stages move automatically

| When you… | The stage becomes |
|---|---|
| record a rate request to a supplier | **Supplier mail sent** |
| enter a supplier's quoted price | **Quote received** |
| save your selling price / itinerary as shared | **Quote / itinerary shared** (and a follow-up is set for 2 days later) |
| log a call / WhatsApp / email with the client after the quote | **Follow-up** |
| press **Confirm booking** | **Booking confirmed** |
| record an advance | **Advance received** |
| record the final payment (or payments reach the full price) | **Final payment received** |
| the travel start date arrives | **Travelling** |
| the travel end date passes | **Travel completed** |

Stages only move forward automatically. If you delete a payment, the stage steps back to match. A **Lost** enquiry is never revived automatically; pressing **Confirm booking** reopens it. You can always correct a stage yourself with **Change stage**.

---

## 2. One-time setup (about 20 minutes)

You've done this once already for the cash system; these are the same steps with new names.

### Step 1 – New Supabase project (the database)
1. Go to **supabase.com** → **New project**. Name it `skyroad-crm`, choose region **Mumbai (ap-south-1)**, and set a strong database password (save it in your password manager).
2. When it's ready, open **SQL Editor** → **New query**. Paste the whole of `db/migrations/001_init.sql` and press **Run**. You should see "Success". It is safe to run again.
3. Click the **Connect** button (top of the page) → **Transaction pooler** (port **6543**). Copy the URI and replace `[YOUR-PASSWORD]` with your database password. This is your `DATABASE_URL`.

### Step 2 – New GitHub repository
1. On github.com → **New repository** → name it `skyroad-crm` → **Private** → Create.
2. **Add file → Upload files** → drag in everything from the `skyroad-crm` folder: `app`, `components`, `db`, `lib`, `public`, `scripts`, `tests` and the files `package.json`, `tsconfig.json`, `next.config.mjs`, `vercel.json`, `README.md`, `.gitignore`, `.env.example` → **Commit changes**.

### Step 3 – Vercel
1. vercel.com → **Add New… → Project** → import `skyroad-crm`.
2. Before pressing Deploy, open **Environment Variables** and add:
   | Name | Value |
   |---|---|
   | `DATABASE_URL` | the pooler URI from Step 1 |
   | `SETUP_TOKEN` | any long random text, e.g. `skyroad-crm-setup-8h3k29dk3` |
3. Press **Deploy**.

### Step 4 – Your web address: `crm.skyroadholidays.com`
1. Vercel → project → **Settings → Domains → Add** → `crm.skyroadholidays.com`.
2. Copy the **CNAME** value Vercel shows.
3. At your domain's DNS provider, add a record: **Type** `CNAME`, **Name** `crm`, **Value** the copied value. Don't touch any other records.
4. Wait for **Valid Configuration** (5–30 minutes).

### Step 5 – Set your password
Open `https://crm.skyroadholidays.com`. You'll see **Set your password**. Type the `SETUP_TOKEN` value and your new password (8+ characters). The username is **Skyroadholidays**. You can change the password any time in **Settings**.

> Check: `https://crm.skyroadholidays.com/api/health` should say `"status":"ok"`.

---

## 3. Daily use – the 30-second routine

1. **Enquiry comes in** → **+ New enquiry** → paste the message → **Fill the form** → add the name and phone → **Save**.
2. **Ask suppliers** → on the enquiry, the suppliers who cover that destination are pre-ticked → **Record request** → press **Gmail** or **WhatsApp** next to each supplier. The standard message is already written.
3. **Supplier replies** → type their price in their row → **Save**. Tick **Selected** for the one you'll use.
4. **Send the quote** → enter your price and the Canva link → **Save & mark as shared** → **Send quote on WhatsApp**.
5. **Every morning** → open **Follow-ups**: WhatsApp each person, then press **Done → next**.
6. **Client says yes** → **Confirm booking** (add the advance right there). Record the balance when it arrives.

Add your suppliers once (Suppliers → Add a supplier) with email, WhatsApp and the destinations they cover. That is what makes the one-click requests work.

**Tip:** on your phone, open the site and choose *Share → Add to Home Screen* to get an app icon.

---

## 4. Backups & export
- **Settings → Download full backup (JSON)** gives every enquiry, supplier, quote, payment, timeline entry and the change history. Do it weekly and keep it in Google Drive or iCloud.
- **Settings → All enquiries (CSV)** and every report export open directly in Excel.
- Supabase also keeps daily backups of the database (Project → Database → Backups).
- Deleted enquiries go to **Settings → Trash** and can be restored. The database refuses permanent deletes.

## 5. Security
- Passwords are hashed with scrypt. Sessions are random tokens stored only as SHA-256 hashes. You are signed out after 7 idle days, or 30 days at most.
- 5 wrong passwords from one network block it for 15 minutes.
- All data lives in a private `crm` schema with row-level security on and public API access revoked.
- Every change is recorded in an audit log with who and when.

## 6. Forgot your password?
On your computer, in the project folder, with `DATABASE_URL` in `.env.local`: `npm install` then `npm run set-password`.

## 7. For developers
- `npm run dev` runs locally (put `DATABASE_URL` and `SETUP_TOKEN` in `.env.local`).
- `npm run db:migrate` applies migrations from the command line instead of the SQL Editor.
- `npm test` runs against a **separate, empty** database in `TEST_DATABASE_URL`: 25 database rule checks plus 21 application tests.

## 8. What's next (step 2 – automation)
The CRM is ready for the automated flow you described ("new q / Thailand / 1–6 Dec / 2 adults / 2N Krabi, 3N Phuket" → Canva itinerary + supplier mail + CRM update). That needs a secure connection so Claude can create and update enquiries for you, plus Gmail access to send and read supplier mail. It will be added as the next step.
# Skyroad-crm-system
