import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { site } from '@/lib/site';

const FEATURES = [
  { title: 'Does it build?', body: 'Every artifact is built in a sandbox against a pinned toolchain, with the exit code and full log published.' },
  { title: 'Any sorry left?', body: 'Per-declaration axiom probes surface sorryAx — the placeholder that type-checks but proves nothing.' },
  { title: 'Which axioms?', body: 'Anything beyond propext, Classical.choice and Quot.sound is named explicitly.' },
  { title: 'How much is covered?', body: "Asserted results in the paper against declarations actually checked, with the matching method shown." },
  { title: 'Is the source public?', body: 'A neutral, fixable state — not a grade. Authors can attach a repo and trigger a re-check.' },
  { title: 'Embed the badge', body: 'A shields-style endpoint for your README, so a clean result travels with the work.' },
];

export default function Home() {
  return (
    <>
      <section className="flex flex-col items-start gap-6 py-24">
        <p className="text-sm font-medium text-muted-foreground">Formal verification, audited</p>
        <h1 className="max-w-3xl text-balance text-5xl font-semibold tracking-tight sm:text-6xl">
          {site.tagline}
        </h1>
        <p className="max-w-2xl text-lg text-muted-foreground">{site.description}</p>
        <div className="flex flex-wrap gap-3">
          <Link href="/artifacts" className={buttonVariants({ size: 'lg' })}>
            Browse the registry
          </Link>
          <Link href="/docs" className={buttonVariants({ variant: 'outline', size: 'lg' })}>
            Read the docs
          </Link>
        </div>
      </section>

      <section className="grid gap-4 pb-24 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f) => (
          <Card key={f.title}>
            <CardHeader>
              <CardTitle>{f.title}</CardTitle>
              <CardDescription>{f.body}</CardDescription>
            </CardHeader>
            <CardContent />
          </Card>
        ))}
      </section>
    </>
  );
}
