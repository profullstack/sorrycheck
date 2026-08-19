import type { Declaration, DeclarationKind } from './types.js';

const KEYWORDS: DeclarationKind[] = [
  'theorem',
  'lemma',
  'def',
  'abbrev',
  'instance',
  'example',
  'structure',
  'inductive',
  'class',
  'axiom',
];

const MODIFIERS = new Set([
  'private',
  'protected',
  'noncomputable',
  'partial',
  'unsafe',
  'nonrec',
  'scoped',
  'local',
  'mutual',
]);

interface Stripped {
  /** Source with comments replaced by spaces, so offsets and line numbers hold. */
  code: string;
  /** Docstring text keyed by the line it ends on. */
  docstrings: Map<number, string>;
}

/**
 * Blank out comments while preserving every byte offset and newline.
 *
 * Offsets are preserved on purpose: `sorry` inside a comment must not count as a
 * placeholder, but the line numbers reported for declarations still have to
 * match the real file. Lean block comments nest, so the depth counter is not
 * optional.
 */
export function stripComments(source: string): Stripped {
  const out = source.split('');
  const docstrings = new Map<number, string>();

  let i = 0;
  let depth = 0;
  let blockStart = -1;
  let isDoc = false;
  let line = 1;
  const lineOf: number[] = new Array(source.length);

  for (let k = 0; k < source.length; k++) {
    lineOf[k] = line;
    if (source[k] === '\n') line++;
  }

  while (i < source.length) {
    const two = source.slice(i, i + 2);

    if (depth === 0 && two === '--') {
      while (i < source.length && source[i] !== '\n') {
        out[i] = ' ';
        i++;
      }
      continue;
    }

    if (two === '/-') {
      if (depth === 0) {
        blockStart = i;
        isDoc = source.slice(i, i + 3) === '/--';
      }
      depth++;
      out[i] = ' ';
      out[i + 1] = ' ';
      i += 2;
      continue;
    }

    if (depth > 0 && two === '-/') {
      depth--;
      out[i] = ' ';
      out[i + 1] = ' ';
      i += 2;
      if (depth === 0 && isDoc && blockStart >= 0) {
        const text = source
          .slice(blockStart + 3, i - 2)
          .replace(/\s+/g, ' ')
          .trim();
        // Keyed by the line the docstring ends on: the declaration follows it.
        docstrings.set(lineOf[i - 1] as number, text);
        isDoc = false;
      }
      continue;
    }

    if (depth > 0) {
      if (source[i] !== '\n') out[i] = ' ';
      i++;
      continue;
    }

    i++;
  }

  return { code: out.join(''), docstrings };
}

const IDENTIFIER = String.raw`[A-Za-z_α-ωΑ-Ω][A-Za-z0-9_'!?α-ωΑ-Ω\.]*`;

/**
 * Find top-level declarations in a Lean 4 file.
 *
 * This is a scanner, not a parser: a real Lean frontend is out of scope and
 * would mean running Lean. It keys off declarations starting at column zero
 * after optional modifiers, which is the convention every project follows and
 * which is enough to enumerate what a file claims to prove. Where it is unsure
 * it reports less, never more.
 */
export function parseLean(source: string, file: string): Declaration[] {
  const { code, docstrings } = stripComments(source);
  const lines = code.split('\n');
  const declarations: Declaration[] = [];

  const starts: Array<{ index: number; line: number; kind: DeclarationKind; name: string }> = [];

  for (let n = 0; n < lines.length; n++) {
    const raw = lines[n] as string;
    if (/^\s/.test(raw)) continue; // indented: part of a body

    let rest = raw.trim();
    if (!rest) continue;

    // Skip attributes and modifiers to reach the keyword.
    while (rest.startsWith('@[')) {
      const close = rest.indexOf(']');
      if (close === -1) break;
      rest = rest.slice(close + 1).trim();
    }
    let word = rest.split(/\s+/)[0] ?? '';
    while (MODIFIERS.has(word)) {
      rest = rest.slice(word.length).trim();
      word = rest.split(/\s+/)[0] ?? '';
    }

    if (!KEYWORDS.includes(word as DeclarationKind)) continue;
    const kind = word as DeclarationKind;

    let after = rest.slice(word.length).trim();

    // Lean has compound declaration heads — `class abbrev Foo`, `class inductive
    // Bar`. Without this the second keyword is read as the declaration's name,
    // which is exactly what mathlib's `class abbrev IsAffineMonoid` produced.
    for (;;) {
      const next = after.split(/\s+/)[0] ?? '';
      if (!next || !KEYWORDS.includes(next as DeclarationKind)) break;
      after = after.slice(next.length).trim();
    }

    const nameMatch = after.match(new RegExp(`^(${IDENTIFIER})`));
    const name = kind === 'example' ? `example@${file}:${n + 1}` : nameMatch?.[1];
    if (!name) continue;

    starts.push({
      index: lines.slice(0, n).reduce((acc, l) => acc + l.length + 1, 0),
      line: n + 1,
      kind,
      name,
    });
  }

  for (let s = 0; s < starts.length; s++) {
    const start = starts[s] as (typeof starts)[number];
    const end = s + 1 < starts.length ? (starts[s + 1] as (typeof starts)[number]).index : code.length;
    const body = code.slice(start.index, end);

    const declaration: Declaration = {
      name: start.name,
      kind: start.kind,
      file,
      line: start.line,
      hasSorryToken: /(^|[^A-Za-z0-9_'])sorry([^A-Za-z0-9_'!?]|$)/.test(body),
      isAxiom: start.kind === 'axiom',
    };

    const doc = docstrings.get(start.line - 1);
    if (doc) declaration.docstring = doc;

    declarations.push(declaration);
  }

  return declarations;
}

