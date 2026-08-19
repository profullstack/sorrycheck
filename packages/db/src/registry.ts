import type { Db } from './index.js';

export type SourceStatus = 'published' | 'not_published' | 'unreachable' | 'not_applicable';
export type QueueStatus = 'pending' | 'checked' | 'skipped';

export interface Artifact {
  id: number;
  slug: string;
  title: string;
  authors: string;
  venue: string | null;
  paper_url: string | null;
  source_url: string | null;
  source_status: SourceStatus;
  queue_status: QueueStatus;
  author_note: string | null;
  first_seen_at: number;
  last_checked_at: number | null;
  claimed_by: number | null;
  notified_at: number | null;
}

export interface Check {
  id: number;
  artifact_id: number;
  commit_sha: string | null;
  toolchain: string | null;
  exit_code: number | null;
  duration_ms: number | null;
  kind: string;
  system: string | null;
  declarations_total: number;
  sorry_total: number;
  axioms_total: number;
  files_scanned: number;
  files_available: number;
  summary: string | null;
  checked_at: number;
}

/** URL-safe, stable, and readable in a badge markdown link. */
export function slugify(text: string): string {
  return (
    text
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'artifact'
  );
}

export interface UpsertArtifact {
  slug: string;
  title: string;
  authors?: string;
  venue?: string | null;
  paperUrl?: string | null;
  sourceUrl?: string | null;
  sourceStatus?: SourceStatus;
  queueStatus?: QueueStatus;
}

/**
 * Insert an artifact, or leave the existing row alone.
 *
 * The importer writes thousands of rows and must not clobber a claimed
 * artifact's corrected metadata on a re-run, so this is insert-or-ignore rather
 * than an upsert. Correcting a row is a deliberate, separate call.
 */
export async function insertArtifact(db: Db, input: UpsertArtifact, now = Date.now()): Promise<void> {
  await db.execute({
    sql: `insert or ignore into artifacts
            (slug, title, authors, venue, paper_url, source_url, source_status, queue_status, first_seen_at)
          values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      input.slug,
      input.title,
      input.authors ?? '',
      input.venue ?? null,
      input.paperUrl ?? null,
      input.sourceUrl ?? null,
      input.sourceStatus ?? 'not_published',
      input.queueStatus ?? 'pending',
      now,
    ],
  });
}

export async function getArtifact(db: Db, slug: string): Promise<Artifact | null> {
  const r = await db.execute({ sql: 'select * from artifacts where slug = ?', args: [slug] });
  return (r.rows[0] as unknown as Artifact) ?? null;
}

export async function latestCheck(db: Db, artifactId: number): Promise<Check | null> {
  const r = await db.execute({
    sql: 'select * from checks where artifact_id = ? order by checked_at desc, id desc limit 1',
    args: [artifactId],
  });
  return (r.rows[0] as unknown as Check) ?? null;
}

export async function claimPending(db: Db, limit: number): Promise<Artifact[]> {
  const r = await db.execute({
    sql: `select * from artifacts where queue_status = 'pending' order by first_seen_at asc limit ?`,
    args: [limit],
  });
  return r.rows as unknown as Artifact[];
}

export interface RecordCheckInput {
  artifactId: number;
  kind: string;
  system: string | null;
  declarationsTotal: number;
  sorryTotal: number;
  axiomsTotal: number;
  filesScanned: number;
  filesAvailable: number;
  summary: string;
  commitSha?: string | null;
  declarations: Array<{
    name: string;
    kind: string;
    file: string;
    line: number;
    hasSorry: boolean;
    isAxiom: boolean;
  }>;
  coverage?: {
    assertedCount: number;
    matchedCount: number;
    method: string;
    detail: string;
  } | null;
}

/**
 * Persist a check and everything it found, then mark the artifact checked.
 *
 * `exit_code` is deliberately left null: nothing was executed. A null there
 * means NOT RUN, and every read path must render it that way rather than as a
 * failure — a false "fails to build" from our own harness is the error most
 * likely to be believed and least likely to be forgiven.
 */
export async function recordCheck(db: Db, input: RecordCheckInput, now = Date.now()): Promise<number> {
  await db.execute({
    sql: `insert into checks
            (artifact_id, commit_sha, kind, system, declarations_total, sorry_total,
             axioms_total, files_scanned, files_available, summary, checked_at)
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      input.artifactId,
      input.commitSha ?? null,
      input.kind,
      input.system,
      input.declarationsTotal,
      input.sorryTotal,
      input.axiomsTotal,
      input.filesScanned,
      input.filesAvailable,
      input.summary,
      now,
    ],
  });

  const row = await db.execute({
    sql: 'select id from checks where artifact_id = ? order by id desc limit 1',
    args: [input.artifactId],
  });
  const checkId = Number((row.rows[0] as unknown as { id: number }).id);

  for (const d of input.declarations) {
    await db.execute({
      sql: `insert into declarations (check_id, name, kind, file, line, has_sorry, is_axiom)
            values (?, ?, ?, ?, ?, ?, ?)`,
      args: [checkId, d.name, d.kind, d.file, d.line, d.hasSorry ? 1 : 0, d.isAxiom ? 1 : 0],
    });
  }

  if (input.coverage) {
    await db.execute({
      sql: `insert into coverage (check_id, asserted_count, matched_count, method, detail)
            values (?, ?, ?, ?, ?)`,
      args: [
        checkId,
        input.coverage.assertedCount,
        input.coverage.matchedCount,
        input.coverage.method,
        input.coverage.detail,
      ],
    });
  }

  await db.execute({
    sql: `update artifacts set queue_status = 'checked', last_checked_at = ? where id = ?`,
    args: [now, input.artifactId],
  });

  return checkId;
}

