import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeStatic,
  classifySource,
  detectSystem,
  extractAssertedResults,
  matchCoverage,
  parseMappingToml,
  parseSourceUrl,
  summarize,
} from '../dist/index.js';

test('numbered results are extracted, deduplicated and sorted', () => {
  const paper = `We prove Theorem 10.2 and Theorem 10.5. Lemma 3 is used throughout.
  As noted, Theorem 10.2 follows from Proposition 4.1. Corollary 2 is immediate.`;
  const results = extractAssertedResults(paper);
  assert.deepEqual(
    results.map((r) => r.label),
    ['corollary 2', 'lemma 3', 'proposition 4.1', 'theorem 10.2', 'theorem 10.5'],
  );
});

test('prose without a number is not counted as an asserted result', () => {
  const results = extractAssertedResults('By the theorem above and our main lemma, the result holds.');
  assert.deepEqual(results, []);
});

test('an author mapping is exact and wins over the other methods', () => {
  const toml = `# my mapping
[results]
"theorem 10.2" = "Paper.MainResult"
"lemma 3" = "Paper.helper"

[other]
"theorem 1" = "ignored"
`;
  const mapping = parseMappingToml(toml);
  assert.equal(mapping.get('theorem 10.2'), 'Paper.MainResult');
  assert.equal(mapping.get('lemma 3'), 'Paper.helper');
  assert.equal(mapping.has('theorem 1'), false, 'only the [results] table is read');

  const coverage = matchCoverage(
    extractAssertedResults('Theorem 10.2 and Lemma 3.'),
    [
      { name: 'Paper.MainResult', kind: 'theorem', file: 'P.lean', line: 1, hasSorryToken: false, isAxiom: false },
      { name: 'Paper.helper', kind: 'lemma', file: 'P.lean', line: 5, hasSorryToken: false, isAxiom: false },
    ],
    mapping,
  );
  assert.equal(coverage.matchedCount, 2);
  assert.deepEqual(coverage.methods, ['declared-mapping']);
  assert.ok(coverage.matches.every((m) => m.confidence === 1));
});

test('a mapping pointing at a declaration that does not exist does not match', () => {
  const coverage = matchCoverage(
    extractAssertedResults('Theorem 1.'),
    [],
    new Map([['theorem 1', 'Nope.Missing']]),
  );
  assert.equal(coverage.matchedCount, 0);
  assert.deepEqual(coverage.unmatched.map((r) => r.label), ['theorem 1']);
});

test('a docstring reference matches and records the method', () => {
  const coverage = matchCoverage(extractAssertedResults('Theorem 10.5 is the main result.'), [
    {
      name: 'Paper.whatever',
      kind: 'theorem',
      file: 'P.lean',
      line: 1,
      hasSorryToken: false,
      isAxiom: false,
      docstring: 'This is Theorem 10.5 from the paper.',
    },
  ]);
  assert.equal(coverage.matchedCount, 1);
  assert.deepEqual(coverage.methods, ['docstring-reference']);
  assert.equal(coverage.matches[0].declaration, 'Paper.whatever');
});

test('name similarity matches thm_10_2 to Theorem 10.2', () => {
  const coverage = matchCoverage(extractAssertedResults('Theorem 10.2 holds.'), [
    { name: 'Paper.thm_10_2', kind: 'theorem', file: 'P.lean', line: 1, hasSorryToken: false, isAxiom: false },
  ]);
  assert.equal(coverage.matchedCount, 1);
  assert.deepEqual(coverage.methods, ['name-similarity']);
  assert.equal(coverage.matches[0].confidence, 0.6);
});

test('an unmatched result is reported as unmatched and never as unproven', () => {
  const coverage = matchCoverage(extractAssertedResults('Theorem 10.2 and Theorem 99.9.'), [
    { name: 'Paper.thm_10_2', kind: 'theorem', file: 'P.lean', line: 1, hasSorryToken: false, isAxiom: false },
  ]);
  assert.equal(coverage.assertedCount, 2);
  assert.equal(coverage.matchedCount, 1);
  assert.deepEqual(coverage.unmatched.map((r) => r.label), ['theorem 99.9']);
  // The shape carries no field that could be read as a claim about the author.
  assert.equal('unproven' in coverage, false);
  assert.equal('failed' in coverage, false);
});

