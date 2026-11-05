import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import mongoose from 'mongoose';

const writeTest = process.argv.includes('--write-test');
const uri = process.env.MONGODB_URI;
const connectionOptions = { serverSelectionTimeoutMS: 15000, connectTimeoutMS: 10000, autoIndex: false };
let server;
let testUserId;
let testWorkspaceId;
let writeStarted = false;
const marker = randomBytes(12).toString('hex');
const email = `db-check-${marker}@example.invalid`;
const password = randomBytes(32).toString('base64url');
let cookie = '';
let csrf = '';

function reportTopology() {
  const servers = [...mongoose.connection.getClient().topology.description.servers.values()];
  const unavailable = servers.filter(s => s.type === 'Unknown');
  console.log(`Database ping passed. Replica-set members discovered: ${servers.length}; currently unavailable: ${unavailable.length}.`);
  if (unavailable.length) {
    console.warn('Some members are unreachable. Primary read/write success does not verify replica-set failover.');
    if (unavailable.some(s => /TLS|SSL|certificate/i.test(s.error?.message || ''))) console.warn('Unreachable members report TLS errors. Check Atlas cluster health, IP access rules and the network path.');
  }
}
async function request(path, method = 'GET', body, status = 200, authenticated = true) {
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
    method, signal: AbortSignal.timeout(30000), headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(authenticated && cookie ? { Cookie: cookie, 'X-CSRF-Token': csrf } : {}),
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  assert.equal(response.status, status, `${method} ${path.replace(/[a-f\d]{24}/g, ':id')}: expected ${status}, got ${response.status}`);
  const setCookie = response.headers.getSetCookie?.()[0];
  if (setCookie) cookie = setCookie.split(';')[0];
  const data = response.status === 204 ? null : await response.json();
  if (data?.csrfToken) csrf = data.csrfToken;
  return data;
}

async function cleanTestData() {
  if (!writeTest || !mongoose.connection.db) return;
  const db = mongoose.connection.db;
  // This random email exists only for this run; never delete any pre-existing user.
  const user = await db.collection('users').findOne({ email });
  const userId = user?._id || (testUserId && new mongoose.Types.ObjectId(testUserId));
  if (userId) {
    const businesses = await db.collection('workspaces').find({ ownerUserId: userId, name: `Database verification ${marker}` }, { projection: { _id: 1 } }).toArray();
    for (const business of businesses) {
      await db.collection('cashitems').deleteMany({ workspaceId: business._id });
      await db.collection('workspaces').deleteOne({ _id: business._id, ownerUserId: userId });
    }
    await db.collection('authsessions').deleteMany({ userId });
    await db.collection('users').deleteOne({ _id: userId, email });
    assert.equal(await db.collection('users').countDocuments({ _id: userId }), 0);
    assert.equal(await db.collection('workspaces').countDocuments({ ownerUserId: userId }), 0);
    if (testWorkspaceId) assert.equal(await db.collection('cashitems').countDocuments({ workspaceId: new mongoose.Types.ObjectId(testWorkspaceId) }), 0);
  }
  console.log('Temporary verification account, business, invoice and sessions removed. Existing business records were not changed.');
}

try {
  if (!uri) throw Object.assign(new Error(), { code: 'MISSING_MONGODB_URI' });
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0' || /(?:tlsInsecure|tlsAllowInvalidCertificates|tlsAllowInvalidHostnames)=true/i.test(uri)
    || (uri.startsWith('mongodb+srv://') && /[?&](?:tls|ssl)=false/i.test(uri))) {
    throw Object.assign(new Error(), { code: 'UNSAFE_TLS_CONFIGURATION' });
  }
  await mongoose.connect(uri, connectionOptions);
  assert.equal((await mongoose.connection.db.command({ ping: 1 })).ok, 1);
  reportTopology();
  if (writeTest) {
    writeStarted = true;
    // Exercise actual HTTP handlers and authorization against the configured database.
    const { default: app } = await import('../src/app.js');
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const account = await request('/auth/register', 'POST', { name: 'Temporary database check', email, password }, 201, false);
    testUserId = account.user.id;
    const asOfDate = new Date().toISOString().slice(0, 10);
    const date = new Date(`${asOfDate}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + 1);
    const expectedDate = date.toISOString().slice(0, 10);
    const created = await request('/workspaces', 'POST', { name: `Database verification ${marker}`, asOfDate, openingCashPaise: 100000 }, 201);
    testWorkspaceId = created.workspace.id;
    const base = `/workspaces/${testWorkspaceId}`;
    const saved = await request(`${base}/items`, 'POST', { category: 'receivable', counterparty: 'Fabricated verification customer', amountPaise: 25000,
      dueDate: expectedDate, expectedDate, confidenceState: 'verified' }, 201);
    await request(`${base}/items/${saved.item.id}`, 'PATCH', { amountPaise: 30000, settledPaise: 10000, status: 'partial' });
    console.log('Authenticated API account creation, business creation, invoice save and partial-payment update passed.');
    await mongoose.disconnect();
    await mongoose.connect(uri, connectionOptions);
    await request('/auth/login', 'POST', { email, password }, 200, false);
    const items = (await request(`${base}/items`)).items;
    const persisted = items.find(item => item.id === saved.item.id);
    assert.ok(persisted, 'Saved invoice must survive reconnection');
    assert.equal(persisted.amountPaise, 30000);
    assert.equal(persisted.settledPaise, 10000);
    assert.equal(persisted.outstandingPaise, 20000);
    const forecast = await request(`${base}/forecast?horizonDays=3`);
    assert.equal(forecast.daily.at(-1).closingCashPaise, 120000, 'Forecast must include only the remaining payment');
    await request(`${base}/items`, 'GET', undefined, 401, false);
    console.log('Fresh connection/login, persisted read, forecast balance and anonymous-access rejection passed.');
  }
  console.log(writeTest ? 'DATABASE READ/WRITE VERIFICATION PASSED.' : 'DATABASE CONNECTION CHECK PASSED. Add --write-test to verify API saving and persistence.');
} catch (error) {
  // Connection errors can contain hosts, usernames and URIs. Never print raw errors.
  console.error(`Database check failed: ${error.code || error.name || 'UNKNOWN_ERROR'}.`);
  if (error.name === 'AssertionError') console.error(error.message);
  console.error('Check Atlas cluster health, current IP access, database-user permissions and MONGODB_URI. TLS validation stays enabled.');
  process.exitCode = 1;
} finally {
  try {
    if (writeStarted) {
      if (mongoose.connection.readyState !== 1) await mongoose.connect(uri, connectionOptions);
      await cleanTestData();
    }
  } catch { console.error(`Temporary-data cleanup could not finish. Inspect verification account ${email}${testWorkspaceId ? ` and business ${testWorkspaceId}` : ''} before retrying.`); process.exitCode = 1; }
  if (server) await new Promise(resolve => server.close(resolve));
  await mongoose.disconnect();
}