export async function markSkipped(db: Db, artifactId: number, now = Date.now()): Promise<void> {
  await db.execute({
    sql: `update artifacts set queue_status = 'skipped', last_checked_at = ? where id = ?`,
    args: [now, artifactId],
  });
}

export interface ListOptions {
  query?: string;
  limit?: number;
  offset?: number;
  /** Front page leads with artifacts that pass — see the PRD's fairness policy. */
  passingFirst?: boolean;
}

export interface ArtifactRow extends Artifact {
  system: string | null;
  declarations_total: number | null;
  sorry_total: number | null;
  summary: string | null;
}

/**
 * List artifacts with their most recent check.
 *
 * Ordering leads with artifacts that check out clean, which is a deliberate
 * editorial choice from the PRD: a registry that opens on failures reads as a
 * shaming tool, and that framing cannot be retrofitted away later.
 */
export async function listArtifacts(db: Db, options: ListOptions = {}): Promise<ArtifactRow[]> {
  const limit = Math.min(options.limit ?? 50, 200);
  const offset = options.offset ?? 0;
  const args: Array<string | number> = [];

  let where = '';
  if (options.query?.trim()) {
    where = `where (a.title like ? or a.authors like ? or a.slug like ?)`;
    const like = `%${options.query.trim()}%`;
    args.push(like, like, like);
  }

  const order = options.passingFirst
    ? `order by (case when c.sorry_total = 0 and c.declarations_total > 0 then 0 else 1 end),
                a.last_checked_at desc, a.id desc`
    : `order by a.last_checked_at desc, a.id desc`;

  args.push(limit, offset);

  const r = await db.execute({
    sql: `select a.*, c.system, c.declarations_total, c.sorry_total, c.summary
          from artifacts a
          left join checks c on c.id = (
            select id from checks where artifact_id = a.id order by checked_at desc, id desc limit 1
          )
          ${where}
          ${order}
          limit ? offset ?`,
    args,
  });
  return r.rows as unknown as ArtifactRow[];
}

