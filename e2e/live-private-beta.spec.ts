import { createClient } from '@supabase/supabase-js';
import { expect, test, type Page } from '@playwright/test';

const live = process.env.PLAYWRIGHT_LIVE_SUPABASE === '1';
const phase = process.env.PLAYWRIGHT_LIVE_PHASE ?? '';
const ownerEmail = process.env.E2E_OWNER_EMAIL ?? '';
const ownerPassword = process.env.E2E_OWNER_PASSWORD ?? '';
const adminEmail = process.env.E2E_ADMIN_EMAIL ?? '';
const managerEmail = process.env.E2E_MANAGER_EMAIL ?? '';
const agentEmail = process.env.E2E_AGENT_EMAIL ?? '';
const financeEmail = process.env.E2E_FINANCE_EMAIL ?? '';
const viewerEmail = process.env.E2E_VIEWER_EMAIL ?? '';
const ownerBEmail = process.env.E2E_OWNER_B_EMAIL ?? '';
const workspaceAId = process.env.E2E_WORKSPACE_A_ID ?? '';
const workspaceBId = process.env.E2E_WORKSPACE_B_ID ?? '';
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

async function login(page: Page, email: string, password = ownerPassword) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });
}

async function authenticatedClient(email: string) {
  const client = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password: ownerPassword });
  expect(error).toBeNull();
  return client;
}

test('live first-admin setup is atomic and persists', async ({ page }) => {
  test.skip(!live || phase !== 'setup', 'Run only during the live setup phase.');

  await login(page, ownerEmail);
  await page.goto('/setup');
  await page.getByLabel('Workspace name').fill('Sprint 004 Workspace A');
  await page.getByLabel('Full name').fill('Synthetic Owner A');
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL('/');

  await page.reload();
  await expect(page).toHaveURL('/');
  const status = await page.request.get('/api/setup/status');
  expect(status.ok()).toBeTruthy();
  expect((await status.json()).setupOpen).toBe(false);
});

test('live unauthenticated requests fail closed', async ({ page }) => {
  test.skip(!live || phase !== 'unauth', 'Run only during the live unauthenticated phase.');

  await page.goto('/collections');
  await expect(page).toHaveURL(/\/login/);
  expect((await page.request.get('/api/collections/overview')).status()).toBe(401);
  expect((await page.request.post('/api/collections/generate-monthly', {
    data: { month: new Date().toISOString().slice(0, 7) }
  })).status()).toBe(401);
});

