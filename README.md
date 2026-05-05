# Kling Studio — Motion Control Dashboard

Personal local-first dashboard for Kling AI's Motion Control video generations. Replace the person in a source video with the person from a reference image, watch the job from queued → processing → completed, and track per-generation cost.

Local-only, single-user, Postgres + Redis + MinIO via Docker. UI is Next.js 16 + Tailwind 4. Worker is a separate Node process driven by BullMQ.

## Quick start

```bash
# 1. Install local deps
brew install node@20 ffmpeg
corepack enable
# Install Docker Desktop or OrbStack manually

# 2. Configure
cp .env.example .env.local
# Edit .env.local: paste KLING_ACCESS_KEY and KLING_SECRET_KEY from
# https://app.klingai.com/global/dev
# Optionally set WEBHOOK_SECRET=$(openssl rand -hex 32)

# 3. Bring up infra
pnpm install
pnpm infra:up               # postgres + redis + minio + bucket init

# 4. Migrate the DB
pnpm db:migrate

# 5. Run (two terminals)
pnpm dev                    # Next.js — http://localhost:3000
pnpm dev:worker             # BullMQ worker (required for generations to actually run)
```

Open http://localhost:3000.

## Architecture

```
Browser ──► Next.js (API routes + RSC pages)
              │
              │  enqueue
              ▼
            BullMQ (Redis)  ◄── worker process polls
                                   │ JWT-signed POST /v1/videos/motion-control
                                   ▼
                                Kling API
                                   │
                                   │  download generated video
                                   ▼
                                MinIO (S3-compatible)
              ▲                    │
              │  Prisma ───► Postgres
              │
            UI reads via React Query
```

See [`docs/architecture.md`](docs/architecture.md) for the full design + trade-offs and [`docs/kling-api-spec.md`](docs/kling-api-spec.md) for the verbatim Kling Motion Control API spec this app integrates with.

## Project layout

```
src/
  app/                      Next.js App Router
    api/                    REST endpoints + webhook receiver
    create/                 Create-generation flow
    library/                Uploads + generations browser
    usage/                  Cost rollups
  components/               UI components (shadcn-style primitives in ui/)
  lib/
    kling/                  Kling provider — JWT, request, errors, pricing
    db.ts, env.ts, ...      Cross-cutting infrastructure
  worker/                   Long-running BullMQ worker
prisma/                     Schema + migrations
docker-compose.dev.yml      Postgres, Redis, MinIO with bucket init
docs/                       Spec + architecture + post-build checklist
```

## Common commands

| Action | Command |
| --- | --- |
| Run UI | `pnpm dev` |
| Run worker | `pnpm dev:worker` |
| Type-check | `pnpm exec tsc --noEmit` |
| Migrate DB | `pnpm db:migrate` |
| Reset DB | `pnpm db:reset` |
| Open Prisma Studio | `pnpm db:studio` |
| Bring infra up / down | `pnpm infra:up` / `pnpm infra:down` |
| Tail infra logs | `pnpm infra:logs` |
| Take page screenshots | `pnpm exec tsx scripts/screenshot.ts` (UI must be running) |
| Lint | `pnpm lint` |

## Service URLs (local)

| Service | URL | Credentials |
| --- | --- | --- |
| App | http://localhost:3000 | — |
| Postgres | localhost:5432 | `kling` / `kling` / `kling_mc` |
| Redis | localhost:6379 | — |
| MinIO API | http://localhost:9000 | `minioadmin` / `minioadmin` |
| MinIO Console | http://localhost:9001 | `minioadmin` / `minioadmin` |

See [`docs/post-build-checklist.md`](docs/post-build-checklist.md) for monitoring, troubleshooting, deploying, and the followup punch-list left over after v0.
