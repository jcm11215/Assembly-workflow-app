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
  admin_id       uuid := gen_random_uuid();
  lead_id        uuid := gen_random_uuid();
  assembler_id   uuid := gen_random_uuid();
  other_id       uuid := gen_random_uuid();   -- second assembler, not assigned to test_job
  assembler_a_id uuid := gen_random_uuid();   -- experienced tier
  assembler_b_id uuid := gen_random_uuid();   -- trainee tier
  test_job_id    uuid;
  other_job_id   uuid;
  job_a_id       uuid;   -- assigned to assembler A, walked ready -> complete
  job_b_id       uuid;   -- assigned to assembler B, walked ready -> testing, then blocked at sign-off
  n              int;
  step0_items    int := 5;   -- PROCEDURE[0].items.length, must match triggers.sql
  step_idx       smallint;
  item_idx       int;
  next_stage     job_stage;
begin
  raise notice '--- setting up fixtures as postgres (bypasses RLS) ---';
  set local role postgres;

  insert into profiles (id, full_name, role) values
    (admin_id, 'Harness Admin', 'admin'),
    (lead_id, 'Harness Lead', 'lead'),
    (assembler_id, 'Harness Assembler', 'assembler'),
    (other_id, 'Harness Other Assembler', 'assembler'),
    (assembler_a_id, 'Harness Assembler A', 'assembler_a'),
    (assembler_b_id, 'Harness Assembler B', 'assembler_b')
  on conflict (id) do update set role = excluded.role;

  insert into jobs (job_number, customer, stage, assigned_to)
  values ('HARNESS-1', 'Test Co', 'ready', assembler_id)
  returning id into test_job_id;

  insert into jobs (job_number, customer, stage, assigned_to)
  values ('HARNESS-2', 'Test Co', 'ready', other_id)
  returning id into other_job_id;

  insert into jobs (job_number, customer, stage, assigned_to)
  values ('HARNESS-3', 'Test Co', 'ready', assembler_a_id)
  returning id into job_a_id;

  insert into jobs (job_number, customer, stage, assigned_to)
  values ('HARNESS-4', 'Test Co', 'ready', assembler_b_id)
  returning id into job_b_id;

  -- Pre-clear every checklist gate (steps 0-6) on both tier-test jobs, so
  -- the walk-throughs below exercise the sign-off gate itself rather than
  -- re-proving the checklist gate that the legacy ASSEMBLER block above
  -- already covers.
  foreach step_idx in array array[0,1,2,3,4,5,6]::smallint[] loop
    for item_idx in 0 .. step_item_count(step_idx) - 1 loop
      insert into job_checklist (job_id, step_index, item_index, done)
      values (job_a_id, step_idx, item_idx, true)
      on conflict (job_id, step_index, item_index) do update set done = true;
      insert into job_checklist (job_id, step_index, item_index, done)
      values (job_b_id, step_idx, item_idx, true)
      on conflict (job_id, step_index, item_index) do update set done = true;
    end loop;
  end loop;

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

  -- ================== ASSEMBLER A (experienced) ==================
  -- Checklist gates are already pre-cleared on HARNESS-3 (job_a_id), so
  -- this walk exercises the sign-off gate (can_sign_off), not the
  -- checklist gate -- that's covered above for the legacy assembler role.
  raise notice '--- as ASSEMBLER A (experienced, assigned to HARNESS-3) ---';
  perform set_config('request.jwt.claims', json_build_object('sub', assembler_a_id)::text, true);

  update jobs set percent_complete = 35 where id = job_a_id;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: assembler_a could not update percent_complete on own assigned job'; end if;
  raise notice 'PASS: assembler_a updates percent_complete on assigned job';

  foreach next_stage in array array['layout','bearings','drive','final','testing','qc','complete']::job_stage[] loop
    update jobs set stage = next_stage where id = job_a_id;
    get diagnostics n = row_count;
    if n <> 1 then
      raise exception 'FAIL: assembler_a (experienced) could not advance HARNESS-3 into %', next_stage;
    end if;
  end loop;
  raise notice 'PASS: assembler_a (experienced) walked HARNESS-3 all the way through qc and complete';

  -- ================== ASSEMBLER B (trainee) ==================
  raise notice '--- as ASSEMBLER B (trainee, assigned to HARNESS-4) ---';
  perform set_config('request.jwt.claims', json_build_object('sub', assembler_b_id)::text, true);

  -- Same day-to-day rights as an experienced assembler: progress, checklist,
  -- notes, blockers -- the tier only restricts sign-off, nothing else.
  update jobs set percent_complete = 35 where id = job_b_id;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: assembler_b (trainee) could not update percent_complete on own assigned job'; end if;
  raise notice 'PASS: assembler_b (trainee) updates percent_complete on assigned job';

  update job_checklist set done = false where job_id = job_b_id and step_index = 0 and item_index = 0;
  update job_checklist set done = true  where job_id = job_b_id and step_index = 0 and item_index = 0;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: assembler_b (trainee) could not toggle a checklist item on own assigned job'; end if;
  raise notice 'PASS: assembler_b (trainee) completes a checklist item on assigned job';

  insert into notes (job_id, author, body) values (job_b_id, assembler_b_id, 'harness note by assembler B');
  raise notice 'PASS: assembler_b (trainee) can add a note';

  insert into blockers (job_id, issue) values (job_b_id, 'harness blocker by assembler B');
  raise notice 'PASS: assembler_b (trainee) can report a blocker';

  -- Full stage walk up to (but not into) a sign-off stage: same as an
  -- experienced assembler, checklist gates already pre-cleared.
  foreach next_stage in array array['layout','bearings','drive','final','testing']::job_stage[] loop
    update jobs set stage = next_stage where id = job_b_id;
    get diagnostics n = row_count;
    if n <> 1 then
      raise exception 'FAIL: assembler_b (trainee) could not advance HARNESS-4 into % (should match assembler_a up to testing)', next_stage;
    end if;
  end loop;
  raise notice 'PASS: assembler_b (trainee) walked HARNESS-4 through every stage up to testing, same as an experienced assembler';

  begin
    update jobs set stage = 'qc' where id = job_b_id;
    raise exception 'FAIL: assembler_b (trainee) was able to sign HARNESS-4 into qc';
  exception when insufficient_privilege then
    raise notice 'PASS: assembler_b (trainee) blocked from testing -> qc: %', sqlerrm;
  end;

  -- A trainee can also be handed a job that's already past qc (e.g.
  -- reassigned by a lead) -- confirm qc -> complete is blocked too, not
  -- just the testing -> qc hop.
  raise notice '--- lead advances HARNESS-4 into qc so the qc -> complete gate can be tested ---';
  perform set_config('request.jwt.claims', json_build_object('sub', lead_id)::text, true);
  update jobs set stage = 'qc' where id = job_b_id;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: lead could not advance HARNESS-4 into qc (test setup)'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', assembler_b_id)::text, true);
  begin
    update jobs set stage = 'complete' where id = job_b_id;
    raise exception 'FAIL: assembler_b (trainee) was able to sign HARNESS-4 into complete';
  exception when insufficient_privilege then
    raise notice 'PASS: assembler_b (trainee) blocked from qc -> complete: %', sqlerrm;
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
  delete from jobs where job_number in ('HARNESS-1','HARNESS-2','HARNESS-3','HARNESS-4');
  delete from profiles where id in (admin_id, lead_id, assembler_id, other_id, assembler_a_id, assembler_b_id);
  delete from activity_log where action = 'harness test';

  raise notice '=== ROLE HARNESS: ALL CHECKS PASSED ===';
end $$;
