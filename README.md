# ZatGo AI Marketing — ZatMa AI Studio

*Create. Market. Grow. — Powered by AI.*

Multi-tenant AI Marketing + CRM SaaS by **ZatGo Innovation**. See [`docs/`](./docs) for the
overview, architecture, roadmap and current [implementation status](./docs/IMPLEMENTATION_STATUS.md).

## Local development

Prerequisites: Node.js 22.12+, pnpm 10, PostgreSQL 16, Redis 7. You can run them with Docker:

```bash
docker compose -f infrastructure/docker/docker-compose.yml up -d postgres redis s3 s3-init
```

Then:

```bash
pnpm install
cp apps/api/.env.example apps/api/.env      # set BETTER_AUTH_SECRET (openssl rand -base64 32)
cp apps/web/.env.example apps/web/.env.local
pnpm db:migrate && pnpm db:seed
pnpm dev                                    # web http://localhost:3000 · API http://localhost:4000/api/docs
```

| Command | What it does |
|---|---|
| `pnpm lint` / `pnpm typecheck` | ESLint / strict TypeScript across the monorepo |
| `pnpm test` | Unit tests (Vitest) |
| `pnpm test:e2e` | API e2e tests against the `zatma_test` database (includes tenant isolation) |
| `pnpm build` | Production builds |
