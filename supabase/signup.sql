-- =====================================================================
-- Self-service account creation support.
-- Run after triggers.sql. Idempotent: safe to re-run.
-- =====================================================================

-- ---------- signup_codes ----------
-- The shop access code employees must type to create an account. The app
-- is served from a public URL, so without this gate anyone who found the
-- link could create themselves an account and read every job.
--
-- RLS is on with NO policies, deliberately: that makes the table
-- unreadable to anon and authenticated alike. Only the service role --
-- which is to say only the create-account Edge Function, never the
-- browser -- can check a code against it.
create table if not exists signup_codes (
  code        text primary key,
  label       text not null default '',
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

alter table signup_codes enable row level security;

-- ---------- handle_new_user, hardened ----------
-- Replaces the triggers.sql version. That one took the new user's role
-- from raw_user_meta_data, which was safe only while accounts could be
-- created by an admin in the dashboard. With self-service signup that is
-- a privilege escalation: the metadata is client-supplied, so anyone
-- signing up could ask for role 'admin' and get it.
--
-- Everyone lands as an 'assembler'. Promotion is an explicit admin
-- action against the profiles table, which trg_no_self_promote guards.
--
-- The one exception is the owner's account, seeded as admin here at
-- INSERT time. It used to be done by a separate bootstrap trigger doing
-- an UPDATE afterward, which block_self_promote rejects -- a signup
-- trigger has no auth.uid(), so the guard saw a non-admin changing a
-- role and failed the whole signup. INSERT is not guarded. The address
-- is hardcoded here and never read from raw_user_meta_data, which the
-- browser controls.
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, full_name, role)
  values (new.id,
          coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
                   split_part(new.email, '@', 1)),
          case when lower(new.email) = 'justinmckinney@iscmfg.com'
               then 'admin'::user_role
               else 'assembler'::user_role end)
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists trg_on_auth_user_created on auth.users;
create trigger trg_on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

drop trigger if exists trg_zz_bootstrap_admin on auth.users;
drop function if exists bootstrap_first_admin();
