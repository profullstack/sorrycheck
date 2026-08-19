#!/usr/bin/env node
import { connect, countArtifacts, insertArtifact, migrate, slugify } from '@sorrycheck/db';
import { classifySource } from '@sorrycheck/analyzer';
import { fromRepo, RateLimited, searchArxiv, searchRepos, shards, type Discovered } from './discover.js';

/**
 * Corpus discovery.
 *
 *   pnpm --filter @sorrycheck/worker crawl [--target 4000] [--no-arxiv]
 *
 * Rows are written straight to the database as `pending` and drained by the
 * checker. They deliberately do NOT go through the HTTP submit path, which
 * resolves each entry over the network as it arrives and caps out in the low
 * hundreds.
 *
 * Set GITHUB_TOKEN to raise the search limit from 10 requests/minute to 30. A
 * scopeless token is enough: only public repositories are read.
 */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Options {
  target: number;
  arxiv: boolean;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Options {
  const options: Options = { target: 4000, arxiv: true, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--target') options.target = Number(argv[++i]);
    else if (argv[i] === '--no-arxiv') options.arxiv = false;
    else if (argv[i] === '--dry-run') options.dryRun = true;
  }
  if (!Number.isFinite(options.target) || options.target <= 0) options.target = 4000;
  return options;
}

/** Retry a search through rate limiting rather than abandoning the shard. */
async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof RateLimited) {
        const wait = Math.min(err.retryAfterMs + 1000, 120_000);
        console.log(`[crawl] rate limited on ${label}; waiting ${Math.round(wait / 1000)}s`);
        await sleep(wait);
        continue;
      }
      console.error(`[crawl] ${label} failed:`, err instanceof Error ? err.message : err);
      return null;
    }
  }
  return null;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const db = connect();
  await migrate(db);

  const before = await countArtifacts(db);
  console.log(
    `[crawl] target ${options.target}; registry currently holds ${before.total} artifacts` +
      (process.env['GITHUB_TOKEN'] ? '' : ' (no GITHUB_TOKEN — search is limited to 10 req/min)'),
  );

  const seen = new Set<string>();
  const queue: Discovered[] = [];

  for (const query of shards()) {
    if (queue.length >= options.target) break;

    for (let page = 1; page <= 10; page++) {
      if (queue.length >= options.target) break;

      const result = await withRetry(() => searchRepos(query, page), `${query} p${page}`);
      if (!result) break;

      for (const item of result.items) {
        if (seen.has(item.full_name)) continue;
        seen.add(item.full_name);
        queue.push(fromRepo(item));
      }

      console.log(
        `[crawl] ${query} p${page}: +${result.items.length} (${queue.length}/${options.target})`,
      );

      // GitHub's search cap: no query returns more than 1,000 results, so pages
      // past the last populated one are wasted requests against a tight limit.
      if (result.items.length < 100) break;
      await sleep(2500);
    }
  }

  if (options.arxiv && queue.length < options.target) {
    for (let start = 0; start < 500 && queue.length < options.target; start += 100) {
      const found = await withRetry(() => searchArxiv(start), `arxiv ${start}`);
      if (!found?.length) break;
      for (const paper of found) {
        const key = paper.paperUrl ?? paper.title;
        if (seen.has(key)) continue;
        seen.add(key);
        queue.push(paper);
      }
      console.log(`[crawl] arxiv ${start}: +${found.length} (${queue.length}/${options.target})`);
      await sleep(3000);
    }
  }

  if (options.dryRun) {
    console.log(`[crawl] dry run — discovered ${queue.length}, wrote nothing`);
    for (const item of queue.slice(0, 5)) console.log(`  ${item.title} — ${item.sourceUrl || '(no source)'}`);
    return;
  }

  const slugs = new Set<string>();
  let written = 0;

  for (const item of queue) {
    let slug = slugify(item.title);
    if (slugs.has(slug)) {
      let n = 2;
      while (slugs.has(`${slug}-${n}`)) n++;
      slug = `${slug}-${n}`;
    }
    slugs.add(slug);

    await insertArtifact(db, {
      slug,
      title: item.title,
      authors: item.authors,
      venue: item.venue ?? null,
      paperUrl: item.paperUrl ?? null,
      sourceUrl: item.sourceUrl || null,
      sourceStatus: classifySource(item.sourceUrl, true),
      queueStatus: 'pending',
    });
    written++;
    if (written % 250 === 0) console.log(`[crawl] wrote ${written}/${queue.length}`);
  }

  const after = await countArtifacts(db);
  console.log(
    `[crawl] discovered ${queue.length}, wrote ${written}; registry now holds ${after.total} artifacts (${after.pending} pending)`,
  );
}

main().catch((err) => {
  console.error('[crawl] failed', err);
  process.exit(1);
});
