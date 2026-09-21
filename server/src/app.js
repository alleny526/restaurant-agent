import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { JsonStore } from './store.js';
import { RestaurantOrchestrator } from './orchestrator.js';
import { ExplanationProvider, HuaweiAccountProvider, VisionProvider } from './providers.js';
import { filterRestaurants, parseDiningIntent, recommendRestaurants } from './recommendation.js';
import { issueToken, verifyToken } from './security.js';

function sendJson(response, statusCode, value, requestId, origin = '*') {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-request-id': requestId,
    'access-control-allow-origin': origin,
    'access-control-allow-headers': 'content-type, authorization, x-device-id, x-api-key',
    'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS'
  });
  response.end(JSON.stringify(value));
}

async function readJson(request, maxBytes = 8 * 1024 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maxBytes) {
      const error = new Error('请求体过大');
      error.statusCode = 413;
      error.code = 'PAYLOAD_TOO_LARGE';
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('请求体不是有效 JSON');
    error.statusCode = 400;
    error.code = 'INVALID_JSON';
    throw error;
  }
}

function publicRestaurant(restaurant) {
  return { ...restaurant, recommendationReason: restaurant.recommendationReason ?? '' };
}

function publicUser(user) {
  const { huaweiOpenId: _huaweiOpenId, huaweiUnionId: _huaweiUnionId, ...value } = user;
  return value;
}

function authorizedUser(request, state, config) {
  const header = request.headers.authorization ?? '';
  const payload = verifyToken(header.startsWith('Bearer ') ? header.slice(7) : '', config.authSecret);
  if (!payload) {
    const error = new Error('登录已失效或未登录');
    error.statusCode = 401;
    error.code = 'UNAUTHORIZED';
    throw error;
  }
  const user = state.users.find((item) => item.id === payload.sub);
  if (!user) {
    const error = new Error('用户不存在');
    error.statusCode = 401;
    error.code = 'UNAUTHORIZED';
    throw error;
  }
  return user;
}

