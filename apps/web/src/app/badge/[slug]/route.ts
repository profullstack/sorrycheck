import { connect, getArtifact, latestCheck } from '@sorrycheck/db';
import { verdictFor, type Tone } from '@/lib/verdict';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Badge colours follow the same rule as the pages: there is no red for a
 * neutral state. A missing repository is grey, a placeholder found in source is
 * amber, and green means only what it says — no placeholder token in the source.
 */
const COLORS: Record<Tone, string> = {
  pass: '#22c55e',
  attention: '#d97706',
  neutral: '#9ca3af',
  unknown: '#9ca3af',
};

function width(text: string): number {
  let w = 0;
  for (const ch of text) w += /[ilj.,:'|!]/.test(ch) ? 3 : /[A-Z@%]/.test(ch) ? 8 : 6.2;
  return Math.ceil(w);
}

const escapeXml = (text: string): string =>
  text.replace(/[<>&'"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c] as string,
  );

function svg(label: string, message: string, color: string): string {
  const lw = width(label) + 12;
  const mw = width(message) + 12;
  const total = lw + mw;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="20" role="img" aria-label="${escapeXml(label)}: ${escapeXml(message)}">
  <title>${escapeXml(label)}: ${escapeXml(message)}</title>
  <linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
  <clipPath id="r"><rect width="${total}" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${lw}" height="20" fill="#555"/>
    <rect x="${lw}" width="${mw}" height="20" fill="${color}"/>
    <rect width="${total}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="${lw / 2}" y="15" fill="#010101" fill-opacity=".3">${escapeXml(label)}</text>
    <text x="${lw / 2}" y="14">${escapeXml(label)}</text>
    <text x="${lw + mw / 2}" y="15" fill="#010101" fill-opacity=".3">${escapeXml(message)}</text>
    <text x="${lw + mw / 2}" y="14">${escapeXml(message)}</text>
  </g>
</svg>`;
}

const respond = (body: string) =>
  new Response(body, {
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      'cache-control': 'public, max-age=300, s-maxage=300',
    },
  });

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  // The route is /badge/{slug}.svg, so the dynamic segment carries the suffix.
  const { slug: raw } = await params;
  const slug = raw.replace(/\.svg$/, '');

  const db = connect();
  let artifact = null;
  try {
    artifact = await getArtifact(db, slug);
  } catch {
    /* registry not migrated yet */
  }
  if (!artifact) return respond(svg('sorrycheck', 'unknown', COLORS.unknown));

  const check = await latestCheck(db, artifact.id);
  const verdict = verdictFor(artifact, check);

  // Badges are read in a README with no context, so the message says what was
  // measured rather than implying a build result.
  const message =
    verdict.tone === 'pass' && check
      ? `${check.declarations_total} decls · 0 sorry in source`
      : verdict.label;

  return respond(svg('sorrycheck', message, COLORS[verdict.tone]));
}
