import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { createRestaurantServer } from '../src/app.js';
import { AmapPlaceProvider, amapInternals } from '../src/amap.js';
import { RestaurantOrchestrator } from '../src/orchestrator.js';
import { isAllowedPublicRoute } from '../src/public-gateway-policy.js';
import { ChatModelProvider, VisionProvider } from '../src/providers.js';
import { parseDiningIntent, recommendRestaurants } from '../src/recommendation.js';
import { SqliteStore } from '../src/store.js';
import { testRestaurants } from '../test-support/fixtures.js';

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
    dataFile: join(tempDirectory, 'restaurant-agent.sqlite'),
    authSecret: 'test-secret-that-is-long-enough-for-tests',
    demoMode: true,
    initialRestaurants: testRestaurants
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
  assert.equal(health.body.database, 'sqlite');
  assert.equal(health.body.llmConfigured, false);

  const result = await request('/v1/restaurants?cuisine=%E6%B1%9F%E6%B5%99%E8%8F%9C&openNow=true');
  assert.equal(result.response.status, 200);
  assert.ok(result.body.items.length >= 2);
  assert.ok(result.body.items.every((item) => item.cuisines.includes('江浙菜') && item.isOpen));
});

test('state is persisted as a SQLite database', async () => {
  const bytes = await readFile(join(tempDirectory, 'restaurant-agent.sqlite'));
  assert.equal(bytes.subarray(0, 15).toString('utf8'), 'SQLite format 3');
  const restaurants = await runtime.store.queryRestaurants({ query: '兰溪' });
  assert.equal(restaurants[0].id, 'rest-lanxi');
  assert.equal(restaurants[0].menu[0].name, '清蒸鲈鱼');
  const reopened = await new SqliteStore(join(tempDirectory, 'restaurant-agent.sqlite')).init();
  const restored = reopened.snapshot().restaurants.find((item) => item.id === 'rest-lanxi');
  assert.equal(restored.menu[0].name, '清蒸鲈鱼');
});

