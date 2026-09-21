import assert from 'node:assert/strict';
import { constants, generateKeyPairSync, sign } from 'node:crypto';
import { test } from 'node:test';
import { HuaweiAccountProvider } from '../src/providers.js';

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

test('standard Huawei Account code exchange verifies the returned ID token', async () => {
  const clientId = '123456789';
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const publicJwk = publicKey.export({ format: 'jwk' });
  publicJwk.kid = 'test-key';
  publicJwk.alg = 'PS256';
  publicJwk.use = 'sig';

  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'PS256', kid: 'test-key', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: 'https://accounts.huawei.com', aud: clientId, azp: clientId,
    iat: now, exp: now + 300, sub: 'union-id', openid: 'open-id', display_name: '测试用户'
  })).toString('base64url');
  const signingInput = `${header}.${payload}`;
  const signature = sign('sha256', Buffer.from(signingInput), {
    key: privateKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32
  }).toString('base64url');
  const idToken = `${signingInput}.${signature}`;

  const requests = [];
  const provider = new HuaweiAccountProvider({
    huaweiClientId: clientId,
    huaweiClientSecret: 'client-secret',
    fetchImpl: async (url, options = {}) => {
      requests.push({ url, options });
      if (url.endsWith('/token')) return jsonResponse({ access_token: 'access-token', id_token: idToken });
      if (url.endsWith('/certs')) return jsonResponse({ keys: [publicJwk] });
      return jsonResponse({}, 404);
    }
  });

  const identity = await provider.exchangeAuthorizationCode('authorization-code');
  assert.deepEqual(identity, {
    openId: 'open-id', unionId: 'union-id', phone: '', nickname: '测试用户', avatarUrl: ''
  });
  assert.equal(requests[0].options.body.get('grant_type'), 'authorization_code');
  assert.equal(requests[0].options.body.get('supportAlg'), 'PS256');
});
