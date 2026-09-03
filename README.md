# Webhook System — Production

A production-shaped version of the sync/async webhook demo: **Website
A (sender)** sends a burst of 100–1000 webhook calls to **Website B
(receiver)**, and the receiver replies back via a callback webhook.
This version replaces every "toy" piece with the real thing.

## What changed from the demo, and why

| Demo version | Production version | Why it matters at scale |
|---|---|---|
| In-memory array queue | **Redis + BullMQ** durable queue | Survives a crash or restart. Jobs aren't lost if the process dies mid-batch. |
| One process does everything | **Separate API and worker processes** | Scale them independently — add more workers when processing is the bottleneck, without touching the API layer, and vice versa. |
| No durable status table | **PostgreSQL + Prisma** message ledger | Operators can query message status, retries, timestamps, and permanent failures after queue retention expires. |
| Plain shared-secret header (optional) | **HMAC-SHA256 request signing** with timestamp + replay protection | Verifies requests are authentic and unmodified; rejects stale/replayed requests. This is what Stripe, GitHub, and Twilio actually do. |
| No retry on failed reply delivery | **Automatic retry with exponential backoff**, both at the job level (BullMQ) and the reply-webhook delivery level | Network blips and slow senders don't silently drop results. |
| No duplicate protection | **Postgres unique external message ID + BullMQ job ID** | Webhook senders retry on timeout — the same message can arrive twice. Duplicates are detected and ignored instead of double-processed. |
| No rate limiting | **express-rate-limit** on the public endpoint | Protects the receiver from being flooded far beyond what it (or downstream systems) can absorb. |
| `console.log` | **Structured logging** (pino) | Machine-parseable logs for log aggregation (Datadog, CloudWatch, etc.) |
| No health checks | **`/healthz`** (liveness) and **`/readyz`** (readiness, checks Redis) | Load balancers and orchestrators (Kubernetes, ECS, Render) use these to know when to route traffic to an instance or restart it. |
| No shutdown handling | **Graceful shutdown** (SIGTERM) | Rolling deploys and autoscaler scale-downs don't drop in-flight requests. |

## Architecture

```
                    HMAC-signed POST /webhook (one per message)
  ┌──────────┐   ─────────────────────────────────────────►   ┌──────────────────┐
  │  sender  │                                                  │  receiver-api    │
  │(Website A)│  ◄─────────────────────────────────────────    │  (Website B)     │
  └──────────┘        POST /webhook/reply (per completed msg)   └────────┬─────────┘
       ▲                                                                  │ enqueue
       │                                                                  ▼
       │                                                         ┌──────────────┐
       │                                                         │ PostgreSQL   │◄─── message status,
       │                                                         │  + Prisma    │     retries, errors
       │                                                         └──────┬───────┘
       │                                                                │ enqueue
       │                                                                ▼
       │                                                         ┌──────────────┐
       │                                                         │    Redis     │◄─── durable BullMQ queue
       │                                                         │  (BullMQ)    │
       │                                                         └──────┬───────┘
       │                                                                │ dequeue (many workers)
       │                                        ┌───────────────────────┼───────────────────────┐
       │                                        ▼                       ▼                       ▼
       │                               ┌────────────────┐    ┌────────────────┐    ┌────────────────┐
       └───────────────────────────────┤ receiver-worker│    │ receiver-worker│    │ receiver-worker│
             reply webhook, with retry  │   instance 1   │    │   instance 2   │    │   instance N   │
                                        └────────────────┘    └────────────────┘    └────────────────┘
```

The API layer (`receiver-api`) only ever does three things per
request: verify the signature, validate the payload, create/claim the
message row by external id, push the job onto Redis, and respond `202`.
It never does the actual work — that keeps it fast and able to absorb
bursts even if processing is slow.

The worker layer (`receiver-worker`) is a **separate process** that
pulls jobs from Redis, does the real work, and updates PostgreSQL as a
message moves through `QUEUED`, `PROCESSING`, `PROCESSED`, or `FAILED`.
Because coordination lives in Redis and durable state lives in
PostgreSQL, you can run **any number** of worker instances, on any
number of machines, and they'll automatically share the load with no
extra code.

