import type { ProofSystem, SourceStatus } from './types.js';

export interface SourceRef {
  host: 'github' | 'gitlab' | 'zenodo' | 'other';
  owner?: string;
  repo?: string;
  /** A commit, tag or branch when the URL pins one. */
  ref?: string;
  url: string;
}

/**
 * Recognise where a formalization lives from its URL.
 *
 * Returns null rather than guessing when the URL is not a source location — a
 * link to a project's landing page is not a published formalization, and
 * treating it as one would turn `not_published` into a false `published`, which
 * is the single most damaging error this registry could make in the author's
 * favour and against its own credibility.
 */
export function parseSourceUrl(raw: string): SourceRef | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  const parts = url.pathname.split('/').filter(Boolean);

  if (url.hostname === 'github.com' || url.hostname === 'www.github.com') {
    const [owner, repo, ...rest] = parts;
    if (!owner || !repo) return null;
    const ref =
      (rest[0] === 'tree' || rest[0] === 'commit' || rest[0] === 'blob') && rest[1] ? rest[1] : undefined;
    return {
      host: 'github',
      owner,
      repo: repo.replace(/\.git$/, ''),
      ...(ref ? { ref } : {}),
      url: `https://github.com/${owner}/${repo.replace(/\.git$/, '')}`,
    };
  }

  if (url.hostname === 'gitlab.com') {
    const [owner, repo] = parts;
    if (!owner || !repo) return null;
    return { host: 'gitlab', owner, repo: repo.replace(/\.git$/, ''), url: raw };
  }

  if (url.hostname.endsWith('zenodo.org')) {
    return { host: 'zenodo', url: raw };
  }

  return { host: 'other', url: raw };
}

const SYSTEM_MARKERS: Array<{ system: ProofSystem; test: (path: string) => boolean }> = [
  { system: 'lean4', test: (p) => /(^|\/)lakefile\.(lean|toml)$/.test(p) || /(^|\/)lean-toolchain$/.test(p) },
  { system: 'coq', test: (p) => /(^|\/)_CoqProject$/.test(p) || /(^|\/)dune-project$/.test(p) },
  { system: 'isabelle', test: (p) => /(^|\/)ROOT$/.test(p) },
];

/**
 * Identify the proof system from a repository's file list.
 *
 * Build-file markers are checked before source extensions: a repository can
 * contain a stray `.v` or `.lean` file without being a formalization project,
 * and the build file is what says the project is meant to check.
 */
export function detectSystem(paths: string[]): ProofSystem | null {
  for (const { system, test } of SYSTEM_MARKERS) {
    if (paths.some(test)) return system;
  }
  if (paths.some((p) => p.endsWith('.lean'))) return 'lean4';
  if (paths.some((p) => p.endsWith('.v'))) return 'coq';
  if (paths.some((p) => p.endsWith('.thy'))) return 'isabelle';
  return null;
}

export const SOURCE_EXTENSIONS: Record<ProofSystem, string> = {
  lean4: '.lean',
  coq: '.v',
  isabelle: '.thy',
};

/**
 * Files that carry a source extension but contain no mathematics.
 *
 * `lakefile.lean` is the obvious one: it ends in `.lean` and would otherwise be
 * counted as a scanned proof file, inflating the file count on every Lean
 * artifact we publish.
 */
export function isBuildFile(path: string): boolean {
  const name = path.split('/').pop() ?? path;
  return name === 'lakefile.lean' || name === 'lakefile.toml' || name === 'lean-toolchain';
}

/**
 * Classify a source location without fetching it.
 *
 * `not_applicable` is for artifacts that never claimed a formalization; it is
 * how the registry stays a registry of claims rather than a scoreboard of
 * everyone.
 */
export function classifySource(sourceUrl: string | null | undefined, claimsFormalization: boolean): SourceStatus {
  if (!claimsFormalization) return 'not_applicable';
  if (!sourceUrl || !sourceUrl.trim()) return 'not_published';
  return parseSourceUrl(sourceUrl) ? 'published' : 'not_published';
}
