#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { connect, insertArtifact, migrate, slugify, countArtifacts } from '@sorrycheck/db';
import { classifySource } from '@sorrycheck/analyzer';

/**
 * Bulk importer.
 *
 * Rows are written straight to the database as `pending` and drained by the
 * worker. They deliberately do NOT go through the HTTP submit path: that
 * resolves each entry over the network as it arrives and caps out in the low
 * hundreds — the lesson rssamplifier already paid for.
 *
 *   pnpm --filter @sorrycheck/worker import seed/artifacts.json
 *
 * The file is a JSON array of:
 *   {"title": "...", "authors": "...", "paperUrl": "...", "sourceUrl": "..."}
 */
interface SeedRow {
  title: string;
  authors?: string;
  venue?: string;
  paperUrl?: string;
  sourceUrl?: string;
  slug?: string;
}

async function main(): Promise<void> {
  const path = process.argv[2];
  if (!path) {
    console.error('usage: import <file.json>');
    process.exit(2);
  }

  const rows = JSON.parse(await readFile(path, 'utf8')) as SeedRow[];
  if (!Array.isArray(rows)) {
    console.error('the seed file must contain a JSON array');
    process.exit(2);
  }

  const db = connect();
  await migrate(db);

  let written = 0;
  const seen = new Set<string>();

  for (const row of rows) {
    if (!row?.title?.trim()) continue;

    // Slugs must be unique; a duplicate title gets a numeric suffix rather than
    // silently overwriting the earlier artifact.
    let slug = row.slug?.trim() || slugify(row.title);
    if (seen.has(slug)) {
      let n = 2;
      while (seen.has(`${slug}-${n}`)) n++;
      slug = `${slug}-${n}`;
    }
    seen.add(slug);

    await insertArtifact(db, {
      slug,
      title: row.title.trim(),
      authors: row.authors ?? '',
      venue: row.venue ?? null,
      paperUrl: row.paperUrl ?? null,
      sourceUrl: row.sourceUrl ?? null,
      sourceStatus: classifySource(row.sourceUrl, true),
      queueStatus: 'pending',
    });
    written++;

    if (written % 250 === 0) console.log(`[import] ${written}/${rows.length}`);
  }

  const counts = await countArtifacts(db);
  console.log(
    `[import] wrote ${written} row(s); registry now holds ${counts.total} artifacts (${counts.pending} pending)`,
  );
}

main().catch((err) => {
  console.error('[import] failed', err);
  process.exit(1);
});
