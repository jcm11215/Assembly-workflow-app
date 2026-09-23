/**
 * The database: one SQLite file. node:sqlite is built into Node 22.13+,
 * so there is nothing to install.
 *
 * Schema changes are numbered migrations below, applied in order and
 * recorded in `pragma user_version`. Never edit a migration that has
 * shipped -- add a new one.
 */
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const MIGRATIONS = [
  // 1: initial schema
  `
  create table users (
    id            text primary key,
    login         text not null unique collate nocase,
    full_name     text not null,
    role          text not null default 'trainee' check (role in ('trainee','assembler','admin')),
    active        integer not null default 1,
    password_hash text,                 -- null: imported, sets a password on first sign-in
    legacy_email  text,                 -- imported: the old sign-in address, for that first sign-in
    created_at    text not null,
    updated_at    text not null
  );

  create table sessions (
    token_hash   text primary key,      -- sha256 of the cookie value; the token itself is never stored
    user_id      text not null references users(id) on delete cascade,
    created_at   text not null,
    expires_at   integer not null,      -- unix ms
    last_seen_at integer not null
  );
  create index sessions_user on sessions(user_id);

  create table signup_codes (
    code       text primary key,
    label      text not null default '',
    active     integer not null default 1,
    created_at text not null
  );

  create table settings (
    key   text primary key,
    value text not null                 -- JSON
  );

  create table jobs (
    id               text primary key,
    job_number       text not null unique collate nocase,
    customer         text not null default '',
    description      text not null default '',
    due_date         text,
    priority         text not null default 'Medium' check (priority in ('High','Medium','Low')),
    stage            text not null default 'ready',
    percent_complete integer not null default 0 check (percent_complete between 0 and 100),
    assigned_to      text references users(id) on delete set null,
    created_by       text references users(id) on delete set null,
    last_moved_by    text references users(id) on delete set null,
    version          integer not null default 1,   -- bumped by edits and stage moves: the edit-conflict guard
    rev              integer not null default 0,   -- bumped by every change: lets the app drop an out-of-order copy
    created_at       text not null,
    updated_at       text not null
  );

  -- One row per ticked item. Unticking deletes the row.
  create table checklist (
    job_id  text not null references jobs(id) on delete cascade,
    step    integer not null,
    item    integer not null,
    done_by text references users(id) on delete set null,
    done_at text not null,
    primary key (job_id, step, item)
  );

  create table blockers (
    id          text primary key,
    job_id      text not null references jobs(id) on delete cascade,
    issue       text not null,
    department  text not null default '',
    severity    text not null default 'Medium' check (severity in ('Critical','High','Medium','Low')),
    status      text not null default 'Open' check (status in ('Open','In Progress','Resolved')),
    reported_by text references users(id) on delete set null,
    reported_on text not null,          -- the day it was reported, as the person entered it
    created_at  text not null,
    resolved_by text references users(id) on delete set null,
    resolved_at text
  );
  create index blockers_job on blockers(job_id);

  create table notes (
    id         text primary key,
    job_id     text references jobs(id) on delete cascade,   -- null: shop-wide
    type       text not null default 'Progress' check (type in ('Progress','Issue','NextSteps')),
    body       text not null,
    author     text references users(id) on delete set null,
    note_date  text not null,
    created_at text not null
  );
  create index notes_date on notes(note_date desc, created_at desc);

  create table job_errors (
    id             text primary key,
    job_id         text not null references jobs(id) on delete cascade,
    department     text not null,
    category       text not null default 'other',
    description    text not null,
    found_at_stage text not null default 'unknown',
    rework_hours   real,
    caused_delay   integer not null default 0,
    scrapped       integer not null default 0,
    status         text not null default 'Open' check (status in ('Open','Corrected')),
    correction     text,
    blocker_id     text references blockers(id) on delete set null,
    reported_by    text references users(id) on delete set null,
    reported_at    text not null,
    corrected_at   text
  );

  create table tasks (
    id          text primary key,
    title       text not null,
    details     text not null default '',
    job_id      text references jobs(id) on delete cascade,
    assigned_to text references users(id) on delete set null,
    recurrence  text not null default 'none' check (recurrence in ('none','daily','weekdays','weekly')),
    due_date    text,
    weekday     integer,
    starts_on   text,
    active      integer not null default 1,
    created_by  text references users(id) on delete set null,
    created_at  text not null
  );

  create table task_completions (
    task_id text not null references tasks(id) on delete cascade,
    due_on  text not null,
    done_by text references users(id) on delete set null,
    done_at text not null,
    primary key (task_id, due_on)
  );

  -- Every scan is kept as its own version; the newest drives the job.
  create table blueprints (
    id                text primary key,
    job_id            text not null references jobs(id) on delete cascade,
    version           integer not null,
    file_path         text,             -- relative to data/files; null when no file was kept
    original_filename text,
    mime_type         text,
    thumbnail         blob,             -- small JPEG for lists
    extracted_by      text references users(id) on delete set null,
    extracted_at      text not null,
    unique (job_id, version)
  );

  create table components (
    id                    text primary key,
    blueprint_id          text not null references blueprints(id) on delete cascade,
    sort_order            integer not null default 0,
    item                  text not null,
    item_as_drawn         text not null default '',
    specification         text not null default '',
    quantity              real,
    stage                 text not null default 'other',
    installation_location text not null default 'unknown',
    source_page           integer,
    source_callout        text not null default '',
    extraction_method     text not null default 'inferred',
    confidence            real,
    balloon               text,
    part_number           text not null default '',
    position_x            real,
    position_y            real
  );
  create index components_bp on components(blueprint_id, sort_order);

  -- Append-only: nothing updates or deletes rows here.
  create table activity (
    id          integer primary key autoincrement,
    actor_id    text references users(id) on delete set null,
    actor_name  text not null,
    action      text not null,
    entity_type text,
    entity_id   text,
    detail      text not null default '{}',   -- JSON
    at          text not null
  );
  create index activity_at on activity(at desc);
  create index activity_actor on activity(actor_id, at desc);
  `,

  // 2: the knowledge base the assistant answers from, and staff corrections
  `
  create table knowledge_docs (
    id           text primary key,
    title        text not null,
    collection   text not null default 'general',
    file_path    text,                  -- relative to data/files; null for text that came without a file
    file_name    text not null default '',
    mime_type    text not null default 'application/octet-stream',
    size         integer not null default 0,
    content_hash text not null default '',
    status       text not null default 'pending' check (status in ('pending','indexed','empty','error')),
    detail       text not null default '',
    chunk_count  integer not null default 0,
    created_by   text references users(id) on delete set null,
    created_at   text not null,
    updated_at   text not null
  );
  create index knowledge_docs_hash on knowledge_docs(content_hash);

  create table knowledge_chunks (
    id          integer primary key autoincrement,
    doc_id      text not null references knowledge_docs(id) on delete cascade,
    ordinal     integer not null,
    text        text not null,
    embedding   blob,                   -- float32, unit length
    embed_model text not null default ''
  );
  create index knowledge_chunks_doc on knowledge_chunks(doc_id, ordinal);

  create table corrections (
    id          text primary key,
    question    text not null,
    bad_answer  text not null default '',
    correction  text not null,
    active      integer not null default 1,
    used_count  integer not null default 0,
    embedding   blob,
    embed_model text not null default '',
    created_by  text references users(id) on delete set null,
    created_at  text not null
  );
  `,

  // 3: when a job was finished, for the dashboard's completed-per-week
  // chart. Jobs already complete take the time of their last move into
  // Complete, or their last change when that wasn't logged.
  `
  alter table jobs add column completed_at text;
  update jobs set completed_at = coalesce(
    (select max(a.at) from activity a
      where a.entity_type = 'job' and a.entity_id = jobs.id and a.action = 'Stage moved'
        and json_extract(a.detail, '$.to') = 'complete'),
    updated_at)
  where stage = 'complete';
  `,

  // 4: corrections people make to scanned parts, remembered by the
  // part's description so later scans read it the same way. `key` is
  // shared/partNames.js learnKey(); item and location are each set only
  // once someone has corrected that.
  `
  create table part_names (
    key         text primary key,
    drawn       text not null,
    item        text,
    location    text,
    used_count  integer not null default 0,
    updated_by  text references users(id) on delete set null,
    updated_at  text not null
  );
  `
];

