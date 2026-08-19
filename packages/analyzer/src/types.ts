/** Proof systems we can recognise from a repository's files. */
export type ProofSystem = 'lean4' | 'coq' | 'isabelle';

/**
 * Whether the formalization is published at all.
 *
 * `not_published` is a NEUTRAL state, not a failing grade. It is the field that
 * catches the trigger case — a paper claiming machine-checked results with no
 * source anywhere — and it renders grey, never red. It is also fixable, and the
 * artifact page says how.
 */
export type SourceStatus = 'published' | 'not_published' | 'unreachable' | 'not_applicable';

export type DeclarationKind =
  | 'theorem'
  | 'lemma'
  | 'def'
  | 'abbrev'
  | 'instance'
  | 'example'
  | 'structure'
  | 'inductive'
  | 'class'
  | 'axiom';

export interface Declaration {
  name: string;
  kind: DeclarationKind;
  file: string;
  line: number;
  /**
   * A literal `sorry` (Lean, Isabelle) or `Admitted` (Coq) in the body.
   *
   * This is a STATIC reading of the source. It is not the same fact as
   * `#print axioms` reporting `sorryAx`, which requires building the project —
   * a declaration can depend on `sorryAx` transitively through another
   * declaration without containing the token itself. Never present this as the
   * axiom probe.
   */
  hasSorryToken: boolean;
  /** The docstring immediately above the declaration, comments stripped. */
  docstring?: string;
  /** Declared `axiom` statements are recorded separately: they are not proofs. */
  isAxiom: boolean;
}

/** A numbered result asserted in the paper, e.g. `Theorem 10.2`. */
export interface AssertedResult {
  kind: 'theorem' | 'proposition' | 'lemma' | 'corollary' | 'definition';
  /** The printed number, e.g. "10.2" or "3". */
  number: string;
  /** `theorem 10.2`, lowercased — the join key. */
  label: string;
}

export type MatchMethod = 'declared-mapping' | 'docstring-reference' | 'name-similarity';

export interface CoverageMatch {
  result: AssertedResult;
  declaration: string;
  method: MatchMethod;
  /** 0-1. Exactly 1 for a declared mapping. */
  confidence: number;
}

export interface Coverage {
  assertedCount: number;
  matchedCount: number;
  matches: CoverageMatch[];
  /**
   * Results with no matched declaration. Displayed as "not matched", NEVER as
   * "unproven": we cannot tell an unformalized result from one our matcher
   * missed, and asserting the former would defame someone.
   */
  unmatched: AssertedResult[];
  /** Which methods contributed, most authoritative first. Shown to the reader. */
  methods: MatchMethod[];
}

/**
 * What a static pass can establish without executing anything.
 *
 * Deliberately NOT a build verdict. `lake build` and `#print axioms` need a
 * sandbox that runs untrusted third-party code, which is a separate component;
 * until it exists these fields stay null rather than being guessed at.
 */
export interface StaticAnalysis {
  system: ProofSystem | null;
  declarations: Declaration[];
  /** Declarations whose source contains a placeholder token. */
  sorryDeclarations: string[];
  /** Declarations introduced with `axiom` — assumed, not proved. */
  axiomDeclarations: string[];
  /** Files we actually opened and parsed. */
  filesScanned: number;
  /**
   * Source files present in the project. Larger than `filesScanned` when fetch
   * caps truncated the read — surfaced so a partial scan is never presented as a
   * complete one.
   */
  filesAvailable: number;
  coverage: Coverage | null;
}
