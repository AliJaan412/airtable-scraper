# Sred.io — Airtable Integration Platform

Full-stack app that connects to Airtable via OAuth, syncs data into MongoDB, scrapes revision history, and displays everything in an AG Grid UI.

---

## Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js v22, Express, TypeScript |
| Database | MongoDB + Mongoose |
| Job Queue | BullMQ + Redis (optional — falls back to inline if unavailable) |
| Cache | Redis (optional — silently skipped if unavailable) |
| Frontend | Angular 19, AG Grid 33.0, Angular Material |
| State Management | NgXs (Angular store) |
| Scraper | Puppeteer (headless Chrome) |
| Tests | Jest + ts-jest (backend) |

---

## Prerequisites

- Node.js v22+
- MongoDB running on `localhost:27017`
- An Airtable account with an OAuth app registered at [airtable.com/create/oauth](https://airtable.com/create/oauth)
- **Redis** (optional but recommended) — enables job retry and API caching. Install via `docker run -p 6379:6379 redis` or `winget install Redis.Redis`.

---

## Setup

### 1. Clone and install

```bash
# Backend
cd backend
npm install

# Frontend
cd ../frontend
npm install
```

### 2. Configure environment

```bash
cd backend
cp .env.example .env
```

Open `backend/.env` and fill in:

```env
MONGODB_URI=mongodb://localhost:27017/sred_io
AIRTABLE_CLIENT_ID=your-client-id
AIRTABLE_CLIENT_SECRET=your-client-secret
AIRTABLE_REDIRECT_URI=http://localhost:3000/api/airtable/oauth/callback

# Optional — Redis for job queue and caching
REDIS_URL=redis://localhost:6379
REDIS_CACHE_TTL=300
```

> **Getting Airtable credentials:**
> 1. Go to [airtable.com/create/oauth](https://airtable.com/create/oauth)
> 2. Register an app — set redirect URL to `http://localhost:3000/api/airtable/oauth/callback`
> 3. Select scopes: `data.records:read/write`, `schema.bases:read/write`, `user.email:read`
> 4. Generate a client secret and copy both Client ID and Secret into `.env`

### 3. Run

```bash
# Terminal 1 — Backend
cd backend
npm run dev
# → http://localhost:3000
# → Swagger docs: http://localhost:3000/api/docs

# Terminal 2 — Frontend
cd frontend
npm start
# → http://localhost:4200
```

---

## Usage

### Connect Airtable
1. Open [http://localhost:4200](http://localhost:4200)
2. Go to **Airtable Integration** in the sidebar
3. Click **Connect Airtable** → authorise in Airtable → redirected back as connected

### Sync Data
Click **Sync All** on the Airtable Integration page to pull bases, tables, records, and users into MongoDB.

### View Data
Go to **Raw Data** → select an entity from the dropdown → data loads in the AG Grid with search, sort, and filter.

### Scrape Revision History
Go to **Scraper** → enter your Airtable email & password → authenticate (handle MFA if prompted) → click **Start Scraping**.

---

## Seed 200 Test Records

The FSD requires testing with 200+ records. Use the seeder script:

```bash
# 1. Create a Base + Table in airtable.com with fields:
#    Title (text), Status (single select), Assignee (text), Priority (single select)

# 2. Sync bases & tables first
#    → UI: Airtable Integration → Sync All

# 3. Run the seeder
cd backend
npm run seed

# 4. Sync again to pull records into MongoDB
#    → UI: Airtable Integration → Sync All

# 5. Run the scraper from the Scraper page
```

---

## API Overview

| Module | Base Path | Description |
|--------|----------|-------------|
| Airtable | `/api/airtable` | OAuth, sync, data access |
| Scraper | `/api/scraper` | Cookie auth, scraping jobs, changelogs |
| Raw Data | `/api/raw-data` | Dynamic collection queries for the grid |

Full API reference available at **[http://localhost:3000/api/docs](http://localhost:3000/api/docs)** (Swagger UI).

---

## Project Structure

```
Sred.io/
├── backend/
│   └── src/
│       ├── modules/
│       │   ├── airtable/    ← OAuth + data sync + 429 retry
│       │   │   └── __tests__/
│       │   ├── scraper/     ← Cookie scraping + BullMQ queue
│       │   │   └── __tests__/
│       │   └── raw-data/    ← Dynamic grid queries
│       │       └── __tests__/
│       ├── common/          ← DB, Redis client, cache, middleware
│       ├── config/          ← Environment config
│       ├── scripts/         ← Seed script
│       └── server.ts        ← Entry point + graceful shutdown
└── frontend/
    └── src/app/
        ├── store/
        │   ├── airtable/        ← NgXs AirtableState
        │   └── scraper/         ← NgXs ScraperState
        ├── features/
        │   ├── raw-data/        ← AG Grid page
        │   ├── airtable/        ← Connect + sync page
        │   └── scraper/         ← Scraper control page
        ├── core/
        │   ├── services/        ← HTTP services
        │   └── models/          ← TypeScript interfaces
        └── shared/              ← Reusable pipes/components
```

---

## Scripts

```bash
# Backend
npm run dev          # Start dev server with hot reload
npm run build        # Compile TypeScript
npm run seed         # Create 200 test records in Airtable
npm test             # Run Jest unit tests (24 tests)
npm run test:coverage  # Run tests with coverage report

# Frontend
npm start            # Serve on localhost:4200
npm run build        # Production build
```
