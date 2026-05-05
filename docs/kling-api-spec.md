# Kling Motion Control — API Technical Spec

**Status:** Phase-1 research deliverable, v2.
**Last updated:** 2026-05-05
**Source:** Verbatim from the official Kling developer portal (provided by user) plus cross-references for sections not yet pasted.

---

## 0. Status

This spec is complete enough to start Phase 2 once user decisions land. Verbatim from the official Kling developer portal:

- ✅ Motion Control endpoints (create, query single, query list) — §4–§5
- ✅ API base URL — §2
- ✅ JWT authentication — §3
- ✅ Error code table — §7
- ✅ Callback protocol — §6

Still **unconfirmed** (low-risk):
- Capability Map (which `mode` works with which `model_name`) — defaults will be `kling-v2-6` + `std`; we'll catch validation errors at runtime via service code 1201/1203.
- §VI Account Information Inquiry (resource-pack-list endpoint) — needed for live balance; will fetch when needed.
- Pricing per task on user's actual account — we'll use a configurable rate table and treat `final_unit_deduction` (returned by both query and callback) as authoritative for actual cost.

**Provider decision:** integrate **directly against the official Kling API**. Aggregator (kie.ai) is dropped from v0; we keep the `KlingProvider` interface for a one-file future swap.

---

## 1. Endpoint summary

| Action | Method | Path |
|---|---|---|
| Create Motion Control task | `POST` | `/v1/videos/motion-control` |
| Query task (single) | `GET` | `/v1/videos/motion-control/{id}` |
| Query task (list) | `GET` | `/v1/videos/motion-control?pageNum=&pageSize=` |
| (TBD) Query account credits / resource pack | `GET` | section 6-1 in official spec; path not yet captured |
| (TBD) Receive callback | `POST` (server → us) | URL we provide via `callback_url` per task |

## 2. Base URL

```
https://api-singapore.klingai.com
```

Verbatim from the portal: *"The API endpoint for the new system has been updated from `https://api.klingai.com` to `https://api-singapore.klingai.com`. This API is suitable for users whose servers are located outside of China."*

Translation: `api-singapore` is the **new global endpoint** for non-China users (not a region we choose for latency reasons). The old `api.klingai.com` is legacy.

We'll still expose `KLING_BASE_URL` as an env var so this is configurable, but default to `api-singapore.klingai.com`.

---

## 3. Authentication (verbatim from portal)

JWT (RFC 7519). Generate the token server-side per request (or cache short-lived):

- **Algorithm:** `HS256`
- **Header:** `{"alg":"HS256","typ":"JWT"}`
- **Payload:**
  - `iss` = AccessKey
  - `exp` = current unix seconds + 1800 (30 min)
  - `nbf` = current unix seconds − 5
  - **No `iat` claim in the official sample** — only `iss`, `exp`, `nbf`. We'll match that exactly to avoid validators that reject extra claims.
- **Signing key:** SecretKey (HMAC)
- **Header sent:** `Authorization: Bearer <jwt>` (note: a single space between `Bearer` and the token; the portal calls this out)

Reference Python from the portal:

```python
import time
import jwt

ak = "" # access key
sk = "" # secret key

def encode_jwt_token(ak, sk):
    headers = {"alg": "HS256", "typ": "JWT"}
    payload = {
        "iss": ak,
        "exp": int(time.time()) + 1800,
        "nbf": int(time.time()) - 5,
    }
    return jwt.encode(payload, sk, headers=headers)
```

### 3.1 Implementation plan

`lib/kling/jwt.ts` — uses `jsonwebtoken`:

```ts
import jwt from "jsonwebtoken";

let cached: { token: string; expiresAt: number } | null = null;

export function getKlingToken(ak: string, sk: string): string {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.expiresAt - now > 60) return cached.token;
  const payload = { iss: ak, exp: now + 1800, nbf: now - 5 };
  const token = jwt.sign(payload, sk, { algorithm: "HS256", noTimestamp: true });
  cached = { token, expiresAt: now + 1800 };
  return token;
}
```

`noTimestamp: true` matters — `jsonwebtoken` adds `iat` by default, but the official sample omits it. We omit too.

Both AccessKey and SecretKey stay server-side only (worker process + Next.js API routes). They never reach the browser bundle.

---

## 4. POST `/v1/videos/motion-control` — Create Task (verbatim from official docs)

### 4.1 Request headers

| Field | Value | Required |
|---|---|---|
| `Content-Type` | `application/json` | yes |
| `Authorization` | `Bearer <jwt>` (see §3) | yes |

### 4.2 Request body