export async function createRestaurantServer(options = {}) {
  const config = {
    dataFile: resolve(options.dataFile ?? process.env.DATA_FILE ?? './data/runtime.json'),
    authSecret: options.authSecret ?? process.env.AUTH_SECRET ?? 'development-secret-change-before-production',
    demoMode: options.demoMode ?? process.env.DEMO_MODE !== 'false',
    allowedOrigins: (options.allowedOrigins ?? process.env.ALLOWED_ORIGINS ?? '*').split(','),
    xiaoyiApiKey: options.xiaoyiApiKey ?? process.env.XIAOYI_API_KEY ?? '',
    visionApiUrl: process.env.VISION_API_URL ?? '',
    visionApiKey: process.env.VISION_API_KEY ?? '',
    llmApiUrl: process.env.LLM_API_URL ?? '',
    llmApiKey: process.env.LLM_API_KEY ?? '',
    huaweiClientId: options.huaweiClientId ?? process.env.HUAWEI_CLIENT_ID ?? '',
    huaweiClientSecret: options.huaweiClientSecret ?? process.env.HUAWEI_CLIENT_SECRET ?? ''
  };
  if (!config.demoMode && config.authSecret === 'development-secret-change-before-production') {
    throw new Error('生产环境必须配置强随机 AUTH_SECRET');
  }
  const store = await new JsonStore(config.dataFile).init();
  const orchestrator = new RestaurantOrchestrator(store, {
    vision: new VisionProvider(config),
    explanation: new ExplanationProvider(config)
  });
  const huaweiAccount = options.huaweiAccountProvider ?? new HuaweiAccountProvider(config);

  const server = createServer(async (request, response) => {
    const requestId = request.headers['x-request-id']?.toString() ?? randomUUID();
    const originHeader = request.headers.origin ?? '*';
    const origin = config.allowedOrigins.includes('*') || config.allowedOrigins.includes(originHeader) ? originHeader : '';
    try {
      if (request.method === 'OPTIONS') {
        sendJson(response, 204, {}, requestId, origin);
        return;
      }
      if (!origin) {
        const error = new Error('来源不在允许列表');
        error.statusCode = 403;
        error.code = 'ORIGIN_FORBIDDEN';
        throw error;
      }

      const url = new URL(request.url, 'http://localhost');
      const path = url.pathname;

      if (path.startsWith('/xiaoyi/tools/') && config.xiaoyiApiKey &&
        request.headers['x-api-key'] !== config.xiaoyiApiKey) {
        throw Object.assign(new Error('云插件密钥无效'), { statusCode: 401, code: 'INVALID_PLUGIN_KEY' });
      }

      if (request.method === 'GET' && path === '/healthz') {
        sendJson(response, 200, { status: 'ok', service: 'xiaoyi-restaurant-agent', version: '1.0.0' }, requestId, origin);
        return;
      }

      // HarmonyOS demo client entry point. The app and server intentionally share
      // one compact request/response contract so the demo needs no cloud platform.
      if (request.method === 'POST' && path === '/v1/agent/execute') {
        const body = await readJson(request, 16 * 1024 * 1024);
        sendJson(response, 200, await orchestrator.executeAppRequest(body), requestId, origin);
        return;
      }

      if (request.method === 'GET' && path === '/v1/restaurants') {
        const state = store.snapshot();
        const params = Object.fromEntries(url.searchParams.entries());
        const items = filterRestaurants(state.restaurants, params).map(publicRestaurant);
        sendJson(response, 200, { items, total: items.length }, requestId, origin);
        return;
      }

      const restaurantMatch = path.match(/^\/v1\/restaurants\/([^/]+)$/);
      if (request.method === 'GET' && restaurantMatch) {
        const restaurant = store.snapshot().restaurants.find((item) => item.id === decodeURIComponent(restaurantMatch[1]));
        if (!restaurant) throw Object.assign(new Error('餐厅不存在'), { statusCode: 404, code: 'RESTAURANT_NOT_FOUND' });
        sendJson(response, 200, publicRestaurant(restaurant), requestId, origin);
        return;
      }

      if (request.method === 'POST' && path === '/v1/sessions') {
        const body = await readJson(request);
        const session = await orchestrator.createSession({
          deviceId: body.deviceId ?? request.headers['x-device-id'] ?? 'anonymous',
          userId: body.userId ?? ''
        });
        sendJson(response, 201, session, requestId, origin);
        return;
      }

      if (request.method === 'GET' && path === '/v1/sessions/active') {
        const deviceId = url.searchParams.get('deviceId') ?? request.headers['x-device-id'] ?? 'anonymous';
        sendJson(response, 200, await orchestrator.getActiveSession(deviceId), requestId, origin);
        return;
      }

      const messageMatch = path.match(/^\/v1\/sessions\/([^/]+)\/messages$/);
      if (request.method === 'POST' && messageMatch) {
        const body = await readJson(request);
        const result = await orchestrator.handleMessage(messageMatch[1], body.text, body.userId ?? '');
        sendJson(response, 200, result, requestId, origin);
        return;
      }

      const selectMatch = path.match(/^\/v1\/sessions\/([^/]+)\/select$/);
      if (request.method === 'POST' && selectMatch) {
        const body = await readJson(request);
        sendJson(response, 200, await orchestrator.selectRestaurant(selectMatch[1], body.restaurantId), requestId, origin);
        return;
      }

      const arriveMatch = path.match(/^\/v1\/sessions\/([^/]+)\/arrive$/);
      if (request.method === 'POST' && arriveMatch) {
        sendJson(response, 200, await orchestrator.arrive(arriveMatch[1]), requestId, origin);
        return;
      }

      const menuMatch = path.match(/^\/v1\/sessions\/([^/]+)\/menu\/recognize$/);
      if (request.method === 'POST' && menuMatch) {
        const body = await readJson(request, 16 * 1024 * 1024);
        sendJson(response, 200, await orchestrator.recognizeMenu(menuMatch[1], body.images), requestId, origin);
        return;
      }

      const doneMatch = path.match(/^\/v1\/sessions\/([^/]+)\/done$/);
      if (request.method === 'POST' && doneMatch) {
        sendJson(response, 200, await orchestrator.finishDining(doneMatch[1]), requestId, origin);
        return;
      }

      if (request.method === 'POST' && path === '/v1/auth/huawei') {
        const body = await readJson(request);
        const identity = await huaweiAccount.exchangeAuthorizationCode(body.authorizationCode);
        const user = await store.transaction((state) => {
          let profile = state.users.find((item) => item.huaweiUnionId === identity.unionId);
          if (!profile) profile = state.users.find((item) => item.huaweiOpenId === identity.openId);
          if (!profile) {
            profile = {
              id: randomUUID(), phone: '', nickname: identity.nickname, hometown: '', avatarUrl: identity.avatarUrl,
              dietaryRestrictions: [], tastePreferences: ['清淡'], cuisinePreferences: [],
              personalizationEnabled: true, authProvider: 'huawei', huaweiOpenId: identity.openId,
              huaweiUnionId: identity.unionId, deviceId: request.headers['x-device-id'] ?? '',
              createdAt: new Date().toISOString()
            };
            state.users.push(profile);
          } else {
            if ((profile.huaweiUnionId && profile.huaweiUnionId !== identity.unionId) ||
              (profile.huaweiOpenId && profile.huaweiOpenId !== identity.openId)) {
              throw Object.assign(new Error('该本地账号已关联其他华为账号'), {
                statusCode: 409, code: 'HUAWEI_ACCOUNT_CONFLICT'
              });
            }
            profile.authProvider = 'huawei';
            profile.huaweiOpenId = identity.openId;
            profile.huaweiUnionId = identity.unionId;
            profile.deviceId = request.headers['x-device-id'] ?? profile.deviceId ?? '';
            if (identity.avatarUrl) profile.avatarUrl = identity.avatarUrl;
            if (!profile.nickname && identity.nickname) profile.nickname = identity.nickname;
            profile.updatedAt = new Date().toISOString();
          }
          return profile;
        });
        sendJson(response, 200, {
          token: issueToken(user, config.authSecret), user: publicUser(user)
        }, requestId, origin);
        return;
      }

      if (request.method === 'PUT' && path === '/v1/users/me/profile') {
        const body = await readJson(request);
        const state = store.snapshot();
        const current = authorizedUser(request, state, config);
        const profile = await store.transaction((mutable) => {
          const user = mutable.users.find((item) => item.id === current.id);
          user.nickname = String(body.nickname ?? '').trim().slice(0, 40);
          user.hometown = String(body.hometown ?? '').trim().slice(0, 40);
          user.dietaryRestrictions = Array.isArray(body.dietaryRestrictions) ? body.dietaryRestrictions.slice(0, 20) : [];
          user.tastePreferences = Array.isArray(body.tastePreferences) ? body.tastePreferences.slice(0, 20) : [];
          user.cuisinePreferences = Array.isArray(body.cuisinePreferences) ? body.cuisinePreferences.slice(0, 20) : [];
          user.personalizationEnabled = body.personalizationEnabled !== false;
          user.updatedAt = new Date().toISOString();
          return user;
        });
        sendJson(response, 200, publicUser(profile), requestId, origin);
        return;
      }

      if (request.method === 'GET' && path === '/v1/users/me/profile') {
        const state = store.snapshot();
        const current = authorizedUser(request, state, config);
        sendJson(response, 200, publicUser(current), requestId, origin);
        return;
      }

      if (request.method === 'DELETE' && path === '/v1/users/me') {
        const state = store.snapshot();
        const current = authorizedUser(request, state, config);
        await store.transaction((mutable) => {
          mutable.users = mutable.users.filter((item) => item.id !== current.id);
          mutable.reviews = mutable.reviews.filter((item) => item.userId !== current.id);
          mutable.sessions = mutable.sessions.filter((item) => item.userId !== current.id);
          return true;
        });
        sendJson(response, 200, { deleted: true }, requestId, origin);
        return;
      }

      // 小艺开放平台云插件：稳定、扁平的工具接口。
      if (request.method === 'POST' && path === '/xiaoyi/tools/search_restaurants') {
        const body = await readJson(request);
        const state = store.snapshot();
        const intent = parseDiningIntent(body.query ?? '');
        const profile = state.users.find((item) => item.id === body.userId) ?? null;
        const restaurants = recommendRestaurants(state.restaurants, intent, profile, Math.min(Number(body.limit) || 5, 5));
        sendJson(response, 200, { intent, restaurants }, requestId, origin);
        return;
      }

      if (request.method === 'POST' && path === '/xiaoyi/tools/select_restaurant') {
        const body = await readJson(request);
        const existing = await orchestrator.ensureExternalSession(body.conversationId ?? randomUUID(), body.userId ?? '');
        sendJson(response, 200, await orchestrator.selectRestaurant(existing.id, body.restaurantId), requestId, origin);
        return;
      }

      if (request.method === 'POST' && path === '/xiaoyi/tools/arrive') {
        const body = await readJson(request);
        const existing = await orchestrator.ensureExternalSession(body.conversationId ?? randomUUID(), body.userId ?? '');
        sendJson(response, 200, await orchestrator.arrive(existing.id), requestId, origin);
        return;
      }

      if (request.method === 'POST' && path === '/xiaoyi/tools/submit_menu') {
        const body = await readJson(request);
        const existing = await orchestrator.ensureExternalSession(body.conversationId ?? randomUUID(), body.userId ?? '');
        sendJson(response, 200,
          await orchestrator.acceptRecognizedMenu(existing.id, body.items, body.lowConfidenceFields), requestId, origin);
        return;
      }

      if (request.method === 'POST' && path === '/xiaoyi/tools/finish_dining') {
        const body = await readJson(request);
        const existing = await orchestrator.ensureExternalSession(body.conversationId ?? randomUUID(), body.userId ?? '');
        sendJson(response, 200, await orchestrator.finishDining(existing.id), requestId, origin);
        return;
      }

      if (request.method === 'POST' && path === '/xiaoyi/tools/submit_review') {
        const body = await readJson(request);
        const existing = await orchestrator.ensureExternalSession(body.conversationId ?? randomUUID(), body.userId ?? '');
        if (!body.restaurantId || existing.selectedRestaurantId !== body.restaurantId) {
          throw Object.assign(new Error('评价餐厅与当前会话选择不一致'), {
            statusCode: 409, code: 'RESTAURANT_CONTEXT_MISMATCH'
          });
        }
        await orchestrator.finishDining(existing.id);
        sendJson(response, 200, await orchestrator.handleMessage(existing.id, body.text, body.userId ?? ''), requestId, origin);
        return;
      }

      throw Object.assign(new Error('接口不存在'), { statusCode: 404, code: 'NOT_FOUND' });
    } catch (error) {
      const statusCode = Number(error.statusCode) || 500;
      const code = error.code ?? 'INTERNAL_ERROR';
      const message = statusCode >= 500 ? '服务暂时不可用' : error.message;
      if (statusCode >= 500) console.error(`[${requestId}]`, error);
      sendJson(response, statusCode, { code, message, requestId }, requestId, origin || '*');
    }
  });

  return { server, store, orchestrator, config };
}
