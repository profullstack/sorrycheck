import { Hono } from 'hono';
import { handle } from 'hono/vercel';
import {
  connect,
  countArtifacts,
  coverageFor,
  createClaim,
  declarationsFor,
  getArtifact,
  getClaim,
  insertArtifact,
  latestCheck,
  listArtifacts,
  migrate,
  requeue,
  setAuthorNote,
  setSourceUrl,
  slugify,
} from '@sorrycheck/db';
import { classifySource, parseSourceUrl } from '@sorrycheck/analyzer';
import {
  issueLoginToken,
  magicLinkUrl,
  authenticationOptions,
  resolveSession,
  SESSION_COOKIE,
} from '@sorrycheck/auth';
import { siteUrl, site } from '@/lib/site';
import { STATIC_SCOPE_NOTE, verdictFor } from '@/lib/verdict';

export const runtime = 'nodejs';

const app = new Hono().basePath('/api');

let migrated = false;
async function db() {
  const client = connect();
  if (!migrated) {
    await migrate(client);
    migrated = true;
  }
  return client;
}

app.get('/health', (c) => c.json({ ok: true, service: 'sorrycheck' }));

/* ── registry ─────────────────────────────────────────────────────────────── */

/**
 * Every read path is unauthenticated. Accounts exist only to CLAIM an artifact
 * you authored — reading the registry never requires one.
 */
app.get('/v1/artifacts', async (c) => {
  const client = await db();
  const query = c.req.query('q');
  const limit = Number(c.req.query('limit') ?? 50);
  const offset = Number(c.req.query('offset') ?? 0);

  const rows = await listArtifacts(client, {
    ...(query ? { query } : {}),
    limit: Number.isFinite(limit) ? limit : 50,
    offset: Number.isFinite(offset) ? offset : 0,
    passingFirst: true,
  });

  return c.json({
    note: STATIC_SCOPE_NOTE,
    counts: await countArtifacts(client),
    artifacts: rows.map((row) => ({
      slug: row.slug,
      title: row.title,
      authors: row.authors,
      paperUrl: row.paper_url,
      sourceUrl: row.source_url,
      sourceStatus: row.source_status,
      system: row.system,
      declarations: row.declarations_total,
      sorryInSource: row.sorry_total,
      lastCheckedAt: row.last_checked_at,
      verdict: verdictFor(row, {
        sorry_total: row.sorry_total ?? 0,
        declarations_total: row.declarations_total ?? 0,
        system: row.system,
      } as never),
      url: `${siteUrl()}/a/${row.slug}`,
    })),
  });
});

app.get('/v1/artifacts/:slug', async (c) => {
  const client = await db();
  const artifact = await getArtifact(client, c.req.param('slug'));
  if (!artifact) return c.json({ error: 'not found' }, 404);

  const check = await latestCheck(client, artifact.id);
  const declarations = check ? await declarationsFor(client, check.id) : [];
  const coverage = check ? await coverageFor(client, check.id) : null;

  return c.json({
    note: STATIC_SCOPE_NOTE,
    slug: artifact.slug,
    title: artifact.title,
    authors: artifact.authors,
    venue: artifact.venue,
    paperUrl: artifact.paper_url,
    sourceUrl: artifact.source_url,
    sourceStatus: artifact.source_status,
    authorNote: artifact.author_note,
    lastCheckedAt: artifact.last_checked_at,
    verdict: verdictFor(artifact, check),
    check: check
      ? {
          kind: check.kind,
          system: check.system,
          commitSha: check.commit_sha,
          declarationsTotal: check.declarations_total,
          sorryTotal: check.sorry_total,
          axiomsTotal: check.axioms_total,
          filesScanned: check.files_scanned,
          summary: check.summary,
          checkedAt: check.checked_at,
          // Explicitly null and explicitly explained: nothing was executed.
          exitCode: null,
          buildStatus: 'not-run',
          buildNote:
            'The build and `#print axioms` probe require a sandbox that runs untrusted code. It is not implemented, so no build result exists for this artifact.',
        }
      : null,
    declarations: declarations.map((d) => ({
      name: d.name,
      kind: d.kind,
      file: d.file,
      line: d.line,
      hasSorryInSource: Boolean(d.has_sorry),
      isAxiom: Boolean(d.is_axiom),
      // Null, not empty: the axiom probe did not run.
      axioms: null,
    })),
    coverage: coverage
      ? {
          assertedCount: coverage.asserted_count,
          matchedCount: coverage.matched_count,
          methods: coverage.method ? coverage.method.split(',') : [],
          note: 'An unmatched result means our matcher found no declaration for it. It does not mean the result is unproven.',
          ...(coverage.detail ? (JSON.parse(coverage.detail) as object) : {}),
        }
      : null,
  });
});

