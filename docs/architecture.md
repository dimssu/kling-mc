# Architecture & Stack Choice

**Status:** Phase-1 deliverable. To be ratified by the user before Phase-2 build.
**Last updated:** 2026-05-05

---

## 0. Provider decision (updated 2026-05-05)

Now that the user has provided the verbatim Motion Control spec from the official Kling portal, we integrate **directly against the official Kling API** (`api-singapore.klingai.com`). The aggregator option (kie.ai) is dropped from v0. We keep the `KlingProvider` interface so a future swap is one-file work, but ship one implementation.

---

## 1. Recommended stack

| Layer | Choice | Why |
|---|---|---|
| Frontend + backend | **Next.js 15 (App Router) + TypeScript** | Single repo for UI + API routes; React Server Components + streaming for snappy UX; first-class file uploads via FormData; the dominant choice for "polished SaaS dashboard with API integrations" so component ecosystem (shadcn/ui, react-hook-form, Tanstack Query) lines up. |
| UI primitives | **Tailwind CSS + shadcn/ui** | shadcn provides copy-in components we own (no design rot). Pairs well with `mcp__magic` (21st.dev) which is already loaded — that MCP outputs Tailwind/shadcn-compatible code. |
| Database | **Postgres (via Prisma)** | Strong typing end-to-end; transactions for `Generation` lifecycle; mature ecosystem. Local dev via Docker; prod via Neon / Supabase / RDS. |
| Job queue | **BullMQ + Redis** | Battle-tested for async-task orchestration with retries, backoff, concurrency caps. Worker can run as a separate Node process. Graceful restart recovery is native. |
| Object storage | **S3-compatible** (MinIO local, Cloudflare R2 / AWS S3 prod) | Source videos + reference images + generated outputs. Signed URLs for the provider to fetch our uploads, and for the browser to view results. Same SDK in both envs. |
| Validation | **Zod** | Single source of truth for request schemas + DB DTOs + form validation. |
| Auth (later, if multi-user) | **Auth.js (NextAuth)** | If single-user/local-only, skip for v0. |
| Testing | **Vitest** (unit) + **Playwright** (E2E + screenshot QA) | QA agent uses Playwright to take screenshots and walk flows. |
| Observability | **Pino logs + a debug page** | Structured logs to file/stdout; an in-app `/debug` route shows recent jobs, errors, queue depth. |

### Versions to pin

- Node 20 LTS
- pnpm 9 (faster + stricter than npm)
- Postgres 16
- Redis 7

---

## 2. Why this stack — addressing the brief's priorities

The brief asked for: **developer experience, type safety, async job handling, file upload reliability, UI polish**. Mapping each to a choice:

- **Type safety** — TypeScript end-to-end. Zod on the boundary. Prisma generates DB types. `KlingProvider` interface is the seam between our app and the (potentially-changing) provider API.
- **Async job handling** — BullMQ is purpose-built for this. Generations are slow (up to 10 min) and bursty; in-memory async/await won't survive a restart, and serverless functions time out. BullMQ + a long-running worker survives restarts and gives us per-user concurrency caps + retry-with-backoff for free.
- **File upload reliability** — Direct-to-S3 uploads via signed URLs (the browser uploads straight to R2/S3, the API only sees metadata). For v0 we can simplify to "upload to API → API streams to storage" since file sizes are bounded (≤100 MB). We'll start simple and migrate to direct-upload only if it becomes a bottleneck.
- **UI polish** — shadcn/ui + 21st.dev (`mcp__magic`) for any non-trivial component. Tailwind for layout. Framer Motion only where it adds clarity (loading states, status transitions).
- **DX** — single repo, single command (`pnpm dev`) brings up Next + worker + Postgres + Redis + MinIO via `docker-compose` overlay. Hot reload everywhere.

---

## 3. Architecture diagram (text)

