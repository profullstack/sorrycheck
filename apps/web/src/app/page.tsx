import Link from 'next/link';
import { connect, countArtifacts, listArtifacts } from '@sorrycheck/db';
import { TONE_CLASSES, verdictFor } from '@/lib/verdict';
import { site } from '@/lib/site';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ q?: string }>;
}

export default async function Home({ searchParams }: Props) {
  const { q } = await searchParams;
  const db = connect();

  // A cold database is the normal state before the first import, so the page
  // degrades to the explanation rather than to a stack trace.
  let artifacts: Awaited<ReturnType<typeof listArtifacts>> = [];
  let counts = { total: 0, checked: 0, pending: 0 };
  try {
    [artifacts, counts] = await Promise.all([
      listArtifacts(db, { ...(q ? { query: q } : {}), limit: 40, passingFirst: true }),
      countArtifacts(db),
    ]);
  } catch {
    /* registry not migrated yet */
  }

  return (
    <div className="flex flex-col gap-12 py-12">
      <section className="flex flex-col items-start gap-5">
        <p className="text-sm font-medium text-muted-foreground">Verification registry</p>
        <h1 className="max-w-3xl text-balance text-5xl font-semibold tracking-tight sm:text-6xl">
          {site.tagline}
        </h1>
        <p className="max-w-2xl text-lg text-muted-foreground">
          &ldquo;Verified in Lean 4&rdquo; has become a credibility badge, and almost nobody audits
          it. sorrycheck reads artifacts that claim a machine-checked proof and publishes what is
          actually true about them — mechanical facts, re-derivable by anyone.
        </p>
        <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
          <span>{counts.total} artifacts</span>
          <span>·</span>
          <span>{counts.checked} checked</span>
          <span>·</span>
          <span>{counts.pending} queued</span>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <form action="/" className="flex gap-2">
          <input
            name="q"
            defaultValue={q ?? ''}
            placeholder="Search by title, author or slug"
            className="h-10 w-full max-w-md rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <button
            type="submit"
            className="h-10 rounded-md border px-4 text-sm font-medium hover:bg-muted"
          >
            Search
          </button>
        </form>

        {artifacts.length === 0 ? (
          <p className="text-muted-foreground">
            {q
              ? `Nothing matched “${q}”.`
              : 'No artifacts have been imported yet. Run the seed importer to populate the registry.'}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {artifacts.map((artifact) => {
              const verdict = verdictFor(artifact, {
                sorry_total: artifact.sorry_total ?? 0,
                declarations_total: artifact.declarations_total ?? 0,
                system: artifact.system,
              } as never);
              return (
                <li key={artifact.slug}>
                  <Link
                    href={`/a/${artifact.slug}`}
                    className="flex flex-col gap-1 rounded-md border p-4 hover:bg-muted/40"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-medium">{artifact.title}</span>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-xs ${TONE_CLASSES[verdict.tone]}`}
                      >
                        {verdict.label}
                      </span>
                    </div>
                    {artifact.authors ? (
                      <span className="text-sm text-muted-foreground">{artifact.authors}</span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3 border-t pt-8">
        <h2 className="text-xl font-semibold tracking-tight">How this registry behaves</h2>
        <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
          <li>
            We report mechanical facts, never verdicts on people. &ldquo;No source published&rdquo;
            is a fixable fact about a link, not a claim about anyone&rsquo;s honesty.
          </li>
          <li>
            Neutral states stay neutral. A missing repository renders grey, and the page says how to
            attach one.
          </li>
          <li>
            Authors can claim a page, correct the mapping, add a note that renders above the fold,
            and trigger a re-check.
          </li>
          <li>
            An unmatched result is reported as unmatched, never as unproven. We cannot tell those
            apart, so we do not guess.
          </li>
        </ul>
        <p className="text-sm">
          <Link href="/docs" className="underline underline-offset-4">
            Read what is and is not measured →
          </Link>
        </p>
      </section>
    </div>
  );
}
