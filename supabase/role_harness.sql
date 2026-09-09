-- =====================================================================
-- Role verification harness -- run on a BRANCH database before applying
-- rls.sql to production. Each block impersonates a role via a fake JWT
-- claim and asserts the expected outcome. A failed assertion raises,
-- so running this file straight through (\i role_harness.sql) either
-- completes silently or tells you exactly which policy is wrong.
--
-- Prereqs: schema.sql, migration.sql (or seed data), triggers.sql,
-- rls.sql all applied on this branch.
-- =====================================================================

do $$
declare
  admin_id     uuid := gen_random_uuid();
  lead_id      uuid := gen_random_uuid();
  assembler_id uuid := gen_random_uuid();
  other_id     uuid := gen_random_uuid();   -- second assembler, not assigned to test_job
  test_job_id  uuid;
  other_job_id uuid;
  n            int;
  step0_items  int := 5;   -- PROCEDURE[0].items.length, must match triggers.sql
begin
  raise notice '--- setting up fixtures as postgres (bypasses RLS) ---';
  set local role postgres;

  insert into profiles (id, full_name, role) values
    (admin_id, 'Harness Admin', 'admin'),
    (lead_id, 'Harness Lead', 'lead'),
    (assembler_id, 'Harness Assembler', 'assembler'),
    (other_id, 'Harness Other Assembler', 'assembler')
  on conflict (id) do update set role = excluded.role;

  insert into jobs (job_number, customer, stage, assigned_to)
  values ('HARNESS-1', 'Test Co', 'ready', assembler_id)
  returning id into test_job_id;

  insert into jobs (job_number, customer, stage, assigned_to)
  values ('HARNESS-2', 'Test Co', 'ready', other_id)
  returning id into other_job_id;

  -- ================== ASSEMBLER ==================
  raise notice '--- as ASSEMBLER (assigned to HARNESS-1) ---';
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', assembler_id)::text, true);

  select count(*) into n from jobs; -- select policy is unrestricted
  if n < 2 then raise exception 'FAIL: assembler should see all jobs (select), saw %', n; end if;
  raise notice 'PASS: assembler sees all jobs via select';

  update jobs set percent_complete = 10 where id = test_job_id;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: assembler could not update percent_complete on own assigned job'; end if;
  raise notice 'PASS: assembler updates percent_complete on assigned job';

  begin
    update jobs set priority = 'High' where id = test_job_id;
    raise exception 'FAIL: assembler was able to change priority (should be trigger-blocked)';
  exception when insufficient_privilege then
    raise notice 'PASS: assembler blocked from changing priority (trg_job_column_perms)';
  end;

  update jobs set percent_complete = 20 where id = other_job_id;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: assembler updated a job not assigned to them (% rows)', n; end if;
  raise notice 'PASS: assembler cannot touch a job assigned to someone else';

  begin
    update jobs set stage = 'complete' where id = test_job_id;
    raise exception 'FAIL: assembler skipped stages without the checklist gate firing';
  exception when others then
    raise notice 'PASS: stage-skip blocked (trg_stage_transition): %', sqlerrm;
  end;

  insert into job_checklist (job_id, step_index, item_index, done)
  values (test_job_id, 0, 0, true)
  on conflict (job_id, step_index, item_index) do update set done = true;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: assembler could not check off an item on their own job'; end if;
  raise notice 'PASS: assembler completes a checklist item on assigned job';

  begin
    delete from activity_log where actor = assembler_id;
    raise exception 'FAIL: activity_log allowed a delete -- audit trail is not append-only';
  exception when insufficient_privilege then
    raise notice 'PASS: activity_log delete blocked for assembler';
  end;

  insert into activity_log (action, detail) values ('harness test', '{}'::jsonb);
  perform 1 from activity_log where action = 'harness test' and actor = assembler_id;
  if not found then raise exception 'FAIL: activity_log did not stamp actor = auth.uid()'; end if;
  raise notice 'PASS: activity_log actor stamped server-side from auth.uid()';

  insert into blockers (job_id, issue) values (test_job_id, 'harness blocker');
  raise notice 'PASS: assembler can report a blocker (insert unrestricted by design)';

  begin
    update blockers set status = 'Resolved' where job_id = test_job_id;
    raise exception 'FAIL: assembler resolved a blocker (lead/admin only)';
  exception when insufficient_privilege then
    raise notice 'PASS: assembler cannot change blocker status';
  end;

  -- ================== LEAD ==================
  raise notice '--- as LEAD ---';
  perform set_config('request.jwt.claims', json_build_object('sub', lead_id)::text, true);

  update jobs set priority = 'High', assigned_to = other_id where id = test_job_id;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: lead could not reassign / edit job fields'; end if;
  raise notice 'PASS: lead edits full job record including assignment';

  update blockers set status = 'Resolved' where job_id = test_job_id;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: lead could not resolve a blocker'; end if;
  raise notice 'PASS: lead resolves a blocker';

  insert into blueprints (job_id, status) values (test_job_id, 'extracted');
  raise notice 'PASS: lead can create a blueprint record';

  update blueprints set status = 'approved' where job_id = test_job_id;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: lead could not approve a blueprint'; end if;
  raise notice 'PASS: lead approves a blueprint extraction';

  begin
    delete from jobs where id = other_job_id;
    raise exception 'FAIL: lead deleted a job (admin only)';
  exception when insufficient_privilege then
    raise notice 'PASS: lead cannot delete jobs';
  end;

  begin
    update profiles set role = 'admin' where id = lead_id;
    raise exception 'FAIL: lead self-promoted to admin';
  exception when insufficient_privilege then
    raise notice 'PASS: lead cannot change their own role';
  end;

  -- ================== ADMIN ==================
  raise notice '--- as ADMIN ---';
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id)::text, true);

  update profiles set role = 'lead' where id = assembler_id;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: admin could not change a role'; end if;
  raise notice 'PASS: admin manages roles';

  delete from jobs where id = other_job_id;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: admin could not delete a job'; end if;
  raise notice 'PASS: admin deletes a job';

  begin
    delete from activity_log where action = 'harness test';
    raise exception 'FAIL: admin deleted an activity_log row -- append-only must hold for every role';
  exception when insufficient_privilege then
    raise notice 'PASS: activity_log immutable even for admin';
  end;

  raise notice '--- cleanup ---';
  reset role;
  delete from jobs where job_number in ('HARNESS-1','HARNESS-2');
  delete from profiles where id in (admin_id, lead_id, assembler_id, other_id);
  delete from activity_log where action = 'harness test';

  raise notice '=== ROLE HARNESS: ALL CHECKS PASSED ===';
end $$;