test('live production workflow, role checks and workspace isolation', async ({ page }) => {
  test.skip(!live || phase !== 'workflow', 'Run only during the live workflow phase.');
  test.slow();

  const stamp = Date.now();
  const month = new Date().toISOString().slice(0, 7);
  const onePixelPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const utilityBillPng = Buffer.concat([onePixelPng, Buffer.from(String(stamp))]);
  await login(page, ownerEmail);

  const create = await page.request.post('/api/tenancies/create-with-collection', {
    data: {
      tenancy: {
        tenant: `Synthetic Tenant ${stamp}`,
        landlord: 'Synthetic Landlord',
        property: 'Synthetic Residence',
        unit_no: `A-${stamp}`,
        monthly_rental: 3000,
        security_deposit: 6000,
        utility_deposit: 1000,
        access_card_deposit: 200,
        car_park_remote_deposit: 100,
        commencement_date: `${month}-01`,
        expiry_date: '2027-06-30',
        renewal_reminder: '2027-04-01',
        status: 'active'
      },
      collection: {
        collection_month: `${month}-01`,
        due_date: `${month}-01`,
        rental_amount: 3000,
        tnb_amount: 0,
        water_amount: 0,
        iwk_amount: 0,
        wifi_amount: 0,
        aircond_amount: 0,
        other_charges: 0,
        amount_paid: 0,
        payment_status: 'outstanding',
        payment_history: []
      }
    }
  });
  expect(create.ok(), await create.text()).toBeTruthy();
  const created = await create.json();
  const tenancyId = created.tenancy.id as string;
  const collectionId = created.collection.id as string;

  const agreement = await page.request.post('/api/documents/upload', {
    multipart: {
      documentType: 'tenancy_agreement',
      file: {
        name: `synthetic-tenancy-${stamp}.png`,
        mimeType: 'image/png',
        buffer: onePixelPng
      }
    }
  });
  expect([200, 422]).toContain(agreement.status());
  const agreementPayload = await agreement.json();
  const agreementDocumentId = agreementPayload.document.id as string;

  const account = await page.request.post('/api/utility-accounts', {
    data: {
      tenancyId,
      provider: 'tnb',
      accountNumber: `TNB${stamp}`,
      meterNumber: `M${stamp}`,
      registeredName: 'Synthetic Tenant',
      billingAddress: 'Synthetic Residence'
    }
  });
  expect(account.ok(), await account.text()).toBeTruthy();

  const billUpload = await page.request.post('/api/utility-bills/upload', {
    multipart: {
      tenancyId,
      rentalCollectionId: collectionId,
      provider: 'tnb',
      file: { name: `synthetic-tnb-${stamp}.png`, mimeType: 'image/png', buffer: utilityBillPng }
    }
  });
  expect([200, 422]).toContain(billUpload.status());
  const billUploadPayload = await billUpload.json();
  expect(billUploadPayload.failedStage).toBe('ocr');

  const billConfirm = await page.request.post('/api/utility-bills/confirm', {
    data: {
      tenancyId,
      rentalCollectionId: collectionId,
      documentId: billUploadPayload.documentId,
      provider: 'tnb',
      accountNumber: `TNB${stamp}`,
      meterNumber: `M${stamp}`,
      billNumber: `BILL-${stamp}`,
      billDate: `${month}-02`,
      dueDate: `${month}-20`,
      totalAmountDue: 180,
      extractedJson: { reviewed: true },
      confidenceJson: { overall: 'reviewed' },
      rawExtractedText: 'Reviewed synthetic utility bill',
      sourceFilename: `synthetic-tnb-${stamp}.png`
    }
  });
  expect(billConfirm.ok(), await billConfirm.text()).toBeTruthy();

  for (const [transactionType, amount] of [['payment', 1000], ['reversal', 100]] as const) {
    const payment = await page.request.post('/api/collections/payments', {
      data: {
        rentalCollectionId: collectionId,
        amount,
        paymentDate: `${month}-05`,
        paymentMethod: 'bank_transfer',
        paymentReference: `${transactionType}-${stamp}`,
        transactionType
      }
    });
    expect(payment.ok(), await payment.text()).toBeTruthy();
  }

  const reminder = await page.request.post('/api/collection-reminders/log', {
    data: {
      rentalCollectionId: collectionId,
      reminderType: 'friendly',
      language: 'bilingual',
      messageText: 'Synthetic reminder / test reminder',
      sentStatus: 'draft'
    }
  });
  expect(reminder.ok(), await reminder.text()).toBeTruthy();

  const followup = await page.request.post('/api/collection-followups/action', {
    data: { rentalCollectionId: collectionId, action: 'snoozed', notes: 'Synthetic follow-up' }
  });
  expect(followup.ok(), await followup.text()).toBeTruthy();

  const signedUrl = await page.request.post('/api/documents/signed-url', {
    data: { documentId: agreementDocumentId, disposition: 'inline' }
  });
  expect(signedUrl.ok(), await signedUrl.text()).toBeTruthy();
  expect((await signedUrl.json()).signedUrl).toMatch(/^https:/);

  const overviewBefore = await page.request.get(`/api/collections/overview?month=${month}`);
  expect(overviewBefore.ok(), await overviewBefore.text()).toBeTruthy();
  const beforePayload = await overviewBefore.json();
  const beforeRow = beforePayload.overview.rows.find((row: { collection: { id: string } }) => row.collection.id === collectionId);
  expect(beforeRow.paid).toBe(900);
  expect(beforeRow.reminderCount).toBe(1);
  expect(beforeRow.followupStatus).toBe('snoozed');

  await page.reload();
  const overviewAfter = await page.request.get(`/api/collections/overview?month=${month}`);
  const afterPayload = await overviewAfter.json();
  expect(afterPayload.overview.rows.find((row: { collection: { id: string } }) => row.collection.id === collectionId).paid).toBe(900);

  const systemCheck = await page.request.get('/api/admin/system-check');
  expect(systemCheck.ok(), await systemCheck.text()).toBeTruthy();
  expect((await systemCheck.json()).check.migration.applied).toBe(true);

  await page.goto('/logout');
  await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
  await page.goto('/collections');
  await expect(page).toHaveURL(/\/login/);

  await login(page, ownerBEmail);
  const workspaceBTenancy = await page.request.post('/api/tenancies/create-with-collection', {
    data: {
      tenancy: {
        tenant: `Workspace B Tenant ${stamp}`,
        landlord: 'Workspace B Landlord',
        property: 'Workspace B Property',
        unit_no: `B-${stamp}`,
        monthly_rental: 1500,
        security_deposit: 3000,
        utility_deposit: 500,
        access_card_deposit: 0,
        car_park_remote_deposit: 0,
        commencement_date: `${month}-01`,
        expiry_date: '2027-06-30',
        status: 'active'
      },
      collection: {
        collection_month: `${month}-01`, due_date: `${month}-01`, rental_amount: 1500,
        tnb_amount: 0, water_amount: 0, iwk_amount: 0, wifi_amount: 0, aircond_amount: 0,
        other_charges: 0, amount_paid: 0, payment_status: 'outstanding', payment_history: []
      }
    }
  });
  expect(workspaceBTenancy.ok(), await workspaceBTenancy.text()).toBeTruthy();
  const workspaceBTenancyId = (await workspaceBTenancy.json()).tenancy.id as string;

  await page.goto('/logout');
  await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
  await login(page, financeEmail);
  const restrictedDelete = await page.request.delete(`/api/tenancies/${tenancyId}`);
  expect(restrictedDelete.status()).toBe(403);

  const financeOverview = await page.request.get(`/api/collections/overview?month=${month}`);
  const financePayload = await financeOverview.json();
  expect(financePayload.overview.rows.some((row: { tenancy: { id: string } }) => row.tenancy.id === workspaceBTenancyId)).toBe(false);

  const directClient = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
  const signedIn = await directClient.auth.signInWithPassword({ email: financeEmail, password: ownerPassword });
  expect(signedIn.error).toBeNull();
  const foreignInsert = await directClient.from('tenancies').insert({
    workspace_id: workspaceBId,
    tenant: 'Blocked Cross Workspace Tenant', landlord: 'Blocked', property: 'Blocked',
    monthly_rental: 1, security_deposit: 0, utility_deposit: 0, access_card_deposit: 0,
    car_park_remote_deposit: 0, commencement_date: `${month}-01`, expiry_date: '2027-06-30'
  });
  expect(foreignInsert.error).not.toBeNull();
  const foreignUpload = await directClient.storage.from('real-estate-documents').upload(
    `${workspaceBId}/utility-bills/2026/07/blocked-${stamp}.png`, onePixelPng,
    { contentType: 'image/png', upsert: false }
  );
  expect(foreignUpload.error).not.toBeNull();
});

