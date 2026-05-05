# Pre-Build Checklist (v2)

What you need to do or provide before I start writing application code in Phase 2. Tick each box and reply with anything you can't or won't provide so we can find a workaround.

> **What changed since v1:** you provided the verbatim Motion Control endpoint spec from the official Kling portal, so we're integrating directly against `api-singapore.klingai.com`. The kie.ai aggregator path is dropped from v0.

---

## A. Decisions you need to make

- [ ] **Deployment target.** Local-only for now? VPS later (Fly / Railway / Hetzner)? This determines whether we need `ngrok` / Cloudflare Tunnel for testing Kling webhooks during dev.
- [ ] **Single-user or multi-user?** Recommended: single-user. Multi-user adds Auth.js work in Phase 2.
- [ ] **Storage for uploads/outputs.** Recommended: **MinIO via Docker locally**, **Cloudflare R2** when deployed. Alternative: local filesystem only (simplest, but no public URLs for Kling to fetch — we'd have to base64-inline images and tunnel videos through a public dev URL).
- [ ] **Default model.** `kling-v2-6` (cheaper, default in the API) or `kling-v3` (newer)?
- [ ] **Default mode.** `std` or `pro`? We'll let users override per generation, but the form needs a default.

---

## B. Credentials & accounts you must obtain

### B.1 Kling official API access — **REQUIRED**

- [ ] Sign up / log in at https://app.klingai.com/global/dev
- [ ] Verify your tier supports Motion Control on Kling 2.6 / 3.0 (check the Capability Map in the portal)
- [ ] Create an API key → save the **Access Key** AND **Secret Key** (secret shown only once)
- [ ] Ensure the account has credits / a resource pack with enough for testing — at $0.20–$0.33 per 5 s of std/pro output, $5–$10 covers a healthy test sweep
- [ ] Provide me **`KLING_ACCESS_KEY`** and **`KLING_SECRET_KEY`** by writing them into `.env.local` (don't paste them in chat). Tell me when they're there.

### B.2 Three additional doc sections still missing

I need these from the portal to finish the spec before code:

- [ ] **§I. General Information → API Authentication** (verbatim JWT signing details — algorithm, claims, expiry rules)
- [ ] **§I. General Information → Error Code** (full code/message table)
- [ ] **§V. Callback Protocol** (exact webhook body Kling POSTs to our `callback_url`)
- [ ] **§VI. Account Information Inquiry** (the resource-pack-list endpoint — for live balance display)
- [ ] **The Capability Map** (which `mode` works with which `model_name`)

You can either **paste each section into chat**, or **let me drive your browser via the Chrome MCP** (requires the Claude in Chrome extension installed and connected). Tell me which.

### B.3 GitHub

- [ ] Create the GitHub repo (private) and tell me the URL — I'll set the `origin` remote and push commits in atomic chunks.
- [ ] Confirm `gh` CLI is authenticated on your machine (`gh auth status`).

### B.4 MCPs / design tools

- ✅ `mcp__magic` (21st.dev components) — already loaded, usable immediately.
- ✅ `design:design-critique`, `design:accessibility-review`, `design:design-system` — already loaded.
- [ ] **Stitch MCP** — not installed. Optional. Install only if you specifically want it; shadcn/ui + 21st.dev cover ~95% of UI needs.
- [ ] **Pexels MCP** — not installed. Optional. Useful only for stock imagery on empty/marketing states.

If you don't install Stitch/Pexels, I will design without them — flag now if that's a blocker.

### B.5 Object storage

Pick one based on A above:

- [ ] **Local MinIO via Docker** — preferred for dev; nothing for you to do beyond installing Docker
- [ ] **Cloudflare R2** — provide bucket name, access key, secret key, account ID, public URL base
- [ ] **AWS S3** — provide bucket, access key, secret key, region

### B.6 Database

- [ ] **Local Postgres via Docker** — preferred for dev
- [ ] **Or** managed Postgres (Neon / Supabase) — provide `DATABASE_URL`

---

## C. Local dependencies to install

- [ ] **Node 20 LTS** — `brew install node@20` (or via `nvm`)
- [ ] **pnpm 9** — `corepack enable && corepack prepare pnpm@latest --activate`
- [ ] **Docker Desktop** (or OrbStack) — for Postgres + Redis + MinIO via `docker-compose`
- [ ] **`gh` CLI** — `brew install gh` and `gh auth login`
- [ ] **`ffmpeg`** — `brew install ffmpeg` (for video metadata probing during validation)

Verify:
```bash
node --version    # v20.x
pnpm --version    # 9.x
docker --version
gh --version
ffmpeg -version
```

Optional:
- [ ] **`ngrok`** — `brew install ngrok` (free tier). Needed to receive Kling webhooks against your laptop. Skip if you're OK with polling-only locally.

---

## D. Environment variables we will need

I'll create `.env.example` in the repo. You populate `.env.local`:

```ini
# Kling official API
KLING_ACCESS_KEY=
KLING_SECRET_KEY=
KLING_BASE_URL=https://api-singapore.klingai.com   # or api.klingai.com / api-beijing.klingai.com
KLING_TOKEN_TTL_SECONDS=1800                        # JWT lifetime; 30 min max
KLING_DEFAULT_MODEL=kling-v2-6                      # or kling-v3
KLING_DEFAULT_MODE=std                              # or pro

# Database
DATABASE_URL=postgresql://kling:kling@localhost:5432/kling_mc

# Redis (BullMQ)
REDIS_URL=redis://localhost:6379

# Storage
STORAGE_PROVIDER=minio                # or r2 or s3
S3_ENDPOINT=http://localhost:9000     # MinIO local; remove for AWS S3
S3_REGION=us-east-1
S3_BUCKET=kling-mc-media
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
S3_PUBLIC_URL_BASE=http://localhost:9000/kling-mc-media

# App
APP_BASE_URL=http://localhost:3000     # used to build webhook URLs
WEBHOOK_SECRET=                         # generate: openssl rand -hex 32
DEFAULT_USER_ID=local                   # for single-user mode

# Concurrency
MAX_CONCURRENT_GENERATIONS=2
PER_USER_CONCURRENT_LIMIT=2

# Logging
LOG_LEVEL=info
```

---

## E. Confirmations / answers I need from you

Reply on each:

1. **Storage:** local MinIO (recommended) or R2/S3 from day one?
2. **Auth scope:** single-user (your laptop) or multi-user from day one?
3. **Default model + mode:** `kling-v2-6` + `std` is my recommendation for cost-effective testing. OK?
4. **Pricing display:** OK to use a configurable rate table (defaulting to public Kling 2.6 prices: $0.20/5 s std, $0.33/5 s pro) until you confirm your contract rate?
5. **Stitch / Pexels MCPs:** install or skip?
6. **Code-review gate:** I'll run a `general-purpose` agent in "code reviewer" + "integration validator" roles before each push (transient agents, not persistent). OK or do you want a different gate?
7. **The three missing doc sections** (auth, error codes, callbacks): paste them yourself, or let me drive your browser via the Chrome MCP to grab them?
8. **Repo URL** for the GitHub remote (or "create later")?

---

## F. What I will NOT do without explicit approval

- Push to GitHub (local commits only until you say "push")
- Burn API credits on test calls during build (no live Kling hits until you green-light)
- Touch your other working directories (`dims/.claude`, `saved-spark/.claude`)
- Install OS-level tools for you (Docker, Node) — you install, I run
- Install Stitch / Pexels MCPs (those are MCP server installs; I can't do them)

---

## G. Once everything above is settled

Reply with: "Pre-build checklist complete, decisions: [your choices to E1–E8]" and I'll start Phase 2.
