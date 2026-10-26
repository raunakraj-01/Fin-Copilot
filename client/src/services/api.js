const baseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api';

export async function api(path, options) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || `Request failed (${response.status})`);
  return data;
}
