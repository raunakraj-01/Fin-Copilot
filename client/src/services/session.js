let csrf = '';
export const setCsrf = value => { csrf = value || ''; };
export async function sessionFetch(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (!['GET', 'HEAD', 'OPTIONS'].includes((options.method || 'GET').toUpperCase()) && csrf) headers['X-CSRF-Token'] = csrf;
  const response = await fetch(url, { ...options, headers, credentials: 'include' });
  if (response.status === 401 && !String(url).match(/\/auth\/(login|register|me)(?:$|\?)/)) window.dispatchEvent(new Event('cashflow-session-expired'));
  return response;
}
