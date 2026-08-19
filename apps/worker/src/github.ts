import type { SourceFile } from '@sorrycheck/analyzer';
import { isBuildFile, SOURCE_EXTENSIONS, type ProofSystem } from '@sorrycheck/analyzer';

const API = 'https://api.github.com';

export interface RepoSnapshot {
  /** Every path in the repository at `sha`. */
  paths: string[];
  sha: string;
  files: SourceFile[];
  mappingToml?: string;
}

export class GithubError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function headers(): Record<string, string> {
  const token = process.env['GITHUB_TOKEN'];
  return {
    accept: 'application/vnd.github+json',
    'user-agent': 'sorrycheck',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

async function json<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: headers() });
  if (!response.ok) {
    throw new GithubError(`${url} -> ${response.status}`, response.status);
  }
  return (await response.json()) as T;
}

/**
 * Read a repository's tree and the source files in it.
 *
 * Nothing is executed and nothing is cloned: this reads the GitHub API only.
 * That is a deliberate boundary — running a third party's build is the job of
 * the sandbox, which does not exist yet, and doing it here would mean executing
 * untrusted code inside the app container.
 *
 * Caps exist because a single pathological repository must not consume the
 * whole crawl budget; when one is hit the snapshot is still returned and the
 * caller reports what it scanned rather than pretending it saw everything.
 */
export async function fetchRepo(
  owner: string,
  repo: string,
  ref: string | undefined,
  system: ProofSystem | null,
  limits: { maxFiles?: number; maxBytes?: number } = {},
): Promise<RepoSnapshot> {
  const maxFiles = limits.maxFiles ?? 400;
  const maxBytes = limits.maxBytes ?? 4_000_000;

  const meta = await json<{ default_branch: string }>(`${API}/repos/${owner}/${repo}`);
  const branch = ref ?? meta.default_branch;

  const tree = await json<{
    sha: string;
    truncated: boolean;
    tree: Array<{ path: string; type: string; size?: number }>;
  }>(`${API}/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`);

  const paths = tree.tree.filter((n) => n.type === 'blob').map((n) => n.path);

  const extension = system ? SOURCE_EXTENSIONS[system] : null;
  const wanted = extension
    ? tree.tree
        .filter((n) => n.type === 'blob' && n.path.endsWith(extension) && !isBuildFile(n.path))
        .sort((a, b) => (a.size ?? 0) - (b.size ?? 0))
    : [];

  const files: SourceFile[] = [];
  let bytes = 0;
  for (const node of wanted) {
    if (files.length >= maxFiles || bytes + (node.size ?? 0) > maxBytes) break;
    const raw = await fetch(
      `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${node.path
        .split('/')
        .map(encodeURIComponent)
        .join('/')}`,
      { headers: headers() },
    );
    if (!raw.ok) continue;
    const content = await raw.text();
    bytes += content.length;
    files.push({ path: node.path, content });
  }

  const snapshot: RepoSnapshot = { paths, sha: tree.sha, files };

  if (paths.includes('sorrycheck.toml')) {
    const raw = await fetch(
      `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/sorrycheck.toml`,
      { headers: headers() },
    );
    if (raw.ok) snapshot.mappingToml = await raw.text();
  }

  return snapshot;
}
