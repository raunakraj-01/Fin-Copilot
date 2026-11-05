import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';

// Opt-in live test against the existing dev server, never the temporary demo.
const keep = process.argv.includes('--keep-fixtures');
const apiBase = 'http://localhost:5000/api';
const origin = 'http://localhost:5173';
const run = `${new Date().toISOString().slice(0, 10)}-${randomBytes(4).toString('hex')}`;
const output = new URL(`../../tmp/atlas-isolation/${run}/`, import.meta.url);
const accounts = ['owner-a', 'accountant-a', 'owner-b', 'accountant-b'].map(key => ({
  key, name: `Fabricated ${key}`, email: `${key}-${run}@example.invalid`, password: randomBytes(24).toString('base64url'), cookie: '', csrf: '',
}));
const businesses = [];
const results = [];
let passed = false;
let requestCount = 0;

async function call(client, method, path, body, expected = 200, extraHeaders = {}) {
  requestCount++;
  const response = await fetch(`${apiBase}${path}`, {
    method, signal: AbortSignal.timeout(30000), headers: { Origin: origin,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(client?.cookie ? { Cookie: client.cookie, 'X-CSRF-Token': client.csrf } : {}), ...extraHeaders,
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  assert.equal(response.status, expected, `${client?.key || 'anonymous'} ${method} ${path}: expected ${expected}, got ${response.status}`);
  if (client) {
    const cookie = response.headers.getSetCookie?.()[0];
    if (cookie) client.cookie = cookie.split(';')[0];
  }
  const data = response.status === 204 ? null : await response.json();
  if (client && data?.csrfToken) client.csrf = data.csrfToken;
  return data;
}
function record(check, detail) { results.push({ check, detail, status: 'PASS' }); console.log(`PASS: ${check}`); }
async function login(account) {
  await call(account, 'POST', '/auth/login', { email: account.email, password: account.password });
  assert.equal((await call(account, 'GET', '/auth/me')).user.id, account.id);
}
async function invite(owner, business, accountant, testWrongEmail = false) {
  const invitation = await call(owner, 'POST', `/workspaces/${business.id}/members/invitations`, { email: accountant.email }, 201);
  const token = new URL(invitation.invitationUrl).searchParams.get('invite');
  if (testWrongEmail) await call(accounts.find(a => a.key === 'accountant-b'), 'POST', '/auth/invitations/accept', { token }, 400);
  await call(accountant, 'POST', '/auth/invitations/accept', { token });
  await call(accountant, 'POST', '/auth/invitations/accept', { token }, 400);
}
function itemBody(counterparty, amountPaise, expectedDate, category = 'receivable') {
  return { category, externalId: category === 'receivable' ? 'INV-001' : 'RENT-001', counterparty, amountPaise,
    dueDate: expectedDate, expectedDate, confidenceState: 'verified' };
}
async function cleanup() {
  const db = mongoose.connection.db;
  for (const account of accounts) {
    const user = await db.collection('users').findOne({ email: account.email });
    if (!user) continue;
    const own = await db.collection('workspaces').find({ ownerUserId: user._id, name: { $in: [`Atlas Fabricated A ${run}`, `Atlas Fabricated B ${run}`] } }).toArray();
    for (const business of own) {
      for (const name of ['cashitems', 'recurringrules', 'orderscenarios', 'rescueplans', 'importbatches', 'banktransactions', 'syncdevices', 'syncbatches', 'paymentobservations', 'paymentoffers', 'collectionfollowups']) {
        await db.collection(name).deleteMany({ workspaceId: business._id });
      }
      await db.collection('workspaces').deleteOne({ _id: business._id, ownerUserId: user._id });
    }
    await db.collection('authsessions').deleteMany({ userId: user._id });
    await db.collection('users').deleteOne({ _id: user._id, email: account.email });
  }
}

try {
  const uri = process.env.MONGODB_URI || '';
  assert.ok(new URL(uri).hostname.endsWith('.mongodb.net'), 'This live test requires the configured Atlas database');
  assert.notEqual(process.env.NODE_TLS_REJECT_UNAUTHORIZED, '0', 'TLS verification must be enabled');
  assert.ok(!/(?:tlsInsecure|tlsAllowInvalidCertificates|tlsAllowInvalidHostnames)=true|[?&](?:tls|ssl)=false/i.test(uri), 'TLS verification must be enabled');
  await mkdir(output, { recursive: true });
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000, connectTimeoutMS: 10000, autoIndex: false });
  assert.equal((await mongoose.connection.db.command({ ping: 1 })).ok, 1);
  const health = await call(null, 'GET', '/health');
  assert.notEqual(health.demoMode, true, 'Run npm run dev; demo mode is not allowed');
  assert.equal((await fetch(origin, { signal: AbortSignal.timeout(5000) })).status, 200);
  record('Normal dev server and Atlas connection', 'Frontend 5173, API 5000, Atlas ping; demo mode disabled');

  for (const account of accounts) {
    const registered = await call(account, 'POST', '/auth/register', { name: account.name, email: account.email, password: account.password }, 201);
    account.id = registered.user.id;
    const registeredSession = { ...account };
    await call(account, 'POST', '/auth/logout', {}, 204);
    await call(registeredSession, 'GET', '/auth/me', undefined, 401);
    account.cookie = ''; account.csrf = '';
    await login(account);
  }
  const [ownerA, accountantA, ownerB, accountantB] = accounts;
  await call(null, 'POST', '/auth/login', { email: ownerA.email, password: 'wrong password for test' }, 401);
  record('Four independent owner/accountant logins', 'Registration, explicit logout/login and session identity verified; wrong password rejected');
  const asOfDate = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(`${asOfDate}T00:00:00Z`); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const expectedDate = tomorrow.toISOString().slice(0, 10);
  for (const [index, owner] of [ownerA, ownerB].entries()) {
    const letter = index === 0 ? 'A' : 'B';
    const business = (await call(owner, 'POST', '/workspaces', { name: `Atlas Fabricated ${letter} ${run}`, asOfDate,
      openingCashPaise: index === 0 ? 10000000 : 20000000, minimumReservePaise: 1000000 }, 201)).workspace;
    businesses.push(business);
    // Verify the running API is writing to this exact configured Atlas database.
    assert.ok(await mongoose.connection.db.collection('workspaces').findOne({ _id: new mongoose.Types.ObjectId(business.id), ownerUserId: new mongoose.Types.ObjectId(owner.id) }));
    business.invoice = (await call(owner, 'POST', `/workspaces/${business.id}/items`, itemBody(`Customer ${letter} private`, index === 0 ? 5000000 : 8000000, expectedDate), 201)).item;
  }
  const [a, b] = businesses;
  await invite(ownerA, a, accountantA, true); await invite(ownerB, b, accountantB);
  record('Separate business ownership and email-bound invitations', 'Each accountant joined only the intended business; wrong-email and reused invitations rejected');
  for (const [client, business, role] of [[ownerA,a,'owner'],[accountantA,a,'accountant'],[ownerB,b,'owner'],[accountantB,b,'accountant']]) {
    const listed = (await call(client, 'GET', '/workspaces')).workspaces;
    assert.deepEqual(listed.map(w => ({ id: w.id, role: w.role })), [{ id: business.id, role }]);
    const items = (await call(client, 'GET', `/workspaces/${business.id}/items`)).items;
    assert.deepEqual(items.map(i => i.id), [business.invoice.id]);
  }
  record('Business and invoice lists stay isolated', 'Each of four accounts sees exactly its assigned business and invoice');

  for (const [accountant, business, letter] of [[accountantA,a,'A'],[accountantB,b,'B']]) {
    const base = `/workspaces/${business.id}`;
    await call(accountant, 'PATCH', `${base}/items/${business.invoice.id}`, { description: `Bookkeeping by accountant ${letter}` });
    await call(accountant, 'POST', `${base}/items`, itemBody(`Rent ${letter}`, 1000000, expectedDate, 'expense'), 201);
    await call(accountant, 'POST', `${base}/items/${business.invoice.id}/promises`, { amountPaise: 1000000, promisedDate: expectedDate, note: `Business ${letter} promise` }, 201);
    await call(accountant, 'POST', `${base}/orders/scenarios`, { label: `Fabricated order ${letter}`, orderValuePaise: 1000000, advancePaise: 0, advanceDate: expectedDate,
      finalCollectionDate: expectedDate, costLines: [], delayedCollectionDays: 0 }, 201);
    const forecast = await call(accountant, 'GET', `${base}/forecast?horizonDays=3`);
    assert.equal(forecast.daily.at(-1).closingCashPaise, letter === 'A' ? 14000000 : 27000000);
    const scenarios = await call(accountant, 'GET', `${base}/orders/scenarios`);
    business.scenarioId = scenarios.scenarios[0]._id;
  }
  record('Accountants can perform authorized bookkeeping and planning', 'Invoice edits, expenses, promises, saved order analyses and distinct forecast totals passed in both businesses');

  for (const [accountant, business] of [[accountantA,a],[accountantB,b]]) {
    const base = `/workspaces/${business.id}`;
    const denied = [['PATCH','',{ minimumReservePaise: 0 }],['DELETE',`/items/${business.invoice.id}`],['GET','/members'],
      ['POST','/members/invitations',{email:'uninvited@example.invalid'}],['POST','/sync/devices',{name:'Forbidden'}],['GET','/sync/status'],
      ['PATCH','/reliability/consent',{share:true}],['GET','/followups'],['POST','/offers/preview',{}]];
    for (const [method,path,body] of denied) await call(accountant,method,`${base}${path}`,body,403,{'X-Role':'owner'});
  }
  record('Accountant owner-only actions blocked', '18 attempts to alter settings, delete invoices, manage access, integrations, consent, messaging and offers returned 403');

  let blockedCrossBusiness = 0;
  for (const [client, own, foreign] of [[ownerA,a,b],[accountantA,a,b],[ownerB,b,a],[accountantB,b,a]]) {
    const base = `/workspaces/${foreign.id}`;
    for (const path of ['', '/items','/recurring-rules','/bank','/promises','/forecast','/spending-check','/rescue/plans','/orders/scenarios','/sync/devices','/sync/status','/reliability/consent','/followups','/members']) {
      await call(client,'GET',`${base}${path}`,undefined,404,{'X-Workspace-Id':own.id,'X-Role':'owner'}); blockedCrossBusiness++;
    }
    for (const path of ['/items','/imports/inspect','/bank/imports/inspect',`/items/${foreign.invoice.id}/promises`,'/rescue/analyze','/orders/analyze','/shock/analyze','/copilot/chat','/offers/preview']) {
      await call(client,'POST',`${base}${path}`,{},404); blockedCrossBusiness++;
    }
    await call(client,'PATCH',`${base}/items/${foreign.invoice.id}`,{counterparty:'Unauthorized change'},404); blockedCrossBusiness++;
    // An allowed business URL must not make a foreign child ID accessible.
    await call(client,'PATCH',`/workspaces/${own.id}/items/${foreign.invoice.id}`,{counterparty:'Unauthorized change'},404); blockedCrossBusiness++;
    await call(client,'POST',`/workspaces/${own.id}/items/${foreign.invoice.id}/promises`,{amountPaise:1,promisedDate:expectedDate},404); blockedCrossBusiness++;
    await call(client,'POST',`/workspaces/${own.id}/orders/scenarios/${foreign.scenarioId}/recalculate`,{},404); blockedCrossBusiness++;
  }
  record('Cross-business reads, writes and foreign child IDs blocked', `${blockedCrossBusiness} attempts returned 404 across both owner and accountant sessions; spoofed role/business headers did not grant access`);
  for (const [owner,business,letter] of [[ownerA,a,'A'],[ownerB,b,'B']]) {
    const items=(await call(owner,'GET',`/workspaces/${business.id}/items`)).items;
    assert.equal(items.find(i=>i.id===business.invoice.id).counterparty,`Customer ${letter} private`);
    assert.equal(items.length,2);
    assert.equal((await call(owner,'GET',`/workspaces/${business.id}/orders/scenarios`)).scenarios.length,1);
  }
  record('Denied attacks leave saved records unchanged', 'Both businesses retained their original invoice identities, two ledger records and one saved order');
  await call(ownerA,'PATCH',`/workspaces/${a.id}/items/${a.invoice.id}`,{description:'CSRF attempt'},403,{'X-CSRF-Token':''});
  await call(null,'GET',`/workspaces/${a.id}/items`,undefined,401);
  record('Anonymous access and missing CSRF rejected', 'Unauthenticated read returned 401; mutation without CSRF returned 403');
  await call(ownerA,'DELETE',`/workspaces/${a.id}/members/${accountantA.id}`,undefined,204);
  await call(accountantA,'GET',`/workspaces/${a.id}/forecast`,undefined,404);
  assert.deepEqual((await call(accountantA,'GET','/workspaces')).workspaces,[]);
  await invite(ownerA,a,accountantA);
  await call(accountantA,'GET',`/workspaces/${a.id}/forecast`);
  record('Immediate accountant removal and restored manual-test access', 'Old login lost access immediately; fresh invitation restored only Business A');
  for(const client of accounts) {
    const old={...client}; await call(client,'POST','/auth/logout',{},204); await call(old,'GET','/auth/me',undefined,401);
  }
  record('Logout revokes all four test sessions', 'Reusing logged-out session cookies returned 401');
  passed = true;
} catch(error) {
  console.error(`LIVE ISOLATION TEST FAILED (${error.code || error.name}).`);
  if(error.name==='AssertionError')console.error(error.message);
  process.exitCode=1;
} finally {
  try {
    if(mongoose.connection.readyState===1 && (!passed || !keep)) {await cleanup();console.log('Only this run\'s fabricated accounts and business records were removed.');}
    if(passed && keep) {
      const details=`# Fabricated Atlas login details\n\nOpen http://localhost:5173. These accounts contain fabricated test records only. This file contains plaintext test passwords and is excluded from Git.\n\n| Business | Role | Email | Password |\n| --- | --- | --- | --- |\n${accounts.map(a=>`| ${a.key.endsWith('-a')?'A':'B'} | ${a.key.startsWith('owner')?'Owner':'Accountant'} | ${a.email} | ${a.password} |`).join('\n')}\n\nBusiness A: ${businesses[0].name} (${businesses[0].id})\n\nBusiness B: ${businesses[1].name} (${businesses[1].id})\n\nUse separate browser profiles or normal and Incognito windows for separate simultaneous accounts. Tabs in the same browser profile share one login cookie. All automated test sessions were logged out; sign in with the credentials above.\n\nOwners: Setup & Import → Business access. Accountants: update records and use forecasts; owner-only settings are blocked.\n`;
      await writeFile(new URL('LOGIN_DETAILS.md',output),details,{mode:0o600,flag:'wx'});
      console.log(`Manual login details saved locally: ${fileURLToPath(new URL('LOGIN_DETAILS.md',output))}`);
    }
    const report={timestamp:new Date().toISOString(),run,passed,keptFixtures:passed&&keep,apiBase,frontend:origin,requests:requestCount,businesses:businesses.map(b=>({id:b.id,name:b.name})),results};
    await writeFile(new URL('report.json',output),JSON.stringify(report,null,2),{mode:0o600});
    console.log(`${passed?'PASSED':'FAILED'}: ${results.length} check groups; ${requestCount} live API requests. Report: ${fileURLToPath(new URL('report.json',output))}`);
  } catch {console.error(`Fixture cleanup or local report could not finish. Inspect run ${run}; do not remove other businesses.`);process.exitCode=1;}
  await mongoose.disconnect();
}