test('AMap POI responses are normalized without inventing menu data', async () => {
  let requestedUrl = '';
  const provider = new AmapPlaceProvider({
    amapWebKey: 'test-amap-key', amapDefaultRegion: '深圳市', amapLocation: '', amapRadiusMeters: 5000
  }, async (url) => {
    requestedUrl = url.toString();
    return new Response(JSON.stringify({
      status: '1', info: 'OK', pois: [{
        id: 'B0001', name: '授权数据餐厅', address: '科技园 1 号', location: '113.9,22.5',
        type: '餐饮服务;中餐厅;中餐厅', atag: '粤菜',
        business: { tag: '清淡,烧味', rating: '4.6', cost: '88', opentime_today: '00:00-23:59' },
        photos: [
          { title: '门店环境', url: 'https://example.com/store.jpg' },
          { title: '菜单价目表', url: 'https://example.com/menu.jpg' }
        ]
      }]
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  const items = await provider.search('想吃粤菜', 5);
  assert.match(requestedUrl, /\/v5\/place\/text/);
  assert.match(requestedUrl, /types=050000/);
  assert.equal(new URL(requestedUrl).searchParams.get('show_fields'), 'business,photos');
  assert.equal(items[0].id, 'amap:B0001');
  assert.equal(items[0].averagePrice, 88);
  assert.equal(items[0].menu.length, 0);
  assert.equal(items[0].images.length, 2);
  assert.equal(items[0].images[1].menuCandidate, true);
  assert.equal(items[0].imageUrl, 'https://example.com/store.jpg');
  assert.equal(items[0].source, 'amap');
});

test('unknown opening hours stay unknown', () => {
  assert.deepEqual(amapInternals.openingState(''), { known: false, open: false });
});

test('natural language dining intent extracts name, dish, distance and rating', () => {
  const intent = parseDiningIntent('帮我找“福味家宴”，想吃盐水鸭，2公里内评分4.5以上的清淡菜');
  assert.deepEqual(intent.restaurantNames, ['福味家宴']);
  assert.deepEqual(intent.dishes, ['盐水鸭']);
  assert.equal(intent.maxDistanceKm, 2);
  assert.equal(intent.minRating, 4.5);
  assert.deepEqual(intent.tastes, ['清淡']);
});

test('bare food terms match both dishes and store names', () => {
  const intent = parseDiningIntent('炒饼');
  assert.deepEqual(intent.dishes, ['炒饼']);
  assert.deepEqual(intent.restaurantNames, ['炒饼']);
});

test('restaurant query searches menu item fields in SQLite', async () => {
  const restaurants = await runtime.store.queryRestaurants({ query: '鲈鱼' });
  assert.ok(restaurants.some((item) => item.id === 'rest-lanxi'));
});

test('restaurant ranking applies name, dish, distance and rating constraints', () => {
  const intent = parseDiningIntent('找“福味家宴”，想吃盐水鸭，2公里内评分4.5以上');
  const result = recommendRestaurants([
    { id: 'target', name: '福味家宴', cuisines: ['南京菜'], tags: ['盐水鸭'], menu: [],
      averagePrice: 80, rating: 4.8, isOpen: true, openStatusKnown: true, distanceMeters: 1200 },
    { id: 'far', name: '福味家宴远店', cuisines: ['南京菜'], tags: ['盐水鸭'], menu: [],
      averagePrice: 80, rating: 4.9, isOpen: true, openStatusKnown: true, distanceMeters: 3500 }
  ], intent, null, 5);
  assert.deepEqual(result.map((item) => item.id), ['target']);
});

test('restaurant detail recognizes only AMap photos explicitly labeled as menus', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'restaurant-agent-photo-menu-'));
  try {
    const restaurant = {
      id: 'amap:photo-menu', externalPoiId: 'photo-menu', source: 'amap', name: '图片菜单餐厅',
      address: '南京市测试路', location: { longitude: 118.79, latitude: 32.04 }, distanceMeters: 0,
      cuisines: ['南京菜'], tags: [], averagePrice: 60, rating: 4.5, isOpen: true,
      openStatusKnown: true, openingHours: '09:00-22:00', telephone: '', imageUrl: 'https://example.com/store.jpg',
      images: [
        { title: '门店环境', url: 'https://example.com/store.jpg', menuCandidate: false },
        { title: '菜单价目表', url: 'https://example.com/menu.jpg', menuCandidate: true }
      ], reviewSummary: '', menu: [], dataUpdatedAt: new Date().toISOString()
    };
    const store = await new SqliteStore(join(directory, 'restaurants.sqlite'), {
      initialRestaurants: [restaurant]
    }).init();
    const fetchedUrls = [];
    const orchestrator = new RestaurantOrchestrator(store, {
      vision: {}, places: { isConfigured: () => false },
      imageFetch: async (url) => {
        fetchedUrls.push(url);
        return new Response(Buffer.from('image-bytes'), { status: 200, headers: { 'content-type': 'image/jpeg' } });
      },
      chat: {
        recognizeMenu: async () => ({
          usedModel: true, items: [{ id: 'photo-dish', name: '金陵盐水鸭', category: '凉菜', price: 58,
            ingredients: [], tags: [], confidence: 0.91 }]
        })
      }
    });
    const result = await orchestrator.restaurantDetail('amap:photo-menu', { sessionId: 'preview' },
      { userId: 'guest', personalizationEnabled: false });
    assert.deepEqual(fetchedUrls, ['https://example.com/menu.jpg']);
    assert.equal(result.selectedRestaurant.menu[0].name, '金陵盐水鸭');
    assert.equal(store.snapshot().restaurants[0].menuSource, 'amap-photo-vision');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('public gateway exposes app, Huawei login and authenticated profile routes', () => {
  assert.equal(isAllowedPublicRoute('GET', '/healthz'), true);
  assert.equal(isAllowedPublicRoute('POST', '/v1/agent/execute'), true);
  assert.equal(isAllowedPublicRoute('POST', '/v1/auth/register'), true);
  assert.equal(isAllowedPublicRoute('POST', '/v1/auth/login'), true);
  assert.equal(isAllowedPublicRoute('POST', '/v1/auth/huawei'), true);
  assert.equal(isAllowedPublicRoute('GET', '/v1/users/me/profile'), true);
  assert.equal(isAllowedPublicRoute('PUT', '/v1/users/me/profile'), true);
  assert.equal(isAllowedPublicRoute('POST', '/v1/restaurants/amap%3AB001/reviews'), true);
  assert.equal(isAllowedPublicRoute('GET', '/internal/diagnostics'), false);
  assert.equal(isAllowedPublicRoute('POST', '/v1/auth/otp/request'), false);
  assert.equal(isAllowedPublicRoute('DELETE', '/v1/users/me'), false);
  assert.equal(isAllowedPublicRoute('GET', '/v1/restaurants'), false);
});

test('menu demo recognition can stay enabled independently of server demo mode', async () => {
  const vision = new VisionProvider({ visionApiUrl: '', visionApiKey: '', visionDemoMode: true });
  const result = await vision.recognize([{ base64: 'aGVsbG8=' }], { menu: [] });
  assert.equal(result.provider, 'demo');
  assert.ok(result.items.length > 0);
});

test('AMap searches rank only POIs returned by the current regional query', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'restaurant-agent-amap-scope-'));
  try {
    const store = await new SqliteStore(join(directory, 'restaurants.sqlite'), {
      initialRestaurants: testRestaurants
    }).init();
    const restaurant = {
      id: 'amap:nanjing-1', externalPoiId: 'nanjing-1', source: 'amap', name: '南京测试餐厅',
      address: '南京市秦淮区测试路1号', location: { longitude: 118.79, latitude: 32.04 },
      distanceMeters: 0, cuisines: ['餐饮服务'], tags: [], averagePrice: 80, rating: 4.8,
      isOpen: true, openStatusKnown: true, openingHours: '09:00-22:00', telephone: '', imageUrl: '',
      reviewSummary: '餐厅基础信息来自高德地图 Web 服务 API。', menu: [],
      dataUpdatedAt: '2026-09-20T00:00:00.000Z'
    };
    const orchestrator = new RestaurantOrchestrator(store, {
      vision: {}, chat: {},
      places: { isConfigured: () => true, search: async () => [restaurant] }
    });
    const result = await orchestrator.searchRestaurants('推荐南京人均100元以内的餐厅', '', 5);
    assert.equal(result.dataSource, 'amap');
    assert.deepEqual(result.restaurants.map((item) => item.id), ['amap:nanjing-1']);
    assert.match(result.restaurants[0].recommendationReason, /主营餐饮服务/);
    assert.doesNotMatch(result.restaurants[0].recommendationReason, /信息来自|自建数据库/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('AMap uses supplied device coordinates for nearby distance search', async () => {
  let requestedUrl = '';
  const provider = new AmapPlaceProvider({
    amapWebKey: 'test-key', amapDefaultRegion: '南京市', amapLocation: '', amapRadiusMeters: 5000
  }, async (url) => {
    requestedUrl = url.toString();
    return new Response(JSON.stringify({ status: '1', info: 'OK', pois: [] }), {
      status: 200, headers: { 'content-type': 'application/json' }
    });
  });
  await provider.search('附近餐厅', 5, { longitude: 118.796877, latitude: 32.060255 });
  assert.match(requestedUrl, /\/v5\/place\/around/);
  assert.match(requestedUrl, /location=118\.796877%2C32\.060255/);
  assert.match(requestedUrl, /sortrule=distance/);
});

test('AMap place search requests the requested page', async () => {
  let requestedUrl = '';
  const provider = new AmapPlaceProvider({
    amapWebKey: 'test-amap-key', amapDefaultRegion: '南京市', amapLocation: '', amapRadiusMeters: 5000
  }, async (url) => {
    requestedUrl = url.toString();
    return new Response(JSON.stringify({ status: '1', info: 'OK', pois: [] }), {
      status: 200, headers: { 'content-type': 'application/json' }
    });
  });
  await provider.search('餐厅', 20, null, 3);
  assert.match(requestedUrl, /page_size=20/);
  assert.match(requestedUrl, /page_num=3/);
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

  const confirmedMenu = await request(`/v1/sessions/${sessionId}/menu/confirm`, {
    method: 'POST', body: '{}'
  });
  assert.equal(confirmedMenu.body.session.stage, 'DINING');
  assert.equal(confirmedMenu.body.session.menuStatus, 'CONFIRMED');

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
  const persistedSession = state.sessions.find((item) => item.id === sessionId);
  assert.ok(persistedSession.messages.every((item) => !item.text.includes('13800138000')));
});

test('reviews retain separate entries across users and visits', async () => {
  const created = await request('/v1/sessions', {
    method: 'POST', body: JSON.stringify({ deviceId: 'repeat-review-device', userId: 'flow-device' })
  });
  const sessionId = created.body.id;
  await runtime.store.transaction((state) => {
    state.users.push({
      id: 'flow-device', nickname: '回访用户', phone: '', hometown: '', dietaryRestrictions: [],
      tastePreferences: [], cuisinePreferences: [], personalizationEnabled: true
    });
    state.users.push({
      id: 'other-review-user', nickname: '另一位用户', phone: '', hometown: '', dietaryRestrictions: [],
      tastePreferences: [], cuisinePreferences: [], personalizationEnabled: true
    });
    const session = state.sessions.find((item) => item.id === sessionId);
    session.userId = 'flow-device';
    session.selectedRestaurantId = 'rest-suyuan';
    session.stage = 'REVIEW';
    return true;
  });

  const reviewed = await request(`/v1/sessions/${sessionId}/messages`, {
    method: 'POST', body: JSON.stringify({ text: '第二次到店，蔬菜依然新鲜', userId: 'flow-device' })
  });
  assert.equal(reviewed.response.status, 200);
  const reviews = runtime.store.snapshot().reviews.filter((item) =>
    item.userId === 'flow-device' && item.restaurantId === 'rest-suyuan');
  assert.ok(reviews.length >= 2);
  assert.equal(new Set(reviews.map((item) => item.id)).size, reviews.length);
  assert.ok(reviews.some((item) => item.text.includes('第二次到店')));

  const other = await request('/v1/sessions', {
    method: 'POST', body: JSON.stringify({ deviceId: 'other-review-device', userId: 'other-review-user' })
  });
  await runtime.store.transaction((state) => {
    const session = state.sessions.find((item) => item.id === other.body.id);
    session.userId = 'other-review-user';
    session.selectedRestaurantId = 'rest-suyuan';
    session.stage = 'REVIEW';
    return true;
  });
  const otherReviewed = await request(`/v1/sessions/${other.body.id}/messages`, {
    method: 'POST', body: JSON.stringify({ text: '第一次来，环境安静', userId: 'other-review-user' })
  });
  assert.equal(otherReviewed.response.status, 200);

  const restaurant = await request('/v1/restaurants/rest-suyuan');
  const publicReviews = restaurant.body.reviews;
  assert.ok(publicReviews.some((item) => item.authorName === '回访用户'));
  assert.ok(publicReviews.some((item) => item.authorName === '另一位用户'));
  assert.ok(publicReviews.every((item) => item.createdAt.length >= 16));
});

test('discover pagination returns unique restaurants and public reviews', async () => {
  const first = await request('/v1/agent/execute', {
    method: 'POST',
    body: JSON.stringify({
      action: 'discover', page: 1, pageSize: 2, state: { sessionId: 'page-1', stage: 'PRE_MEAL', selectedRestaurantId: '', userId: 'guest' },
      profile: { userId: 'guest', dietaryRestrictions: [], tastePreferences: [], cuisinePreferences: [], personalizationEnabled: true }
    })
  });
  const second = await request('/v1/agent/execute', {
    method: 'POST',
    body: JSON.stringify({
      action: 'discover', page: 2, pageSize: 2, state: { sessionId: 'page-2', stage: 'PRE_MEAL', selectedRestaurantId: '', userId: 'guest' },
      profile: { userId: 'guest', dietaryRestrictions: [], tastePreferences: [], cuisinePreferences: [], personalizationEnabled: true }
    })
  });
  assert.equal(first.response.status, 200);
  assert.equal(second.response.status, 200);
  assert.equal(first.body.restaurants.length, 2);
  assert.equal(second.body.restaurants.length, 2);
  assert.equal(first.body.restaurants.some((item) => item.id === second.body.restaurants[0].id), false);
  const reviewed = second.body.restaurants.find((item) => item.id === 'rest-suyuan');
  assert.ok(reviewed);
  assert.ok(Array.isArray(reviewed.reviews));
});

test('HarmonyOS demo endpoint preserves the end-to-end app contract', async () => {
  let state = {
    sessionId: 'arkts-demo-session', stage: 'PRE_MEAL', selectedRestaurantId: '', userId: 'guest'
  };
  const profile = {
    userId: 'guest', nickname: '游客', phone: '', hometown: '', dietaryRestrictions: ['花生'],
    tastePreferences: ['清淡'], cuisinePreferences: ['江浙菜'], personalizationEnabled: true
  };
  const execute = async (action, message = '', restaurantId = '', menuImages = [], recognizedMenu = []) => {
    const result = await request('/v1/agent/execute', {
      method: 'POST',
      body: JSON.stringify({
        action, message, restaurantId, menuImages, recognizedMenu, rating: 0, state, profile
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

  const selected = await execute('select_restaurant', '', 'rest-beifang');
  assert.equal(selected.state.stage, 'RESTAURANT_SELECTED');
  assert.equal(selected.state.selectedRestaurantId, 'rest-beifang');

  const arrived = await execute('arrive');
  assert.equal(arrived.state.stage, 'ARRIVED');

  const recognized = await execute('upload_menu', '', '', [], [
    { id: 'device-ocr-1', name: '盐水鸭', category: '待确认', price: 48,
      ingredients: [], tags: [], confidence: 0.92 }
  ]);
  assert.equal(recognized.state.stage, 'MENU_READY');
  assert.equal(recognized.recognizedMenu[0].name, '盐水鸭');
  assert.ok(recognized.dishRecommendations.length > 0);
  assert.equal(recognized.dishRecommendations[0].reason, '');
  assert.equal(recognized.state.menuStatus, 'PENDING');
  const pendingVersion = runtime.store.snapshot().menuVersions.find((item) => item.id === recognized.state.menuVersionId);
  assert.equal(pendingVersion.status, 'PENDING');
  const savedRestaurant = runtime.store.snapshot().restaurants.find((item) => item.id === 'rest-beifang');
  assert.equal(savedRestaurant.menu.length, 0);
  const reopenedAfterOcr = await new SqliteStore(join(tempDirectory, 'restaurant-agent.sqlite')).init();
  const restoredMenu = reopenedAfterOcr.snapshot().restaurants.find((item) => item.id === 'rest-beifang');
  assert.equal(restoredMenu.menu.length, 0);

  const confirmed = await execute('confirm_menu');
  assert.equal(confirmed.state.stage, 'DINING');
  const confirmedRestaurant = runtime.store.snapshot().restaurants.find((item) => item.id === 'rest-beifang');
  assert.equal(confirmedRestaurant.menu[0].name, '盐水鸭');
  assert.equal(confirmedRestaurant.menuSource, 'device-ocr');
  assert.equal(confirmedRestaurant.menuSourceSessionId, state.sessionId);
  const confirmedVersion = runtime.store.snapshot().menuVersions.find((item) => item.id === confirmed.state.menuVersionId);
  assert.equal(confirmedVersion.status, 'CONFIRMED');

  const finished = await execute('finish_meal');
  assert.equal(finished.state.stage, 'REVIEW');

  const reviewed = await execute('chat', '味道很好，服务也不错');
  assert.equal(reviewed.state.stage, 'END');
  assert.equal(reviewed.reviewSaved, true);
  assert.deepEqual(reviewed.recognizedMenu, []);
  assert.deepEqual(reviewed.dishRecommendations, []);
});

test('model handles discovery and free-form chat without rewriting fixed workflow actions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'restaurant-agent-model-flow-'));
  try {
    const store = await new SqliteStore(join(directory, 'restaurants.sqlite'), {
      initialRestaurants: testRestaurants
    }).init();
    const modelNodes = [];
    let intentCalls = 0;
    let rankCalls = 0;
    const chat = {
      isConfigured: () => true,
      analyzeIntent: async (_text, fallback) => {
        intentCalls += 1;
        return { intent: fallback, usedModel: true };
      },
      rankIds: async ({ fallbackIds, limit }) => {
        rankCalls += 1;
        return { ids: fallbackIds.slice(0, limit), usedModel: true };
      },
      complete: async ({ facts, fallback }) => {
        modelNodes.push(`${facts.action ?? 'chat'}:${facts.stage ?? 'PREVIEW'}`);
        return { text: `模型回复：${fallback}`, usedModel: true };
      }
    };
    const orchestrator = new RestaurantOrchestrator(store, {
      vision: new VisionProvider({ visionApiUrl: '', visionApiKey: '', visionDemoMode: true }),
      chat,
      places: { isConfigured: () => false }
    });
    let state = { sessionId: 'model-flow', stage: 'PRE_MEAL', selectedRestaurantId: '', userId: 'guest' };
    const profile = {
      userId: 'guest', dietaryRestrictions: [], tastePreferences: ['清淡'],
      cuisinePreferences: ['江浙菜'], personalizationEnabled: true
    };
    const execute = async (action, extra = {}, expectedModel = false) => {
      const response = await orchestrator.executeAppRequest({
        action, message: '', restaurantId: '', menuImages: [], recognizedMenu: [],
        state, profile, ...extra
      });
      state = response.state;
      assert.equal(response.modelUsed, expectedModel);
      return response;
    };

    const discovered = await orchestrator.executeAppRequest({
      action: 'discover', state, profile, message: '', restaurantId: '', menuImages: [], recognizedMenu: []
    });
    assert.equal(discovered.modelUsed, false);
    await execute('chat', { message: '推荐清淡的江浙菜' }, true);
    await execute('select_restaurant', { restaurantId: 'rest-suyuan' });
    await execute('arrive');
    await execute('upload_menu', { recognizedMenu: [
      { id: 'ocr-dish', name: '清炒时蔬', category: '蔬菜', price: 28,
        ingredients: ['青菜'], tags: ['清淡'], confidence: 0.95 }
    ] });
    await execute('confirm_menu');
    const diningReply = await execute('chat', { message: '这道菜有什么特点' }, true);
    assert.match(diningReply.reply, /^模型回复/);
    await execute('finish_meal');
    await execute('chat', { message: '味道清淡，服务很好' });

    assert.ok(intentCalls > 0);
    assert.ok(rankCalls > 0);
    assert.ok(modelNodes.some((node) => node.startsWith('chat:')));
    assert.equal(modelNodes.some((node) => node.startsWith('select_restaurant:')), false);
    assert.equal(modelNodes.some((node) => node.startsWith('arrive:')), false);
    assert.equal(modelNodes.some((node) => node.startsWith('upload_menu:')), false);
    assert.equal(modelNodes.some((node) => node.startsWith('finish_meal:')), false);
    assert.equal(state.stage, 'END');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('restaurant queries after selection use model keywords and AMap candidates', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'restaurant-agent-reselect-query-'));
  try {
    const store = await new SqliteStore(join(directory, 'restaurants.sqlite'), {
      initialRestaurants: testRestaurants
    }).init();
    let searchedKeyword = '';
    let intentCalls = 0;
    let rankCalls = 0;
    const hotpot = {
      id: 'amap:hotpot-1', externalPoiId: 'hotpot-1', source: 'amap', name: '南京火锅测试店',
      address: '南京市测试路 8 号', location: { longitude: 118.79, latitude: 32.04 },
      distanceMeters: 800, cuisines: ['火锅'], tags: ['麻辣'], averagePrice: 90, rating: 4.8,
      isOpen: true, openStatusKnown: true, openingHours: '10:00-23:00', telephone: '', imageUrl: '',
      reviewSummary: '', menu: [], dataUpdatedAt: '2026-09-21T00:00:00.000Z'
    };
    const orchestrator = new RestaurantOrchestrator(store, {
      vision: {},
      chat: {
        analyzeIntent: async (text, fallback) => {
          intentCalls += 1;
          return { intent: { ...fallback, keywords: ['火锅'], cuisines: ['火锅'] }, usedModel: true };
        },
        rankIds: async ({ fallbackIds }) => {
          rankCalls += 1;
          return { ids: fallbackIds, usedModel: true };
        }
      },
      places: {
        isConfigured: () => true,
        search: async (keyword) => {
          searchedKeyword = keyword;
          return [hotpot];
        }
      }
    });
    const session = await orchestrator.ensureAppSession('reselect-query', 'guest', null);
    await orchestrator.selectRestaurant(session.id, 'rest-lanxi');
    const result = await orchestrator.handleMessage(session.id, '想换一家火锅店', 'guest');
    assert.equal(searchedKeyword, '火锅');
    assert.equal(intentCalls, 1);
    assert.equal(rankCalls, 1);
    assert.deepEqual(result.restaurants.map((item) => item.id), ['amap:hotpot-1']);
    assert.equal(result.session.selectedRestaurantId, 'rest-lanxi');
    assert.equal(result.session.stage, 'RESTAURANT_SELECTED');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('ordinary account registration and login issue the shared profile token', async () => {
  const registered = await request('/v1/auth/register', {
    method: 'POST', body: JSON.stringify({ nickname: '普通用户', account: 'DemoUser', password: 'secure123' })
  });
  assert.equal(registered.response.status, 201);
  assert.equal(registered.body.user.nickname, '普通用户');
  assert.ok(registered.body.token.includes('.'));
  assert.equal(registered.body.user.passwordHash, undefined);
  const stored = runtime.store.snapshot().users.find((item) => item.id === registered.body.user.id);
  assert.match(stored.passwordHash, /^scrypt\$/);
  assert.ok(!stored.passwordHash.includes('secure123'));

  const duplicate = await request('/v1/auth/register', {
    method: 'POST', body: JSON.stringify({ nickname: '重复用户', account: 'demouser', password: 'secure123' })
  });
  assert.equal(duplicate.response.status, 409);

  const rejected = await request('/v1/auth/login', {
    method: 'POST', body: JSON.stringify({ account: 'DemoUser', password: 'wrong-password' })
  });
  assert.equal(rejected.response.status, 401);

  const loggedIn = await request('/v1/auth/login', {
    method: 'POST', body: JSON.stringify({ account: 'demouser', password: 'secure123' })
  });
  assert.equal(loggedIn.response.status, 200);
  assert.equal(loggedIn.body.user.id, registered.body.user.id);

  const profile = await request('/v1/users/me/profile', {
    headers: { authorization: `Bearer ${loggedIn.body.token}` }
  });
  assert.equal(profile.response.status, 200);
  assert.equal(profile.body.nickname, '普通用户');

  const review = await request('/v1/restaurants/rest-suyuan/reviews', {
    method: 'POST', headers: { authorization: `Bearer ${loggedIn.body.token}` },
    body: JSON.stringify({ text: '详情页直接评论，环境安静。', rating: 4 })
  });
  assert.equal(review.response.status, 201);
  assert.equal(review.body.authorName, '普通用户');
  assert.equal(review.body.rating, 4);
  const restaurant = await request('/v1/restaurants/rest-suyuan');
  assert.ok(restaurant.body.reviews.some((item) => item.id === review.body.id));
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
      nickname: '餐厅用户', hometown: '杭州', avatarUrl: 'data:image/jpeg;base64,/9j/2Q==', dietaryRestrictions: ['虾'],
      tastePreferences: ['清淡'], cuisinePreferences: ['江浙菜'], personalizationEnabled: true
    })
  });
  assert.equal(profile.response.status, 200);
  assert.equal(profile.body.nickname, '餐厅用户');
  assert.equal(profile.body.hometown, '杭州');
  assert.equal(profile.body.avatarUrl, 'data:image/jpeg;base64,/9j/2Q==');
  assert.deepEqual(profile.body.dietaryRestrictions, ['虾']);

  const unauthorized = await request('/v1/users/me/profile', {
    method: 'PUT', body: JSON.stringify({ nickname: 'bad' })
  });
  assert.equal(unauthorized.response.status, 401);
});

test('DeepSeek-compatible provider sends structured requests and validates candidate ids', async () => {
  const requests = [];
  const responses = [
    { cuisines: ['南京菜'], tastes: ['清淡'], maxPrice: 100, openNow: true, raw: 'ignored' },
    { ids: ['rest-2', 'invented-id', 'rest-1'] },
    null
  ];
  const provider = new ChatModelProvider({
    llmBaseUrl: 'https://api.deepseek.com', llmApiKey: 'test-key',
    llmModel: 'deepseek-chat', llmTimeoutMs: 5000
  }, async (url, options) => {
    requests.push({ url, options, body: JSON.parse(options.body) });
    const next = responses.shift();
    const content = next === null ? '基于已检索到的餐厅事实，这是模型回复。' : JSON.stringify(next);
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
      status: 200, headers: { 'content-type': 'application/json' }
    });
  });

  const fallback = { cuisines: [], tastes: [], maxPrice: null, openNow: true, raw: '推荐餐厅' };
  const intent = await provider.analyzeIntent('推荐南京清淡、人均100元以内的餐厅', fallback);
  assert.equal(intent.usedModel, true);
  assert.equal(intent.intent.maxPrice, 100);
  const ranked = await provider.rankIds({
    userMessage: '推荐餐厅', kind: '餐厅', candidates: [{ id: 'rest-1' }, { id: 'rest-2' }],
    preferences: null, fallbackIds: ['rest-1', 'rest-2'], limit: 2
  });
  assert.deepEqual(ranked.ids, ['rest-2', 'rest-1']);
  const reply = await provider.complete({
    userMessage: '推荐餐厅', facts: { restaurants: [{ id: 'rest-2' }] }, fallback: 'fallback'
  });
  assert.equal(reply.usedModel, true);
  assert.match(reply.text, /模型回复/);
  assert.equal(requests[0].url, 'https://api.deepseek.com/chat/completions');
  assert.equal(requests[0].body.model, 'deepseek-chat');
  assert.equal(requests[0].options.headers.authorization, 'Bearer test-key');
  assert.deepEqual(requests.slice(0, 2).map((item) => item.body.response_format), [
    { type: 'json_object' }, { type: 'json_object' }
  ]);
});

test('Qwen-compatible provider disables thinking for stable structured output', async () => {
  let requestBody = null;
  const provider = new ChatModelProvider({
    llmProvider: 'qwen',
    llmBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    llmApiKey: 'test-key', llmModel: 'qwen3.8-flash', llmTimeoutMs: 5000
  }, async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"ids":["dish-1"]}' } }] }), {
      status: 200, headers: { 'content-type': 'application/json' }
    });
  });
  const result = await provider.rankIds({
    userMessage: '想吃清淡的', kind: '菜品', candidates: [{ id: 'dish-1', name: '清炒时蔬' }],
    preferences: { tastePreferences: ['清淡'] }, fallbackIds: ['dish-1'], limit: 1
  });
  assert.equal(result.usedModel, true);
  assert.equal(requestBody.enable_thinking, false);
  assert.equal(requestBody.model, 'qwen3.8-flash');
  assert.deepEqual(requestBody.response_format, { type: 'json_object' });
});

test('OpenAI GPT-5.6 request uses reasoning-model compatible token parameters', async () => {
  let requestBody = null;
  const provider = new ChatModelProvider({
    llmProvider: 'openai-compatible', llmBaseUrl: 'https://rehdasu.cn/v1',
    llmApiKey: 'test-key', llmModel: 'gpt-5.6-sol', llmTimeoutMs: 5000
  }, async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: '测试回复' } }] }), {
      status: 200, headers: { 'content-type': 'application/json' }
    });
  });
  const result = await provider.complete({ userMessage: '推荐餐厅', facts: {}, fallback: 'fallback' });
  assert.equal(result.usedModel, true);
  assert.equal(requestBody.model, 'gpt-5.6-sol');
  assert.equal(requestBody.temperature, undefined);
  assert.equal(requestBody.max_tokens, undefined);
  assert.equal(requestBody.max_completion_tokens, 180);
  assert.equal(requestBody.reasoning_effort, 'none');
});

