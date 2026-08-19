import {
  connect,
  migrate,
  claimPending,
  markSkipped,
  recordCheck,
  pruneExpired,
  type Artifact,
  type Db,
} from '@sorrycheck/db';
import { analyzeStatic, detectSystem, parseSourceUrl, summarize } from '@sorrycheck/analyzer';
import { fetchRepo, GithubError } from './github.js';

/**
 * The checker: drains the pending queue and records what a static pass can
 * establish about each artifact.
 *
 * This runs as a second process inside the SAME Railway container as the web
 * server (see docker-entrypoint.sh), not as its own service.
 *
 * What it does NOT do: build anything. `lake build` and `#print axioms` require
 * executing untrusted third-party code in a network-off, non-root, disposable
 * sandbox. That component does not exist yet, so every check is recorded with
 * kind='static' and a null exit_code, and every read path renders a null
 * exit_code as "not run" rather than as a failure.
 */
const INTERVAL = Number(process.env['WORKER_INTERVAL_MS'] ?? 60_000);
const BATCH = Number(process.env['WORKER_BATCH_SIZE'] ?? 5);

async function check(db: Db, artifact: Artifact): Promise<void> {
  const ref = artifact.source_url ? parseSourceUrl(artifact.source_url) : null;

  if (!ref || ref.host !== 'github' || !ref.owner || !ref.repo) {
    // Nothing to read. This is not a failing grade — it is the neutral state the
    // artifact page already shows, and the page says how to fix it.
    await markSkipped(db, artifact.id);
    console.log(`[checker] ${artifact.slug}: no readable source, left as ${artifact.source_status}`);
    return;
  }

  let snapshot;
  try {
    // Two passes: the tree first, so the system is known before any file is
    // fetched and we only pull the extension that matters.
    const probe = await fetchRepo(ref.owner, ref.repo, ref.ref, null, { maxFiles: 0 });
    const system = detectSystem(probe.paths);
    snapshot = system ? await fetchRepo(ref.owner, ref.repo, ref.ref, system) : probe;
  } catch (err) {
    if (err instanceof GithubError && (err.status === 404 || err.status === 451)) {
      await db.execute({
        sql: `update artifacts set source_status = 'unreachable', queue_status = 'checked', last_checked_at = ? where id = ?`,
        args: [Date.now(), artifact.id],
      });
      console.log(`[checker] ${artifact.slug}: source unreachable (${err.status})`);
      return;
    }
    throw err;
  }

  const analysis = analyzeStatic({
    files: snapshot.files,
    paths: snapshot.paths,
    ...(snapshot.mappingToml ? { mappingToml: snapshot.mappingToml } : {}),
  });

  await recordCheck(db, {
    artifactId: artifact.id,
    kind: 'static',
    system: analysis.system,
    declarationsTotal: analysis.declarations.filter((d) => !d.isAxiom).length,
    sorryTotal: analysis.sorryDeclarations.length,
    axiomsTotal: analysis.axiomDeclarations.length,
    filesScanned: analysis.filesScanned,
    filesAvailable: analysis.filesAvailable,
    summary: summarize(analysis),
    commitSha: snapshot.sha,
    declarations: analysis.declarations.map((d) => ({
      name: d.name,
      kind: d.kind,
      file: d.file,
      line: d.line,
      hasSorry: d.hasSorryToken,
      isAxiom: d.isAxiom,
    })),
    coverage: analysis.coverage
      ? {
          assertedCount: analysis.coverage.assertedCount,
          matchedCount: analysis.coverage.matchedCount,
          method: analysis.coverage.methods.join(','),
          detail: JSON.stringify({
            matches: analysis.coverage.matches,
            unmatched: analysis.coverage.unmatched,
          }),
        }
      : null,
  });

  if (artifact.source_status !== 'published') {
    await db.execute({
      sql: `update artifacts set source_status = 'published' where id = ?`,
      args: [artifact.id],
    });
  }

  console.log(`[checker] ${artifact.slug}: ${summarize(analysis)}`);
}

async function tick(db: Db): Promise<void> {
  const pruned = await pruneExpired(db);
  if (pruned.loginTokens || pruned.sessions) {
    console.log(`[checker] pruned ${pruned.loginTokens} token(s), ${pruned.sessions} session(s)`);
  }

  const batch = await claimPending(db, BATCH);
  if (batch.length === 0) return;

  console.log(`[checker] draining ${batch.length} pending artifact(s)`);
  for (const artifact of batch) {
    try {
      await check(db, artifact);
    } catch (err) {
      // One bad repository must not stall the queue behind it.
      console.error(`[checker] ${artifact.slug} failed`, err);
      await markSkipped(db, artifact.id);
    }
  }
}

async function main(): Promise<void> {
  const db = connect();
  const applied = await migrate(db);
  if (applied.length) console.log(`[checker] applied migrations: ${applied.join(', ')}`);
  console.log(`[checker] up, interval=${INTERVAL}ms, batch=${BATCH}`);

  for (;;) {
    try {
      await tick(db);
    } catch (err) {
      console.error('[checker] tick failed', err);
    }
    await new Promise((r) => setTimeout(r, INTERVAL));
  }
}

main().catch((err) => {
  console.error('[checker] fatal', err);
  process.exit(1);
});
