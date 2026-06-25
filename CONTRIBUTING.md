# Contributing to Sred.io

Thanks for taking the time to contribute! Here's everything you need to get started.

## Prerequisites

- Node.js v22+
- MongoDB running on `localhost:27017`
- Redis (optional) — `docker run -p 6379:6379 redis`
- An Airtable OAuth app — see [README.md](README.md) for setup

## Local Setup

```bash
# 1. Fork and clone the repo
git clone https://github.com/<your-username>/sred.io.git
cd sred.io

# 2. Install dependencies
cd backend && npm install
cd ../frontend && npm install

# 3. Configure environment
cd backend
cp .env.example .env
# Fill in your Airtable credentials in .env

# 4. Run
# Terminal 1
cd backend && npm run dev

# Terminal 2
cd frontend && npm start
```

## Branch Naming

| Type | Pattern | Example |
|------|---------|---------|
| Feature | `feat/<short-description>` | `feat/export-csv` |
| Bug fix | `fix/<short-description>` | `fix/sync-timeout` |
| Docs | `docs/<short-description>` | `docs/update-setup` |
| Refactor | `refactor/<short-description>` | `refactor/queue-service` |

## Pull Requests

1. Branch off `main`
2. Keep PRs focused — one feature or fix per PR
3. Run tests before opening a PR:
   ```bash
   cd backend && npm test
   ```
4. Fill in the PR template when submitting
5. PRs require at least one review before merging

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add CSV export for AG Grid
fix: handle 429 retry on Airtable sync
docs: add Redis setup instructions
```

## Reporting Bugs

Use the [Bug Report](.github/ISSUE_TEMPLATE/bug_report.md) issue template.

## Requesting Features

Use the [Feature Request](.github/ISSUE_TEMPLATE/feature_request.md) issue template.

## Code Style

- Backend: ESLint + Prettier (run `npm run lint` to check)
- Frontend: Angular ESLint
- TypeScript strict mode is enabled — no `any` unless justified

## Security

Do **not** open a public issue for security vulnerabilities. Email the maintainer directly or use GitHub's private vulnerability reporting.

The scraper module accesses Airtable via cookie-based auth. Only use it against accounts you own or have explicit permission to scrape.
