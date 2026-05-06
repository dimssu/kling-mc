# Kling Studio — Motion Control Dashboard

Personal dashboard for Kling AI's Motion Control video generations and image-to-image carousels. Replace the person in a source video with the person from a reference image, watch the job from queued → processing → completed, and track per-generation cost.

Single-user. **MongoDB Atlas** for metadata, **AWS S3** for media (shared bucket with [kling-gallery](../kling-gallery)). Redis runs locally via Docker for the BullMQ queue. UI is Next.js 16 + Tailwind 4. The worker is a separate Node process.

## Quick start

```bash
# 1. Install local deps
brew install node@20 ffmpeg
corepack enable
# Install Docker Desktop or OrbStack manually

# 2. Configure
cp .env.example .env.local
# Edit .env.local: paste
#   - KLING_ACCESS_KEY / KLING_SECRET_KEY from https://app.klingai.com/global/dev
#   - MONGODB_URI (Atlas or self-hosted)
#   - S3_REGION / S3_BUCKET / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY / S3_PUBLIC_URL_BASE
# Optionally set WEBHOOK_SECRET=$(openssl rand -hex 32)

# 3. Bring up Redis (only piece that still runs locally)
pnpm install
pnpm infra:up

# 4. Run (two terminals)
pnpm dev                    # Next.js — http://localhost:3000
pnpm dev:worker             # BullMQ worker (required for generations to actually run)
```

Open http://localhost:3000.

Mongo collections are created lazily on first insert; there is no migration step.

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
                                AWS S3 (mc/ prefix in shared bucket)
              ▲                    │
              │  Mongoose ───► MongoDB Atlas
              │
            UI reads via React Query
```

The S3 bucket is shared with [kling-gallery](../kling-gallery): kling-mc writes under `mc/uploads/...` and `mc/outputs/...`; the gallery writes under `gallery/originals/...` and `gallery/thumbnails/...`. See `../kling-gallery/SETUP.md` for bucket policy + CORS.

See [`docs/architecture.md`](docs/architecture.md) for the full design + trade-offs and [`docs/kling-api-spec.md`](docs/kling-api-spec.md) for the verbatim Kling API spec this app integrates with.

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
    mongo.ts                Mongoose connection (cached across hot reloads)
    storage.ts              AWS S3 client + key prefix helpers
    serialize.ts            Mongo doc → API JSON (_id → id)
    env.ts, logger.ts, ...  Cross-cutting infrastructure
  models/                   Mongoose schemas (MediaAsset, Generation, ImageGeneration, ImageCarousel)
  worker/                   Long-running BullMQ worker
docker-compose.dev.yml      Redis only (Postgres + MinIO are gone)
scripts/
  migrate-pg-minio-to-mongo-s3.ts   One-shot legacy migration
  sync-to-gallery.ts                One-way push to kling-gallery
docs/                       Spec + architecture + post-build checklist
```

## Common commands

| Action | Command |
| --- | --- |
| Run UI | `pnpm dev` |
| Run worker | `pnpm dev:worker` |
| Type-check | `pnpm exec tsc --noEmit` |
| Bring infra up / down | `pnpm infra:up` / `pnpm infra:down` |
| Tail infra logs | `pnpm infra:logs` |
| Take page screenshots | `pnpm exec tsx scripts/screenshot.ts` (UI must be running) |
| Lint | `pnpm lint` |
| Migrate legacy data (one-shot) | `pnpm migrate:legacy` |
| Push completed gens to gallery | `pnpm sync:gallery` |

## Service URLs (local)

| Service | URL | Credentials |
| --- | --- | --- |
| App | http://localhost:3000 | — |
| Redis | localhost:6379 | — |
| MongoDB | (Atlas/your cluster) | from `MONGODB_URI` |
| S3 | (AWS) | from `S3_*` env vars |

## Migrating from the old Postgres + MinIO setup

If you have data in the old local stack:

1. Keep the old Postgres + MinIO containers running on their original ports.
2. Fill in `LEGACY_DATABASE_URL` / `LEGACY_S3_*` in `.env.local`.
3. Set the new `MONGODB_URI` and `S3_*` (target).
4. Run `pnpm migrate:legacy` — it copies all rows and S3 objects, idempotent on row id.
5. Spot-check a few rows in Atlas; if good, tear down `docker-compose.dev.yml` Postgres + MinIO containers.

See [`docs/post-build-checklist.md`](docs/post-build-checklist.md) for monitoring, troubleshooting, and the followup punch-list.