test('simple flow nodes use the configured fast OpenAI model', async () => {
  let requestBody = null;
  const provider = new ChatModelProvider({
    llmProvider: 'openai-compatible', llmBaseUrl: 'https://rehdasu.cn/v1',
    llmApiKey: 'test-key', llmModel: 'gpt-5.6-sol', llmFastModel: 'gpt-5.6-luna', llmTimeoutMs: 5000
  }, async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: '已选择餐厅' } }] }), {
      status: 200, headers: { 'content-type': 'application/json' }
    });
  });
  const result = await provider.complete({
    userMessage: '确认选择', facts: {}, fallback: 'fallback', flowNode: 'SELECT'
  });
  assert.equal(result.usedModel, true);
  assert.equal(result.model, 'gpt-5.6-luna');
  assert.equal(requestBody.model, 'gpt-5.6-luna');
  assert.equal(requestBody.reasoning_effort, 'none');
});

test('GPT vision menu recognition returns validated items in one request', async () => {
  let requestBody = null;
  const provider = new ChatModelProvider({
    llmProvider: 'openai-compatible', llmBaseUrl: 'https://rehdasu.cn/v1',
    llmApiKey: 'test-key', llmModel: 'gpt-5.6-sol', llmTimeoutMs: 5000
  }, async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
      items: [{ id: 'vision-1', name: '盐水鸭', category: '凉菜', price: 48,
        ingredients: [], tags: ['南京菜'], confidence: 0.96 }],
      lowConfidenceFields: [], reply: '识别到1道菜，请确认价格。'
    }) } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  const result = await provider.recognizeMenu([
    { mimeType: 'image/jpeg', base64: 'aGVsbG8=' }
  ], [{ id: 'ocr-1', name: '盐水鸡', price: 48 }], null);
  assert.equal(result.usedModel, true);
  assert.equal(result.items[0].name, '盐水鸭');
  assert.equal(requestBody.response_format.type, 'json_object');
  assert.equal(requestBody.messages[1].content[1].type, 'image_url');
  assert.match(requestBody.messages[1].content[1].image_url.url, /^data:image\/jpeg;base64,/);
});

