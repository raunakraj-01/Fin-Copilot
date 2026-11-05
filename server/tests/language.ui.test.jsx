// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import App from '../../client/src/app/App.jsx';
import { setLanguage, t } from '../../client/src/i18n/index.js';

afterEach(() => { cleanup(); setLanguage('en'); localStorage.clear(); vi.unstubAllGlobals(); });

test('top-right language control switches navigation and persists selection', async () => {
  localStorage.clear(); setLanguage('en');
  vi.stubGlobal('fetch', vi.fn(async url => ({ ok: true, json: async () => url.endsWith('/auth/me') ? { user: { id: 'user', name: 'Owner' }, csrfToken: 'csrf' } : { workspaces: [] } })));
  render(<App />);
  await screen.findByLabelText('Language');
  fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'hi' } });
  expect(screen.getByRole('button', { name: 'नकदी तनाव परीक्षण' })).toBeTruthy();
  expect(document.documentElement.lang).toBe('hi');
  expect(localStorage.getItem('cashflowLanguage')).toBe('hi');
  fireEvent.change(screen.getByLabelText('भाषा'), { target: { value: 'kn' } });
  expect(screen.getByRole('button', { name: 'ನಗದು ಒತ್ತಡ ಪರೀಕ್ಷೆ' })).toBeTruthy();
  expect(t('Whom should I call first?')).toBe('ಮೊದಲು ಯಾರಿಗೆ ಕರೆ ಮಾಡಲಿ?');
  fireEvent.change(screen.getByLabelText('ಭಾಷೆ'), { target: { value: 'en' } });
  expect(screen.getByRole('button', { name: 'Cash Shock Lab' })).toBeTruthy();
});
