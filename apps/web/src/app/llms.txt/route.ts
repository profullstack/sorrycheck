import { site, siteUrl } from '@/lib/site';
import { STATIC_SCOPE_NOTE } from '@/lib/verdict';

export const runtime = 'nodejs';

export function GET() {
  const base = siteUrl();
  const body = `# ${site.name}

> ${site.description}

"Verified in Lean 4" has become a credibility badge, and almost nobody audits it.
${site.name} reads artifacts that claim a machine-checked proof and publishes what
is actually true about them.

## What is measured, and what is not

${STATIC_SCOPE_NOTE}

The build and the axiom probe (\`lake build\`, \`#print axioms\`) have NOT run. They
require a sandbox that executes untrusted third-party code with the network off,
and that component is not implemented. Every check is recorded with
buildStatus="not-run" and a null exitCode. A null exit code means NOT RUN. It does
not mean the project failed to build, and must never be reported as such.

## How to read a verdict

- published / not_published / unreachable / not_applicable describe the SOURCE,
  not the mathematics.
- "no source published" is a neutral, fixable fact about a link. It is not a
  claim that anyone's results are false, and it is not a failing grade.
- "placeholder in source" means a literal \`sorry\` or \`Admitted\` token was found
  in a declaration's source. A work-in-progress repository legitimately has these.
- An unmatched coverage result means our matcher found no declaration for it. It
  does NOT mean the result is unproven — we cannot tell those apart and we do not
  guess.

## API

Unauthenticated.

- GET ${base}/api/v1/artifacts?q=&limit=&offset=
- GET ${base}/api/v1/artifacts/{slug}
- POST ${base}/api/v1/submit  {"title","authors","paperUrl","sourceUrl"}
- MCP: ${base}/api/mcp (streamable-http; tools: get_artifact, search_artifacts)

## Other surfaces

- Artifact page: ${base}/a/{slug}
- Badge: ${base}/badge/{slug}.svg
- Feed: ${base}/feed.xml
- Health: ${base}/api/health
- Source: https://github.com/profullstack/${site.name} (MIT)

## For authors

Attach a repository at ${base}/submit and the page re-checks itself. A
\`sorrycheck.toml\` in the repository maps your paper's numbered results to
declarations so coverage is exact rather than inferred:

    [results]
    "theorem 10.2" = "Paper.MainResult"

Everything readable here is unauthenticated. Accounts exist only to claim an
artifact you authored.
`;
  return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