test('fixed flow rejects actions that skip required stages', async () => {
  const result = await request('/v1/agent/execute', {
    method: 'POST',
    body: JSON.stringify({
      action: 'finish_meal', message: '', restaurantId: '', menuImages: [], recognizedMenu: [],
      state: { sessionId: 'invalid-flow', stage: 'PRE_MEAL', selectedRestaurantId: '', userId: 'guest' },
      profile: { userId: 'guest', dietaryRestrictions: [], tastePreferences: [],
        cuisinePreferences: [], personalizationEnabled: true }
    })
  });
  assert.equal(result.response.status, 409);
  assert.equal(result.body.code, 'INVALID_FLOW_TRANSITION');
});

test('changing restaurant before review resets the restaurant conversation', async () => {
  const state = { sessionId: 'locked-selection', stage: 'PRE_MEAL', selectedRestaurantId: '', userId: 'guest' };
  const profile = { userId: 'guest', dietaryRestrictions: [], tastePreferences: [],
    cuisinePreferences: [], personalizationEnabled: true };
  const selected = await request('/v1/agent/execute', {
    method: 'POST', body: JSON.stringify({
      action: 'select_restaurant', restaurantId: 'rest-lanxi', menuImages: [], recognizedMenu: [], state, profile
    })
  });
  assert.equal(selected.response.status, 200);
  const changed = await request('/v1/agent/execute', {
    method: 'POST', body: JSON.stringify({
      action: 'select_restaurant', restaurantId: 'rest-suyuan', menuImages: [], recognizedMenu: [],
      state: selected.body.state, profile
    })
  });
  assert.equal(changed.response.status, 200);
  assert.equal(changed.body.state.selectedRestaurantId, 'rest-suyuan');
  assert.equal(changed.body.state.stage, 'RESTAURANT_SELECTED');
  const stored = runtime.store.snapshot().sessions.find((item) => item.id === changed.body.state.sessionId);
  assert.equal(stored.messages.length, 1);
  assert.match(stored.messages[0].text, /素源里/);
});

