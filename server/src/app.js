import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { SqliteStore } from './store.js';
import { AmapPlaceProvider } from './amap.js';
import { RestaurantOrchestrator } from './orchestrator.js';
import { BaiduOcrProvider, ChatModelProvider, HuaweiAccountProvider, VisionProvider } from './providers.js';
import {
  createOtp, hashOtp, hashPassword, issueToken, sanitizeReview, verifyPassword, verifyToken
} from './security.js';
import { Telemetry } from './telemetry.js';

function sendJson(response, statusCode, value, requestId, origin = '*') {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-request-id': requestId,
    'access-control-allow-origin': origin,
    'access-control-allow-headers': 'content-type, authorization, x-device-id',
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

function publicReview(item) {
  return {
    id: item.id, rating: Number(item.rating) || 0, text: sanitizeReview(item.text ?? ''),
    tags: Array.isArray(item.tags) ? item.tags : [], authorName: item.authorName ?? '匿名用户',
    createdAt: item.updatedAt ?? item.createdAt
  };
}

function publicRestaurant(restaurant, reviews = []) {
  return {
    ...restaurant,
    recommendationReason: restaurant.recommendationReason ?? '',
    reviews: reviews.filter((item) => item.restaurantId === restaurant.id)
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
      .map(publicReview)
  };
}

function publicUser(user) {
  const {
    huaweiOpenId: _huaweiOpenId, huaweiUnionId: _huaweiUnionId,
    passwordHash: _passwordHash, accountKey: _accountKey, ...value
  } = user;
  return { ...value, avatarUrl: String(value.avatarUrl ?? '') };
}

function normalizedAccount(value) {
  return String(value ?? '').trim().toLocaleLowerCase('zh-CN');
}

function validatePasswordAccount(account, password) {
  if (account.length < 3 || account.length > 40 || /\s/.test(account)) {
    throw Object.assign(new Error('账号应为 3-40 位且不能包含空格'), {
      statusCode: 400, code: 'INVALID_ACCOUNT'
    });
  }
  if (String(password ?? '').length < 6 || String(password ?? '').length > 128) {
    throw Object.assign(new Error('密码长度应为 6-128 位'), {
      statusCode: 400, code: 'INVALID_PASSWORD'
    });
  }
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
    dataFile: resolve(options.dataFile ?? process.env.DATA_FILE ?? './data/restaurant-agent.sqlite'),
    authSecret: options.authSecret ?? process.env.AUTH_SECRET ?? 'development-secret-change-before-production',
    demoMode: options.demoMode ?? process.env.DEMO_MODE !== 'false',
    allowedOrigins: (options.allowedOrigins ?? process.env.ALLOWED_ORIGINS ?? '*').split(','),
    visionApiUrl: options.visionApiUrl ?? process.env.VISION_API_URL ?? '',
    visionApiKey: options.visionApiKey ?? process.env.VISION_API_KEY ?? '',
    visionDemoMode: options.visionDemoMode ?? process.env.VISION_DEMO_MODE !== 'false',
    llmBaseUrl: options.llmBaseUrl ?? process.env.LLM_BASE_URL ?? '',
    llmApiKey: options.llmApiKey ?? process.env.LLM_API_KEY ?? '',
    llmModel: options.llmModel ?? process.env.LLM_MODEL ?? '',
    llmFastModel: options.llmFastModel ?? process.env.LLM_FAST_MODEL ?? '',
    llmProvider: options.llmProvider ?? process.env.LLM_PROVIDER ?? '',
    llmTimeoutMs: options.llmTimeoutMs ?? process.env.LLM_TIMEOUT_MS ?? 20_000,
    amapWebKey: options.amapWebKey ?? process.env.AMAP_WEB_KEY ?? '',
    amapDefaultRegion: options.amapDefaultRegion ?? process.env.AMAP_DEFAULT_REGION ?? '南京市',
    amapLocation: options.amapLocation ?? process.env.AMAP_LOCATION ?? '',
    amapRadiusMeters: options.amapRadiusMeters ?? process.env.AMAP_RADIUS_METERS ?? 5000,
    amapCacheTtlSeconds: options.amapCacheTtlSeconds ?? process.env.AMAP_CACHE_TTL_SECONDS ?? 300,
    huaweiClientId: options.huaweiClientId ?? process.env.HUAWEI_CLIENT_ID ?? '',
    huaweiClientSecret: options.huaweiClientSecret ?? process.env.HUAWEI_CLIENT_SECRET ?? '',
    baiduOcrAppId: options.baiduOcrAppId ?? process.env.BAIDU_OCR_APP_ID ?? '',
    baiduOcrApiKey: options.baiduOcrApiKey ?? process.env.BAIDU_OCR_API_KEY ?? '',
    baiduOcrSecretKey: options.baiduOcrSecretKey ?? process.env.BAIDU_OCR_SECRET_KEY ?? ''
  };
  if (!config.demoMode && config.authSecret === 'development-secret-change-before-production') {
    throw new Error('生产环境必须配置强随机 AUTH_SECRET');
  }
  const store = await new SqliteStore(config.dataFile, {
    initialRestaurants: options.initialRestaurants ?? []
  }).init();
  const chat = options.chatProvider ?? new ChatModelProvider(config, options.llmFetchImpl ?? globalThis.fetch);
  const telemetry = options.telemetry ?? new Telemetry();
  const huaweiAccount = options.huaweiAccountProvider ?? new HuaweiAccountProvider(config);
  const orchestrator = new RestaurantOrchestrator(store, {
    vision: new VisionProvider(config),
    ocr: new BaiduOcrProvider(config),
    chat,
    places: new AmapPlaceProvider(config, options.fetchImpl ?? globalThis.fetch),
    telemetry
  });

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

      if (request.method === 'GET' && path === '/healthz') {
        sendJson(response, 200, {
          status: 'ok', service: 'restaurant-agent', version: '2.0.0',
          database: 'sqlite', amapConfigured: Boolean(config.amapWebKey),
          llmConfigured: chat.isConfigured(), llmProvider: chat.providerName,
          baiduOcrConfigured: Boolean(config.baiduOcrApiKey && config.baiduOcrSecretKey),
          menuUploadFlow: 'baidu-ocr-text-only-gpt-cleanup'
        }, requestId, origin);
        return;
      }

      if (request.method === 'GET' && path === '/internal/diagnostics') {
        const remoteAddress = request.socket.remoteAddress ?? '';
        if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remoteAddress)) {
          throw Object.assign(new Error('诊断接口仅允许本机访问'), { statusCode: 403, code: 'LOCAL_ONLY' });
        }
        const state = store.snapshot();
        sendJson(response, 200, {
          service: 'restaurant-agent', database: 'sqlite',
          counts: {
            restaurants: state.restaurants.length,
            sessions: state.sessions.length,
            menuVersions: state.menuVersions.length,
            processedRequests: state.processedRequests.length
          },
          models: { primary: chat.model, fast: chat.fastModel || chat.model },
          metrics: telemetry.snapshot()
        }, requestId, origin);
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
        const params = Object.fromEntries(url.searchParams.entries());
        const reviews = store.snapshot().reviews;
        const items = (await store.queryRestaurants(params)).map((item) => publicRestaurant(item, reviews));
        sendJson(response, 200, { items, total: items.length }, requestId, origin);
        return;
      }

      const restaurantMatch = path.match(/^\/v1\/restaurants\/([^/]+)$/);
      if (request.method === 'GET' && restaurantMatch) {
        const restaurant = store.snapshot().restaurants.find((item) => item.id === decodeURIComponent(restaurantMatch[1]));
        if (!restaurant) throw Object.assign(new Error('餐厅不存在'), { statusCode: 404, code: 'RESTAURANT_NOT_FOUND' });
        sendJson(response, 200, publicRestaurant(restaurant, store.snapshot().reviews), requestId, origin);
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

      const confirmMenuMatch = path.match(/^\/v1\/sessions\/([^/]+)\/menu\/confirm$/);
      if (request.method === 'POST' && confirmMenuMatch) {
        sendJson(response, 200, await orchestrator.confirmMenu(confirmMenuMatch[1]), requestId, origin);
        return;
      }

      const doneMatch = path.match(/^\/v1\/sessions\/([^/]+)\/done$/);
      if (request.method === 'POST' && doneMatch) {
        sendJson(response, 200, await orchestrator.finishDining(doneMatch[1]), requestId, origin);
        return;
      }

      if (request.method === 'POST' && path === '/v1/auth/register') {
        const body = await readJson(request);
        const account = String(body.account ?? '').trim();
        const accountKey = normalizedAccount(account);
        const password = String(body.password ?? '');
        const nickname = String(body.nickname ?? '').trim();
        validatePasswordAccount(account, password);
        if (!nickname || nickname.length > 40) {
          throw Object.assign(new Error('请输入 1-40 位昵称'), { statusCode: 400, code: 'INVALID_NICKNAME' });
        }
        const user = await store.transaction((state) => {
          if (state.users.some((item) => item.accountKey === accountKey ||
            (item.phone && item.phone === account))) {
            throw Object.assign(new Error('该账号已注册'), { statusCode: 409, code: 'ACCOUNT_EXISTS' });
          }
          const profile = {
            id: randomUUID(), account, accountKey, passwordHash: hashPassword(password),
            phone: /^1\d{10}$/.test(account) ? account : '', nickname, hometown: '', avatarUrl: '',
            dietaryRestrictions: [], tastePreferences: ['清淡'], cuisinePreferences: [],
            personalizationEnabled: true, authProvider: 'password',
            deviceId: request.headers['x-device-id'] ?? '', createdAt: new Date().toISOString()
          };
          state.users.push(profile);
          return profile;
        });
        sendJson(response, 201, {
          token: issueToken(user, config.authSecret), user: publicUser(user)
        }, requestId, origin);
        return;
      }

      const restaurantReviewMatch = path.match(/^\/v1\/restaurants\/([^/]+)\/reviews$/);
      if (request.method === 'POST' && restaurantReviewMatch) {
        const body = await readJson(request);
        const snapshot = store.snapshot();
        const current = authorizedUser(request, snapshot, config);
        const restaurantId = decodeURIComponent(restaurantReviewMatch[1]);
        if (!snapshot.restaurants.some((item) => item.id === restaurantId)) {
          throw Object.assign(new Error('餐厅不存在'), { statusCode: 404, code: 'RESTAURANT_NOT_FOUND' });
        }
        const text = sanitizeReview(String(body.text ?? ''));
        if (!text) throw Object.assign(new Error('评论内容不能为空'), { statusCode: 400, code: 'INVALID_REVIEW' });
        const rating = Math.min(Math.max(Number(body.rating) || 0, 1), 5);
        const review = await store.transaction((state) => {
          const created = {
            id: randomUUID(), userId: current.id, authorName: current.nickname || '已登录用户',
            restaurantId, sessionId: '', rating, text, tags: [], createdAt: new Date().toISOString()
          };
          state.reviews.push(created);
          return created;
        });
        sendJson(response, 201, publicReview(review), requestId, origin);
        return;
      }

      if (request.method === 'POST' && path === '/v1/auth/login') {
        const body = await readJson(request);
        const account = String(body.account ?? '').trim();
        const password = String(body.password ?? '');
        validatePasswordAccount(account, password);
        const state = store.snapshot();
        const user = state.users.find((item) => item.accountKey === normalizedAccount(account) ||
          (item.phone && item.phone === account));
        if (!user?.passwordHash || !verifyPassword(password, user.passwordHash)) {
          throw Object.assign(new Error('账号或密码错误'), { statusCode: 401, code: 'INVALID_CREDENTIALS' });
        }
        await store.transaction((mutable) => {
          const saved = mutable.users.find((item) => item.id === user.id);
          saved.deviceId = request.headers['x-device-id'] ?? saved.deviceId ?? '';
          saved.lastLoginAt = new Date().toISOString();
          return true;
        });
        sendJson(response, 200, {
          token: issueToken(user, config.authSecret), user: publicUser(user)
        }, requestId, origin);
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

      if (request.method === 'POST' && path === '/v1/auth/otp/request') {
        const body = await readJson(request);
        if (!/^1\d{10}$/.test(body.phone ?? '')) {
          throw Object.assign(new Error('请输入有效的 11 位手机号'), { statusCode: 400, code: 'INVALID_PHONE' });
        }
        const id = randomUUID();
        const code = createOtp();
        const otp = {
          id, phone: body.phone, codeHash: hashOtp(id, body.phone, code, config.authSecret),
          expiresAt: Date.now() + 5 * 60 * 1000, attempts: 0, used: false
        };
        await store.transaction((state) => {
          state.otpRequests = state.otpRequests.filter((item) => item.expiresAt > Date.now() && !item.used);
          state.otpRequests.push(otp);
          return true;
        });
        sendJson(response, 200, { requestId: id, expiresInSeconds: 300, debugCode: config.demoMode ? code : '' }, requestId, origin);
        return;
      }

      if (request.method === 'POST' && path === '/v1/auth/otp/verify') {
        const body = await readJson(request);
        const user = await store.transaction((state) => {
          const otp = state.otpRequests.find((item) => item.id === body.requestId && item.phone === body.phone);
          if (!otp || otp.used || otp.expiresAt < Date.now() || otp.attempts >= 5) {
            throw Object.assign(new Error('验证码已过期，请重新获取'), { statusCode: 401, code: 'OTP_EXPIRED' });
          }
          otp.attempts += 1;
          if (otp.codeHash !== hashOtp(body.requestId, body.phone, body.code, config.authSecret)) {
            throw Object.assign(new Error('验证码错误'), { statusCode: 401, code: 'OTP_INVALID' });
          }
          otp.used = true;
          let profile = state.users.find((item) => item.phone === body.phone);
          if (!profile) {
            profile = {
              id: randomUUID(), phone: body.phone, nickname: '新用户', hometown: '', avatarUrl: '',
              dietaryRestrictions: [], tastePreferences: ['清淡'], cuisinePreferences: [],
              personalizationEnabled: true, deviceId: request.headers['x-device-id'] ?? '',
              createdAt: new Date().toISOString()
            };
            state.users.push(profile);
          }
          profile.deviceId = request.headers['x-device-id'] ?? profile.deviceId ?? '';
          return profile;
        });
        sendJson(response, 200, { token: issueToken(user, config.authSecret), user: publicUser(user) }, requestId, origin);
        return;
      }

      if (request.method === 'GET' && path === '/v1/users/me/profile') {
        const state = store.snapshot();
        sendJson(response, 200, publicUser(authorizedUser(request, state, config)), requestId, origin);
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
          const avatarUrl = String(body.avatarUrl ?? user.avatarUrl ?? '').trim();
          const inlineAvatar = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(avatarUrl);
          const remoteAvatar = /^https:\/\/[^\s]+$/.test(avatarUrl);
          if (avatarUrl.length > 2 * 1024 * 1024 || (avatarUrl && !inlineAvatar && !remoteAvatar)) {
            throw Object.assign(new Error('头像格式无效或文件过大'), {
              statusCode: 400, code: 'INVALID_AVATAR'
            });
          }
          user.avatarUrl = avatarUrl;
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

      throw Object.assign(new Error('接口不存在'), { statusCode: 404, code: 'NOT_FOUND' });
    } catch (error) {
      const statusCode = Number(error.statusCode) || 500;
      const code = error.code ?? 'INTERNAL_ERROR';
      const message = statusCode >= 500 ? '服务暂时不可用' : error.message;
      if (statusCode >= 500) console.error(`[${requestId}]`, error);
      sendJson(response, statusCode, { code, message, requestId }, requestId, origin || '*');
    }
  });

  return { server, store, orchestrator, telemetry, config };
}
