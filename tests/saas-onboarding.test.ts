import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { destinationForMemberships, getSafeNextPath } from '../lib/auth/navigation';

const migration = readFileSync('supabase/migrations/20260716101934_sprint_008_multitenant_saas_onboarding.sql', 'utf8');
const signup = readFileSync('app/signup/page.tsx', 'utf8');
const callback = readFileSync('app/auth/callback/route.ts', 'utf8');
const provisionRoute = readFileSync('app/api/workspaces/provision/route.ts', 'utf8');
const server = readFileSync('lib/supabase/server.ts', 'utf8');
const invitationRoute = readFileSync('app/api/workspace-invitations/route.ts', 'utf8');
const acceptRoute = readFileSync('app/api/workspace-invitations/accept/route.ts', 'utf8');
const onboarding = readFileSync('app/onboarding/workspace/page.tsx', 'utf8');

test('onboarding has no anonymous-auth dependency', () => {
  for (const source of [signup, callback, provisionRoute, onboarding]) assert.doesNotMatch(source, /signInAnonymously|anonymous sign-in/i);
});

test('signup uses email and password with verification callback', () => {
  assert.match(signup, /auth\.signUp/); assert.match(signup, /emailRedirectTo/); assert.match(signup, /\/auth\/callback/);
});

test('existing accounts receive a non-enumerating response', () => {
  assert.match(signup, /already registered/); assert.doesNotMatch(signup, /account exists for/i);
});

test('signup and onboarding contain bilingual validation strings', () => {
  assert.match(signup, /Passwords do not match/); assert.match(signup, /两次输入的密码不一致/);
  assert.match(onboarding, /Complete all required fields/); assert.match(onboarding, /请填写所有必填项目/);
});

test('callback requires verified email and exchanges the PKCE code', () => {
  assert.match(callback, /exchangeCodeForSession/); assert.match(callback, /email_confirmed_at/);
});

test('safe next rejects open redirects', () => {
  assert.equal(getSafeNextPath('https://evil.example/steal'), '/onboarding/workspace');
  assert.equal(getSafeNextPath('//evil.example/steal'), '/onboarding/workspace');
  assert.equal(getSafeNextPath('/documents?tab=all'), '/documents?tab=all');
});

test('membership routing covers no, one, many, and suspended memberships', () => {
  assert.equal(destinationForMemberships([]), '/onboarding/workspace');
  assert.equal(destinationForMemberships([{ workspaceId: 'a', status: 'active' }]), '/home');
  assert.equal(destinationForMemberships([{ workspaceId: 'a', status: 'active' }, { workspaceId: 'b', status: 'active' }]), '/workspace/select');
  assert.match(destinationForMemberships([{ workspaceId: 'a', status: 'suspended' }]), /access-denied/);
});

test('workspace provisioning is atomic and idempotent', () => {
  assert.match(migration, /pg_advisory_xact_lock/); assert.match(migration, /onboarding_attempts/);
  assert.match(migration, /unique \(user_id, idempotency_key\)/); assert.match(migration, /idempotentReplay/);
});

test('provisioning creates a fixed owner membership and activity log', () => {
  assert.match(migration, /values \(new_workspace_id, caller_id, 'owner', 'active'\)/);
  assert.match(migration, /'workspace_provisioned'/);
  const payloadType = provisionRoute.slice(provisionRoute.indexOf('type ProvisionPayload'), provisionRoute.indexOf('export async function'));
  assert.doesNotMatch(payloadType, /owner_user_id|ownerId|role/);
});

test('provisioning derives the caller and has no anonymous execution grant', () => {
  assert.match(migration, /caller_id uuid := auth\.uid\(\)/);
  assert.match(migration, /revoke all on function public\.provision_workspace[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.provision_workspace[\s\S]*to authenticated/);
});

test('privileged functions use empty search paths and qualified relations', () => {
  for (const name of ['provision_workspace', 'create_workspace_invitation', 'accept_workspace_invitation']) {
    const start = migration.indexOf(`function public.${name}`); assert.ok(start >= 0);
    assert.match(migration.slice(start, start + 1400), /security definer[\s\S]*set search_path = ''/);
  }
});

test('active workspace IDs are validated against the signed-in user', () => {
  assert.match(server, /ACTIVE_WORKSPACE_COOKIE/); assert.match(server, /eq\('user_id', user\.id\)/); assert.match(server, /eq\('workspace_id', requestedWorkspaceId\)/);
});

test('cross-workspace business access stays workspace scoped', () => {
  assert.match(server, /workspaceId: String\(membership\.data\.workspace_id\)/);
  assert.doesNotMatch(server, /request[\s\S]*workspaceId[\s\S]*as AuthContext/);
});

test('membership table supports multiple workspaces per user', () => {
  assert.match(migration, /view public\.workspace_memberships[\s\S]*security_invoker/);
  assert.match(migration, /workspace_members/); assert.doesNotMatch(migration, /unique \(user_id\)(?!,)/);
});

test('final owner cannot be removed or demoted', () => {
  assert.match(migration, /protect_final_workspace_owner/); assert.match(migration, /final_owner_required/);
});

test('non-owners cannot create owner invitations', () => {
  assert.match(migration, /invite_role not in \('admin', 'manager', 'agent', 'finance', 'viewer'\)/);
  assert.match(invitationRoute, /allowedRoles = \['admin', 'manager', 'agent', 'finance', 'viewer'\]/);
  assert.doesNotMatch(invitationRoute, /allowedRoles = \[[^\]]*owner/);
});

test('invitation creation requires Owner or Admin membership', () => {
  assert.match(invitationRoute, /requireWorkspaceAccess\(\['owner', 'admin'\]/);
  assert.match(migration, /role in \('owner', 'admin'\) and status = 'active'/);
});

test('invitation tokens are random, hashed, and expiring', () => {
  assert.match(migration, /gen_random_bytes\(32\)/); assert.match(migration, /digest\(raw_token, 'sha256'\)/); assert.match(migration, /expires_at <= now\(\)/);
});

test('invitation acceptance requires matching authenticated email', () => {
  assert.match(migration, /lower\(invitation\.email\) <> caller_email/); assert.match(migration, /invitation_email_mismatch/);
  assert.match(acceptRoute, /email_confirmed_at/);
});

test('duplicate active invitations are prevented', () => {
  assert.match(migration, /workspace_invitations_active_email_idx/); assert.match(migration, /where status = 'pending'/);
});

test('RLS is enabled on new exposed tables', () => {
  assert.match(migration, /alter table public\.onboarding_attempts enable row level security/);
  assert.match(migration, /alter table public\.workspace_invitations enable row level security/);
});

test('direct invitation mutation grants are not exposed', () => {
  assert.match(migration, /revoke all on public\.workspace_invitations from public, anon, authenticated/);
  assert.doesNotMatch(migration, /grant (insert|update|delete).*workspace_invitations/i);
});

test('legacy global bootstrap is retired without deleting existing workspaces', () => {
  assert.match(migration, /revoke all on function public\.bootstrap_first_workspace/);
  assert.doesNotMatch(migration, /drop table public\.workspaces|truncate public\.workspaces/i);
});

test('client code contains no privileged credential reference', () => {
  for (const source of [signup, onboarding, provisionRoute, invitationRoute]) assert.doesNotMatch(source, /SERVICE_ROLE|service-role/i);
});

test('workspace selection only uses current-user membership rows', () => {
  const route = readFileSync('app/api/workspaces/active/route.ts', 'utf8');
  assert.match(route, /eq\('user_id', user\.data\.user\.id\)/); assert.match(route, /membership\.data\.status !== 'active'/);
});
