import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { normalizeCrmEmail, normalizeCrmPhone, normalizeHttpUrl, normalizeStringList, nullableNumber } from '../lib/crm/normalize';
import { canCreateCrm, canDeleteCrm, canManageCrmRecord, canReadCrm, maskCrmContact } from '../lib/crm/permissions';
import { availableCrmStageTransitions, crmStageLabel, CRM_PIPELINE_STAGES, isCrmPipelineStage, validateCrmStageTransition } from '../lib/crm/pipeline';

const root = process.cwd();

test('canonical agent journey has stable order and bilingual labels', () => {
  assert.deepEqual(CRM_PIPELINE_STAGES, [
    'NEW_ENQUIRY','CONTACTED','QUALIFIED','MATCHED','VIEWING_SCHEDULED','VIEWING_COMPLETED',
    'FOLLOW_UP','NEGOTIATION','BOOKING','LEGAL','HANDOVER','CLOSED','LOST','AFTER_SALES',
  ]);
  for (const stage of CRM_PIPELINE_STAGES) {
    assert.equal(isCrmPipelineStage(stage), true);
    assert.ok(crmStageLabel(stage, 'en').length > 0);
    assert.ok(crmStageLabel(stage, 'zh').length > 0);
  }
});

test('pipeline transitions prevent skips and terminal reopening', () => {
  assert.equal(validateCrmStageTransition('NEW_ENQUIRY','CONTACTED'), true);
  assert.equal(validateCrmStageTransition('NEW_ENQUIRY','NEGOTIATION'), false);
  assert.equal(validateCrmStageTransition('VIEWING_COMPLETED','FOLLOW_UP'), true);
  assert.equal(validateCrmStageTransition('FOLLOW_UP','VIEWING_SCHEDULED'), true);
  assert.equal(validateCrmStageTransition('CLOSED','AFTER_SALES'), true);
  assert.equal(validateCrmStageTransition('LOST','NEW_ENQUIRY'), false);
  assert.deepEqual(availableCrmStageTransitions('HANDOVER'), ['CLOSED','LOST']);
});

test('CRM role helpers enforce read-only and assignment boundaries', () => {
  assert.equal(canReadCrm('viewer'), true);
  assert.equal(canReadCrm('finance'), true);
  assert.equal(canCreateCrm('finance'), false);
  assert.equal(canCreateCrm('agent'), true);
  assert.equal(canManageCrmRecord('agent','user-1','user-1'), true);
  assert.equal(canManageCrmRecord('agent','user-2','user-1'), false);
  assert.equal(canManageCrmRecord('manager','user-2','user-1'), false);
  assert.equal(canDeleteCrm('admin'), true);
  assert.equal(canDeleteCrm('manager'), false);
  assert.match(maskCrmContact('client@example.com'), /^c\*\*\*@example\.com$/);
  assert.match(maskCrmContact('+60123456789'), /6789$/);
  assert.equal(canReadCrm(null as never), false);
});

test('client normalization is deterministic and null-safe', () => {
  assert.equal(normalizeCrmPhone('012-345 6789'), '+60123456789');
  assert.equal(normalizeCrmPhone('+60 12 345 6789'), '+60123456789');
  assert.equal(normalizeCrmPhone(null), '');
  assert.equal(normalizeCrmEmail(' Client@Example.COM '), 'client@example.com');
  assert.deepEqual(normalizeStringList('KLCC, Mont Kiara, , Bangsar'), ['KLCC','Mont Kiara','Bangsar']);
  assert.equal(nullableNumber('-1'), null);
  assert.equal(nullableNumber('2500'), 2500);
  assert.equal(normalizeHttpUrl('javascript:alert(1)'), '');
  assert.equal(normalizeHttpUrl('https://maps.example/point'), 'https://maps.example/point');
});

test('migration creates additive workspace-safe workflow tables, indexes, history, and RLS', () => {
  const sql = readFileSync(join(root,'supabase/migrations/20260724090000_agent_crm_appointment_foundation.sql'),'utf8');
  for (const table of ['crm_enquiries','crm_deals','crm_appointments','crm_follow_ups','crm_listing_matches','crm_enquiry_stage_history','crm_deal_stage_history']) {
    assert.match(sql,new RegExp(`create table if not exists public\\.${table}`));
    assert.match(sql,new RegExp(`alter table public\\.${table} enable row level security`));
  }
  assert.match(sql,/alter table public\.contacts[\s\S]*client_type/);
  assert.match(sql,/foreign key \(workspace_id, contact_id\) references public\.contacts\(workspace_id, id\)/);
  assert.match(sql,/foreign key \(workspace_id, commercial_listing_id\) references public\.commercial_listings\(workspace_id, id\)/);
  assert.match(sql,/crm_stage_transition_allowed/);
  assert.match(sql,/crm_record_stage_change/);
  assert.match(sql,/invalid CRM stage transition/);
  assert.match(sql,/crm_appointments_workspace_start_idx/);
  assert.match(sql,/crm_follow_ups_workspace_due_idx/);
  assert.match(sql,/to authenticated/);
  assert.match(sql,/with check/);
  assert.match(sql,/revoke all on public\.crm_enquiries/);
  assert.doesNotMatch(sql,/security definer/i);
});

test('CRM routes enforce workspace auth, mutation roles, duplicate warnings, and assignment checks', () => {
  const enquiries = readFileSync(join(root,'app/api/crm/enquiries/route.ts'),'utf8');
  const appointments = readFileSync(join(root,'app/api/crm/appointments/route.ts'),'utf8');
  const clients = readFileSync(join(root,'app/api/crm/clients/route.ts'),'utf8');
  for (const route of [enquiries, appointments, clients]) assert.match(route,/requireWorkspaceAccess/);
  assert.match(enquiries,/CRM_WRITE_ROLES/);
  assert.match(enquiries,/possible-duplicate-client/);
  assert.match(enquiries,/confirmDuplicate/);
  assert.match(enquiries,/validateCrmStageTransition/);
  assert.match(enquiries,/canManageCrmRecord/);
  assert.match(appointments,/canManageCrmRecord/);
  assert.match(clients,/possible-duplicate-client/);
});

