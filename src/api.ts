export type Health = { ok: boolean; service: string; transport: string; faxEnabled: boolean };
const withSlash = (endpoint: string) => endpoint.trim().replace(/\/$/, '');
export async function checkApi(endpoint: string): Promise<Health> {
  const response = await fetch(withSlash(endpoint) + '/healthz', { signal: AbortSignal.timeout(7000) });
  if (!response.ok) throw new Error('Server returned HTTP ' + response.status);
  return response.json() as Promise<Health>;
}
export async function submitFax(endpoint: string, token: string, payload: {
  recipient: string; title: string; filename: string; contentBase64: string;
}): Promise<{ id: string; status: string }> {
  const response = await fetch(withSlash(endpoint) + '/api/faxes', {
    method: 'POST', headers: {'Content-Type':'application/json','Authorization':'Bearer ' + token},
    body: JSON.stringify(payload)
  });
  const result = await response.json() as { id?: string; status?: string; error?: string };
  if (!response.ok) throw new Error(result.error || 'Fax submission failed (HTTP ' + response.status + ')');
  return {id: result.id || '', status: result.status || ''};
}
