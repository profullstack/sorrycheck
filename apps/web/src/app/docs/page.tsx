import Link from 'next/link';
import { STATIC_SCOPE_NOTE } from '@/lib/verdict';

export const metadata = { title: 'Docs' };

function Code({ children }: { children: string }) {
  return (
    <pre className="mt-3 overflow-x-auto rounded-md border bg-muted/30 p-4 font-mono text-xs">
      {children}
    </pre>
  );
}

export default function DocsPage() {
  return (
    <article className="max-w-3xl py-16">
      <h1 className="text-4xl font-semibold tracking-tight">Docs</h1>
      <p className="mt-4 text-lg text-muted-foreground">
        What sorrycheck measures, what it does not, and how to read a verdict.
      </p>

      <h2 className="mt-12 text-2xl font-semibold tracking-tight">What is measured today</h2>
      <p className="mt-2 text-muted-foreground">{STATIC_SCOPE_NOTE}</p>
      <ul className="mt-4 list-disc pl-5 text-muted-foreground">
        <li>Whether the formalization source is published at all, and reachable.</li>
        <li>Which proof system the project uses — Lean 4, Coq or Isabelle.</li>
        <li>Which declarations exist, with their file and line.</li>
        <li>
          Which declarations contain a literal placeholder token in source —{' '}
          <code className="font-mono">sorry</code> in Lean and Isabelle,{' '}
          <code className="font-mono">Admitted</code> in Coq.
        </li>
        <li>Which declarations are introduced with `axiom`, and so assumed rather than proved.</li>
        <li>
          How many of the paper&rsquo;s numbered results were matched to a declaration, and by which
          method.
        </li>
        <li>How much of the project was actually read, when size caps truncated the scan.</li>
      </ul>

      <h2 className="mt-12 text-2xl font-semibold tracking-tight">What has not run</h2>
      <div className="mt-3 rounded-md border border-amber-600/40 bg-amber-600/10 p-4 text-sm">
        <p className="font-medium">The build and the axiom probe are not implemented.</p>
        <p className="mt-2">
          <code className="font-mono">lake build</code> and{' '}
          <code className="font-mono">#print axioms</code> require a sandbox that executes untrusted
          third-party code with the network off, a hard timeout and a disposable filesystem. That
          component does not exist yet, so no artifact has a build result.
        </p>
        <p className="mt-2">
          Every check records <code className="font-mono">exitCode: null</code> and{' '}
          <code className="font-mono">buildStatus: &ldquo;not-run&rdquo;</code>. A null exit code
          means <strong>not run</strong>. It does not mean a project failed to build, and nothing
          here should be reported as if it did.
        </p>
        <p className="mt-2">
          This distinction is not pedantic: a file with zero <code className="font-mono">sorry</code>{' '}
          tokens can still depend on <code className="font-mono">sorryAx</code> through a declaration
          in another file. A static scan cannot see that. Only the axiom probe can.
        </p>
      </div>

      <h2 className="mt-12 text-2xl font-semibold tracking-tight">How to read a verdict</h2>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="py-2 pr-4 font-medium">Source status</th>
              <th className="py-2 font-medium">What it means</th>
            </tr>
          </thead>
          <tbody>
            {[
              ['published', 'We found a source location and read it.'],
              [
                'not_published',
                'We could not find published source. A neutral, fixable fact about a link — not a claim that anyone’s results are false.',
              ],
              [
                'unreachable',
                'The location did not respond. A private or moved repository looks the same as one that is gone.',
              ],
              ['not_applicable', 'The artifact does not claim a machine-checked formalization.'],
            ].map(([status, meaning]) => (
              <tr key={status} className="border-t align-top">
                <td className="py-2 pr-4 font-mono">{status}</td>
                <td className="py-2 text-muted-foreground">{meaning}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-4 text-sm text-muted-foreground">
        A placeholder found in source is not a failure either. Work in progress legitimately
        contains them, and saying otherwise about someone&rsquo;s repository would be both wrong and
        unfair.
      </p>

      <h2 className="mt-12 text-2xl font-semibold tracking-tight">Coverage</h2>
      <p className="mt-2 text-muted-foreground">
        Coverage matches the paper&rsquo;s numbered results to declarations by three methods, most
        authoritative first: an author-supplied mapping, a docstring naming the result, then name
        similarity. The method is always shown so you can weigh it.
      </p>
      <p className="mt-3 text-muted-foreground">
        An unmatched result means the matcher found no declaration for it.{' '}
        <strong>It does not mean the result is unproven.</strong> We cannot tell a result that was
        never formalized from one our matcher missed, so we do not guess.
      </p>

      <h2 className="mt-12 text-2xl font-semibold tracking-tight">For authors</h2>
      <p className="mt-2 text-muted-foreground">
        Attach a repository at <Link href="/submit" className="underline underline-offset-4">/submit</Link>{' '}
        and the page re-checks itself. A <code className="font-mono">sorrycheck.toml</code> in the
        repository makes coverage exact rather than inferred:
      </p>
      <Code>{`[results]
"theorem 10.2" = "Paper.MainResult"
"lemma 3" = "Paper.helper"`}</Code>
      <p className="mt-3 text-muted-foreground">
        You can also add a note that renders above the fold on your artifact page. We would rather
        publish your correction than our guess.
      </p>

      <h2 className="mt-12 text-2xl font-semibold tracking-tight">API</h2>
      <p className="mt-2 text-muted-foreground">
        Unauthenticated. Accounts exist only to claim an artifact you authored.
      </p>
      <Code>{`GET  /api/v1/artifacts?q=&limit=&offset=
GET  /api/v1/artifacts/{slug}
POST /api/v1/submit   {"title","authors","paperUrl","sourceUrl"}
POST /api/mcp         streamable-http: get_artifact, search_artifacts`}</Code>

      <h2 className="mt-12 text-2xl font-semibold tracking-tight">Badge</h2>
      <Code>{`[![sorrycheck](https://sorrycheck.com/badge/my-artifact.svg)](https://sorrycheck.com/a/my-artifact)`}</Code>
    </article>
  );
}