```
┌─────────────────────────────────────────────────────────────┐
│                         Browser                             │
│  Next.js client (RSC + client components, Tanstack Query)   │
└─────────────────────────────────────────────────────────────┘
                ↑ ↓ HTTP / SSE for live status
┌─────────────────────────────────────────────────────────────┐
│                  Next.js server (API routes)                │
│  • POST /api/generations           — create job             │
│  • GET  /api/generations/:id       — status                 │
│  • GET  /api/library               — list                   │
│  • POST /api/uploads (presigned)   — file upload            │
│  • POST /api/webhooks/kie          — provider callback      │
│                                                             │
│  Server actions for: favorite, delete, etc.                 │
└─────────────────────────────────────────────────────────────┘
        │                          │                  │
        ▼                          ▼                  ▼
   ┌────────┐              ┌──────────────┐    ┌──────────────┐
   │ Redis  │← BullMQ queue│   Postgres   │    │  S3 / R2     │
   └────────┘              │ (Prisma)     │    │ (uploads,    │
        ▲                  │              │    │  outputs)    │
        │                  └──────────────┘    └──────────────┘
        │ pulls jobs                                  ▲
        ▼                                             │ stores result
   ┌─────────────────────────────────────────────────┘
   │           Worker process (Node, long-running)    │
   │  • picks job → calls KlingProvider.createTask()  │
   │  • polls (fallback) or awaits webhook            │
   │  • updates DB, downloads result to our storage   │
   └──────────────────────────────────────────────────┘
                          ↑ ↓
                ┌──────────────────────┐
                │   KlingProvider      │
                │ └─ OfficialKling ✅  │   (v0 — api-singapore.klingai.com)
                │     (aggregators = future swap, not v0)
                └──────────────────────┘
```

---

## 4. Data model (initial)

```prisma
model MediaAsset {
  id          String   @id @default(cuid())
  kind        String   // "source_video" | "reference_image" | "generated_video"
  filename    String
  mimeType    String
  sizeBytes   Int
  durationSec Float?   // videos only
  width       Int?
  height      Int?
  storageKey  String   // S3/R2 object key
  thumbnailKey String?
  isFavorite  Boolean  @default(false)
  createdAt   DateTime @default(now())
  generations Generation[] @relation("Output")
}

model Generation {
  id              String   @id @default(cuid())
  status          String   // queued | processing | completed | failed | cancelled
  provider        String   // "kling_official" (v0). Reserved for future aggregator swap.
  providerTaskId  String?
  sourceVideoId   String
  referenceImageId String
  outputAssetId   String?  @unique
  prompt          String?
  mode            String   // "std" | "pro"
  characterOrientation String // "video" | "image"
  estimatedCostUsd Decimal @db.Decimal(10, 4)
  actualCostUsd    Decimal? @db.Decimal(10, 4)
  errorMessage     String?
  rawProviderPayload Json?
  isFavorite       Boolean  @default(false)
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
  completedAt      DateTime?

  sourceVideo    MediaAsset @relation("SourceVideo", fields: [sourceVideoId], references: [id])
  referenceImage MediaAsset @relation("ReferenceImage", fields: [referenceImageId], references: [id])
  outputAsset    MediaAsset? @relation("Output", fields: [outputAssetId], references: [id])

  @@index([status])
  @@index([createdAt])
}
```

---

## 5. Routing (frontend)

```
/                       — Dashboard (recent generations, quick-create CTA, balance)
/create                 — Create-generation form (upload + preview + cost estimate)
/library/uploads        — Uploads tab (with filters)
/library/generations    — Generations tab
/library/favorites      — Favorites
/generations/:id        — Single generation detail / playback / download
/usage                  — Cost & usage tracking page
/settings               — API keys (read-only display), provider toggle, concurrency cap
/debug                  — In-app debug view (queue, recent errors)
```

---

## 6. Trade-offs explicitly considered

**Next.js vs. separate Vite-React frontend + Express/Fastify backend.** Single Next.js repo wins for time-to-first-feature and shared types. Lose some control over backend lifecycle — mitigated by running the BullMQ worker as a sibling process, not inside Next.