test('finish meal is idempotent after a lost response', async () => {
  let state = { sessionId: 'idempotent-finish', stage: 'PRE_MEAL', selectedRestaurantId: '', userId: 'guest' };
  const profile = { userId: 'guest', dietaryRestrictions: [], tastePreferences: [],
    cuisinePreferences: [], personalizationEnabled: true };
  const execute = async (action, restaurantId = '') => {
    const result = await request('/v1/agent/execute', {
      method: 'POST', body: JSON.stringify({
        action, message: '', restaurantId, menuImages: [], recognizedMenu: [], state, profile
      })
    });
    assert.equal(result.response.status, 200);
    state = result.body.state;
    return result.body;
  };
  await execute('select_restaurant', 'rest-lanxi');
  await execute('arrive');
  const first = await execute('finish_meal');
  assert.equal(first.state.stage, 'REVIEW');
  const retry = await execute('finish_meal');
  assert.equal(retry.state.stage, 'REVIEW');
  assert.deepEqual(retry.recognizedMenu, []);
});

test('subsequent menu uploads append dishes and persist the merged menu', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'restaurant-agent-menu-append-'));
  try {
    const store = await new SqliteStore(join(directory, 'restaurants.sqlite'), {
      initialRestaurants: testRestaurants
    }).init();
    const orchestrator = new RestaurantOrchestrator(store, {
      vision: new VisionProvider({ visionApiUrl: '', visionApiKey: '', visionDemoMode: true }),
      chat: {
        recognizeMenu: async (_images, items) => ({ usedModel: false, items, lowConfidenceFields: [], reply: '' })
      },
      places: { isConfigured: () => false }
    });
    const session = await orchestrator.ensureAppSession('append-menu', 'guest', null);
    await orchestrator.selectRestaurant(session.id, 'rest-suyuan');
    await orchestrator.arrive(session.id);
    const first = await orchestrator.processMenuUpload(session.id, {
      menuImages: [], profile: null,
      recognizedMenu: [{ id: 'page-1', name: '盐水鸭', category: '冷菜', price: 48,
        ingredients: [], tags: ['南京菜'], confidence: 0.96 }]
    });
    assert.deepEqual(first.items.map((item) => item.name), ['盐水鸭']);
    const second = await orchestrator.processMenuUpload(session.id, {
      menuImages: [], profile: null,
      recognizedMenu: [{ id: 'page-1', name: '鸭血粉丝汤', category: '小吃', price: 28,
        ingredients: [], tags: ['南京菜'], confidence: 0.94 }]
    });
    assert.deepEqual(second.items.map((item) => item.name), ['盐水鸭', '鸭血粉丝汤']);
    assert.equal(new Set(second.items.map((item) => item.id)).size, 2);
    const persistedBeforeConfirm = store.snapshot().restaurants.find((item) => item.id === 'rest-suyuan');
    assert.deepEqual(persistedBeforeConfirm.menu, []);
    await orchestrator.confirmMenu(session.id);
    const persisted = store.snapshot().restaurants.find((item) => item.id === 'rest-suyuan');
    assert.deepEqual(persisted.menu.map((item) => item.name), ['盐水鸭', '鸭血粉丝汤']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('client request ids make write operations idempotent', async () => {
  const payload = {
    action: 'select_restaurant', clientRequestId: 'idempotency-select-1', message: '',
    restaurantId: 'rest-lanxi', menuImages: [], recognizedMenu: [], rating: 0,
    state: { sessionId: 'idempotency-all-writes', stage: 'PRE_MEAL', selectedRestaurantId: '', userId: 'guest' },
    profile: { userId: 'guest', dietaryRestrictions: [], tastePreferences: [],
      cuisinePreferences: [], personalizationEnabled: true }
  };
  const first = await request('/v1/agent/execute', { method: 'POST', body: JSON.stringify(payload) });
  const second = await request('/v1/agent/execute', { method: 'POST', body: JSON.stringify(payload) });
  assert.equal(first.response.status, 200);
  assert.deepEqual(second.body, first.body);
  const saved = runtime.store.snapshot().processedRequests.filter((item) => item.key.endsWith(':idempotency-select-1'));
  assert.equal(saved.length, 1);
});

test('local diagnostics expose only redacted timing and count data', async () => {
  const diagnostics = await request('/internal/diagnostics');
  assert.equal(diagnostics.response.status, 200);
  assert.equal(typeof diagnostics.body.counts.restaurants, 'number');
  assert.ok(Array.isArray(diagnostics.body.metrics.recent));
  assert.equal(JSON.stringify(diagnostics.body).includes('13800138000'), false);
});
