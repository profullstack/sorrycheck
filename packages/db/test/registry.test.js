import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { migrate } from '../dist/migrate.js';
import {
  claimPending,
  countArtifacts,
  coverageFor,
  declarationsFor,
  getArtifact,
  insertArtifact,
  latestCheck,
  listArtifacts,
  markSkipped,
  recordCheck,
  setAuthorNote,
  slugify,
} from '../dist/registry.js';

async function freshDb(t) {
  const dir = await mkdtemp(join(tmpdir(), 'registry-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const db = createClient({ url: `file:${join(dir, 'test.db')}` });
  await migrate(db);
  return db;
}

test('slugify produces stable url-safe slugs', () => {
  assert.equal(slugify('The Logic of AGI: A Modal Account'), 'the-logic-of-agi-a-modal-account');
  assert.equal(slugify('   '), 'artifact');
  assert.ok(slugify('x'.repeat(200)).length <= 80);
});

test('inserting is idempotent and never clobbers a corrected row', async (t) => {
  const db = await freshDb(t);
  await insertArtifact(db, { slug: 'a', title: 'First', sourceUrl: 'https://github.com/o/r' });
  await insertArtifact(db, { slug: 'a', title: 'Overwritten?', sourceUrl: null });

  const artifact = await getArtifact(db, 'a');
  assert.equal(artifact.title, 'First');
  assert.equal(artifact.source_url, 'https://github.com/o/r');
  assert.equal((await countArtifacts(db)).total, 1);
});

test('pending artifacts are drained oldest first and can be skipped', async (t) => {
  const db = await freshDb(t);
  await insertArtifact(db, { slug: 'old', title: 'Old' }, 1000);
  await insertArtifact(db, { slug: 'new', title: 'New' }, 2000);

  const batch = await claimPending(db, 10);
  assert.deepEqual(batch.map((a) => a.slug), ['old', 'new']);

  await markSkipped(db, batch[0].id);
  assert.deepEqual((await claimPending(db, 10)).map((a) => a.slug), ['new']);
  assert.equal((await countArtifacts(db)).pending, 1);
});

test('a recorded check stores declarations, coverage, and leaves exit_code null', async (t) => {
  const db = await freshDb(t);
  await insertArtifact(db, { slug: 'x', title: 'X' });
  const artifact = await getArtifact(db, 'x');

  const checkId = await recordCheck(db, {
    artifactId: artifact.id,
    kind: 'static',
    system: 'lean4',
    declarationsTotal: 2,
    sorryTotal: 1,
    axiomsTotal: 0,
    filesScanned: 1,
    filesAvailable: 1,
    summary: '2 declarations found in 1 file; 1 contains a placeholder in source.',
    commitSha: 'abc123',
    declarations: [
      { name: 'thm_a', kind: 'theorem', file: 'M.lean', line: 1, hasSorry: false, isAxiom: false },
      { name: 'thm_b', kind: 'theorem', file: 'M.lean', line: 5, hasSorry: true, isAxiom: false },
    ],
    coverage: {
      assertedCount: 3,
      matchedCount: 2,
      method: 'docstring-reference',
      detail: JSON.stringify({ matches: [], unmatched: [{ label: 'theorem 9' }] }),
    },
  });

  const check = await latestCheck(db, artifact.id);
  assert.equal(check.id, checkId);
  assert.equal(check.system, 'lean4');
  assert.equal(check.commit_sha, 'abc123');
  assert.equal(
    check.exit_code,
    null,
    'nothing was executed, so there is no exit code — null means NOT RUN',
  );

  const declarations = await declarationsFor(db, checkId);
  assert.deepEqual(declarations.map((d) => [d.name, d.has_sorry]), [
    ['thm_a', 0],
    ['thm_b', 1],
  ]);

  const coverage = await coverageFor(db, checkId);
  assert.equal(coverage.matched_count, 2);
  assert.equal(coverage.method, 'docstring-reference');

  const after = await getArtifact(db, 'x');
  assert.equal(after.queue_status, 'checked');
  assert.ok(after.last_checked_at > 0);
});

test('the latest check wins when an artifact is re-checked', async (t) => {
  const db = await freshDb(t);
  await insertArtifact(db, { slug: 'y', title: 'Y' });
  const artifact = await getArtifact(db, 'y');

  const base = {
    artifactId: artifact.id,
    kind: 'static',
    system: 'lean4',
    axiomsTotal: 0,
    filesScanned: 1,
    filesAvailable: 1,
    declarations: [],
    coverage: null,
  };
  await recordCheck(db, { ...base, declarationsTotal: 1, sorryTotal: 1, summary: 'first' }, 1000);
  await recordCheck(db, { ...base, declarationsTotal: 1, sorryTotal: 0, summary: 'second' }, 2000);

  const check = await latestCheck(db, artifact.id);
  assert.equal(check.summary, 'second');
  assert.equal(check.sorry_total, 0);
});

test('the listing leads with artifacts that check out clean', async (t) => {
  const db = await freshDb(t);
  for (const [slug, sorry] of [
    ['dirty', 2],
    ['clean', 0],
  ]) {
    await insertArtifact(db, { slug, title: slug });
    const a = await getArtifact(db, slug);
    await recordCheck(
      db,
      {
        artifactId: a.id,
        kind: 'static',
        system: 'lean4',
        declarationsTotal: 5,
        sorryTotal: sorry,
        axiomsTotal: 0,
        filesScanned: 1,
        filesAvailable: 1,
        summary: '',
        declarations: [],
        coverage: null,
      },
      3000,
    );
  }

  const rows = await listArtifacts(db, { passingFirst: true });
  assert.equal(rows[0].slug, 'clean', 'the front page must not open on failures');
});

test('search matches title, author and slug', async (t) => {
  const db = await freshDb(t);
  await insertArtifact(db, { slug: 'logic-of-agi', title: 'The Logic of AGI', authors: 'Kocabay' });
  await insertArtifact(db, { slug: 'other', title: 'Something Else', authors: 'Nobody' });

  assert.deepEqual((await listArtifacts(db, { query: 'Logic' })).map((r) => r.slug), ['logic-of-agi']);
  assert.deepEqual((await listArtifacts(db, { query: 'Kocabay' })).map((r) => r.slug), ['logic-of-agi']);
  assert.deepEqual((await listArtifacts(db, { query: 'zzz' })).map((r) => r.slug), []);
});

test('an author note can be attached and read back', async (t) => {
  const db = await freshDb(t);
  await insertArtifact(db, { slug: 'z', title: 'Z' });
  await setAuthorNote(db, 'z', 'Appendix D.1 is the accurate statement of coverage.');
  assert.equal((await getArtifact(db, 'z')).author_note, 'Appendix D.1 is the accurate statement of coverage.');
});
