// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AuthGate from '../../client/src/components/AuthGate.jsx';
import BusinessAccess from '../../client/src/components/BusinessAccess.jsx';
import App from '../../client/src/app/App.jsx';
import { sessionFetch, setCsrf } from '../../client/src/services/session.js';

const user = { id: 'owner', name: 'Owner', email: 'owner@example.test' };
const response = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); setCsrf(''); localStorage.clear(); sessionStorage.clear(); window.history.replaceState(null, '', '/'); });
function gate() { return render(<AuthGate>{(account, logout) => <div>Private records for {account.name}<button onClick={logout}>Sign out</button></div>}</AuthGate>); }

test('keeps private views hidden until login and sends subsequent mutations with cookie credentials and CSRF', async () => {
  const fetch = vi.fn(async url => url.endsWith('/auth/me') ? response({ error: { message: 'Sign in' } }, 401) : response({ user, csrfToken: 'session-csrf' }));
  vi.stubGlobal('fetch', fetch); gate();
  await screen.findByRole('heading', { name: 'Sign in to CashFlow Copilot' });
  expect(screen.queryByText(/Private records/)).toBeNull();
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: user.email } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'My long password 42' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  await screen.findByText('Private records for Owner');
  const login = fetch.mock.calls.find(([url]) => url.endsWith('/auth/login'));
  expect(JSON.parse(login[1].body)).toEqual({ email: user.email, password: 'My long password 42' });
  expect(login[1].credentials).toBe('include');
  await sessionFetch('/api/workspaces', { method: 'POST' });
  expect(fetch.mock.lastCall[1].headers['X-CSRF-Token']).toBe('session-csrf');
  expect(JSON.stringify(localStorage)).not.toContain('session-csrf');
  expect(JSON.stringify(sessionStorage)).not.toContain('My long password');
});

test('registration validates a long password and submits no client-selected roles', async () => {
  const fetch = vi.fn(async url => url.endsWith('/auth/me') ? response({ error: {} }, 401) : response({ user, csrfToken: 'csrf' }, 201));
  vi.stubGlobal('fetch', fetch); gate();
  fireEvent.click(await screen.findByRole('button', { name: 'Create an account' }));
  expect(screen.getByLabelText('Password').minLength).toBe(15);
  fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Owner' } });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: user.email } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'My long password 42' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
  await screen.findByText('Private records for Owner');
  expect(JSON.parse(fetch.mock.calls.find(([url]) => url.endsWith('/auth/register'))[1].body)).toEqual({ name: 'Owner', email: user.email, password: 'My long password 42' });
});

test('logout and an expired API session unmount private data', async () => {
  const fetch = vi.fn(async url => url.endsWith('/auth/me') ? response({ user, csrfToken: 'csrf' }) : url.endsWith('/auth/logout') ? response(null, 204) : response({ error: {} }, 401));
  vi.stubGlobal('fetch', fetch); gate();
  await screen.findByText('Private records for Owner');
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  await screen.findByRole('heading', { name: 'Sign in to CashFlow Copilot' });
  expect(screen.queryByText(/Private records/)).toBeNull();
  expect(fetch.mock.calls.find(([url]) => url.endsWith('/auth/logout'))[1].headers['X-CSRF-Token']).toBe('csrf');
  cleanup(); gate(); await screen.findByText('Private records for Owner');
  await sessionFetch('/api/workspaces/private/forecast');
  await screen.findByRole('heading', { name: 'Sign in to CashFlow Copilot' });
  expect(screen.queryByText(/Private records/)).toBeNull();
});

test('removes invitation secrets from the URL and accepts them only through the authenticated API', async () => {
  const token = 'a'.repeat(64); window.history.replaceState(null, '', `/?invite=${token}`);
  const fetch = vi.fn(async url => response(url.endsWith('/auth/me') ? { user, csrfToken: 'csrf' } : { workspaceId: 'business' }));
  vi.stubGlobal('fetch', fetch); gate();
  await screen.findByRole('heading', { name: 'Accept accountant invitation' });
  expect(window.location.search).toBe(''); expect(screen.queryByText(/Private records/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Accept invitation' }));
  await screen.findByText('Private records for Owner');
  const accept = fetch.mock.calls.find(([url]) => url.endsWith('/auth/invitations/accept'))[1];
  expect(JSON.parse(accept.body)).toEqual({ token }); expect(accept.headers['X-CSRF-Token']).toBe('csrf');
});

test('owner access controls create an invitation and revoke an accountant through scoped endpoints', async () => {
  setCsrf('csrf');
  const fetch = vi.fn(async (url, options) => {
    if (url.endsWith('/members/invitations')) return response({ invitationUrl: 'https://app.test/?invite=secret' }, 201);
    if (options.method === 'DELETE') return response(null, 204);
    if (url.endsWith('/members')) return response({ members: [{ id: 'a', name: 'Accountant', email: 'a@example.test', role: 'accountant' }], invitations: [] });
    return response({ devices: [] });
  });
  vi.stubGlobal('fetch', fetch); render(<BusinessAccess workspaceId="business-a" />);
  await screen.findByRole('button', { name: 'Remove accountant' });
  fireEvent.change(screen.getByLabelText('Accountant email'), { target: { value: 'a@example.test' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create accountant invitation' }));
  await screen.findByDisplayValue('https://app.test/?invite=secret');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Remove accountant' }).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'Remove accountant' }));
  await waitFor(() => expect(fetch.mock.calls.some(([url, options]) => url.endsWith('/workspaces/business-a/members/a') && options.method === 'DELETE')).toBe(true));
});

test('business selector uses server memberships and ignores forged cached business IDs and owner roles', async () => {
  localStorage.setItem('cashflowProfiles', JSON.stringify([{ id: 'foreign', name: 'Other private business', role: 'owner' }]));
  localStorage.setItem('cashflowWorkspace:owner', 'foreign');
  vi.stubGlobal('fetch', vi.fn(async url => response(url.endsWith('/auth/me') ? { user, csrfToken: 'csrf' } : {
    workspaces: [{ id: 'authorized', name: 'Authorized business', role: 'accountant' }],
  })));
  render(<App />);
  await screen.findByRole('option', { name: 'Authorized business · accountant' });
  expect(screen.getByLabelText('Supplier profile').value).toBe('');
  expect(screen.queryByRole('option', { name: /Other private business/ })).toBeNull();
  expect(screen.queryByRole('heading', { name: 'Business access' })).toBeNull();
});
