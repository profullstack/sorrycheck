import { connect, migrate } from '@sorrycheck/db';

/**
 * The checker: resolves sources, builds formalizations in a sandbox and records verdicts.
 *
 * This runs as a second process inside the SAME Railway container as the web
 * server (see docker-entrypoint.sh), not as its own service.
 */
const INTERVAL = Number(process.env['WORKER_INTERVAL_MS'] ?? 60_000);

async function tick(): Promise<void> {
  // TODO: resolves sources, builds formalizations in a sandbox and records verdicts
}

async function main(): Promise<void> {
  const db = connect();
  const applied = await migrate(db);
  if (applied.length) console.log(`[checker] applied migrations: ${applied.join(', ')}`);
  console.log(`[checker] up, interval=${INTERVAL}ms`);

  for (;;) {
    try {
      await tick();
    } catch (err) {
      console.error('[checker] tick failed', err);
    }
    await new Promise((r) => setTimeout(r, INTERVAL));
  }
}

main().catch((err) => {
  console.error('[checker] fatal', err);
  process.exit(1);
});