**BullMQ vs. Inngest vs. Trigger.dev.** Inngest/Trigger are nicer DX but add a third-party dependency for a paid plan at scale. BullMQ + Redis is free, runs locally, and the patterns it imposes are well-understood. Pick if user wants pure-self-hosted; revisit if scale > 10 jobs/min sustained.

**Postgres vs. SQLite.** SQLite is simpler for single-user local. Postgres wins because (a) generation lifecycle benefits from real concurrent transactions, (b) we get FOR UPDATE SKIP LOCKED for queue-recovery on restart, (c) zero migration cost when going to prod.

**Webhook-only vs. polling-only vs. both.** Both, with webhook primary and polling as a fallback. Webhooks fail silently more often than docs suggest; polling is the safety net.

**Direct-to-S3 uploads vs. through-the-API uploads.** Through-the-API for v0 (simpler, files are bounded). Migrate to direct upload if upload latency becomes painful or we hit Vercel's 4.5 MB body limit (we won't on a self-hosted Node deploy).

**Single-user vs. multi-user.** Brief implies single-user (a personal dashboard). v0 ships single-user with auth optional. Schema doesn't preclude adding `userId` later; we'll add an `ownerId` field on day 1 with a hardcoded value to make multi-user a non-breaking change.

---

## 7. Deployment target options

| Option | Pros | Cons | Recommended? |
|---|---|---|---|
| Local-only (laptop) | Zero cost, full control, fastest dev loop | Can't receive webhooks (need ngrok/Cloudflare Tunnel for testing) | ✅ for dev |
| VPS (Fly.io / Railway / Hetzner) | Cheap, persistent, supports long-running worker, real public URL for webhooks | One more thing to manage | ✅ for v1 |
| Vercel + external worker | Best Next.js DX | Worker can't run on Vercel; you'd need Inngest/Upstash QStash | ❌ unless we change queue tech |

We will design for "Node anywhere" — the app must run with `pnpm start` and a `WORKER=true` sibling process. Deploys to any Node host without modification.

---

## 8. Repo layout

```
kling-mc/
├── docs/                       # this folder
├── src/
│   ├── app/                    # Next.js app router
│   │   ├── (dashboard)/
│   │   ├── api/
│   │   │   ├── generations/
│   │   │   ├── uploads/
│   │   │   └── webhooks/
│   │   └── layout.tsx
│   ├── components/             # UI components
│   ├── lib/
│   │   ├── db.ts               # Prisma client
│   │   ├── queue.ts            # BullMQ setup
│   │   ├── storage.ts          # S3 wrapper
│   │   ├── validation.ts       # Zod schemas + media validators
│   │   └── kling/
│   │       ├── types.ts        # KlingProvider interface, MotionControlInput, TaskStatus
│   │       ├── jwt.ts          # AccessKey/SecretKey → cached JWT
│   │       ├── official.ts     # OfficialKlingProvider — POST /v1/videos/motion-control etc.
│   │       ├── pricing.ts      # rate table for cost estimation + final_unit_deduction → USD
│   │       └── index.ts        # provider factory
│   ├── worker/
│   │   ├── index.ts            # entrypoint
│   │   └── handlers/
│   │       └── motion-control.ts
│   └── server/                 # server-only utilities
├── prisma/
│   └── schema.prisma
├── docker-compose.dev.yml      # postgres + redis + minio
├── .env.example
├── package.json
└── tsconfig.json
```

---

## 9. What we are explicitly NOT building in v0

- Multi-tenant auth (single-user assumed; `ownerId` defaulted)
- Direct-to-S3 browser uploads
- Real-time streaming results to the browser via WebSocket — Tanstack Query polling on the status endpoint is good enough for the few-minute scale of these jobs
- Internationalization
- Mobile-native app
- Aggregator (kie.ai / fal.ai / etc.) backup provider — interface stays, no second implementation in v0
