export const site = {
  name: 'sorrycheck',
  domain: 'sorrycheck.com',
  tagline: 'Does that proof actually check?',
  description: 'A public verdict registry for papers and repos claiming machine-checked proofs.',
};

/** Public origin. Passkey rpID derives from this, so it must match the real host. */
export function siteUrl(): string {
  const env = process.env;
  return env['SITE_URL'] ?? 'http://localhost:3000';
}