export const uuid = () => randomUUID();
export const now = () => new Date().toISOString();

export function openDb(file){
  if(file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const raw = new DatabaseSync(file);
  raw.exec('pragma journal_mode = wal; pragma foreign_keys = on; pragma busy_timeout = 5000;');
  migrate(raw);
  return wrap(raw);
}

function migrate(raw){
  const current = raw.prepare('pragma user_version').get().user_version;
  for(let v = current; v < MIGRATIONS.length; v++){
    raw.exec('begin');
    try {
      raw.exec(MIGRATIONS[v]);
      raw.exec(`pragma user_version = ${v + 1}`);
      raw.exec('commit');
    } catch (e) {
      raw.exec('rollback');
      throw new Error(`Database migration ${v + 1} failed: ${e.message}`);
    }
  }
}

/** A thin layer over node:sqlite: cached statements, and a transaction
 *  helper that nests (an inner call just joins the outer transaction). */
function wrap(raw){
  const cache = new Map();
  const stmt = sql => {
    let s = cache.get(sql);
    if(!s){ s = raw.prepare(sql); cache.set(sql, s); }
    return s;
  };
  let depth = 0;

  return {
    raw,
    all: (sql, ...params) => stmt(sql).all(...params),
    get: (sql, ...params) => stmt(sql).get(...params),
    run: (sql, ...params) => stmt(sql).run(...params),
    exec: sql => raw.exec(sql),
    tx(fn){
      if(depth > 0) return fn();
      depth++;
      raw.exec('begin immediate');
      try {
        const out = fn();
        raw.exec('commit');
        return out;
      } catch (e) {
        raw.exec('rollback');
        throw e;
      } finally {
        depth--;
      }
    },
    close: () => raw.close()
  };
}

/* ---------------- settings (small JSON documents) ---------------- */

export function getSetting(db, key, fallback = null){
  const row = db.get('select value from settings where key = ?', key);
  return row ? JSON.parse(row.value) : fallback;
}

export function putSetting(db, key, value){
  db.run('insert into settings (key, value) values (?, ?) on conflict(key) do update set value = excluded.value',
    key, JSON.stringify(value));
}
