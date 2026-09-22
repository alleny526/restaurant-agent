import 'dotenv/config';
import { createServer, request as createRequest } from 'node:http';
import { isAllowedPublicRoute } from './public-gateway-policy.js';

const port = Number(process.env.PUBLIC_GATEWAY_PORT ?? 8788);
const privateOrigin = new URL(process.env.PRIVATE_ORIGIN ?? 'http://127.0.0.1:8787');
const maxBodyBytes = 16 * 1024 * 1024;

function sendJson(response, statusCode, value) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  response.end(JSON.stringify(value));
}

const server = createServer((incoming, outgoing) => {
  const url = new URL(incoming.url ?? '/', privateOrigin);
  if (!isAllowedPublicRoute(incoming.method ?? 'GET', url.pathname)) {
    sendJson(outgoing, 404, { code: 'NOT_FOUND', message: '公网入口未开放该接口' });
    return;
  }
  const contentLength = Number(incoming.headers['content-length'] ?? 0);
  if (contentLength > maxBodyBytes) {
    sendJson(outgoing, 413, { code: 'PAYLOAD_TOO_LARGE', message: '请求体过大' });
    return;
  }

  const headers = { ...incoming.headers, host: privateOrigin.host };
  const proxy = createRequest({
    protocol: privateOrigin.protocol,
    hostname: privateOrigin.hostname,
    port: privateOrigin.port,
    method: incoming.method,
    path: `${url.pathname}${url.search}`,
    headers
  }, (upstream) => {
    outgoing.writeHead(upstream.statusCode ?? 502, upstream.headers);
    upstream.pipe(outgoing);
  });
  proxy.on('error', () => {
    if (!outgoing.headersSent) sendJson(outgoing, 502, { code: 'UPSTREAM_UNAVAILABLE', message: '服务暂不可用' });
    else outgoing.destroy();
  });
  incoming.pipe(proxy);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Restricted app gateway listening on http://127.0.0.1:${port}`);
});
