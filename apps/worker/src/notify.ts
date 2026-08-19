#!/usr/bin/env node
import { connect, getArtifact, markNotified, migrate } from '@sorrycheck/db';

/**
 * Tell an artifact's authors that a page exists, before it becomes findable.
 *
 *   pnpm --filter @sorrycheck/worker notify <slug> <email> [--dry-run]
 *
 * The fairness policy says notify before publishing, and the artifact page
 * renders `noindex` until `notified_at` is stamped. This is the only thing that
 * stamps it, so a page cannot become indexable without someone having been told.
 *
 * Address discovery is deliberately NOT automated. A crawled GitHub repository
 * or arXiv listing does not carry a contact address we have any right to guess
 * at, and mailing a scraped address would be exactly the behaviour that makes a
 * registry read as a shaming tool. The address is supplied by a human here.
 */
async function main(): Promise<void> {
  const [slug, email, ...rest] = process.argv.slice(2);
  const dryRun = rest.includes('--dry-run');

  if (!slug || !email || !email.includes('@')) {
    console.error('usage: notify <slug> <email> [--dry-run]');
    process.exit(2);
  }

  const db = connect();
  await migrate(db);

  const artifact = await getArtifact(db, slug);
  if (!artifact) {
    console.error(`no artifact "${slug}"`);
    process.exit(1);
  }

  const base = process.env['SITE_URL'] ?? 'https://sorrycheck.com';
  const url = `${base}/a/${artifact.slug}`;

  const subject = `sorrycheck has a page for "${artifact.title}"`;
  const text = `We generated a page about the formalization for "${artifact.title}":

  ${url}

sorrycheck publishes mechanical facts about artifacts that claim a machine-checked
proof: which declarations exist in the published source, which contain a
placeholder token, and how many of a paper's numbered results we could match to a
declaration. It does not judge the work, and it does not run builds.

We are telling you before the page becomes findable. Until you have seen it, the
page is not indexed by search engines.

If anything is wrong, you can fix it directly:

  ${base}/submit?slug=${artifact.slug}

Attaching a repository turns "no source published" into a real reading of your
formalization. A sorrycheck.toml in the repository maps your paper's numbered
results to declarations so coverage is exact rather than inferred. You can also
add a note that renders above the fold on the page.

We would rather publish your correction than our guess.

— sorrycheck, by Profullstack, Inc.
`;

  if (dryRun) {
    console.log(`[notify] would email ${email}\n\nSubject: ${subject}\n\n${text}`);
    return;
  }

  const key = process.env['RESEND_API_KEY'];
  if (!key) {
    console.error('[notify] RESEND_API_KEY is not set — refusing to stamp notified_at without sending');
    process.exit(1);
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: process.env['MAIL_FROM'] ?? 'sorrycheck <hello@sorrycheck.com>',
      to: email,
      subject,
      text,
    }),
  });

  // Only stamp after the provider accepted it. Stamping on a failed send would
  // make the page indexable while nobody had actually been told.
  if (!response.ok) {
    console.error(`[notify] send failed: ${response.status} ${await response.text().catch(() => '')}`);
    process.exit(1);
  }

  const stamped = await markNotified(db, artifact.slug);
  console.log(
    `[notify] emailed ${email} about ${artifact.slug}` +
      (stamped ? ' and stamped notified_at' : ' (already notified previously)'),
  );
}

main().catch((err) => {
  console.error('[notify] failed', err);
  process.exit(1);
});
