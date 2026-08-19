export interface Discovered {
  slug: string;
  title: string;
  authors: string;
  sourceUrl: string;
  paperUrl?: string;
  venue?: string;
}

export interface SearchPage {
  total: number;
  incomplete: boolean;
  items: Array<{
    full_name: string;
    html_url: string;
    description: string | null;
    owner: { login: string };
    homepage: string | null;
    stargazers_count: number;
  }>;
}

const API = 'https://api.github.com';

function headers(): Record<string, string> {
  const token = process.env['GITHUB_TOKEN'];
  return {
    accept: 'application/vnd.github+json',
    'user-agent': 'sorrycheck-crawler',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

export class RateLimited extends Error {
  constructor(readonly retryAfterMs: number) {
    super(`rate limited, retry in ${Math.round(retryAfterMs / 1000)}s`);
  }
}

/**
 * One page of GitHub repository search.
 *
 * Search is the harshest-limited GitHub endpoint — 10 requests/minute
 * unauthenticated, 30 with a token — so a 403 with a reset header is a normal
 * operating condition rather than an error, and is surfaced as such for the
 * caller to wait on.
 */
export async function searchRepos(query: string, page: number): Promise<SearchPage> {
  const url = `${API}/search/repositories?q=${encodeURIComponent(query)}&per_page=100&page=${page}&sort=stars&order=desc`;
  const response = await fetch(url, { headers: headers() });

  if (response.status === 403 || response.status === 429) {
    const reset = Number(response.headers.get('x-ratelimit-reset') ?? 0) * 1000;
    const retryAfter = Number(response.headers.get('retry-after') ?? 0) * 1000;
    const wait = retryAfter || Math.max(reset - Date.now(), 0) || 60_000;
    throw new RateLimited(wait);
  }
  if (!response.ok) throw new Error(`search ${response.status}: ${query} p${page}`);

  const body = (await response.json()) as {
    total_count: number;
    incomplete_results: boolean;
    items: SearchPage['items'];
  };
  return { total: body.total_count, incomplete: body.incomplete_results, items: body.items ?? [] };
}

/**
 * Query shards.
 *
 * GitHub search returns at most 1,000 results per query no matter how many
 * matches exist, so a single `language:Lean` query can never reach the corpus
 * target. Sharding by pushed-date window splits the result set into chunks that
 * each stay under the cap; the windows are coarse for old, sparse years and
 * finer for recent, dense ones.
 */
export function shards(languages = ['Lean', 'Coq', 'Isabelle']): string[] {
  const windows = [
    '<2018-01-01',
    '2018-01-01..2019-12-31',
    '2020-01-01..2021-12-31',
    '2022-01-01..2022-12-31',
    '2023-01-01..2023-12-31',
    '2024-01-01..2024-12-31',
    '2025-01-01..2025-12-31',
    '>=2026-01-01',
  ];

  const queries: string[] = [];
  for (const language of languages) {
    for (const window of windows) {
      queries.push(`language:${language} pushed:${window}`);
    }
  }
  return queries;
}

/** arXiv abstract search for papers claiming a formalization. */
export async function searchArxiv(start: number, max = 100): Promise<Discovered[]> {
  const query =
    'abs:"formalized in Lean" OR abs:"formalised in Lean" OR abs:"machine-checked" OR abs:"verified in Coq" OR abs:"Isabelle/HOL"';
  const url = `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(query)}&start=${start}&max_results=${max}`;

  const response = await fetch(url, { headers: { 'user-agent': 'sorrycheck-crawler' } });
  if (!response.ok) throw new Error(`arxiv ${response.status}`);
  const xml = await response.text();

  const entries = xml.split('<entry>').slice(1);
  const found: Discovered[] = [];

  for (const entry of entries) {
    const title = entry.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.replace(/\s+/g, ' ').trim();
    const id = entry.match(/<id>([\s\S]*?)<\/id>/)?.[1]?.trim();
    if (!title || !id) continue;

    const authors = [...entry.matchAll(/<name>([\s\S]*?)<\/name>/g)]
      .map((m) => (m[1] ?? '').trim())
      .join(', ');

    found.push({
      slug: '',
      title,
      authors,
      // An arXiv paper is not a source location. It is recorded as the paper and
      // left with no source, which is the honest `not_published` state until
      // someone attaches a repository.
      sourceUrl: '',
      paperUrl: id,
      venue: 'arXiv',
    });
  }

  return found;
}

export function fromRepo(item: SearchPage['items'][number]): Discovered {
  return {
    slug: '',
    title: item.full_name,
    authors: item.owner.login,
    sourceUrl: item.html_url,
    ...(item.homepage && /^https?:\/\//.test(item.homepage) ? { paperUrl: item.homepage } : {}),
  };
}
