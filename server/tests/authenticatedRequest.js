// Regression fixtures authenticate with real database-backed sessions. This helper is
// never imported by production code. Dedicated security tests use raw supertest.
import rawRequest from 'supertest';
import mongoose from 'mongoose';
import { randomBytes } from 'node:crypto';
import User from '../src/models/User.js';
import AuthSession from '../src/models/AuthSession.js';
import Workspace from '../src/models/Workspace.js';
import SyncDevice from '../src/models/SyncDevice.js';
import { tokenHash, csrfToken, cookieName } from '../src/services/auth.js';
let session;
let setup;
async function identity() {
  if (setup) return setup;
  setup = (async () => {
    if (session && await AuthSession.exists({ tokenHash: tokenHash(session.token), expiresAt: { $gt: new Date() } })) return session;
    let user = await User.findOne({ email: 'regression-owner@example.test' });
    if (!user) user = await User.create({ email: 'regression-owner@example.test', name: 'Regression owner', passwordHash: 'fixture-not-used-for-login' });
    const token = randomBytes(32).toString('hex');
    await AuthSession.create({ userId: user._id, tokenHash: tokenHash(token), authVersion: user.authVersion, expiresAt: new Date(Date.now() + 8 * 3600000) });
    session = { token, userId: user._id }; return session;
  })();
  try { return await setup; } finally { setup = null; }
}
export default function request(app) {
  const agent = rawRequest(app);
  return new Proxy(agent, { get(target, method) {
    if (!['get', 'post', 'patch', 'put', 'delete', 'head'].includes(method)) return target[method];
    return path => {
      const test = target[method](path); let anonymous = false;
      test.anonymous = () => { anonymous = true; return test; };
      const then = test.then.bind(test);
      test.then = (resolve, reject) => (async () => {
        if (!anonymous) {
          const { token, userId } = await identity();
          // Old synthetic fixtures deliberately have no owner. Assign them explicitly
          // inside the isolated test DB, never through an HTTP claiming shortcut.
          await Workspace.updateMany({ ownerUserId: null }, { $set: { ownerUserId: userId } });
          test.set('Cookie', `${cookieName()}=${token}`).set('X-CSRF-Token', csrfToken(token));
          const bearer = test.get('Authorization')?.replace(/^Bearer\s+/i, '');
          const workspaceId = path.match(/\/workspaces\/([a-f\d]{24})/i)?.[1];
          const service = path.includes('/sync/batches') || path.includes('/reliability/observations') || path.startsWith('/api/followup-automation/');
          if (service && bearer) {
            const id = workspaceId || String((await Workspace.findOne({ ownerUserId: userId }).sort({ _id: -1 }))._id);
            await SyncDevice.updateOne({ tokenHash: tokenHash(bearer) }, { $setOnInsert: { workspaceId: id, tokenHash: tokenHash(bearer), name: 'Regression credential', tokenPrefix: 'fixture', kind: path.includes('followup-automation') ? 'automation' : 'sync', revokedAt: null } }, { upsert: true });
          }
        }
        return then(resolve, reject);
      })().catch(reject);
      return test;
    };
  } });
}
