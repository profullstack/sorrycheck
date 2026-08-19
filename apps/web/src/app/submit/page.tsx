import type { Metadata } from 'next';
import { SubmitForm } from '@/components/submit-form';

export const metadata: Metadata = {
  title: 'Submit or correct an artifact',
  description: 'Add an artifact to the registry, or attach a repository to one that is missing it.',
};

interface Props {
  searchParams: Promise<{ slug?: string }>;
}

export default async function SubmitPage({ searchParams }: Props) {
  const { slug } = await searchParams;

  return (
    <div className="flex max-w-2xl flex-col gap-8 py-12">
      <div className="flex flex-col gap-3">
        <h1 className="text-4xl font-semibold tracking-tight">
          {slug ? 'Correct this artifact' : 'Submit an artifact'}
        </h1>
        <p className="text-lg text-muted-foreground">
          {slug
            ? 'Attach a repository, fix the metadata, or tell us what we got wrong. A corrected artifact is re-checked from scratch.'
            : 'Add a paper or repository that claims a machine-checked formalization. It is queued and checked automatically.'}
        </p>
      </div>

      <SubmitForm {...(slug ? { slug } : {})} />

      <div className="flex flex-col gap-2 rounded-md border bg-muted/30 p-4 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">If this is your work</p>
        <p>
          Attaching a repository changes a page from &ldquo;no source published&rdquo; to a real
          reading of your formalization, and you can supply a{' '}
          <code className="font-mono">sorrycheck.toml</code> mapping your paper&rsquo;s numbered
          results to declarations so coverage is exact rather than guessed:
        </p>
        <pre className="overflow-x-auto rounded-md border bg-background p-3 font-mono text-xs">
          {`[results]
"theorem 10.2" = "Paper.MainResult"
"lemma 3" = "Paper.helper"`}
        </pre>
        <p>
          You can also add a note that renders above the fold on your artifact page. We would rather
          publish your correction than our guess.
        </p>
      </div>
    </div>
  );
}