test('live six-role RLS, storage and authorization matrix', async ({ page }) => {
  test.skip(!live || phase !== 'rbac', 'Run only during the live RBAC phase.');
  test.slow();

  const stamp = Date.now();
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const roles = {
    owner: await authenticatedClient(ownerEmail),
    admin: await authenticatedClient(adminEmail),
    manager: await authenticatedClient(managerEmail),
    agent: await authenticatedClient(agentEmail),
    finance: await authenticatedClient(financeEmail),
    viewer: await authenticatedClient(viewerEmail),
    ownerB: await authenticatedClient(ownerBEmail)
  };

  const { data: tenancyA } = await roles.owner.from('tenancies').select('id, notes').eq('workspace_id', workspaceAId).limit(1).single();
  const { data: tenancyB } = await roles.ownerB.from('tenancies').select('id').eq('workspace_id', workspaceBId).limit(1).single();
  const { data: collectionA } = await roles.owner.from('rental_collections').select('id, notes').eq('workspace_id', workspaceAId).limit(1).single();
  const { data: viewerMembership } = await roles.owner.from('workspace_members').select('id').eq('workspace_id', workspaceAId).eq('role', 'viewer').single();
  expect(tenancyA?.id).toBeTruthy();
  expect(tenancyB?.id).toBeTruthy();
  expect(collectionA?.id).toBeTruthy();
  expect(viewerMembership?.id).toBeTruthy();

  const propertyA = await roles.owner.from('properties').insert({
    workspace_id: workspaceAId,
    property_name: `RLS Property A ${stamp}`,
    status: 'active'
  }).select('id').single();
  const propertyB = await roles.ownerB.from('properties').insert({
    workspace_id: workspaceBId,
    property_name: `RLS Property B ${stamp}`,
    status: 'active'
  }).select('id').single();
  const listingA = await roles.owner.from('listing_memory').insert({
    workspace_id: workspaceAId,
    property_name: `RLS Listing A ${stamp}`,
    freshness: 'fresh'
  }).select('id').single();
  const listingB = await roles.ownerB.from('listing_memory').insert({
    workspace_id: workspaceBId,
    property_name: `RLS Listing B ${stamp}`,
    freshness: 'fresh'
  }).select('id').single();
  expect(propertyA.error).toBeNull();
  expect(propertyB.error).toBeNull();
  expect(listingA.error).toBeNull();
  expect(listingB.error).toBeNull();

  for (const [role, client] of Object.entries(roles).filter(([name]) => name !== 'ownerB')) {
    const ownRead = await client.from('tenancies').select('id').eq('id', tenancyA!.id);
    expect(ownRead.error, `${role} own-workspace read`).toBeNull();
    expect(ownRead.data).toHaveLength(1);
    const foreignRead = await client.from('tenancies').select('id').eq('id', tenancyB!.id);
    expect(foreignRead.error, `${role} foreign-workspace read`).toBeNull();
    expect(foreignRead.data, `${role} foreign-workspace isolation`).toHaveLength(0);

    for (const [table, ownId, foreignId] of [
      ['properties', propertyA.data!.id, propertyB.data!.id],
      ['listing_memory', listingA.data!.id, listingB.data!.id]
    ] as const) {
      const legacyOwnRead = await client.from(table).select('id').eq('id', ownId);
      expect(legacyOwnRead.error, `${role} ${table} own read`).toBeNull();
      expect(legacyOwnRead.data, `${role} ${table} own read`).toHaveLength(1);
      const legacyForeignRead = await client.from(table).select('id').eq('id', foreignId);
      expect(legacyForeignRead.error, `${role} ${table} foreign read`).toBeNull();
      expect(legacyForeignRead.data, `${role} ${table} foreign isolation`).toHaveLength(0);
      const legacyForeignUpdate = await client.from(table).update({ property_name: 'Blocked foreign update' }).eq('id', foreignId).select('id');
      expect(legacyForeignUpdate.error === null ? legacyForeignUpdate.data : [], `${role} ${table} foreign update`).toHaveLength(0);
      const legacyForeignDelete = await client.from(table).delete().eq('id', foreignId).select('id');
      expect(legacyForeignDelete.error === null ? legacyForeignDelete.data : [], `${role} ${table} foreign delete`).toHaveLength(0);
    }
  }

  for (const role of ['owner', 'admin', 'manager', 'agent'] as const) {
    const propertyUpdate = await roles[role].from('properties').update({ status: `checked-${role}` }).eq('id', propertyA.data!.id).select('id');
    expect(propertyUpdate.error, `${role} property update`).toBeNull();
    expect(propertyUpdate.data, `${role} property update`).toHaveLength(1);
    const listingUpdate = await roles[role].from('listing_memory').update({ freshness: `checked-${role}` }).eq('id', listingA.data!.id).select('id');
    expect(listingUpdate.error, `${role} listing update`).toBeNull();
    expect(listingUpdate.data, `${role} listing update`).toHaveLength(1);
  }
  for (const role of ['finance', 'viewer'] as const) {
    const propertyUpdate = await roles[role].from('properties').update({ status: 'blocked' }).eq('id', propertyA.data!.id).select('id');
    expect(propertyUpdate.error === null ? propertyUpdate.data : [], `${role} property write blocked`).toHaveLength(0);
    const listingUpdate = await roles[role].from('listing_memory').update({ freshness: 'blocked' }).eq('id', listingA.data!.id).select('id');
    expect(listingUpdate.error === null ? listingUpdate.data : [], `${role} listing write blocked`).toHaveLength(0);
  }

  const spoofedProperty = await roles.agent.from('properties').insert({
    workspace_id: workspaceBId,
    property_name: 'Blocked spoofed property'
  });
  expect(spoofedProperty.error).not.toBeNull();
  const spoofedListing = await roles.agent.from('listing_memory').insert({
    workspace_id: workspaceBId,
    property_name: 'Blocked spoofed listing'
  });
  expect(spoofedListing.error).not.toBeNull();

  const anon = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
  expect((await anon.from('properties').select('id')).error).not.toBeNull();
  expect((await anon.from('listing_memory').select('id')).error).not.toBeNull();
  expect((await anon.from('properties').insert({ workspace_id: workspaceAId, property_name: 'Blocked anonymous property' })).error).not.toBeNull();
  expect((await anon.from('listing_memory').insert({ workspace_id: workspaceAId, property_name: 'Blocked anonymous listing' })).error).not.toBeNull();

  for (const role of ['owner', 'admin', 'manager', 'agent'] as const) {
    const result = await roles[role].from('tenancies').update({ notes: `rbac-${role}-${stamp}` }).eq('id', tenancyA!.id).select('id');
    expect(result.error, `${role} tenancy update`).toBeNull();
    expect(result.data, `${role} tenancy update`).toHaveLength(1);
  }
  for (const role of ['finance', 'viewer'] as const) {
    const result = await roles[role].from('tenancies').update({ notes: `blocked-${role}-${stamp}` }).eq('id', tenancyA!.id).select('id');
    expect(result.error === null ? result.data : [], `${role} tenancy update blocked`).toHaveLength(0);
  }

  for (const role of ['owner', 'admin', 'manager', 'finance'] as const) {
    const result = await roles[role].from('rental_collections').update({ notes: `rbac-${role}-${stamp}` }).eq('id', collectionA!.id).select('id');
    expect(result.error, `${role} collection update`).toBeNull();
    expect(result.data, `${role} collection update`).toHaveLength(1);
  }
  for (const role of ['agent', 'viewer'] as const) {
    const result = await roles[role].from('rental_collections').update({ notes: `blocked-${role}-${stamp}` }).eq('id', collectionA!.id).select('id');
    expect(result.error === null ? result.data : [], `${role} collection update blocked`).toHaveLength(0);
  }

  for (const role of ['owner', 'admin'] as const) {
    const result = await roles[role].from('workspace_members').update({ role: 'viewer' }).eq('id', viewerMembership!.id).select('id');
    expect(result.error, `${role} member administration`).toBeNull();
    expect(result.data, `${role} member administration`).toHaveLength(1);
  }
  for (const role of ['manager', 'agent', 'finance', 'viewer'] as const) {
    const result = await roles[role].from('workspace_members').update({ role: 'viewer' }).eq('id', viewerMembership!.id).select('id');
    expect(result.error === null ? result.data : [], `${role} member administration blocked`).toHaveLength(0);
  }

  const paths: Array<[keyof typeof roles, string, boolean]> = [
    ['owner', `${workspaceAId}/documents/rbac/owner-${stamp}.png`, true],
    ['admin', `${workspaceAId}/documents/rbac/admin-${stamp}.png`, true],
    ['manager', `${workspaceAId}/documents/rbac/manager-${stamp}.png`, true],
    ['agent', `${workspaceAId}/documents/rbac/agent-${stamp}.png`, true],
    ['finance', `${workspaceAId}/documents/rbac/finance-${stamp}.png`, false],
    ['finance', `${workspaceAId}/utility-bills/rbac/finance-${stamp}.png`, true],
    ['viewer', `${workspaceAId}/documents/rbac/viewer-${stamp}.png`, false]
  ];
  const uploaded: string[] = [];
  for (const [role, path, allowed] of paths) {
    const result = await roles[role].storage.from('real-estate-documents').upload(path, bytes, { contentType: 'image/png' });
    expect(result.error === null, `${role} upload ${path}`).toBe(allowed);
    if (allowed) uploaded.push(path);
  }

  const foreignPath = `${workspaceBId}/documents/rbac/owner-b-${stamp}.png`;
  expect((await roles.ownerB.storage.from('real-estate-documents').upload(foreignPath, bytes, { contentType: 'image/png' })).error).toBeNull();
  expect((await roles.owner.storage.from('real-estate-documents').createSignedUrl(foreignPath, 60)).error).not.toBeNull();
  expect((await roles.owner.storage.from('real-estate-documents').upload(`${workspaceBId}/documents/rbac/blocked-${stamp}.png`, bytes, { contentType: 'image/png' })).error).not.toBeNull();

  const managerPath = uploaded.find((path) => path.includes('/manager-'))!;
  await roles.manager.storage.from('real-estate-documents').remove([managerPath]);
  expect((await roles.owner.storage.from('real-estate-documents').createSignedUrl(managerPath, 60)).error).toBeNull();
  expect((await roles.owner.storage.from('real-estate-documents').remove(uploaded)).error).toBeNull();
  expect((await roles.ownerB.storage.from('real-estate-documents').remove([foreignPath])).error).toBeNull();

  await login(page, managerEmail);
  const managerCheck = await page.request.get('/api/admin/system-check');
  expect(managerCheck.status()).toBe(403);
  const crossSiteWrite = await page.request.post('/api/collection-followups/action', {
    headers: { Origin: 'https://cross-site.invalid', 'Sec-Fetch-Site': 'cross-site' },
    data: { rentalCollectionId: collectionA!.id, action: 'snoozed' }
  });
  expect(crossSiteWrite.status()).toBe(403);

  expect((await roles.admin.from('properties').delete().eq('id', propertyA.data!.id)).error).toBeNull();
  expect((await roles.admin.from('listing_memory').delete().eq('id', listingA.data!.id)).error).toBeNull();
  expect((await roles.ownerB.from('properties').delete().eq('id', propertyB.data!.id)).error).toBeNull();
  expect((await roles.ownerB.from('listing_memory').delete().eq('id', listingB.data!.id)).error).toBeNull();
});
