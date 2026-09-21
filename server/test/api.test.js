import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { createRestaurantServer } from '../src/app.js';

let runtime;
let baseUrl;
let tempDirectory;

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', 'x-device-id': 'test-device', ...(options.headers ?? {}) }
  });
  const body = await response.json();
  return { response, body };
}

before(async () => {
  tempDirectory = await mkdtemp(join(tmpdir(), 'restaurant-agent-'));
  runtime = await createRestaurantServer({
    dataFile: join(tempDirectory, 'runtime.json'),
    authSecret: 'test-secret-that-is-long-enough-for-tests',
    demoMode: true,
    xiaoyiApiKey: 'test-tool-key'
  });
  await new Promise((resolve) => runtime.server.listen(0, '127.0.0.1', resolve));
  const address = runtime.server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise((resolve) => runtime.server.close(resolve));
  await rm(tempDirectory, { recursive: true, force: true });
});

test('health and grounded restaurant search work', async () => {
  const health = await request('/healthz');
  assert.equal(health.response.status, 200);
  assert.equal(health.body.status, 'ok');

  const result = await request('/v1/restaurants?cuisine=%E6%B1%9F%E6%B5%99%E8%8F%9C&openNow=true');
  assert.equal(result.response.status, 200);
  assert.ok(result.body.items.length >= 2);
  assert.ok(result.body.items.every((item) => item.cuisines.includes('江浙菜') && item.isOpen));
});

test('full dining state machine binds review to the selected restaurant', async () => {
  const created = await request('/v1/sessions', {
    method: 'POST',
    body: JSON.stringify({ deviceId: 'flow-device' })
  });
  assert.equal(created.response.status, 201);
  const sessionId = created.body.id;

  const recommendation = await request(`/v1/sessions/${sessionId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ text: '今天想吃清淡的江浙菜', userId: 'flow-device' })
  });
  assert.equal(recommendation.body.session.stage, 'PRE_MEAL');
  assert.ok(recommendation.body.restaurants.length >= 3);
  assert.ok(recommendation.body.restaurants[0].recommendationReason.includes('商家'));

  const selected = await request(`/v1/sessions/${sessionId}/select`, {
    method: 'POST', body: JSON.stringify({ restaurantId: 'rest-suyuan' })
  });
  assert.equal(selected.body.session.stage, 'RESTAURANT_SELECTED');
  assert.equal(selected.body.selectedRestaurant.id, 'rest-suyuan');

  const arrived = await request(`/v1/sessions/${sessionId}/arrive`, { method: 'POST', body: '{}' });
  assert.equal(arrived.body.session.stage, 'ARRIVED');
  assert.match(arrived.body.message.text, /拍/);

  const recognized = await request(`/v1/sessions/${sessionId}/menu/recognize`, {
    method: 'POST',
    body: JSON.stringify({ images: [{ fileName: 'menu.jpg', mimeType: 'image/jpeg', base64: 'aGVsbG8=' }] })
  });
  assert.equal(recognized.body.session.stage, 'MENU_READY');
  assert.ok(recognized.body.items.length > 0);
  assert.match(recognized.body.warning, /过敏原/);

  const corrected = await request(`/v1/sessions/${sessionId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ text: '这道菜不是鱼，是豆腐', userId: 'flow-device' })
  });
  assert.equal(corrected.body.session.stage, 'DINING');
  const correctedSession = runtime.store.snapshot().sessions.find((item) => item.id === sessionId);
  assert.ok(correctedSession.recognizedMenu.some((item) => item.ingredients.includes('豆腐')));

  const done = await request(`/v1/sessions/${sessionId}/done`, { method: 'POST', body: '{}' });
  assert.equal(done.body.session.stage, 'REVIEW');

  const reviewed = await request(`/v1/sessions/${sessionId}/messages`, {
    method: 'POST', body: JSON.stringify({ text: '菜很好吃，服务不错，我的手机号是13800138000', userId: 'flow-device' })
  });
  assert.equal(reviewed.body.session.stage, 'END');
  const state = runtime.store.snapshot();
  const review = state.reviews.find((item) => item.sessionId === sessionId);
  assert.equal(review.restaurantId, 'rest-suyuan');
  assert.match(review.text, /手机号已隐藏/);
  assert.ok(!review.text.includes('13800138000'));
});

