export function isAllowedPublicRoute(method, path) {
  if (method === 'GET' && path === '/healthz') return true;
  if (method === 'POST' && path === '/v1/agent/execute') return true;
  if (method === 'POST' && ['/v1/auth/register', '/v1/auth/login'].includes(path)) return true;
  if (method === 'POST' && path === '/v1/auth/huawei') return true;
  if (method === 'POST' && /^\/v1\/restaurants\/[^/]+\/reviews$/.test(path)) return true;
  if (method === 'OPTIONS' && /^\/v1\/restaurants\/[^/]+\/reviews$/.test(path)) return true;
  if (path === '/v1/users/me/profile' && ['GET', 'PUT'].includes(method)) return true;
  return method === 'OPTIONS' && [
    '/v1/agent/execute', '/v1/auth/register', '/v1/auth/login',
    '/v1/auth/huawei', '/v1/users/me/profile'
  ].includes(path);
}
