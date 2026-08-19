-- The registry.
--
-- Every statement is `if not exists`: the web server and the worker boot at the
-- same instant in the same container and both run migrations, so each statement
-- must be safe to run twice concurrently. See packages/db/src/migrate.ts.

create table if not exists artifacts (
  id integer primary key autoincrement,
  slug text not null unique,
  title text not null,
  authors text not null default '',
  venue text,
  paper_url text,
  source_url text,
  -- published | not_published | unreachable | not_applicable
  -- not_published is NEUTRAL and renders grey. It is a fixable fact, not a grade.
  source_status text not null default 'not_published',
  -- pending | checked | skipped. Bulk imports land as pending; the worker drains them.
  queue_status text not null default 'pending',
  -- An author's right of reply, rendered above the fold on the artifact page.
  author_note text,
  first_seen_at integer not null,
  last_checked_at integer,
  claimed_by integer references users(id) on delete set null,
  -- Set once the authors have been told a page exists, so we never publish first.
  notified_at integer
);

create index if not exists artifacts_queue_idx on artifacts(queue_status);
create index if not exists artifacts_checked_idx on artifacts(last_checked_at);
create index if not exists artifacts_status_idx on artifacts(source_status);

create table if not exists checks (
  id integer primary key autoincrement,
  artifact_id integer not null references artifacts(id) on delete cascade,
  commit_sha text,
  toolchain text,
  -- Null until a sandbox exists to run `lake build`. A null exit_code means
  -- NOT RUN, never "failed" — the distinction is the whole credibility of a
  -- verdict, so it is a nullable column rather than a sentinel value.
  exit_code integer,
  duration_ms integer,
  log_r2_key text,
  -- static | build-pending | built
  kind text not null default 'static',
  -- The system detected in the source: lean4 | coq | isabelle | null
  system text,
  declarations_total integer not null default 0,
  sorry_total integer not null default 0,
  axioms_total integer not null default 0,
  files_scanned integer not null default 0,
  -- Source files present in the project. Greater than files_scanned when fetch
  -- caps truncated the read, so a partial scan is never shown as a complete one.
  files_available integer not null default 0,
  summary text,
  checked_at integer not null
);

create index if not exists checks_artifact_idx on checks(artifact_id, checked_at);

create table if not exists declarations (
  id integer primary key autoincrement,
  check_id integer not null references checks(id) on delete cascade,
  name text not null,
  kind text not null,
  file text not null,
  line integer not null,
  -- A literal `sorry`/`Admitted` in the source. NOT the same fact as
  -- `#print axioms` reporting sorryAx, which needs a build.
  has_sorry integer not null default 0,
  is_axiom integer not null default 0,
  -- JSON array, populated only by the axiom probe. Null means not measured.
  axioms text
);

create index if not exists declarations_check_idx on declarations(check_id);

create table if not exists coverage (
  id integer primary key autoincrement,
  check_id integer not null references checks(id) on delete cascade,
  asserted_count integer not null,
  matched_count integer not null,
  -- Comma-separated match methods, shown to the reader so they can weigh it.
  method text not null default '',
  -- JSON: the matches and the unmatched results, so a page can show its working.
  detail text
);

create index if not exists coverage_check_idx on coverage(check_id);

create table if not exists claims (
  id integer primary key autoincrement,
  artifact_id integer not null references artifacts(id) on delete cascade,
  user_id integer not null references users(id) on delete cascade,
  verified_at integer,
  created_at integer not null
);

create unique index if not exists claims_unique_idx on claims(artifact_id, user_id);