| Field | Type | Required | Default | Notes (verbatim from official docs) |
|---|---|---|---|---|
| `model_name` | string | optional | `kling-v2-6` | Enum: `kling-v2-6`, `kling-v3` |
| `prompt` | string | optional | — | Positive + negative descriptions. ≤ 2500 chars. Can include camera-movement effects. |
| `image_url` | string | **required** | — | Reference image. URL **or** raw base64 (no `data:image/...;base64,` prefix — submit raw string). Formats: `.jpg / .jpeg / .png`. ≤ 10 MB. Dimensions: 300–65536 px. Aspect: 1:2.5 – 2.5:1. Subject must show clear upper or full body, no extreme orientations. |
| `video_url` | string | **required** | — | Reference motion video. Formats: `.mp4 / .mov`. ≤ 100 MB. Dimensions: 340–3850 px. Duration: 3–30 s (max depends on `character_orientation`). Single continuous shot recommended; cuts/camera-movements truncate. **System validates content and may return error codes.** |
| `element_list` | array | optional | — | Currently max 1 entry: `[{ "element_id": <long> }]`. When present, generated video orientation comes from the *video*, not the image. |
| `keep_original_sound` | string | optional | `yes` | Enum: `yes`, `no` |
| `character_orientation` | string | **required** | — | Enum: `image`, `video`. `image` ⇒ video reference must be ≤ 10 s. `video` ⇒ ≤ 30 s. When `element_list` is set, this is forced to `video`-orientation behavior. |
| `mode` | string | **required** | — | Enum: `std`, `pro`. `std` = cost-effective; `pro` = higher quality. Support varies by model — see Capability Map (not yet captured). |
| `watermark_info` | object | optional | — | `{ "enabled": boolean }`. `true` ⇒ produce a separate watermarked output URL. Custom watermarks not supported. |
| `callback_url` | string | optional | — | Webhook URL invoked on status change (see §6). |
| `external_task_id` | string | optional | — | Customer-defined ID; queryable; must be unique per user. Doesn't replace system task ID. |

### 4.3 Verbatim curl example (from official docs)

```bash
curl --request POST \
  --url https://api-singapore.klingai.com/v1/videos/motion-control \
  --header 'Authorization: Bearer <token>' \
  --header 'Content-Type: application/json; charset=utf-8' \
  --data-raw '{
    "model_name": "kling-v2-6",
    "image_url": "https://p2-kling.klingai.com/kcdn/cdn-kcdn112452/kling-qa-test/multi-3.ng.png",
    "prompt": "The girl is wearing a loose gray T-shirt and denim shorts",
    "video_url": "https://p2-kling.klingai.com/kcdn/cdn-kcdn112452/kling-qa-test/dance.mp4",
    "keep_original_sound": "yes",
    "character_orientation": "image",
    "mode": "pro",
    "callback_url": "",
    "external_task_id": "xxx"
  }'
```

### 4.4 Response (200)

```json
{
  "code": 0,
  "message": "string",
  "request_id": "string",
  "data": {
    "task_id": "string",
    "task_info": { "external_task_id": "string" },
    "task_status": "string",
    "created_at": 1722769557708,
    "updated_at": 1722769557708
  }
}
```

- `code === 0` ⇒ accepted. Non-zero is an error (table TBD §7).
- `task_status` enum: `submitted | processing | succeed | failed`.
- `created_at` / `updated_at` are unix milliseconds.

---

## 5. GET `/v1/videos/motion-control/{id}` — Query Task (Single)

### 5.1 Path / query params

- `{id}` is either the system `task_id` **or** the customer's `external_task_id`. Caller picks one.
- No body, no query string.

### 5.2 Response (200)

```json
{
  "code": 0,
  "message": "string",
  "request_id": "string",
  "data": {
    "task_id": "string",
    "task_status": "submitted | processing | succeed | failed",
    "task_status_msg": "string",
    "task_info": { "external_task_id": "string" },
    "task_result": {
      "videos": [
        {
          "id": "string",
          "url": "string",
          "watermark_url": "string",
          "duration": "string"
        }
      ]
    },
    "watermark_info": { "enabled": true },
    "final_unit_deduction": "string",
    "created_at": 1722769557708,
    "updated_at": 1722769557708
  }
}
```

- `task_status_msg` carries the failure reason when `task_status === "failed"` (e.g. content-risk-control trigger).
- `task_result.videos[].url` is the generated video. **Anti-leech URL — Kling deletes generated content after 30 days.** We MUST download to our own storage immediately on completion.
- `task_result.videos[].duration` is total length in seconds (string).
- `final_unit_deduction` = credits actually charged for the task. We persist this on the `Generation` row as the source-of-truth cost.

