# Post-Build Checklist

Manual steps you'll go through after pulling this repo, plus the operational details and the followup punch-list left over from v0.

---

## A. First-run

1. **Install local deps** (one-time):
   - Node 20 LTS — `brew install node@20`
   - pnpm 10 — `corepack enable && corepack prepare pnpm@latest --activate`
   - ffmpeg — `brew install ffmpeg` (the worker uses `ffprobe` for upload validation; if it's missing, source-video uploads will hard-fail)
   - Docker Desktop or OrbStack — required for Postgres / Redis / MinIO

2. **Get Kling credentials**:
   - Sign in at [app.klingai.com/global/dev](https://app.klingai.com/global/dev)
   - Create an API key — copy the **Access Key** AND **Secret Key** (secret is shown once)
   - Top up the account with a small balance for testing (~$5 covers ~17 std runs of a 5 s clip)

3. **Configure `.env.local`**:
   ```bash
   cp .env.example .env.local
   ```
   Edit `.env.local` and fill in:
   - `KLING_ACCESS_KEY` — your AccessKey
   - `KLING_SECRET_KEY` — your SecretKey
   - `WEBHOOK_SECRET` — `$(openssl rand -hex 32)` (only required if you'll enable webhooks; see §C)

   The MinIO / Postgres / Redis defaults already match `docker-compose.dev.yml` — nothing else to edit for local dev.

4. **Install JS deps + bring up infra + migrate DB**:
   ```bash
   pnpm install
   pnpm infra:up
   pnpm db:migrate
   ```

5. **Run the app** (two terminals):
   ```bash
   pnpm dev               # http://localhost:3000
   pnpm dev:worker        # BullMQ worker — required for jobs to actually run
   ```

6. **Smoke test the UI**:
   Open http://localhost:3000, click **New generation**, upload a short MP4 + a reference JPG, hit **Generate**. The card should flip from "Queued" → "Processing" → "Completed" with the output video playing inline.

---

## B. Daily ops

- **Tail infra logs:** `pnpm infra:logs`
- **Tail worker output:** runs in the foreground via `pnpm dev:worker`. Kill with Ctrl-C.
- **Tail Next.js logs:** runs in the foreground via `pnpm dev`. Kill with Ctrl-C.
- **Open the database UI:** `pnpm db:studio`
- **Open the MinIO console:** http://localhost:9001 — log in `minioadmin / minioadmin` to see uploaded media.

### Backups

For local dev, infra is ephemeral by Docker volumes:
```bash
docker volume ls | grep kling-mc
# kling-mc_postgres_data    — your generation history
# kling-mc_redis_data       — BullMQ jobs (transient, no need to back up)
# kling-mc_minio_data       — your uploads + generated videos
```

Quick backup:
```bash
docker run --rm -v kling-mc_postgres_data:/v -v "$PWD":/o alpine \
  tar czf /o/postgres-backup.tar.gz -C /v .
docker run --rm -v kling-mc_minio_data:/v -v "$PWD":/o alpine \
  tar czf /o/minio-backup.tar.gz -C /v .
```

To wipe everything and start fresh:
```bash
pnpm infra:down
docker volume rm kling-mc_postgres_data kling-mc_redis_data kling-mc_minio_data
pnpm infra:up
pnpm db:migrate
```

---

## C. Webhooks (optional)

By default `ENABLE_KLING_WEBHOOKS=false` and the worker polls Kling for status. That's fine — and the recommended path for local dev. If you want Kling to push status updates to your laptop:

1. Set `WEBHOOK_SECRET` in `.env.local` (any 32+ char hex string).
2. Set `ENABLE_KLING_WEBHOOKS=true`.
3. Expose your laptop publicly via `ngrok http 3000` or Cloudflare Tunnel; copy the public URL.
4. Set `APP_BASE_URL` in `.env.local` to that public URL.
5. Restart `pnpm dev` and `pnpm dev:worker`.

The worker now appends `?gid=<id>&sig=<HMAC-SHA256(id, WEBHOOK_SECRET)>` to the callback URL it sends to Kling. The webhook receiver verifies the signature in constant time. Without a valid signature it returns 403.

---

## D. Operating Kling-side

- **Cost reconciliation:** The dashboard shows our local cost estimate from `pnpm exec` `lib/kling/pricing.ts`. The real cost comes back as `final_unit_deduction` in the task-query response and is persisted on the `Generation` row. **Confirm Kling's unit semantics on your account** before treating these as actual dollars — see §F.
- **Rate limits:** Kling returns service code `1302` (QPS) or `1303` (concurrency). The Kling client retries with exponential backoff. If you keep hitting 1303, lower `MAX_CONCURRENT_GENERATIONS` in `.env.local`.
- **JWT clock skew:** If you see service code `1003` (token not yet valid), your laptop's clock is more than 5 s ahead of Kling. Run `sudo sntp -sS time.apple.com`.
- **30-day retention:** Kling deletes generated videos from their CDN 30 days after completion. The worker downloads to MinIO immediately so you keep them indefinitely.

---

## E. Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `@prisma/client did not initialize yet` | `src/generated/prisma` missing | `pnpm db:generate` |
| `Invalid prisma...invocation: Can't reach database server at localhost:5432` | Postgres container down | `pnpm infra:up` |
| `Unrecognized file content` on upload | File not actually JPG/PNG/MP4/MOV | Re-encode; magic-byte sniffing rejects mislabelled files |
| `Could not read video metadata` on upload | `ffprobe` missing or video corrupt | Install ffmpeg; re-encode with `ffmpeg -i in.mov -c copy out.mp4` |
| Generation stuck on "Processing" forever | Worker not running, or worker can't reach Kling | Check `pnpm dev:worker` is running and your network can hit `api-singapore.klingai.com` |
| Worker logs `Missing KLING_ACCESS_KEY` | `.env.local` keys not filled in | Edit `.env.local` and restart the worker |
| Kling returns 1101 / 1102 | Out of credits / arrears | Top up at app.klingai.com |
| Kling returns 1301 | Content policy violation | Re-prompt with safer content; this is non-retryable |
| Generated video URL works in MinIO Console but page shows broken video | Bucket public-read policy not applied | `docker compose -f docker-compose.dev.yml restart minio-bucket-init` |
| Webhook returns 403 | `gid` HMAC mismatch | Check `WEBHOOK_SECRET` matches between worker (mints sig) and Next.js (verifies) — must be identical in `.env.local` |
| Multiple workers double-finalizing | Won't happen — finalize is wrapped in a conditional `updateMany` and rolls back the orphan asset | — |

---

## F. Followups (deferred from v0 review)

These came out of the code-review and integration-validator gates and are NOT blockers for local single-user use, but worth doing before pointing this at heavy traffic or a multi-user deployment.

### Confirm before production traffic

- **`final_unit_deduction` semantics.** The current code feeds it into the same rate table as the duration estimator. If Kling's "units" aren't seconds, the actual-cost UI will be wrong. Confirm by running one test generation and comparing the displayed cost to what Kling deducts on the dashboard.
- **Aspect-ratio bounds inclusivity.** Spec lists `1:2.5–2.5:1`. Our validator uses `1/2.5` and `2.5` inclusive. If Kling rejects exactly-2.5 aspect images server-side, tighten the validator.

### Hardening

- **Streaming uploads.** Upload route currently `Buffer.from(arrayBuffer)`'s the whole file (up to 100 MB). Size is gated, but 100 MB × N concurrent uploads is real memory pressure. Migrate to `Readable.from(file.stream())` + multipart S3 upload.
- **Presigned URLs for thumbnails.** `MediaThumb` reads via `S3_PUBLIC_URL_BASE` directly. Fine for local MinIO with anonymous read; broken when you point at a private bucket. Switch to short-lived presigned URLs returned from the API endpoints.
- **Reconciliation cron.** A scheduled task that finds `processing` rows older than 30 min with no live BullMQ job and marks them `failed`. Currently the orphan-recovery on worker boot handles the common case, but a stuck row from a worker that crashed silently can sit for a long time.
- **Kling balance display.** Spec section 6 ("Account Information Inquiry") describes a resource-pack-list endpoint; the docs aren't fully captured. Once accessed, surface live balance in the sidebar and on `/usage`.
- **Capability map enforcement.** The spec mentions a "Capability Map" gating which `mode` works with which `model_name`. We don't enforce it client-side and rely on Kling returning code 1201/1203. Once captured, validate at the form layer to give users a friendlier error.
- **Soft-delete for generations.** Currently `DELETE` is destructive. A trash bin would be safer for accidental clicks.
- **Tests.** No tests in v0. Highest-value first targets:
  - `lib/kling/jwt.ts` — golden-test the JWT shape against the Python reference sample
  - `lib/kling/pricing.ts` — unit tests on `estimateCostUsd` / `deductionToUsd`
  - `worker/handlers/motion-control.ts` — integration test with a mocked provider that drives the queue→processing→completed loop end to end

### Observability

- Pino logs go to stdout. For prod, ship them to a structured log store (Loki / Datadog / etc.).
- Add OpenTelemetry / Sentry for traces and exceptions.
- Add a `/debug` page that surfaces queue depth, recent errors, last successful Kling round-trip latency.

### Deployment (when you outgrow local)

- The architecture works on any Node host (Fly, Railway, Hetzner, a VPS). Vercel is not viable because the BullMQ worker needs a long-running process.
- For prod:
  - Set `NODE_ENV=production` (this auto-disables `dangerouslyAllowLocalIP`).
  - Use a managed Postgres (Neon/Supabase/RDS) and managed Redis (Upstash, ElastiCache).
  - Move object storage to Cloudflare R2 or AWS S3; flip `S3_FORCE_PATH_STYLE=false` and set the S3 endpoint to AWS region URL.
  - Run `pnpm build` then `pnpm start` for the web; `pnpm start:worker` for the worker (separate process).

---

## G. What's intentionally NOT done

These are scope decisions, not gaps:

- No auth — single-user app on a single laptop.
- No multi-user data segmentation — schema has `ownerId` columns ready (always `local`), but no UI for it.
- No mobile app — the responsive web view works on phones.
- No email / push notifications — the dashboard auto-refreshes every few seconds.
- No internationalization.