test('a near-miss number does not match', () => {
  const coverage = matchCoverage(extractAssertedResults('Theorem 10.2.'), [
    { name: 'Paper.thm_10_3', kind: 'theorem', file: 'P.lean', line: 1, hasSorryToken: false, isAxiom: false },
  ]);
  assert.equal(coverage.matchedCount, 0);
});

test('github urls are parsed, including a pinned ref', () => {
  assert.deepEqual(parseSourceUrl('https://github.com/owner/repo'), {
    host: 'github',
    owner: 'owner',
    repo: 'repo',
    url: 'https://github.com/owner/repo',
  });
  assert.equal(parseSourceUrl('https://github.com/owner/repo/tree/abc123')?.ref, 'abc123');
  assert.equal(parseSourceUrl('https://github.com/owner/repo.git')?.repo, 'repo');
});

test('a non-source url is not mistaken for a published formalization', () => {
  assert.equal(parseSourceUrl('not a url'), null);
  assert.equal(parseSourceUrl('ftp://example.com/x'), null);
  assert.equal(classifySource('not a url', true), 'not_published');
  assert.equal(classifySource('', true), 'not_published');
  assert.equal(classifySource(null, true), 'not_published');
  assert.equal(classifySource('https://github.com/o/r', true), 'published');
  assert.equal(
    classifySource(null, false),
    'not_applicable',
    'a paper claiming no formalization is not graded',
  );
});

test('the proof system is detected from build files first', () => {
  assert.equal(detectSystem(['lakefile.lean', 'Main.lean']), 'lean4');
  assert.equal(detectSystem(['src/_CoqProject', 'src/M.v']), 'coq');
  assert.equal(detectSystem(['ROOT', 'M.thy']), 'isabelle');
  assert.equal(detectSystem(['README.md']), null);
  assert.equal(detectSystem(['notes/scratch.lean']), 'lean4', 'a bare source file still counts');
});

test('the whole static pass reports declarations, holes and coverage', () => {
  const analysis = analyzeStatic({
    files: [
      { path: 'lakefile.lean', content: 'import Lake' },
      {
        path: 'Paper/Main.lean',
        content: `/-- Theorem 10.2 of the paper. -/
theorem thm_10_2 : True := trivial

theorem thm_10_5 : False := by
  sorry

axiom assumed_thing : True
`,
      },
    ],
    paperText: 'We prove Theorem 10.2 and Theorem 10.5.',
  });

  assert.equal(analysis.system, 'lean4');
  assert.equal(analysis.filesScanned, 1);
  assert.equal(analysis.filesAvailable, 1);
  assert.deepEqual(analysis.sorryDeclarations, ['thm_10_5']);
  assert.deepEqual(analysis.axiomDeclarations, ['assumed_thing']);
  assert.equal(analysis.coverage.assertedCount, 2);
  assert.equal(analysis.coverage.matchedCount, 2);
});

test('no formalization found yields an empty, neutral analysis', () => {
  const analysis = analyzeStatic({ files: [{ path: 'README.md', content: '# hi' }] });
  assert.equal(analysis.system, null);
  assert.deepEqual(analysis.declarations, []);
  assert.equal(analysis.coverage, null);
  assert.equal(summarize(analysis), 'No formalization was found in the published source.');
});

test('a truncated read reports how much of the project was actually scanned', () => {
  const analysis = analyzeStatic({
    // Only one file's content was fetched, but the repository has four sources.
    files: [{ path: 'A.lean', content: 'theorem a : True := trivial\n' }],
    paths: ['lakefile.lean', 'A.lean', 'B.lean', 'C.lean', 'D.lean', 'README.md'],
  });

  assert.equal(analysis.filesScanned, 1);
  assert.equal(analysis.filesAvailable, 4, 'lakefile.lean and README.md are not source files');
  assert.match(
    summarize(analysis),
    /1 declaration found in 1 of 4 files/,
    'a partial scan must never be presented as a complete one',
  );
});

test('the summary states mechanical facts without judging the work', () => {
  const analysis = analyzeStatic({
    files: [
      { path: 'lakefile.lean', content: '' },
      { path: 'M.lean', content: 'theorem a : True := trivial\ntheorem b : False := by sorry\n' },
    ],
  });
  const text = summarize(analysis);
  assert.match(text, /2 declarations found in 1 file/);
  assert.match(text, /1 contains a placeholder in source/);
  for (const loaded of ['fake', 'fraud', 'false claim', 'dishonest', 'unverified', 'unproven']) {
    assert.doesNotMatch(text.toLowerCase(), new RegExp(loaded));
  }
});