## Run it locally with Docker Compose

```bash
cp receiver/.env.example receiver/.env   # optionally set WEBHOOK_SECRET
cp sender/.env.example sender/.env       # same WEBHOOK_SECRET here too
docker-compose up --build
```

This starts PostgreSQL, Redis, a migration container, one receiver API
instance, receiver workers, and the sender — all wired together. Open
**http://localhost:5000** for the sender dashboard and
**http://localhost:4000** for the receiver dashboard.

**Scale workers up or down without touching anything else:**
```bash
docker-compose up --scale receiver-worker=8
```

## Run it locally without Docker

Needs local Redis (`redis-server`) on port 6379 and PostgreSQL on port
5432. Create the database first, then run Prisma migrations.

```bash
# terminal 0 - receiver database setup
cd receiver && npm install && npx prisma migrate deploy

# terminal 1 - receiver API
cd receiver && npm install && npm start

# terminal 2 - receiver worker (run several of these to test scaling)
cd receiver && npm run start:worker

# terminal 3 - sender
cd sender && npm install && npm start
```

## Security: HMAC request signing

Set the **same** `WEBHOOK_SECRET` on both `receiver` and `sender`.
Every request from the sender is signed:

```
signature = HMAC_SHA256(secret, `${timestamp}.${rawRequestBody}`)
```

sent as `x-webhook-signature`, alongside `x-webhook-timestamp`. The
receiver recomputes the signature and compares it with a timing-safe
comparison, and rejects timestamps more than 5 minutes old (blocks
replay attacks with a captured signature). Generate a strong secret
with:

```bash
openssl rand -hex 32
```

If `WEBHOOK_SECRET` is left unset on the receiver, signature checking
is disabled — fine for local testing, **not for production**.

## Reliability guarantees

- **At-least-once delivery to the worker**: BullMQ jobs are written to
  Redis before the API responds, and retried automatically
  (`MAX_ATTEMPTS`, exponential backoff) if a worker crashes mid-job or
  throws.
- **Idempotent processing**: each message `id` is stored as a unique
  `externalMessageId` in PostgreSQL and also used as the BullMQ `jobId`.
  Retried deliveries of the same id are safely ignored once queued.
- **At-least-once reply delivery**: the reply-webhook call itself
  retries up to 4 times with backoff if the sender is briefly
  unreachable or slow.
- **Failed jobs aren't silently lost**: after `MAX_ATTEMPTS`, BullMQ
  keeps the job in its "failed" set and PostgreSQL records the message
  as `FAILED` with retry count, failure timestamp, and error text.

## Deploying live (Render Blueprint)

`render.yaml` at the root defines four resources: a managed Redis
(Key Value), the receiver API, the receiver **worker** (a separate
Background Worker service, scaled via `numInstances`), and the sender.

1. Push this repo to GitHub.
2. On Render: **New → Blueprint**, connect the repo.
3. Render prompts you to set `WEBHOOK_SECRET` (marked `sync: false` so
   it's never committed to the repo) — set the **same** value for both
   `webhook-receiver-api` and `webhook-sender`.
4. Deploy. The sender's `RECEIVER_URL` is wired automatically from the
   receiver's live hostname — no manual URL copying.
5. To handle more load, raise `numInstances` on
   `webhook-receiver-worker` in `render.yaml` and redeploy — the API
   layer doesn't need to change at all.

For a fully managed alternative to self-hosting Redis + BullMQ,
consider **AWS SQS + Lambda** (built-in retry/DLQ/concurrency limits)
or a managed BullMQ host — the code here maps directly onto either.

## What's still worth adding before very large scale

- **Dead-letter alerting**: page/notify on `job:failed` events instead
  of just logging them.
- **Autoscaling workers** based on Redis queue depth (`/readyz`
  exposes `queue.waiting`) rather than a fixed instance count.
- **mTLS or IP allowlisting** between sender and receiver if both are
  internal services, in addition to HMAC signing.