### 5.3 List endpoint

`GET /v1/videos/motion-control?pageNum=<1-1000>&pageSize=<1-500>` — defaults `pageNum=1`, `pageSize=30`. Returns the same `data` shape as single-query, but as an array. Useful for backfill / reconciliation if our DB drifts.

---

## 6. Callback Protocol (verbatim from portal)

If `callback_url` is set on Create Task, Kling POSTs to it on every status change. Body:

```json
{
  "task_id": "string",
  "task_status": "submitted | processing | succeed | failed",
  "task_status_msg": "string",
  "created_at": 1722769557708,
  "updated_at": 1722769557708,
  "final_unit_deduction": "string",
  "task_info": {
    "parent_video": {
      "id": "string",
      "url": "string",
      "duration": "string"
    },
    "external_task_id": "string"
  },
  "task_result": {
    "images": [ { "index": 0, "url": "string" } ],
    "videos": [ { "id": "string", "url": "string", "duration": "string" } ]
  }
}
```

### 6.1 Important nuances

- **Callbacks are NOT signed.** The portal documents no HMAC/signature header. **Defense in depth:** treat callbacks as advisory. On receipt, our handler verifies by issuing `GET /v1/videos/motion-control/{task_id}` against Kling, and only persists the result from that. This costs one extra request per task but blocks any spoofed callback.
- **Callback `task_result.videos[]` lacks `watermark_url`** that the query endpoint returns — another reason to GET-then-trust.
- **`task_info.parent_video`** is for video-extension tasks; will be absent for motion-control tasks.
- Kling fires callbacks on **every** status change (including `submitted` → `processing`), not just terminal — handler must be idempotent.
- We will respond `200 OK` immediately to Kling, then enqueue an internal job to do the verify-and-persist. Slow handlers cause Kling retries.

### 6.2 Webhook URL

Per task: `${APP_BASE_URL}/api/webhooks/kling?gid=${generation_id}` — the `gid` query param lets us look up our local row in O(1) without hitting Kling first to translate the task_id.

### 6.3 Polling fallback

Use webhooks as primary. Fall back to polling `GET /v1/videos/motion-control/{task_id}` if no terminal-state webhook arrives within 15 minutes. Cadence: 5 s for first minute, 15 s through minute 5, 30 s thereafter; hard cap 20 min, then mark `failed` with reason `polling_timeout`.

---

## 7. Error codes (verbatim from portal)

| HTTP | Service code | Meaning | Retry? | User-facing? |
|---|---|---|---|---|
| 200 | 0 | Success | n/a | n/a |
| 401 | 1000 | Auth failed (generic) | no | log only — bug in our signing |
| 401 | 1001 | Authorization empty | no | log only — bug |
| 401 | 1002 | Authorization invalid | no | log only — bug |
| 401 | 1003 | Token not yet valid (`nbf` not reached) | yes (after small wait) | log only |
| 401 | 1004 | Token expired | **yes after refresh** | log only — auto-refresh JWT and retry once |
| 429 | 1100 | Account exception (generic) | no | "Account issue, contact support" |
| 429 | 1101 | Account in arrears (postpaid) | no | "Top up your Kling account" — surface |
| 429 | 1102 | Resource pack depleted/expired (prepaid) | no | "Out of credits — top up" — surface |
| 403 | 1103 | Unauthorized for this resource (model/API not in plan) | no | "Your plan doesn't include this model" — surface |
| 400 | 1200 | Invalid request params (generic) | no | show server message |
| 400 | 1201 | Bad key/value | no | show server message — likely client-side validation gap |
| 404 | 1202 | Wrong HTTP method | no | log only — code bug |
| 404 | 1203 | Resource not found (e.g. unknown model) | no | show server message |
| 400 | 1300 | Platform policy triggered (generic) | no | show server message |
| 400 | 1301 | Content safety policy | no | "Generation blocked by content safety" — surface |
| 429 | 1302 | Rate limit exceeded | yes, backoff | retry transparently; surface only if persistent |
| 429 | 1303 | Concurrency / QPS exceeds resource pack | yes, backoff | retry transparently |
| 429 | 1304 | IP whitelist policy | no | "IP not allowed — contact support" |
| 500 | 5000 | Server internal error | yes | log + retry |
| 503 | 5001 | Server temporarily unavailable (maintenance) | yes | log + retry |
| 504 | 5002 | Server internal timeout | yes | log + retry |

### 7.1 Implementation

`lib/kling/errors.ts` exports:

