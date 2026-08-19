import type {
  AssertedResult,
  Coverage,
  CoverageMatch,
  Declaration,
  MatchMethod,
} from './types.js';

const KINDS = ['theorem', 'proposition', 'lemma', 'corollary', 'definition'] as const;

/**
 * Find numbered results asserted in a paper.
 *
 * Deliberately conservative: it wants `Theorem 10.2` or `Lemma 3`, at a word
 * boundary, with the kind capitalised as papers print it. Prose like "the
 * theorem above" is not a countable assertion, and counting it would inflate the
 * denominator of a ratio we publish about someone's work.
 */
export function extractAssertedResults(paperText: string): AssertedResult[] {
  const pattern = new RegExp(
    String.raw`\b(${KINDS.map((k) => k[0]?.toUpperCase() + k.slice(1)).join('|')})\s+(\d+(?:\.\d+)*)`,
    'g',
  );

  const seen = new Map<string, AssertedResult>();
  for (const match of paperText.matchAll(pattern)) {
    const kind = (match[1] as string).toLowerCase() as AssertedResult['kind'];
    const number = match[2] as string;
    const label = `${kind} ${number}`;
    if (!seen.has(label)) seen.set(label, { kind, number, label });
  }

  return [...seen.values()].sort((a, b) =>
    a.kind === b.kind ? compareNumbers(a.number, b.number) : a.kind.localeCompare(b.kind),
  );
}

function compareNumbers(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff) return diff;
  }
  return 0;
}

/**
 * An author-supplied mapping, read from `sorrycheck.toml` in the repository:
 *
 *     [results]
 *     "theorem 10.2" = "Paper.Thm102"
 *     "lemma 3" = "Paper.lemma_three"
 *
 * Parsed with a small reader rather than a TOML dependency, because this is the
 * only TOML we consume and the shape is fixed.
 */
export function parseMappingToml(toml: string): Map<string, string> {
  const mapping = new Map<string, string>();
  let inResults = false;

  for (const raw of toml.split('\n')) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;

    const section = line.match(/^\[([^\]]+)\]$/);
    if (section) {
      inResults = (section[1] as string).trim() === 'results';
      continue;
    }
    if (!inResults) continue;

    const pair = line.match(/^("([^"]+)"|'([^']+)'|[^=\s]+)\s*=\s*("([^"]*)"|'([^']*)'|\S+)$/);
    if (!pair) continue;
    const key = (pair[2] ?? pair[3] ?? pair[1] ?? '').trim().toLowerCase();
    const value = (pair[5] ?? pair[6] ?? pair[4] ?? '').trim();
    if (key && value) mapping.set(key, value);
  }

  return mapping;
}

/** Normalise a declaration name for similarity: `Paper.Thm10_2` → `thm102`. */
function normalize(name: string): string {
  return name
    .split('.')
    .pop()!
    .toLowerCase()
    .replace(/[_'\s-]/g, '');
}

const KIND_ALIASES: Record<string, string[]> = {
  theorem: ['theorem', 'thm'],
  proposition: ['proposition', 'prop'],
  lemma: ['lemma', 'lem'],
  corollary: ['corollary', 'cor'],
  definition: ['definition', 'def'],
};

/**
 * Match a paper's asserted results against the declarations found in its
 * formalization.
 *
 * Three methods, most authoritative first, and each match records which one
 * found it so a reader can weigh it:
 *
 *   1. an author-supplied mapping — exact, confidence 1
 *   2. a docstring naming the result, e.g. `/-- Theorem 10.5 -/`
 *   3. name similarity, e.g. `thm_10_2` for Theorem 10.2
 *
 * An unmatched result is reported as unmatched and nothing more. We cannot tell
 * a result that was never formalized from one this matcher failed to find, and
 * publishing the former as fact about someone's paper would be defamation.
 */
export function matchCoverage(
  asserted: AssertedResult[],
  declarations: Declaration[],
  mapping?: Map<string, string>,
): Coverage {
  const byName = new Map(declarations.map((d) => [d.name, d]));
  const matches: CoverageMatch[] = [];
  const claimed = new Set<string>();
  const methods = new Set<MatchMethod>();

  for (const result of asserted) {
    const mapped = mapping?.get(result.label);
    if (mapped && byName.has(mapped)) {
      matches.push({ result, declaration: mapped, method: 'declared-mapping', confidence: 1 });
      claimed.add(result.label);
      methods.add('declared-mapping');
    }
  }

  const aliases = (result: AssertedResult) => KIND_ALIASES[result.kind] ?? [result.kind];

  for (const result of asserted) {
    if (claimed.has(result.label)) continue;

    const docMatch = declarations.find((d) => {
      if (!d.docstring) return false;
      const text = d.docstring.toLowerCase();
      return aliases(result).some((alias) =>
        new RegExp(String.raw`\b${alias}\s*\.?\s*${result.number.replace(/\./g, '\\.')}\b`).test(text),
      );
    });

    if (docMatch) {
      matches.push({
        result,
        declaration: docMatch.name,
        method: 'docstring-reference',
        confidence: 0.9,
      });
      claimed.add(result.label);
      methods.add('docstring-reference');
    }
  }

  for (const result of asserted) {
    if (claimed.has(result.label)) continue;

    const digits = result.number.replace(/\./g, '');
    const candidate = declarations.find((d) => {
      if (d.kind === 'example') return false;
      const norm = normalize(d.name);
      return aliases(result).some((alias) => norm === `${alias}${digits}`);
    });

    if (candidate) {
      matches.push({
        result,
        declaration: candidate.name,
        method: 'name-similarity',
        confidence: 0.6,
      });
      claimed.add(result.label);
      methods.add('name-similarity');
    }
  }

  const order: MatchMethod[] = ['declared-mapping', 'docstring-reference', 'name-similarity'];

  return {
    assertedCount: asserted.length,
    matchedCount: matches.length,
    matches,
    unmatched: asserted.filter((r) => !claimed.has(r.label)),
    methods: order.filter((m) => methods.has(m)),
  };
}
