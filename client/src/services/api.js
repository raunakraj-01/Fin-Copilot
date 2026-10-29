const baseUrl = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '/api' : 'http://localhost:5000/api');

export async function api(path, options) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(data.error?.message || `Request failed (${response.status})`);
  return data;
}

export function json(path, method, body) {
  return api(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