```ts
export type KlingServiceCode = 0 | 1000 | 1001 | 1002 | 1003 | 1004
  | 1100 | 1101 | 1102 | 1103
  | 1200 | 1201 | 1202 | 1203
  | 1300 | 1301 | 1302 | 1303 | 1304
  | 5000 | 5001 | 5002;

export function isRetryable(code: KlingServiceCode): boolean {
  return code === 1003 || code === 1004 || code === 1302 || code === 1303
      || code === 5000 || code === 5001 || code === 5002;
}

export function isUserFacing(code: KlingServiceCode): boolean {
  return code === 1101 || code === 1102 || code === 1103
      || code === 1200 || code === 1201 || code === 1203 || code === 1300
      || code === 1301 || code === 1304;
}
```

Retries: exponential backoff with jitter — 1, 2, 4, 8, 16 s, cap 5 attempts. For `1004` (token expired) we force a JWT refresh before the retry. For `1003` (`nbf` not reached) we sleep 5 s and retry once — usually a clock-skew artifact.

---

## 8. Pricing (Kling official, partial)

The user's paste is silent on pricing. Public sources:

- Kling 2.6: ~$0.20 (std) / $0.33 (pro) per 5 s of output (community sources).
- Kling 3.0: ~$0.075/s (text+image-to-video). Motion Control specifically not broken out.

We will:

- Show a "live" cost estimate on the create form using a **configurable rate table** in `lib/kling/pricing.ts`. User can override per their actual contract.
- After completion, store `final_unit_deduction` from the response on the `Generation` row as the authoritative actual cost.

A balance/resource-pack endpoint exists in §VI of the official spec (not yet captured); will integrate once specs available.

---

## 9. Lifecycle (provider-aware)

1. **Client uploads** source video + reference image to our backend.
2. **Backend validates locally** — format / size (10 MB image, 100 MB video) / duration (3–30 s, ≤10 s if `character_orientation=image`) / resolution / aspect ratio. Reject early with structured errors.
3. **Backend stores** assets in S3-compatible storage. Generates a short-lived signed URL Kling can fetch. (Kling's `image_url` accepts raw base64 too — we'll prefer signed URL for files >2 MB to keep request bodies small.)
4. **Persist `Generation` row** with status `queued`, all inputs, our estimated cost.
5. **Worker** (BullMQ) picks up the row, mints/fetches a JWT, calls `POST /v1/videos/motion-control` with `external_task_id = our_generation_id` and `callback_url = APP_BASE_URL/api/webhooks/kling`. Updates row to `processing` with `provider_task_id`.
6. **On webhook OR poll** (whichever fires first), worker fetches `GET /v1/videos/motion-control/{task_id}`, downloads `task_result.videos[0].url` to our storage, writes a `MediaAsset` row for the output, updates `Generation` to `completed` with `actualCostUsd` (derived from `final_unit_deduction` × current rate).
7. **On app restart**: worker query for rows in `processing` and resume polling — `external_task_id` makes idempotent re-query trivial.

---

## 10. Open questions / TODOs (low-risk, can resolve during build)

- [ ] §VI. Account Information Inquiry (resource-pack-list endpoint) — for live balance display.
- [ ] Capability Map — which `mode` is valid with which `model_name`. We'll start with `kling-v2-6` + `std/pro` and `kling-v3` + `std/pro`, and surface server-side `1201`/`1203` as user-facing if we get them.
- [ ] Confirm pricing on user's actual account — config in `lib/kling/pricing.ts`.
- [ ] Confirm `image_url` raw-base64 limit. Plan: always upload to our S3 and pass a signed URL (avoids the question).

---

## 11. Sources

- **PRIMARY:** Verbatim Motion Control endpoint spec provided by the user from the official Kling developer portal (`app.klingai.com/global/dev/document-api`).
- [Official Kling docs partial mirror — `199-mcp/mcp-kling`](https://github.com/199-mcp/mcp-kling/blob/main/kling-api-docs.md) — for the common envelope / lip-sync analog confirming response shape.
- [Puter tutorial — Kling API key setup](https://developer.puter.com/tutorials/how-to-get-kling-api-key/)
- [`@microfox/kling-ai` JWT reference](https://www.npmjs.com/package/@microfox/kling-ai) — community JWT signing details (used in §3 placeholder).
- Cross-reference for file constraints / mode behavior: [kie.ai docs](https://docs.kie.ai/market/kling/motion-control-v3), [fal.ai docs](https://fal.ai/models/fal-ai/kling-video/v2.6/standard/motion-control/api), [novita.ai docs](https://novita.ai/docs/api-reference/model-apis-kling-v2.6-pro-motion-control). All consistent with the official paste.
