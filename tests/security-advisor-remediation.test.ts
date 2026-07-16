import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  'supabase/migrations/20260715005307_harden_bootstrap_security_advisor.sql',
  'utf8'
);
const statusRoute = readFileSync('app/api/setup/status/route.ts', 'utf8');
const completeRoute = readFileSync('app/api/setup/complete/route.ts', 'utf8');

test('anonymous bootstrap is denied and authenticated bootstrap is the only grant', () => {
  assert.match(
    migration,
    /revoke all on function public\.bootstrap_first_workspace\(text, text, text, text\)[\s\S]*?from public, anon, authenticated;/
  );
  assert.match(
    migration,
    /grant execute on function public\.bootstrap_first_workspace\(text, text, text, text\)[\s\S]*?to authenticated;/
  );
  assert.doesNotMatch(migration, /bootstrap_first_workspace[^;]+to anon/);
  assert.match(migration, /caller_id uuid := auth\.uid\(\)/);
  assert.match(migration, /if caller_id is null then/);
});

test('historical first bootstrap created a fixed owner state and is now retired by the application', () => {
  assert.match(migration, /insert into public\.profiles/);
  assert.match(migration, /insert into public\.workspaces \(name, owner_user_id, status\)/);
  assert.match(migration, /values \(pg_catalog\.btrim\(workspace_name\), caller_id, 'active'\)/);
  assert.match(migration, /insert into public\.workspace_members \(workspace_id, user_id, role, status\)/);
  assert.match(migration, /values \(new_workspace_id, caller_id, 'owner', 'active'\)/);
  assert.match(migration, /'success', true,[\s\S]*?'workspaceId', new_workspace_id,[\s\S]*?'role', 'owner'/);
  assert.doesNotMatch(migration, /'profileId'|'membershipId'/);
  assert.match(completeRoute, /legacy-setup-retired/);
  assert.match(completeRoute, /status: 410/);
});

test('second and concurrent bootstrap attempts are denied atomically', () => {
  assert.match(migration, /pg_catalog\.pg_advisory_xact_lock/);
  assert.match(migration, /pg_catalog\.hashtextextended\('nexora:first-workspace', 0\)/);
  assert.match(migration, /from setup_private\.workspace_setup_state[\s\S]*?for update/);
  assert.match(migration, /exists \(select 1 from public\.workspaces\)/);
  assert.match(migration, /where role = 'owner' and status = 'active'/);
  assert.match(migration, /set setup_available = false/);
  assert.match(migration, /message = 'setup closed'/);
});

test('bootstrap records a non-sensitive security activity and cannot accept owner values', () => {
  assert.match(migration, /'first_workspace_bootstrapped'/);
  assert.match(migration, /'source', 'authenticated-bootstrap'/);
  assert.doesNotMatch(
    migration,
    /bootstrap_first_workspace\([\s\S]{0,250}(workspace_id|owner_user_id|membership_role)/
  );
});

test('workspace spoofing and ordinary-user system checks are denied', () => {
  assert.match(migration, /create or replace function public\.sprint_004_system_check\(target_workspace_id uuid\)/);
  assert.match(
    migration,
    /where workspace_id = target_workspace_id[\s\S]*?and user_id = caller_id[\s\S]*?and status = 'active'[\s\S]*?and role in \('owner', 'admin'\)/
  );
  assert.match(migration, /message = 'workspace permission denied'/);
  assert.doesNotMatch(migration, /sprint_004_system_check[\s\S]*?security definer/);
  assert.match(migration, /sprint_004_system_check[\s\S]*?security invoker/);
});

test('owner and admin system checks return aggregate non-sensitive booleans only', () => {
  assert.match(migration, /role in \('owner', 'admin'\)/);
  assert.match(migration, /'migration'[\s\S]*?'applied'/);
  assert.match(migration, /'rlsEnabled'/);
  assert.match(migration, /'storagePrivate'/);
  const systemCheck = migration.slice(migration.indexOf('create or replace function public.sprint_004_system_check'));
  assert.doesNotMatch(systemCheck, /information_schema|pg_policies|role_table_grants|auth\.users/);
});

test('historical setup status helper is hardened and the application reports it closed', () => {
  assert.match(migration, /create or replace function public\.workspace_setup_available\(\)/);
  assert.match(migration, /returns boolean[\s\S]*?security invoker[\s\S]*?set search_path = ''/);
  assert.match(migration, /grant select \(setup_available\)/);
  assert.match(statusRoute, /setupOpen: false/);
  assert.match(statusRoute, /replacement: '\/signup'/);
  assert.doesNotMatch(statusRoute, /workspaceId|userId|owner|member/i);
  assert.match(migration, /drop function public\.workspace_setup_open\(\)/);
  assert.match(
    migration,
    /create or replace function public\.workspace_setup_open\(\)[\s\S]*?returns boolean[\s\S]*?security invoker[\s\S]*?select public\.workspace_setup_available\(\)/
  );
  assert.match(migration, /grant execute on function public\.workspace_setup_open\(\) to authenticated/);
  assert.doesNotMatch(migration, /grant execute on function public\.workspace_setup_open\(\) to anon/);
});

test('retained definers use an empty search path and schema-qualified relations', () => {
  const bootstrap = migration.slice(
    migration.indexOf('create or replace function public.bootstrap_first_workspace'),
    migration.indexOf('-- This is an operational deployment diagnostic')
  );
  assert.match(bootstrap, /security definer[\s\S]*?set search_path = ''/);
  for (const relation of ['profiles', 'workspaces', 'workspace_members', 'activity_logs']) {
    assert.match(bootstrap, new RegExp(`public\\.${relation}`));
  }
  assert.match(bootstrap, /auth\.users/);
  assert.match(bootstrap, /setup_private\.workspace_setup_state/);
});

test('PUBLIC execute is removed from every affected function', () => {
  for (const signature of [
    'workspace_setup_available\\(\\)',
    'bootstrap_first_workspace\\(text, text, text, text\\)',
    'sprint_004_system_check\\(uuid\\)',
    'assign_beta_rows_to_workspace\\(uuid\\)'
  ]) {
    assert.match(
      migration,
      new RegExp(`revoke all on function public\\.${signature}[\\s\\S]*?from public`)
    );
  }
  assert.match(migration, /where rolname = pg_catalog\.concat\('service', '_role'\)/);
  assert.match(migration, /revoke all on function public\.bootstrap_first_workspace/);
});
