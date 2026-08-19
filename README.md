# sorrycheck

> Does that proof actually check?

sorrycheck reads artifacts that claim a machine-checked proof and publishes what is actually true about them: does the formalization build, does it still contain `sorry`, which axioms does it really depend on, how many of the paper's asserted results appear as checked declarations, and is the source published at all.

[sorrycheck.com](https://sorrycheck.com) · MIT licensed · built by [Profullstack, Inc.](https://profullstack.com)

## Stack

| Layer | Choice |
| --- | --- |
| Web / SSR / PWA | Next.js 16 (App Router, TypeScript) |
| UI | Tailwind v4 + shadcn-style components |
| API | Hono, mounted inside Next at `/api/*` |
| Database | Turso / libSQL |
| Auth | Magic link + passkey — no passwords |
| Deploy | Railway, one service, Docker |

## Layout

```
apps/
  web/      Next.js app; Hono API at src/app/api/[[...route]]
  worker/   background checker — drains the queue, reads sources, records what it found
            (also `import`, the bulk seed loader)
packages/
  analyzer/ static analysis: declarations, placeholder tokens, coverage matching
  db/       Turso client, registry queries and forward-only migrations
  auth/     magic link, passkey, session
seed/       example seed file for the importer
```

## What is measured, and what is not

**Measured today**, from published source alone:

- whether the formalization source is published at all, and reachable
- which proof system the project uses (Lean 4, Coq, Isabelle)
- which declarations exist, with file and line
- which declarations contain a literal placeholder token — `sorry` in Lean and
  Isabelle, `Admitted` in Coq
- which declarations are introduced with `axiom`, and so assumed rather than proved
- how many of the paper's numbered results matched a declaration, and by which method
- how much of the project was actually read, when size caps truncated the scan

**Not implemented:** the build and the axiom probe. `lake build` and
`#print axioms` require a sandbox that executes untrusted third-party code with
the network off, a hard timeout and a disposable filesystem. Until that exists,
every check records `exit_code = NULL` and `buildStatus: "not-run"`.

A null exit code means **not run**. It does not mean a project failed to build,
and no read path may render it as one. The distinction is load-bearing: a file
with zero `sorry` tokens can still depend on `sorryAx` through a declaration in
another file, which only the axiom probe can see.

## Fairness, in code

The PRD's fairness policy is enforced in `apps/web/src/lib/verdict.ts`, which has
no `fail` tone at all:

- `not_published` is **neutral and grey**. It is a fixable fact about a link, not
  a claim about anyone's honesty, and the page says how to fix it.
- a placeholder in source is `attention`, not failure — work in progress
  legitimately contains them.
- anything unmeasured is `unknown`, never assumed.
- an unmatched coverage result is reported as **unmatched, never as unproven**.
  We cannot tell a result that was never formalized from one our matcher missed.
- the listing leads with artifacts that check out clean, so the front page does
  not open on failures.
- an artifact page is `noindex` until its authors have been notified.

## Running it

```bash
# seed the registry (writes rows directly; never through the HTTP submit path)
pnpm --filter @sorrycheck/worker import seed/example.json

# the checker drains the queue on its own interval
WORKER_BATCH_SIZE=5 pnpm --filter @sorrycheck/worker start
```

Set `GITHUB_TOKEN` to raise the API rate limit. A scopeless token is enough — the
checker only reads public repositories.

## Develop

```bash
pnpm install
cp .env.example .env.local        # then fill in Turso + Resend
pnpm dev
```

No Turso account needed locally — `TURSO_DATABASE_URL` accepts a `file:` URL:

```bash
TURSO_DATABASE_URL=file:./local.db pnpm dev
```

Migrations apply themselves on boot, so a new `packages/db/migrations/*.sql`
ships with a deploy and needs no manual step.

## Deployment

**One Railway service.** `docker-entrypoint.sh` starts the worker and the Next
server in the same container; the Hono API is mounted inside Next rather than
run separately, because Railway exposes a single port. Adding a second Railway
service for the worker is explicitly not the design.

Two traps worth knowing, both learned the hard way on sibling projects:

- Do **not** set `output: 'standalone'` in `next.config.mjs`. Its dependency
  tracing does not survive pnpm's symlinked store and the server dies on boot
  with `MODULE_NOT_FOUND`.
- Do **not** pass `-p` to `next start`. Railway injects `PORT`; hardcoding one
  leaves the edge proxy forwarding to a closed port while the container reports
  healthy.

## Feeds

`/feed.xml` publishes artifacts checked most recently, with their verdicts. It is a plain RSS 2.0
document, submitted to [rssamplifier.com](https://rssamplifier.com).

## License

MIT