/**
 * Coq: `Admitted.` is the placeholder, and `Axiom`/`Parameter` assume rather
 * than prove. `admit` inside a proof also leaves a hole but must be closed with
 * `Admitted`, so keying off `Admitted` alone does not miss anything.
 */
export function parseCoq(source: string, file: string): Declaration[] {
  const code = source
    .replace(/\(\*[\s\S]*?\*\)/g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n');
  const declarations: Declaration[] = [];

  const starts: Array<{ line: number; kind: DeclarationKind; name: string }> = [];
  for (let n = 0; n < code.length; n++) {
    const match = (code[n] as string).match(
      /^\s*(Theorem|Lemma|Corollary|Proposition|Remark|Fact|Definition|Axiom|Parameter|Instance|Example)\s+([A-Za-z_][A-Za-z0-9_']*)/,
    );
    if (!match) continue;
    const keyword = match[1] as string;
    const kind: DeclarationKind =
      keyword === 'Definition'
        ? 'def'
        : keyword === 'Axiom' || keyword === 'Parameter'
          ? 'axiom'
          : keyword === 'Instance'
            ? 'instance'
            : keyword === 'Example'
              ? 'example'
              : keyword === 'Lemma'
                ? 'lemma'
                : 'theorem';
    starts.push({ line: n + 1, kind, name: match[2] as string });
  }

  for (let s = 0; s < starts.length; s++) {
    const start = starts[s] as (typeof starts)[number];
    const endLine = s + 1 < starts.length ? (starts[s + 1] as (typeof starts)[number]).line - 1 : code.length;
    const body = code.slice(start.line - 1, endLine).join('\n');
    declarations.push({
      name: start.name,
      kind: start.kind,
      file,
      line: start.line,
      hasSorryToken: /(^|\W)Admitted\s*\./.test(body),
      isAxiom: start.kind === 'axiom',
    });
  }

  return declarations;
}

/** Isabelle uses `sorry` too, and `axiomatization` to assume. */
export function parseIsabelle(source: string, file: string): Declaration[] {
  const code = source.replace(/\(\*[\s\S]*?\*\)/g, (m) => m.replace(/[^\n]/g, ' ')).split('\n');
  const declarations: Declaration[] = [];

  const starts: Array<{ line: number; kind: DeclarationKind; name: string }> = [];
  for (let n = 0; n < code.length; n++) {
    const match = (code[n] as string).match(
      /^\s*(theorem|lemma|corollary|proposition|definition|axiomatization)\s+([A-Za-z_][A-Za-z0-9_'.]*)\s*[:[]/,
    );
    if (!match) continue;
    const keyword = match[1] as string;
    const kind: DeclarationKind =
      keyword === 'definition'
        ? 'def'
        : keyword === 'axiomatization'
          ? 'axiom'
          : keyword === 'lemma'
            ? 'lemma'
            : 'theorem';
    starts.push({ line: n + 1, kind, name: match[2] as string });
  }

  for (let s = 0; s < starts.length; s++) {
    const start = starts[s] as (typeof starts)[number];
    const endLine = s + 1 < starts.length ? (starts[s + 1] as (typeof starts)[number]).line - 1 : code.length;
    const body = code.slice(start.line - 1, endLine).join('\n');
    declarations.push({
      name: start.name,
      kind: start.kind,
      file,
      line: start.line,
      hasSorryToken: /(^|\W)sorry(\W|$)/.test(body),
      isAxiom: start.kind === 'axiom',
    });
  }

  return declarations;
}
