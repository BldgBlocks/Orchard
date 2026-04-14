async function request(targetPath, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const mutatingRequest = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

  const response = await fetch(targetPath, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(mutatingRequest ? { 'X-Orchard-Request': '1' } : {}),
      ...(options.headers || {}),
    },
  });

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    throw new Error(payload?.message || payload || 'Request failed.');
  }

  return payload;
}

export const api = {
  getHealth() {
    return request('/api/health');
  },
  getConfig() {
    return request('/api/config');
  },
  saveConfig(body) {
    return request('/api/config', {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  },
  saveBatchTargets(batchTargetPaths) {
    return request('/api/config/targets', {
      method: 'PUT',
      body: JSON.stringify({ batchTargetPaths }),
    });
  },
  getProjects() {
    return request('/api/projects');
  },
  getActivity() {
    return request('/api/activity');
  },
  runAction(body) {
    return request('/api/actions/run', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },
  cancelOperation(operationId) {
    return request(`/api/operations/${operationId}/cancel`, {
      method: 'POST',
    });
  },
};