export async function countArtifacts(db: Db): Promise<{ total: number; checked: number; pending: number }> {
  const r = await db.execute(`select
      count(*) as total,
      sum(case when queue_status = 'checked' then 1 else 0 end) as checked,
      sum(case when queue_status = 'pending' then 1 else 0 end) as pending
    from artifacts`);
  const row = r.rows[0] as unknown as { total: number; checked: number | null; pending: number | null };
  return {
    total: Number(row.total ?? 0),
    checked: Number(row.checked ?? 0),
    pending: Number(row.pending ?? 0),
  };
}

export async function declarationsFor(db: Db, checkId: number) {
  const r = await db.execute({
    sql: 'select name, kind, file, line, has_sorry, is_axiom from declarations where check_id = ? order by file, line',
    args: [checkId],
  });
  return r.rows as unknown as Array<{
    name: string;
    kind: string;
    file: string;
    line: number;
    has_sorry: number;
    is_axiom: number;
  }>;
}

export async function coverageFor(db: Db, checkId: number) {
  const r = await db.execute({
    sql: 'select asserted_count, matched_count, method, detail from coverage where check_id = ?',
    args: [checkId],
  });
  return (
    (r.rows[0] as unknown as {
      asserted_count: number;
      matched_count: number;
      method: string;
      detail: string | null;
    }) ?? null
  );
}

export async function setAuthorNote(db: Db, slug: string, note: string): Promise<void> {
  await db.execute({ sql: 'update artifacts set author_note = ? where slug = ?', args: [note, slug] });
}

export interface Claim {
  id: number;
  artifact_id: number;
  user_id: number;
  verified_at: number | null;
  created_at: number;
}

/**
 * Record a claim on an artifact.
 *
 * `verified_at` stays null: a claim is an assertion until a human checks it, and
 * treating "claimed" as "verified" would let anyone take editorial control of a
 * page about someone else's work. An unverified claim still unlocks corrections,
 * because a wrong correction is visible and reversible while a stonewalled
 * author is neither.
 */
export async function createClaim(db: Db, artifactId: number, userId: number, now = Date.now()): Promise<void> {
  await db.execute({
    sql: 'insert or ignore into claims (artifact_id, user_id, created_at) values (?, ?, ?)',
    args: [artifactId, userId, now],
  });
  // coalesce so the first claimant stays recorded rather than being replaced.
  await db.execute({
    sql: 'update artifacts set claimed_by = coalesce(claimed_by, ?) where id = ?',
    args: [userId, artifactId],
  });
}

export async function getClaim(db: Db, artifactId: number, userId: number): Promise<Claim | null> {
  const r = await db.execute({
    sql: 'select * from claims where artifact_id = ? and user_id = ?',
    args: [artifactId, userId],
  });
  return (r.rows[0] as unknown as Claim) ?? null;
}

/** Put an artifact back in the queue, e.g. after its source url was corrected. */
export async function requeue(db: Db, artifactId: number): Promise<void> {
  await db.execute({
    sql: `update artifacts set queue_status = 'pending' where id = ?`,
    args: [artifactId],
  });
}

export async function setSourceUrl(
  db: Db,
  artifactId: number,
  url: string,
  status: SourceStatus,
): Promise<void> {
  await db.execute({
    sql: 'update artifacts set source_url = ?, source_status = ? where id = ?',
    args: [url, status, artifactId],
  });
}

/**
 * Stamp an artifact as notified, returning false if it already was.
 *
 * Until this is set the artifact page renders `noindex`. That is the "notify
 * before publishing" rule enforced rather than merely intended: a page about
 * someone's work should not be findable before they have been told it exists.
 */
export async function markNotified(db: Db, slug: string, now = Date.now()): Promise<boolean> {
  const r = await db.execute({
    sql: 'update artifacts set notified_at = ? where slug = ? and notified_at is null',
    args: [now, slug],
  });
  return r.rowsAffected > 0;
}