/** Submit an artifact, or attach a repository to one that exists. */
app.post('/v1/submit', async (c) => {
  let body: { title?: string; paperUrl?: string; sourceUrl?: string; authors?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'body must be JSON' }, 400);
  }

  const title = body.title?.trim();
  if (!title) return c.json({ error: 'title is required' }, 400);

  if (body.sourceUrl && !parseSourceUrl(body.sourceUrl)) {
    return c.json({ error: 'sourceUrl does not look like a source location' }, 400);
  }

  const client = await db();
  const slug = slugify(title);

  await insertArtifact(client, {
    slug,
    title,
    authors: body.authors ?? '',
    paperUrl: body.paperUrl ?? null,
    sourceUrl: body.sourceUrl ?? null,
    sourceStatus: classifySource(body.sourceUrl, true),
    queueStatus: 'pending',
  });

  return c.json({ ok: true, slug, url: `${siteUrl()}/a/${slug}`, status: 'queued' });
});

/* ── claims and corrections ───────────────────────────────────────────────── */

/**
 * These are the only authenticated routes in the product. Accounts exist to
 * claim an artifact you authored and correct it — never to read the registry.
 */
async function currentUser(c: { req: { header: (name: string) => string | undefined } }) {
  const cookie = c.req.header('cookie') ?? '';
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  return match?.[1] ? resolveSession(await db(), decodeURIComponent(match[1])) : null;
}

app.post('/v1/artifacts/:slug/claim', async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: 'sign in to claim an artifact' }, 401);

  const client = await db();
  const artifact = await getArtifact(client, c.req.param('slug'));
  if (!artifact) return c.json({ error: 'not found' }, 404);

  await createClaim(client, artifact.id, user.id);
  return c.json({
    ok: true,
    claimed: true,
    verified: false,
    note: 'A claim is recorded as an assertion, not a verification. It unlocks corrections; it does not transfer ownership of the page.',
  });
});

app.post('/v1/artifacts/:slug/note', async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: 'sign in to add a note' }, 401);

  const client = await db();
  const artifact = await getArtifact(client, c.req.param('slug'));
  if (!artifact) return c.json({ error: 'not found' }, 404);
  if (!(await getClaim(client, artifact.id, user.id))) {
    return c.json({ error: 'claim this artifact first' }, 403);
  }

  const { note } = await c.req.json<{ note?: string }>();
  if (typeof note !== 'string') return c.json({ error: 'note is required' }, 400);

  await setAuthorNote(client, artifact.slug, note.slice(0, 4000));
  return c.json({ ok: true });
});

/** Attach or correct the source repository, then queue a fresh check. */
app.post('/v1/artifacts/:slug/source', async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: 'sign in to correct an artifact' }, 401);

  const client = await db();
  const artifact = await getArtifact(client, c.req.param('slug'));
  if (!artifact) return c.json({ error: 'not found' }, 404);
  if (!(await getClaim(client, artifact.id, user.id))) {
    return c.json({ error: 'claim this artifact first' }, 403);
  }

  const { sourceUrl } = await c.req.json<{ sourceUrl?: string }>();
  if (!sourceUrl || !parseSourceUrl(sourceUrl)) {
    return c.json({ error: 'sourceUrl does not look like a source location' }, 400);
  }

  await setSourceUrl(client, artifact.id, sourceUrl, classifySource(sourceUrl, true));
  await requeue(client, artifact.id);
  return c.json({ ok: true, status: 'queued', note: 'The artifact will be re-checked from scratch.' });
});

app.post('/v1/artifacts/:slug/recheck', async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: 'sign in to request a re-check' }, 401);

  const client = await db();
  const artifact = await getArtifact(client, c.req.param('slug'));
  if (!artifact) return c.json({ error: 'not found' }, 404);
  if (!(await getClaim(client, artifact.id, user.id))) {
    return c.json({ error: 'claim this artifact first' }, 403);
  }

  await requeue(client, artifact.id);
  return c.json({ ok: true, status: 'queued' });
});

/* ── MCP ──────────────────────────────────────────────────────────────────── */

