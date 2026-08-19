import { parseCoq, parseIsabelle, parseLean } from './lean.js';
import { extractAssertedResults, matchCoverage, parseMappingToml } from './coverage.js';
import { detectSystem, isBuildFile, SOURCE_EXTENSIONS } from './source.js';
import type { Declaration, ProofSystem, StaticAnalysis } from './types.js';

export interface SourceFile {
  path: string;
  content: string;
}

export interface AnalyzeInput {
  /** Files whose content we actually have. Only these are scanned and counted. */
  files: SourceFile[];
  /**
   * Every path in the repository, for detecting the system and for reporting how
   * much of it we read. Kept separate from `files` on purpose: a large project
   * gets truncated by the fetch caps, and counting paths we never opened as
   * "scanned" would publish a file count far larger than what was examined.
   */
  paths?: string[];
  /** The paper's text, when we have it. Coverage is skipped without it. */
  paperText?: string;
  /** Contents of `sorrycheck.toml`, when the repository ships one. */
  mappingToml?: string;
}

const PARSERS: Record<ProofSystem, (source: string, file: string) => Declaration[]> = {
  lean4: parseLean,
  coq: parseCoq,
  isabelle: parseIsabelle,
};

/**
 * Everything that can be established from source alone.
 *
 * What this is NOT: a build verdict, and not the axiom probe. Those require
 * executing `lake build` and `#print axioms` on untrusted third-party code in a
 * network-off sandbox, which is a separate component. Until it exists, a
 * declaration's *transitive* dependence on `sorryAx` is unknown, and this
 * reports only the tokens actually present in the source.
 *
 * Stated plainly so no caller mistakes one for the other: a file with zero
 * `sorry` tokens can still fail `#print axioms`, because it may depend on a
 * declaration in another file that has one.
 */
export function analyzeStatic(input: AnalyzeInput): StaticAnalysis {
  const allPaths = input.paths ?? input.files.map((f) => f.path);
  const system = detectSystem(allPaths);

  if (!system) {
    return {
      system: null,
      declarations: [],
      sorryDeclarations: [],
      axiomDeclarations: [],
      filesScanned: 0,
      filesAvailable: 0,
      coverage: null,
    };
  }

  const extension = SOURCE_EXTENSIONS[system];
  const parse = PARSERS[system];
  const sources = input.files.filter((f) => f.path.endsWith(extension) && !isBuildFile(f.path));
  const available = allPaths.filter((p) => p.endsWith(extension) && !isBuildFile(p)).length;

  const declarations = sources.flatMap((f) => parse(f.content, f.path));

  const coverage = input.paperText
    ? matchCoverage(
        extractAssertedResults(input.paperText),
        declarations,
        input.mappingToml ? parseMappingToml(input.mappingToml) : undefined,
      )
    : null;

  return {
    system,
    declarations,
    sorryDeclarations: declarations.filter((d) => d.hasSorryToken).map((d) => d.name),
    axiomDeclarations: declarations.filter((d) => d.isAxiom).map((d) => d.name),
    filesScanned: sources.length,
    filesAvailable: Math.max(available, sources.length),
    coverage,
  };
}

/**
 * The headline sentence for an artifact page, in the registry's voice.
 *
 * Mechanical facts only. No adjectives about the work or its authors, and the
 * neutral cases read as neutral — "no source published" is a fixable fact, not
 * an accusation.
 */
export function summarize(analysis: StaticAnalysis): string {
  if (!analysis.system) return 'No formalization was found in the published source.';

  const total = analysis.declarations.filter((d) => !d.isAxiom).length;
  const holes = analysis.sorryDeclarations.length;

  // Say how much of the project was actually read. A partial scan reported as a
  // whole one is the most damaging kind of wrong number this registry could
  // publish: it looks authoritative and is not.
  const scope =
    analysis.filesAvailable > analysis.filesScanned
      ? `${analysis.filesScanned} of ${analysis.filesAvailable} files`
      : `${analysis.filesScanned} file${analysis.filesScanned === 1 ? '' : 's'}`;

  const parts = [`${total} declaration${total === 1 ? '' : 's'} found in ${scope}`];

  parts.push(
    holes === 0
      ? 'none contain a placeholder in source'
      : `${holes} contain${holes === 1 ? 's' : ''} a placeholder in source`,
  );

  if (analysis.axiomDeclarations.length) {
    parts.push(`${analysis.axiomDeclarations.length} declared as axioms`);
  }

  if (analysis.coverage) {
    const { matchedCount, assertedCount, methods } = analysis.coverage;
    parts.push(
      `${matchedCount} of ${assertedCount} asserted results matched to a declaration by ${methods.join(' and ') || 'no method'}`,
    );
  }

  return `${parts.join('; ')}.`;
}