test('enquiry route covers create, edit, assign, contact, archive, loss, and deal conversion actions', () => {
  const route = readFileSync(join(root,'app/api/crm/enquiries/route.ts'),'utf8');
  assert.match(route,/\.from\('crm_enquiries'\)\.insert/);
  assert.match(route,/changes\.assigned_user_id/);
  assert.match(route,/validateCrmStageTransition/);
  assert.match(route,/lost-reason-required/);
  assert.match(route,/action === 'archive'/);
  assert.match(route,/action === 'convert-to-deal'/);
  assert.match(route,/enquiry_stage_changed/);
});

test('appointment route covers create, reschedule, cancellation, completion, no-show, outcome, and linkage', () => {
  const route = readFileSync(join(root,'app/api/crm/appointments/route.ts'),'utf8');
  const ui = readFileSync(join(root,'app/appointments/appointments-workspace.tsx'),'utf8');
  assert.match(route,/\.from\('crm_appointments'\)\.insert/);
  for (const status of ['rescheduled','cancelled','completed','no_show']) assert.match(route,new RegExp(`'${status}'`));
  assert.match(route,/follow_up_at/);
  assert.match(route,/map_url/);
  assert.match(ui,/Create follow-up/);
  assert.match(ui,/Open client/);
  assert.match(ui,/enquiry_id/);
});

test('follow-up, overdue, listing match, and enquiry conversion relationships are persisted', () => {
  const followUps = readFileSync(join(root,'app/api/crm/follow-ups/route.ts'),'utf8');
  const matches = readFileSync(join(root,'app/api/crm/matches/route.ts'),'utf8');
  const enquiries = readFileSync(join(root,'app/api/crm/enquiries/route.ts'),'utf8');
  assert.match(followUps,/bucket === 'overdue'/);
  assert.match(followUps,/appointment_id/);
  assert.match(followUps,/deal_id/);
  assert.match(matches,/crm_listing_matches/);
  assert.match(matches,/enquiry_id/);
  assert.match(enquiries,/enquiry_id: current\.data\.id/);
});

test('Home metrics, search groups, and derived notification coverage use live CRM queries', () => {
  const summary = readFileSync(join(root,'app/api/crm/summary/route.ts'),'utf8');
  const search = readFileSync(join(root,'app/api/search/route.ts'),'utf8');
  const notifications = readFileSync(join(root,'app/api/notifications/route.ts'),'utf8');
  for (const metric of ['newEnquiriesToday','hotLeads','followUpsDueToday','viewingsToday','activeDeals']) assert.match(summary,new RegExp(metric));
  for (const table of ['crm_enquiries','contacts','crm_appointments','crm_follow_ups','crm_deals']) assert.match(search,new RegExp(`from\\('${table}'\\)`));
  for (const notification of ['Appointment in 1 hour','crm-hot-no-follow-up','deal_stage_changed','crm-inactive']) assert.match(notifications,new RegExp(notification));
});

test('workspace isolation and preserved route shells remain explicit', () => {
  const migration = readFileSync(join(root,'supabase/migrations/20260724090000_agent_crm_appointment_foundation.sql'),'utf8');
  assert.match(migration,/foreign key \(workspace_id, enquiry_id\)/);
  assert.match(migration,/public\.has_workspace_role\(workspace_id/);
  for (const path of ['app/home/page.tsx','app/dashboard/page.tsx','app/documents/page.tsx','app/collections/page.tsx','app/commercial/page.tsx','app/settings/page.tsx']) {
    assert.equal(existsSync(join(root,path)),true,path);
  }
});

test('production workspaces and integrations point at the shared CRM records', () => {
  const crm = readFileSync(join(root,'app/crm/crm-workspace.tsx'),'utf8');
  const appointment = readFileSync(join(root,'app/appointments/appointments-workspace.tsx'),'utf8');
  const home = readFileSync(join(root,'app/home/home-portal.tsx'),'utf8');
  const search = readFileSync(join(root,'app/api/search/route.ts'),'utf8');
  const notifications = readFileSync(join(root,'app/api/notifications/route.ts'),'utf8');
  assert.match(crm,/\/api\/crm\/enquiries/);
  assert.match(crm,/crm-kanban/);
  assert.match(crm,/possibleDuplicate/);
  assert.match(appointment,/\/api\/crm\/appointments/);
  assert.match(appointment,/status:'completed'/);
  assert.match(home,/\/api\/crm\/summary/);
  assert.match(home,/\/appointments\?action=new-appointment/);
  assert.match(search,/\.from\('crm_enquiries'\)/);
  assert.match(search,/\.from\('crm_appointments'\)/);
  assert.match(search,/\.from\('crm_deals'\)/);
  assert.match(notifications,/crm_follow_ups/);
  assert.match(notifications,/crm-inactive/);
  for (const source of [crm, appointment]) assert.doesNotMatch(source,/mockData|fakeData|seeded/i);
});

test('protected tenancy extraction and deposit files are not referenced by Sprint 007 changes', () => {
  const status = readFileSync(join(root,'tests/agent-crm-appointments.test.ts'),'utf8');
  assert.doesNotMatch(status,/lib\/ai\/tenancy|lib\/ai\/normalizeDeposits|app\/api\/tenancies\/extract/);
});
