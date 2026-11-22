// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

test('production decision requests stay on the serving origin, including custom demo ports', async () => {
  vi.stubEnv('PROD', true);
  vi.stubEnv('VITE_API_BASE_URL', '');
  vi.resetModules();
  const { decisionApiBase } = await import('../../client/src/pages/RescuePlanner/DecisionUI.jsx');
  expect(new URL(`${decisionApiBase()}/workspaces/demo/rescue/analyze`, 'http://localhost:5001').href)
    .toBe('http://localhost:5001/api/workspaces/demo/rescue/analyze');
});

test('configured API and component overrides remain supported', async () => {
  vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.test/api/');
  vi.resetModules();
  const { decisionApiBase } = await import('../../client/src/pages/RescuePlanner/DecisionUI.jsx');
  expect(decisionApiBase()).toBe('https://api.example.test/api');
  expect(decisionApiBase('/custom/api/')).toBe('/custom/api');
});