test('HarmonyOS demo endpoint preserves the end-to-end app contract', async () => {
  let state = {
    sessionId: 'arkts-demo-session', stage: 'PRE_MEAL', selectedRestaurantId: '', userId: 'guest'
  };
  const profile = {
    userId: 'guest', nickname: '游客', phone: '', hometown: '', dietaryRestrictions: ['花生'],
    tastePreferences: ['清淡'], cuisinePreferences: ['江浙菜'], personalizationEnabled: true
  };
  const execute = async (action, message = '', restaurantId = '', menuImages = []) => {
    const result = await request('/v1/agent/execute', {
      method: 'POST',
      body: JSON.stringify({
        action, message, restaurantId, menuImages, recognizedMenu: [], rating: 0, state, profile
      })
    });
    assert.equal(result.response.status, 200);
    state = result.body.state;
    return result.body;
  };

  const discovered = await execute('discover');
  assert.equal(discovered.restaurants.length, 6);
  assert.equal(discovered.restaurants[0].distanceKm, 0.62);

  const recommended = await execute('chat', '想吃清淡的素食');
  assert.ok(recommended.restaurants.length > 0);
  assert.ok(state.sessionId !== 'arkts-demo-session');

  const selected = await execute('select_restaurant', '', 'rest-suyuan');
  assert.equal(selected.state.stage, 'RESTAURANT_SELECTED');
  assert.equal(selected.state.selectedRestaurantId, 'rest-suyuan');

  const arrived = await execute('arrive');
  assert.equal(arrived.state.stage, 'ARRIVED');

  const recognized = await execute('upload_menu', '', '', [
    { fileName: 'menu.jpg', mimeType: 'image/jpeg', base64: 'aGVsbG8=' }
  ]);
  assert.equal(recognized.state.stage, 'MENU_READY');
  assert.ok(recognized.recognizedMenu.length > 0);
  assert.ok(recognized.dishRecommendations.length > 0);

  const finished = await execute('finish_meal');
  assert.equal(finished.state.stage, 'REVIEW');

  const reviewed = await execute('chat', '味道很好，服务也不错');
  assert.equal(reviewed.state.stage, 'END');
  assert.equal(reviewed.reviewSaved, true);
});

test('OTP login and profile update require a valid token', async () => {
  const otp = await request('/v1/auth/otp/request', {
    method: 'POST', body: JSON.stringify({ phone: '13800138000' })
  });
  assert.equal(otp.response.status, 200);
  assert.equal(otp.body.debugCode.length, 6);

  const verified = await request('/v1/auth/otp/verify', {
    method: 'POST',
    body: JSON.stringify({ requestId: otp.body.requestId, phone: '13800138000', code: otp.body.debugCode })
  });
  assert.equal(verified.response.status, 200);
  assert.ok(verified.body.token.includes('.'));

  const profile = await request('/v1/users/me/profile', {
    method: 'PUT',
    headers: { authorization: `Bearer ${verified.body.token}` },
    body: JSON.stringify({
      nickname: '小艺用户', hometown: '杭州', dietaryRestrictions: ['虾'],
      tastePreferences: ['清淡'], cuisinePreferences: ['江浙菜'], personalizationEnabled: true
    })
  });
  assert.equal(profile.response.status, 200);
  assert.equal(profile.body.nickname, '小艺用户');
  assert.deepEqual(profile.body.dietaryRestrictions, ['虾']);

  const restored = await request('/v1/users/me/profile', {
    method: 'GET', headers: { authorization: `Bearer ${verified.body.token}` }
  });
  assert.equal(restored.response.status, 200);
  assert.equal(restored.body.id, verified.body.user.id);
  assert.equal(restored.body.hometown, '杭州');

  const unauthorized = await request('/v1/users/me/profile', {
    method: 'PUT', body: JSON.stringify({ nickname: 'bad' })
  });
  assert.equal(unauthorized.response.status, 401);
});

