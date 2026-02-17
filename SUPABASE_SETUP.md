# Supabase Integration Guide - HS Travel Planner

## Architecture Overview

The application uses a **hybrid persistence model**:

- **Local-first**: Works fully offline using `localStorage`
- **Cloud-sync**: When Supabase credentials are configured, data syncs to the cloud database

This means the app never breaks even if Supabase is unavailable.

---

## Database Schema

### Tables

| Table | Purpose |
|---|---|
| `consultants` | Employee/contractor master data. CRUD from app. |
| `planning_periods` | One record per monthly CSV upload. Historical tracking. |
| `activities` | Individual visit records loaded from CSV. Core data. |
| `establishments` | Known client/hotel database. Validated addresses. |
| `logistics_hotels` | Pre-approved hotels by zone (manual entry by Logistics). |
| `booking_locators` | Confirmation codes linked to activities. Multiple per activity. |
| `activity_log` | Audit trail of all significant actions. |

### Views (Pre-built Reports)

| View | Purpose |
|---|---|
| `v_consultant_monthly_summary` | Monthly stats per consultant (visits, km, transport breakdown) |
| `v_pending_flights` | All pending flights/trains with consultant info |

---

## Setup Instructions

### Step 1: Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) and create a new project
2. Note your **Project URL** and **anon/public API key** from Settings > API

### Step 2: Run the Migration

1. Open your Supabase project's **SQL Editor**
2. Copy the entire contents of `supabase/migrations/001_initial_schema.sql`
3. Paste into the SQL Editor and click **Run**
4. Verify all tables are created in the **Table Editor**

### Step 3: Configure Environment Variables

Create a `.env` file in the project root (or rename `.env.example`):

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbG...YOUR_ANON_KEY_HERE
```

### Step 4: Restart the Dev Server

```bash
npm run dev
```

The app will automatically detect the Supabase credentials and begin syncing.

---

## Data Flow

### Monthly CSV Upload Flow

```
1. User uploads CSV in the App
2. App parses CSV with PapaParse
3. App creates/finds a Planning Period (month/year)
4. Activities are inserted into Supabase with the period reference
5. Activities appear in the proposals view
6. Planning Period is tracked for historical records
```

### Consultant Management Flow

```
1. User adds/edits consultant in Gestión Consultores
2. App saves to localStorage (instant)
3. App syncs to Supabase consultants table (background)
4. On next load, app fetches from Supabase if available
```

### Booking Locators Flow

```
1. User adds confirmation code in Managed view
2. App saves to localStorage bookingConfirmations
3. App syncs to booking_locators table
4. Multiple locators per activity supported
```

---

## File Structure

```
src/
├── supabaseClient.js      # Supabase client initialization
├── supabaseService.js     # All database operations (CRUD)
├── App.jsx                # Main application
└── clientData.json        # Pre-loaded establishment data

supabase/
└── migrations/
    └── 001_initial_schema.sql  # Complete database schema
```

---

## Key Design Decisions

1. **`planning_periods`**: Each CSV upload creates a period (UNIQUE on month+year). This prevents duplicate data and enables monthly comparisons.

2. **Soft deletes**: Consultants use `is_active` flag instead of hard deletion. Historical activity records remain linked.

3. **Denormalized `consultant_name`**: Stored directly in activities for fast reads. The `consultant_id` FK is also kept for relational integrity.

4. **`visit_date` + `visit_date_raw`**: The SQL `DATE` column enables efficient date queries, while `visit_date_raw` preserves the original DD/MM/YYYY format.

5. **`establishments` separate from `activities`**: The establishment master data (validated addresses) is independent of monthly planning. Validated once, used forever.

6. **`logistics_hotels`**: Prepared for future hotel booking feature. Logistics team can manually add approved hotels by zone.

7. **`activity_log`**: JSONB-based audit trail for compliance. Every significant action is logged.

---

## Future Integration Steps

### Phase 1 (Current): Local + Schema Ready

- [x] Schema designed and migration file created
- [x] Service layer (`supabaseService.js`) ready
- [ ] Run migration on Supabase project
- [ ] Configure `.env` with credentials

### Phase 2: Read from Supabase

- [ ] Load consultants from Supabase on app start
- [ ] Load activities from Supabase (latest period)
- [ ] Fallback to localStorage if Supabase unavailable

### Phase 3: Write to Supabase

- [ ] Sync CSV uploads to `activities` + `planning_periods`
- [ ] Sync consultant changes to `consultants`
- [ ] Sync booking locators to `booking_locators`
- [ ] Sync validated addresses to `establishments`

### Phase 4: Logistics Hotels

- [ ] Add admin CRUD for logistics_hotels
- [ ] Zone-based hotel search/assignment
- [ ] Hotel booking integration in Managed view
