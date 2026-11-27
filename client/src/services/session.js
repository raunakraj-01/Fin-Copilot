let csrf = '';
export const setCsrf = value => { csrf = value || ''; };
export async function sessionFetch(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (!['GET', 'HEAD', 'OPTIONS'].includes((options.method || 'GET').toUpperCase()) && csrf) headers['X-CSRF-Token'] = csrf;
  const response = await fetch(url, { ...options, headers, credentials: 'include' });
  if (response.status === 401 && !String(url).match(/\/auth\/(login|register|me)(?:$|\?)/)) window.dispatchEvent(new Event('cashflow-session-expired'));
  return response;
}

export async function readJsonSafe(response) {
  if (!response || response.status === 204) return null;
  if (typeof response.text === 'function') {
    const text = await response.text();
    if (!text) return null;
    try { return JSON.parse(text); }
    catch {
      throw Object.assign(
        new Error(response.ok ? 'Server returned an unexpected response.' : `Service temporarily unavailable (${response.status}). Please try again.`),
        { status: response.status },
      );
    }
  }
  if (typeof response.json === 'function') {
    try { return await response.json(); }
    catch {
      throw Object.assign(
        new Error(response.ok ? 'Server returned an unexpected response.' : `Service temporarily unavailable (${response.status}). Please try again.`),
        { status: response.status },
      );
    }
  }
  return null;
}