test('xiaoyi cloud tool returns no more than five grounded results', async () => {
  const result = await request('/xiaoyi/tools/search_restaurants', {
    method: 'POST',
    headers: { 'x-api-key': 'test-tool-key' },
    body: JSON.stringify({ query: '清淡的江浙菜，人均100以内', limit: 5 })
  });
  assert.equal(result.response.status, 200);
  assert.ok(result.body.restaurants.length > 0 && result.body.restaurants.length <= 5);
  assert.ok(result.body.restaurants.every((item) => item.id.startsWith('rest-')));
});

test('xiaoyi cloud tools preserve context through menu and review', async () => {
  const headers = { 'x-api-key': 'test-tool-key' };
  const conversationId = 'xiaoyi-conversation-1';

  const selected = await request('/xiaoyi/tools/select_restaurant', {
    method: 'POST', headers,
    body: JSON.stringify({ conversationId, restaurantId: 'rest-suyuan', userId: 'xiaoyi-user' })
  });
  assert.equal(selected.response.status, 200);
  assert.equal(selected.body.session.selectedRestaurantId, 'rest-suyuan');

  const arrived = await request('/xiaoyi/tools/arrive', {
    method: 'POST', headers, body: JSON.stringify({ conversationId, userId: 'xiaoyi-user' })
  });
  assert.equal(arrived.body.session.stage, 'ARRIVED');

  const menu = await request('/xiaoyi/tools/submit_menu', {
    method: 'POST', headers,
    body: JSON.stringify({
      conversationId,
      items: [{ id: 'xy-1', name: '清炒时蔬', category: '蔬菜', price: 28,
        ingredients: ['青菜'], tags: ['清淡'], confidence: 0.96 }],
      lowConfidenceFields: []
    })
  });
  assert.equal(menu.body.session.stage, 'MENU_READY');
  assert.equal(menu.body.items[0].name, '清炒时蔬');

  const finished = await request('/xiaoyi/tools/finish_dining', {
    method: 'POST', headers, body: JSON.stringify({ conversationId })
  });
  assert.equal(finished.body.session.stage, 'REVIEW');

  const reviewed = await request('/xiaoyi/tools/submit_review', {
    method: 'POST', headers,
    body: JSON.stringify({ conversationId, restaurantId: 'rest-suyuan', userId: 'xiaoyi-user',
      text: '服务很好，联系电话 13800138000' })
  });
  assert.equal(reviewed.body.session.stage, 'END');
  const saved = runtime.store.snapshot().reviews.find((item) => item.sessionId === reviewed.body.session.id);
  assert.equal(saved.restaurantId, 'rest-suyuan');
  assert.ok(!saved.text.includes('13800138000'));
});

test('xiaoyi cloud tools reject an invalid API key', async () => {
  const result = await request('/xiaoyi/tools/search_restaurants', {
    method: 'POST', headers: { 'x-api-key': 'wrong-key' }, body: JSON.stringify({ query: '江浙菜' })
  });
  assert.equal(result.response.status, 401);
  assert.equal(result.body.code, 'INVALID_PLUGIN_KEY');
});

test('xiaoyi review cannot switch the selected restaurant implicitly', async () => {
  const headers = { 'x-api-key': 'test-tool-key' };
  const conversationId = 'xiaoyi-conversation-guard';
  await request('/xiaoyi/tools/select_restaurant', {
    method: 'POST', headers, body: JSON.stringify({ conversationId, restaurantId: 'rest-suyuan' })
  });
  const result = await request('/xiaoyi/tools/submit_review', {
    method: 'POST', headers,
    body: JSON.stringify({ conversationId, restaurantId: 'rest-lanxi', text: '试图切换餐厅的评论' })
  });
  assert.equal(result.response.status, 409);
  assert.equal(result.body.code, 'RESTAURANT_CONTEXT_MISMATCH');
});
