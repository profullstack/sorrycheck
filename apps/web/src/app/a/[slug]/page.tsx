import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  connect,
  coverageFor,
  declarationsFor,
  getArtifact,
  latestCheck,
} from '@sorrycheck/db';
import { STATIC_SCOPE_NOTE, TONE_CLASSES, verdictFor } from '@/lib/verdict';
import { siteUrl } from '@/lib/site';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const db = connect();
  const artifact = await getArtifact(db, slug);
  if (!artifact) return { title: 'Not found' };

  return {
    title: artifact.title,
    description: `Verification status of ${artifact.title}.`,
    // An unclaimed page stays out of search until its authors have been told it
    // exists. Notify before publishing is the policy; this enforces it.
    ...(artifact.notified_at ? {} : { robots: { index: false, follow: true } }),
  };
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

export default async function ArtifactPage({ params }: Params) {
  const { slug } = await params;
  const db = connect();
  const artifact = await getArtifact(db, slug);
  if (!artifact) notFound();

  const check = await latestCheck(db, artifact.id);
  const verdict = verdictFor(artifact, check);
  const declarations = check ? await declarationsFor(db, check.id) : [];
  const coverage = check ? await coverageFor(db, check.id) : null;

  const coverageDetail = coverage?.detail
    ? (JSON.parse(coverage.detail) as {
        matches: Array<{ result: { label: string }; declaration: string; method: string }>;
        unmatched: Array<{ label: string }>;
      })
    : null;

  const badge = `${siteUrl()}/badge/${artifact.slug}.svg`;

  return (
    <article className="flex flex-col gap-10 py-12">
      <header className="flex flex-col gap-4">
        <h1 className="text-4xl font-semibold tracking-tight">{artifact.title}</h1>
        {artifact.authors ? <p className="text-muted-foreground">{artifact.authors}</p> : null}

        <div className={`rounded-md border p-4 ${TONE_CLASSES[verdict.tone]}`}>
          <p className="font-medium">{verdict.label}</p>
          <p className="mt-1 text-sm opacity-90">{verdict.detail}</p>
        </div>

        {artifact.author_note ? (
          <div className="rounded-md border-l-4 border-l-foreground/40 bg-muted/30 p-4">
            <p className="text-sm font-medium">A note from the authors</p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
              {artifact.author_note}
            </p>
          </div>
        ) : null}
      </header>

      <dl className="grid gap-4 sm:grid-cols-2">
        <Field label="Paper">
          {artifact.paper_url ? (
            <a href={artifact.paper_url} className="underline underline-offset-4">
              {artifact.paper_url}
            </a>
          ) : (
            <span className="text-muted-foreground">not recorded</span>
          )}
        </Field>
        <Field label="Source">
          {artifact.source_url ? (
            <a href={artifact.source_url} className="underline underline-offset-4">
              {artifact.source_url}
            </a>
          ) : (
            <span className="text-muted-foreground">none published</span>
          )}
        </Field>
        <Field label="Proof system">{check?.system ?? <span className="text-muted-foreground">—</span>}</Field>
        <Field label="Files read">
          {check ? (
            check.files_available > check.files_scanned ? (
              <span>
                {check.files_scanned} of {check.files_available}{' '}
                <span className="text-muted-foreground">— a partial read, capped by size</span>
              </span>
            ) : (
              `${check.files_scanned}`
            )
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </Field>
        <Field label="Last checked">
          {artifact.last_checked_at ? (
            new Date(artifact.last_checked_at).toISOString().slice(0, 10)
          ) : (
            <span className="text-muted-foreground">not yet</span>
          )}
        </Field>
      </dl>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold tracking-tight">What was measured</h2>
        <div className="rounded-md border bg-muted/30 p-4 text-sm text-muted-foreground">
          <p>{STATIC_SCOPE_NOTE}</p>
          <p className="mt-3">
            The build and axiom probe have <strong>not run</strong>: that needs a sandbox which
            executes untrusted third-party code, and it is not built yet. No exit code is recorded
            for this artifact, and nothing on this page should be read as a build result.
          </p>
        </div>
      </section>

      {coverage ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold tracking-tight">Coverage</h2>
          <p className="text-sm">
            <span className="font-mono text-lg">
              {coverage.matched_count} / {coverage.asserted_count}
            </span>{' '}
            asserted results matched to a declaration
            {coverage.method ? ` by ${coverage.method.split(',').join(' and ')}` : ''}.
          </p>
          <p className="text-sm text-muted-foreground">
            An unmatched result means our matcher did not find a declaration for it. It does not
            mean the result is unproven — we cannot tell those apart, and we do not guess.{' '}
            {artifact.claimed_by
              ? 'The authors can correct this mapping.'
              : 'Authors can claim this page and supply the mapping directly.'}
          </p>
          {coverageDetail?.unmatched.length ? (
            <p className="text-sm text-muted-foreground">
              Not matched: {coverageDetail.unmatched.map((u) => u.label).join(', ')}
            </p>
          ) : null}
        </section>
      ) : null}

      {declarations.length ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold tracking-tight">
            Declarations ({declarations.length})
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-2 pr-4 font-medium">Name</th>
                  <th className="py-2 pr-4 font-medium">Kind</th>
                  <th className="py-2 pr-4 font-medium">Location</th>
                  <th className="py-2 font-medium">Placeholder in source</th>
                </tr>
              </thead>
              <tbody>
                {declarations.map((d) => (
                  <tr key={`${d.file}:${d.line}:${d.name}`} className="border-t">
                    <td className="py-2 pr-4 font-mono">{d.name}</td>
                    <td className="py-2 pr-4 text-muted-foreground">{d.kind}</td>
                    <td className="py-2 pr-4 font-mono text-xs text-muted-foreground">
                      {d.file}:{d.line}
                    </td>
                    <td className="py-2">
                      {d.is_axiom ? (
                        <span className="text-muted-foreground">axiom — assumed</span>
                      ) : d.has_sorry ? (
                        <span className="text-amber-700 dark:text-amber-400">yes</span>
                      ) : (
                        <span className="text-muted-foreground">no</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold tracking-tight">Badge</h2>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/badge/${artifact.slug}.svg`} alt={`sorrycheck status for ${artifact.title}`} />
        <pre className="overflow-x-auto rounded-md border bg-muted/30 p-4 font-mono text-xs">
          {`[![sorrycheck](${badge})](${siteUrl()}/a/${artifact.slug})`}
        </pre>
      </section>

      <footer className="flex flex-col gap-2 border-t pt-6 text-sm text-muted-foreground">
        <p>
          Something wrong here?{' '}
          <Link href={`/submit?slug=${artifact.slug}`} className="underline underline-offset-4">
            Claim this page, attach a repository, or send a correction
          </Link>
          .
        </p>
        <p>
          Every verdict is keyed to a source location and re-runnable. We report mechanical facts
          only, and never a judgement about the work or its authors.
        </p>
      </footer>
    </article>
  );
}
