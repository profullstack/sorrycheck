import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GithubError, GithubRateLimited } from '../dist/github.js';
import { shards, fromRepo } from '../dist/discover.js';

/**
 * Rate limiting must be distinguishable from a real failure, because the checker
 * treats the two completely differently: a failure marks the artifact skipped
 * forever, a rate limit leaves it pending.
 */
test('a rate limit is a distinct type from a request failure', () => {
  const limited = new GithubRateLimited(30_000);
  const failed = new GithubError('nope', 404);

  assert.ok(limited instanceof GithubRateLimited);
  assert.ok(!(failed instanceof GithubRateLimited));
  assert.ok(!(limited instanceof GithubError));
  assert.equal(limited.retryAfterMs, 30_000);
  assert.equal(failed.status, 404);
  assert.match(limited.message, /retry in 30s/);
});

test('shards cover every language and stay under the 1000-result cap', () => {
  const queries = shards();
  assert.equal(queries.length, 24, '3 languages x 8 date windows');
  for (const language of ['Lean', 'Coq', 'Isabelle']) {
    assert.ok(queries.some((q) => q.startsWith(`language:${language} `)));
  }
  // Every shard must constrain by date, or it hits the cap and silently truncates.
  assert.ok(queries.every((q) => q.includes('pushed:')));
  assert.equal(new Set(queries).size, queries.length, 'no duplicate shards');
});

test('a repository becomes an artifact with its source url', () => {
  const discovered = fromRepo({
    full_name: 'owner/repo',
    html_url: 'https://github.com/owner/repo',
    description: 'a formalization',
    owner: { login: 'owner' },
    homepage: 'https://example.com/paper',
    stargazers_count: 12,
  });
  assert.equal(discovered.title, 'owner/repo');
  assert.equal(discovered.authors, 'owner');
  assert.equal(discovered.sourceUrl, 'https://github.com/owner/repo');
  assert.equal(discovered.paperUrl, 'https://example.com/paper');
});

test('a junk homepage is not recorded as a paper url', () => {
  const discovered = fromRepo({
    full_name: 'owner/repo',
    html_url: 'https://github.com/owner/repo',
    description: null,
    owner: { login: 'owner' },
    homepage: 'not a url',
    stargazers_count: 0,
  });
  assert.equal(discovered.paperUrl, undefined);
});