const MCP_TOOLS = [
  {
    name: 'get_artifact',
    description:
      'Verification status of one artifact in the sorrycheck registry: which declarations exist in the published formalization, which contain a placeholder token in source, and how many of the paper\'s asserted results were matched to a declaration. This is a static reading of source, NOT a build and NOT the `#print axioms` probe.',
    inputSchema: {
      type: 'object',
      properties: { slug: { type: 'string', description: 'The artifact slug.' } },
      required: ['slug'],
    },
  },
  {
    name: 'search_artifacts',
    description: 'Search the sorrycheck registry by title, author or slug.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'number', description: 'Default 20, max 200.' },
      },
    },
  },
];

app.post('/mcp', async (c) => {
  let message: { id?: unknown; method?: string; params?: Record<string, unknown> };
  try {
    message = await c.req.json();
  } catch {
    return c.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }, 400);
  }

  const id = message.id ?? null;
  const reply = (result: unknown) => c.json({ jsonrpc: '2.0', id, result });
  const fail = (code: number, msg: string) => c.json({ jsonrpc: '2.0', id, error: { code, message: msg } });

  switch (message.method) {
    case 'initialize':
      return reply({
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: site.name, version: '0.1.0' },
      });
    case 'notifications/initialized':
      return c.body(null, 204);
    case 'tools/list':
      return reply({ tools: MCP_TOOLS });
    case 'tools/call': {
      const params = (message.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
      const client = await db();

      if (params.name === 'get_artifact') {
        const slug = String(params.arguments?.['slug'] ?? '');
        const artifact = await getArtifact(client, slug);
        if (!artifact) {
          return reply({ content: [{ type: 'text', text: `no artifact "${slug}"` }], isError: true });
        }
        const check = await latestCheck(client, artifact.id);
        const payload = {
          note: STATIC_SCOPE_NOTE,
          slug: artifact.slug,
          title: artifact.title,
          sourceStatus: artifact.source_status,
          verdict: verdictFor(artifact, check),
          buildStatus: 'not-run',
          check,
        };
        return reply({
          content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
          structuredContent: payload,
        });
      }

      if (params.name === 'search_artifacts') {
        const query = params.arguments?.['query'];
        const rows = await listArtifacts(client, {
          ...(query ? { query: String(query) } : {}),
          limit: Math.min(Number(params.arguments?.['limit'] ?? 20), 200),
          passingFirst: true,
        });
        const payload = {
          note: STATIC_SCOPE_NOTE,
          artifacts: rows.map((r) => ({
            slug: r.slug,
            title: r.title,
            sourceStatus: r.source_status,
            sorryInSource: r.sorry_total,
            url: `${siteUrl()}/a/${r.slug}`,
          })),
        };
        return reply({
          content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
          structuredContent: payload,
        });
      }

      return fail(-32602, `unknown tool "${params.name}"`);
    }
    default:
      return fail(-32601, `unknown method "${message.method}"`);
  }
});

app.get('/mcp', (c) => c.json({ name: site.name, transport: 'streamable-http', tools: MCP_TOOLS }));

/* ── auth ─────────────────────────────────────────────────────────────────── */

/**
 * Request a sign-in link. Always answers ok:true — whether an address has an
 * account is not something this endpoint should leak, and rate limits report
 * success for the same reason.
 */
app.post('/auth/magic', async (c) => {
  const { email } = await c.req.json<{ email?: string }>();
  if (!email || !email.includes('@')) return c.json({ ok: true });

  const token = await issueLoginToken(await db(), email);
  const link = magicLinkUrl(siteUrl(), token);

  const key = process.env['RESEND_API_KEY'];
  if (!key) {
    console.log('[auth] magic link for', email, link);
    if (process.env['NODE_ENV'] !== 'production') return c.json({ ok: true, devLink: link });
    return c.json({ ok: true });
  }

  const sent = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: process.env['MAIL_FROM'] ?? 'sorrycheck <hello@sorrycheck.com>',
      to: email,
      subject: 'Your sorrycheck sign-in link',
      text: `Sign in: ${link}\n\nThis link expires in 15 minutes.`,
    }),
  });

  // A failed send used to be swallowed: the endpoint returned ok:true whether or
  // not the provider accepted it, so an unverified sending domain looked exactly
  // like success. Still ok:true to the caller — leaking whether an address has an
  // account is the reason it always answers ok — but no longer silent for us.
  if (!sent.ok) {
    console.error('[auth] resend rejected the send', sent.status, await sent.text().catch(() => ''));
  }

  return c.json({ ok: true });
});

app.get('/auth/passkey/options', async (c) => c.json(await authenticationOptions(siteUrl())));

export const GET = handle(app);
export const POST = handle(app);
