import { randomUUID } from 'node:crypto';
import { parseDiningIntent, recommendRestaurants, suggestDishes } from './recommendation.js';
import { sanitizeReview } from './security.js';

function nowIso() {
  return new Date().toISOString();
}

function message(role, text) {
  return { id: randomUUID(), role, text, createdAt: nowIso() };
}

function publicSession(session) {
  return {
    id: session.id,
    stage: session.stage,
    selectedRestaurantId: session.selectedRestaurantId ?? '',
    menuStatus: session.menuStatus ?? 'NONE',
    menuVersionId: session.menuVersionId ?? session.pendingMenuVersionId ?? session.confirmedMenuVersionId ?? '',
    recognizedMenu: session.recognizedMenu ?? [],
    messages: session.messages
  };
}

function restaurantDescription(restaurant) {
  const storedReason = String(restaurant.recommendationReason ?? '')
    .replace(/信息来自(?:高德地图 POI 数据|餐厅数据库|服务端数据库)。?/g, '')
    .replace(/餐厅基础信息来自高德地图，菜单来自本项目自建数据库。?/g, '')
    .trim();
  const details = [];
  if (Array.isArray(restaurant.tags) && restaurant.tags.length > 0) {
    details.push(`热门特色：${restaurant.tags.slice(0, 4).join('、')}`);
  } else if (Array.isArray(restaurant.cuisines) && restaurant.cuisines.length > 0) {
    details.push(`主营${restaurant.cuisines.slice(0, 2).join('、')}`);
  }
  if (restaurant.openingHours) details.push(`营业时间 ${restaurant.openingHours}`);
  const detailText = details.join('；');
  if (storedReason && detailText && !(restaurant.tags ?? []).some((tag) => storedReason.includes(tag))) {
    return `${storedReason}${storedReason.endsWith('。') ? '' : '。'}${detailText}。`;
  }
  return storedReason || (detailText ? `${detailText}。` : '可到店后上传菜单，获取个性化点菜建议。');
}

function mergeMenuItems(existingItems, newItems) {
  const merged = structuredClone(Array.isArray(existingItems) ? existingItems : []);
  const nameIndexes = new Map(merged.map((item, index) => [String(item.name).trim().toLowerCase(), index]));
  const usedIds = new Set(merged.map((item) => item.id));
  for (const item of newItems) {
    const key = String(item.name).trim().toLowerCase();
    const existingIndex = nameIndexes.get(key);
    if (existingIndex !== undefined) {
      const previous = merged[existingIndex];
      merged[existingIndex] = {
        ...previous,
        ...item,
        id: previous.id,
        ingredients: Array.isArray(item.ingredients) && item.ingredients.length ? item.ingredients : previous.ingredients,
        tags: Array.isArray(item.tags) && item.tags.length ? item.tags : previous.tags
      };
      continue;
    }
    let id = item.id;
    if (usedIds.has(id)) id = `${id}-${randomUUID().slice(0, 8)}`;
    const appended = { ...item, id };
    usedIds.add(id);
    nameIndexes.set(key, merged.length);
    merged.push(appended);
  }
  return merged;
}

function publicReviews(reviews, restaurantId) {
  return reviews
    .filter((item) => item.restaurantId === restaurantId)
    .sort((left, right) => Date.parse(right.updatedAt ?? right.createdAt) - Date.parse(left.updatedAt ?? left.createdAt))
    .map((item) => ({
      id: item.id,
      rating: Number(item.rating) || 0,
      text: sanitizeReview(item.text ?? ''),
      tags: Array.isArray(item.tags) ? item.tags : [],
      createdAt: item.updatedAt ?? item.createdAt
    }));
}

function appRestaurant(restaurant, reviews = []) {
  return {
    id: restaurant.id,
    name: restaurant.name,
    cuisine: restaurant.cuisines[0] ?? '待补充',
    tags: restaurant.tags,
    address: restaurant.address,
    distanceKm: restaurant.distanceMeters / 1000,
    pricePerPerson: restaurant.averagePrice,
    rating: restaurant.rating,
    open: restaurant.isOpen,
    openStatusKnown: restaurant.openStatusKnown !== false,
    openingHours: restaurant.openingHours ?? '',
    source: restaurant.source ?? 'seed',
    reason: restaurantDescription(restaurant),
    menuAvailable: restaurant.menu.length > 0,
    menu: restaurant.menu,
    reviews: publicReviews(reviews, restaurant.id)
  };
}

function appDishRecommendation(item, warning) {
  return {
    menuItemId: item.id,
    name: item.name,
    reason: '基于服务端菜单字段、置信度和已设置偏好生成。',
    allergenWarning: warning || '模型识别可能遗漏，请以餐厅实际说明为准。'
  };
}

function preferenceFacts(profile) {
  if (!profile?.personalizationEnabled) return null;
  return {
    dietaryRestrictions: profile.dietaryRestrictions ?? [],
    tastePreferences: profile.tastePreferences ?? [],
    cuisinePreferences: profile.cuisinePreferences ?? []
  };
}

const ACTION_ALLOWED_STAGES = {
  select_restaurant: ['PRE_MEAL', 'RESTAURANT_SELECTED', 'ARRIVED', 'MENU_READY', 'DINING', 'DINING_DONE'],
  arrive: ['RESTAURANT_SELECTED', 'ARRIVED', 'MENU_READY', 'DINING'],
  upload_menu: ['ARRIVED', 'MENU_READY', 'DINING'],
  confirm_menu: ['MENU_READY', 'DINING'],
  finish_meal: ['DINING', 'REVIEW', 'END']
};

function wantsRestaurantCandidates(text, stage) {
  if (stage === 'PRE_MEAL') return true;
  if (stage === 'REVIEW' || stage === 'END') return false;
  return /(推荐|换|另|别家|餐厅|饭店|小馆|馆子|附近|哪家|哪里吃|想吃|口味|菜系|人均|预算|清淡|麻辣|火锅|烧烤|素食)/.test(text);
}

function assertActionAllowed(action, stage) {
  const allowed = ACTION_ALLOWED_STAGES[action];
  if (allowed && !allowed.includes(stage)) {
    throw httpError(409, 'INVALID_FLOW_TRANSITION', `当前处于 ${stage} 阶段，不能执行 ${action}`);
  }
}

function flowNodeFor(action, stage) {
  if (action === 'select_restaurant') return 'SELECT';
  if (action === 'arrive') return 'ARRIVE';
  if (action === 'upload_menu') return 'MENU';
  if (action === 'confirm_menu') return 'MENU';
  if (action === 'finish_meal') return 'FINISH';
  if (stage === 'END') return 'REVIEW';
  if (stage === 'MENU_READY' || stage === 'DINING') return 'DINING';
  return 'RECOMMEND';
}

function httpError(statusCode, code, text) {
  const error = new Error(text);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function applyMenuCorrection(menu, text) {
  const match = text.match(/不是\s*([^，,。\s]+)[，,]?\s*是\s*([^，,。\s]+)/);
  if (!match) return { menu, corrected: 0, from: '', to: '' };
  const cloned = structuredClone(menu);
  let corrected = 0;
  for (const item of cloned) {
    const index = item.ingredients.findIndex((ingredient) => ingredient.includes(match[1]));
    if (index >= 0) {
      item.ingredients[index] = match[2];
      item.confidence = Math.min(Number(item.confidence) || 0, 0.8);
      corrected += 1;
    }
  }
  return { menu: cloned, corrected, from: match[1], to: match[2] };
}

export class RestaurantOrchestrator {
  constructor(store, providers) {
    this.store = store;
    this.vision = providers.vision;
    this.chat = providers.chat;
    this.places = providers.places;
    this.telemetry = providers.telemetry;
    this.inFlightRequests = new Map();
  }

  async refreshPlaces(query, location = null, page = 1, pageSize = 20) {
    const startedAt = Date.now();
    if (!this.places?.isConfigured()) {
      return { source: 'sqlite', refreshed: 0, restaurantIds: [], warning: '', durationMs: Date.now() - startedAt };
    }
    try {
      const restaurants = await this.places.search(query, pageSize, location, page);
      await this.store.upsertRestaurants(restaurants);
      return {
        source: 'amap',
        refreshed: restaurants.length,
        restaurantIds: restaurants.map((item) => item.id),
        warning: '',
        durationMs: Date.now() - startedAt
      };
    } catch (error) {
      console.warn('AMap refresh failed, using SQLite cache:', error.message);
      return {
        source: 'sqlite-cache', refreshed: 0, restaurantIds: [],
        warning: '高德检索暂不可用，已使用本地数据库缓存。',
        durationMs: Date.now() - startedAt
      };
    }
  }

  searchCandidates(restaurants, refresh) {
    if (refresh.source === 'amap') {
      const ids = new Set(refresh.restaurantIds);
      return restaurants.filter((item) => ids.has(item.id));
    }
    if (refresh.source === 'sqlite-cache') {
      const amapCache = restaurants.filter((item) => item.source === 'amap');
      return amapCache.length ? amapCache : restaurants;
    }
    return restaurants;
  }

  async searchRestaurants(query, userId = '', limit = 5, location = null, profileOverride = null) {
    const fallbackIntent = parseDiningIntent(query);
    const intentResult = await this.chat?.analyzeIntent?.(query, fallbackIntent) ??
      { intent: fallbackIntent, usedModel: false };
    const intent = intentResult.intent;
    const searchTerms = [...new Set([
      ...(intent.keywords ?? []), ...(intent.cuisines ?? []), ...(intent.tastes ?? [])
    ])].filter(Boolean).slice(0, 5);
    const refresh = await this.refreshPlaces(searchTerms.join(' ') || query, location);
    const state = this.store.snapshot();
    const profile = profileOverride ?? state.users.find((item) => item.id === userId) ?? null;
    const databaseItems = await this.store.queryRestaurants({
      openNow: intent.openNow,
      maxPrice: intent.maxPrice ?? ''
    });
    const candidates = this.searchCandidates(databaseItems, refresh);
    const deterministic = recommendRestaurants(candidates, intent, profile, Math.max(limit, 12));
    const rankResult = await this.chat?.rankIds?.({
      userMessage: query,
      kind: '餐厅',
      candidates: deterministic.map((item) => ({
        id: item.id, name: item.name, cuisines: item.cuisines, tags: item.tags,
        averagePrice: item.averagePrice, rating: item.rating, isOpen: item.isOpen,
        distanceMeters: item.distanceMeters
      })),
      preferences: preferenceFacts(profile),
      fallbackIds: deterministic.map((item) => item.id),
      limit
    }) ?? { ids: deterministic.map((item) => item.id).slice(0, limit), usedModel: false };
    const byId = new Map(deterministic.map((item) => [item.id, item]));
    const restaurants = rankResult.ids.map((id) => byId.get(id)).filter(Boolean);
    return {
      intent, restaurants, dataSource: refresh.source, warning: refresh.warning,
      modelUsed: intentResult.usedModel || rankResult.usedModel,
      amapDurationMs: refresh.durationMs ?? 0
    };
  }

  async createSession({ deviceId, userId = '' }) {
    return this.store.transaction((state) => {
      const session = {
        id: randomUUID(),
        deviceId: deviceId || 'anonymous',
        userId,
        stage: 'PRE_MEAL',
        selectedRestaurantId: '',
        menuStatus: 'NONE',
        intent: null,
        recognizedMenu: [],
        messages: [message('agent', '你好，我是餐厅助手。告诉我今天想吃什么，我会基于真实商家数据为你推荐。')],
        createdAt: nowIso(),
        updatedAt: nowIso()
      };
      state.sessions.push(session);
      return publicSession(session);
    });
  }

  async ensureAppSession(sessionKey, userId = '', profile = null) {
    return this.store.transaction((state) => {
      const externalId = `app:${sessionKey}`;
      let session = state.sessions.find((item) => item.id === sessionKey || item.externalId === externalId);
      if (!session) {
        session = {
          id: randomUUID(), externalId, deviceId: `app:${userId || 'guest'}`, userId,
          stage: 'PRE_MEAL', selectedRestaurantId: '', menuStatus: 'NONE', intent: null,
          recognizedMenu: [], messages: [],
          createdAt: nowIso(), updatedAt: nowIso()
        };
        state.sessions.push(session);
      }
      if (userId) session.userId = userId;
      if (profile) session.profileSnapshot = profile;
      return publicSession(session);
    });
  }

  async executeAppRequest(request) {
    const startedAt = Date.now();
    const action = request?.action || 'chat';
    const clientRequestId = String(request?.clientRequestId ?? '').trim().slice(0, 128);
    const userId = request?.profile?.userId || request?.state?.userId || 'guest';
    const idempotencyKey = clientRequestId ? `${userId}:${clientRequestId}` : '';
    try {
      if (idempotencyKey) {
        const cached = this.store.snapshot().processedRequests
          .find((item) => item.key === idempotencyKey);
        if (cached) {
          this.telemetry?.record({ action, totalMs: Date.now() - startedAt, httpStatus: 200,
            idempotencyHit: true, modelUsed: cached.response?.modelUsed === true });
          return structuredClone(cached.response);
        }
        const inFlight = this.inFlightRequests.get(idempotencyKey);
        if (inFlight) return await inFlight;
      }

      const pending = this.executeAppRequestOnce(request);
      if (idempotencyKey) this.inFlightRequests.set(idempotencyKey, pending);
      const response = await pending;
      const responseTelemetry = response.telemetry ?? {};
      delete response.telemetry;
      if (idempotencyKey && action !== 'discover') {
        await this.store.transaction((state) => {
          const cutoff = Date.now() - 24 * 60 * 60 * 1000;
          state.processedRequests = (state.processedRequests ?? [])
            .filter((item) => Date.parse(item.createdAt) >= cutoff && item.key !== idempotencyKey)
            .slice(-299);
          state.processedRequests.push({ key: idempotencyKey, action, response, createdAt: nowIso() });
          return true;
        });
      }
      this.telemetry?.record({
        action, totalMs: Date.now() - startedAt, httpStatus: 200, idempotencyHit: false,
        amapMs: responseTelemetry.amapMs ?? 0, modelMs: responseTelemetry.modelMs ?? 0,
        modelUsed: response.modelUsed === true, modelFallback: responseTelemetry.modelFallback === true,
        ocrSource: responseTelemetry.ocrSource ?? ''
      });
      return response;
    } catch (error) {
      this.telemetry?.record({ action, totalMs: Date.now() - startedAt,
        httpStatus: Number(error.statusCode) || 500, modelUsed: false });
      throw error;
    } finally {
      if (idempotencyKey) this.inFlightRequests.delete(idempotencyKey);
    }
  }

  async executeAppRequestOnce(request) {
    const action = request?.action || 'chat';
    const requestState = request?.state ?? {};
    const userId = request?.profile?.userId || requestState.userId || 'guest';

    if (action === 'discover') {
      const page = Math.min(Math.max(Number(request.page) || 1, 1), 100);
      const pageSize = Math.min(Math.max(Number(request.pageSize) || 20, 1), 25);
      const query = String(request.message ?? '').trim() || '餐厅';
      const refresh = await this.refreshPlaces(query, request.location ?? null, page, pageSize);
      const state = this.store.snapshot();
      let pageItems;
      if (refresh.source === 'amap') {
        const byId = new Map(state.restaurants.map((item) => [item.id, item]));
        pageItems = refresh.restaurantIds.map((id) => byId.get(id)).filter(Boolean);
      } else {
        const start = (page - 1) * pageSize;
        pageItems = state.restaurants.slice(start, start + pageSize);
      }
      const restaurants = pageItems.map((item) => appRestaurant(item, state.reviews));
      const hasMore = refresh.source === 'amap'
        ? refresh.refreshed === pageSize
        : page * pageSize < state.restaurants.length;
      const fallbackReply = refresh.source === 'amap'
        ? `已从高德检索“${query}”，加载第 ${page} 页，共 ${restaurants.length} 家餐厅。`
        : `已从 SQLite 数据库读取第 ${page} 页，共 ${restaurants.length} 家餐厅。${refresh.warning}`;
      return {
        reply: fallbackReply,
        state: {
          sessionId: requestState.sessionId || `preview-${Date.now()}`,
          stage: requestState.stage || 'PRE_MEAL',
          selectedRestaurantId: requestState.selectedRestaurantId || '',
          userId
        },
        restaurants,
        recognizedMenu: [],
        dishRecommendations: [],
        reviewSaved: false,
        modelUsed: false,
        hasMore,
        nextPage: hasMore ? page + 1 : 0,
        telemetry: { amapMs: refresh.durationMs ?? 0, modelMs: 0, modelFallback: false, ocrSource: '' }
      };
    }

    const session = await this.ensureAppSession(requestState.sessionId || randomUUID(), userId, request.profile ?? null);
    assertActionAllowed(action, session.stage);
    let payload;
    if (action === 'select_restaurant') {
      payload = await this.selectRestaurant(session.id, request.restaurantId);
    } else if (action === 'arrive') {
      payload = await this.arrive(session.id);
    } else if (action === 'upload_menu') {
      payload = await this.processMenuUpload(session.id, request);
    } else if (action === 'confirm_menu') {
      payload = await this.confirmMenu(session.id);
    } else if (action === 'finish_meal') {
      payload = await this.finishDining(session.id);
    } else if (action === 'submit_review') {
      payload = await this.handleMessage(session.id, request.message, userId, request.location ?? null);
    } else {
      payload = await this.handleMessage(session.id, request.message, userId, request.location ?? null);
    }
    payload = await this.enrichNodePayload(payload, request, action);
    return this.toAppResponse(payload, request, action);
  }

  async enrichNodePayload(payload, request, action) {
    if (!payload?.message || payload.modelUsed === true || payload.modelAttempted === true) return payload;
    const fallback = payload.message.text;
    const safeRequestMessage = payload.session.stage === 'END' || action === 'submit_review'
      ? sanitizeReview(request.message ?? '')
      : request.message;
    const modelResult = await this.chat?.complete?.({
      userMessage: safeRequestMessage || ({
        select_restaurant: '确认选择这家餐厅',
        arrive: '我已经到店，请继续协助',
        upload_menu: '分析刚识别的菜单并给出点菜建议',
        confirm_menu: '确认菜单并开始点菜',
        finish_meal: '我已经用餐完毕',
        submit_review: '保存并回应我的用餐评价'
      }[action] ?? `执行${action}`),
      history: payload.session.messages.slice(0, -1).map((item) => ({
        ...item,
        text: sanitizeReview(item.text)
      })),
      facts: {
        action,
        stage: payload.session.stage,
        selectedRestaurant: payload.selectedRestaurant ? appRestaurant(payload.selectedRestaurant) : null,
        restaurants: (payload.restaurants ?? []).map((item) => appRestaurant(item)),
        recognizedMenu: payload.items ?? payload.session.recognizedMenu ?? [],
        dishSuggestions: (payload.suggestions ?? payload.menuSuggestions ?? []).map((item) => ({
          id: item.id, name: item.name, price: item.price, ingredients: item.ingredients, tags: item.tags
        })),
        preferences: preferenceFacts(request.profile),
        warning: payload.warning ?? ''
      },
      fallback,
      flowNode: flowNodeFor(action, payload.session.stage)
    }) ?? { text: fallback, usedModel: false };
    if (modelResult.usedModel) {
      payload.message.text = modelResult.text;
      const storedMessage = payload.session.messages.find((item) => item.id === payload.message.id);
      if (storedMessage) storedMessage.text = modelResult.text;
      payload.modelUsed = true;
    }
    payload.modelDurationMs = modelResult.durationMs ?? 0;
    payload.modelName = modelResult.model ?? '';
    payload.modelFallback = modelResult.usedModel !== true;
    return payload;
  }

  toAppResponse(payload, request, action) {
    const session = payload.session;
    const selectedRestaurant = payload.selectedRestaurant ?? null;
    const menuVisible = action === 'arrive' || action === 'upload_menu' || action === 'confirm_menu' ||
      (action === 'chat' && ['MENU_READY', 'DINING'].includes(session.stage));
    let recognizedMenu = menuVisible ? (payload.items ?? session.recognizedMenu ?? []) : [];
    if (recognizedMenu.length === 0 && action === 'arrive' && selectedRestaurant) {
      recognizedMenu = selectedRestaurant.menu;
    }
    const suggestions = menuVisible ? (payload.suggestions ?? payload.menuSuggestions ?? []) : [];
    const state = this.store.snapshot();
    const restaurants = (payload.restaurants ?? []).map((item) => appRestaurant(item, state.reviews));
    const selectedRestaurantResponse = selectedRestaurant
      ? appRestaurant(selectedRestaurant, state.reviews)
      : undefined;
    const reply = payload.message?.text ??
      (action === 'upload_menu' ? `识别到 ${recognizedMenu.length} 道菜，请先确认识别结果。` : '操作已完成。');
    return {
      reply,
      state: {
        sessionId: session.id,
        stage: session.stage,
        selectedRestaurantId: session.selectedRestaurantId ?? '',
        menuStatus: session.menuStatus ?? (session.recognizedMenu?.length ? 'CONFIRMED' : 'NONE'),
        menuVersionId: session.menuVersionId ?? session.pendingMenuVersionId ?? session.confirmedMenuVersionId ?? '',
        userId: request?.profile?.userId || request?.state?.userId || 'guest'
      },
      restaurants,
      selectedRestaurant: selectedRestaurantResponse,
      recognizedMenu,
      dishRecommendations: suggestions.map((item) => appDishRecommendation(item, payload.warning)),
      reviewSaved: payload.reviewSaved === true ||
        (session.stage === 'END' && (action === 'submit_review' || request?.state?.stage === 'REVIEW')),
      modelUsed: payload.modelUsed === true,
      telemetry: {
        amapMs: payload.amapDurationMs ?? 0,
        modelMs: payload.modelDurationMs ?? 0,
        modelFallback: payload.modelFallback === true,
        ocrSource: payload.ocrSource ?? ''
      }
    };
  }

  async getActiveSession(deviceId) {
    return this.store.read((state) => {
      const sessions = state.sessions
        .filter((item) => item.deviceId === deviceId && item.stage !== 'END')
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return sessions.length ? publicSession(sessions[0]) : null;
    });
  }

  async handleMessage(sessionId, text, userId = '', location = null) {
    if (!text?.trim()) throw httpError(400, 'INVALID_TEXT', '消息内容不能为空');
    const existing = this.store.snapshot().sessions.find((item) => item.id === sessionId);
    const candidateResult = existing && wantsRestaurantCandidates(text.trim(), existing.stage)
      ? await this.searchRestaurants(text.trim(), userId, 5, location, existing.profileSnapshot ?? null)
      : null;
    return this.store.transaction(async (state) => {
      const session = state.sessions.find((item) => item.id === sessionId);
      if (!session) throw httpError(404, 'SESSION_NOT_FOUND', '会话不存在');
      if (userId && !session.userId) session.userId = userId;
      session.messages.push(message('user', text.trim()));
      session.updatedAt = nowIso();

      const restaurant = state.restaurants.find((item) => item.id === session.selectedRestaurantId) ?? null;
      const profile = state.users.find((item) => item.id === session.userId || item.deviceId === userId) ??
        session.profileSnapshot ?? null;

      if (session.stage === 'END') {
        throw httpError(409, 'SESSION_ENDED', '本次用餐已完成，请开始新对话');
      }

      if (session.stage === 'REVIEW') {
        const reviewText = sanitizeReview(text);
        const latestUserMessage = session.messages.at(-1);
        if (latestUserMessage?.role === 'user') latestUserMessage.text = reviewText;
        const duplicate = state.reviews.find((item) => item.userId === (session.userId || userId) &&
          item.restaurantId === session.selectedRestaurantId && Date.now() - Date.parse(item.createdAt) < 2 * 60 * 60 * 1000);
        if (duplicate) {
          duplicate.text = reviewText;
          duplicate.updatedAt = nowIso();
        } else {
          state.reviews.push({
            id: randomUUID(), userId: session.userId || userId || 'anonymous',
            restaurantId: session.selectedRestaurantId, sessionId: session.id,
            rating: null, text: reviewText, tags: [], createdAt: nowIso()
          });
        }
        session.stage = 'END';
        const reply = message('agent', '已将评价与本次餐厅和会话绑定保存，谢谢反馈。需要时可以开始新一轮推荐。');
        session.messages.push(reply);
        return this.payload(session, reply, [], restaurant, [], '');
      }

      if (candidateResult) {
        session.intent = candidateResult.intent;
        const restaurants = candidateResult.restaurants;
        const fallbackReply = restaurants.length
          ? `根据“${(candidateResult.intent.keywords ?? []).join('、') || text.trim()}”从高德与商家库找到 ${restaurants.length} 家候选。你可以直接换选其中一家。${candidateResult.warning}`
          : `暂时没有找到匹配的餐厅，可以换个菜系、口味或价格条件再试。${candidateResult.warning}`;
        const reply = message('agent', fallbackReply);
        session.messages.push(reply);
        const payload = this.payload(session, reply, restaurants, restaurant, [], '', candidateResult.modelUsed);
        payload.amapDurationMs = candidateResult.amapDurationMs;
        payload.modelFallback = candidateResult.modelUsed !== true;
        return payload;
      }

      if (session.stage === 'RESTAURANT_SELECTED') {
        return this.reply(session, `已选择${restaurant.name}。请到店后点击“我已抵达”，流程才会进入菜单节点。`, restaurant);
      }

      if (session.stage === 'ARRIVED') {
        return this.reply(session, `${restaurant.name}暂无已确认菜单，请点击“拍照 / 上传菜单”继续。`, restaurant);
      }

      if (restaurant && ['ARRIVED', 'MENU_READY', 'DINING'].includes(session.stage)) {
        let menu = session.recognizedMenu.length ? session.recognizedMenu : restaurant.menu;
        const correction = applyMenuCorrection(menu, text);
        if (correction.corrected > 0) {
          menu = correction.menu;
          session.recognizedMenu = menu;
          const pendingVersion = (state.menuVersions ?? []).find((item) => item.id === session.pendingMenuVersionId);
          if (pendingVersion?.status === 'PENDING') pendingVersion.items = structuredClone(menu);
        }
        const suggestions = suggestDishes(menu, profile);
        const pendingConfirmation = session.menuStatus === 'PENDING';
        session.stage = pendingConfirmation ? 'MENU_READY' : (suggestions.length ? 'DINING' : 'ARRIVED');
        const replyText = correction.corrected > 0
          ? `已把 ${correction.corrected} 道菜中的“${correction.from}”改为“${correction.to}”，并重新生成建议。` +
            `${pendingConfirmation ? '请确认菜单后再开始点菜。' : ''}`
          : suggestions.length
          ? `结合你的偏好，建议优先考虑：${suggestions.map((item) => item.name).join('、')}。涉及过敏原时请以餐厅实际说明为准。`
          : '当前还没有可用菜单。请上传一张清晰、完整的菜单照片。';
        const reply = message('agent', replyText);
        session.messages.push(reply);
        return this.payload(session, reply, [], restaurant, suggestions,
          suggestions.length ? '模型识别可能遗漏过敏原，请以餐厅实际说明为准。' : '');
      }

      const refresh = { source: 'sqlite', warning: '', durationMs: 0 };
      const intent = parseDiningIntent(text);
      session.intent = intent;
      const candidates = this.searchCandidates(state.restaurants, refresh);
      const restaurants = recommendRestaurants(candidates, intent, profile, 5);
      const fallbackReply = restaurants.length
        ? `我从${refresh.source === 'amap' ? '高德与 SQLite 商家库' : 'SQLite 商家库'}中找到了 ${restaurants.length} 家候选，先为你展示相关性最高的结果。推荐理由只使用商家数据与已表达偏好。${refresh.warning}`
        : '暂时没有完全匹配的营业中餐厅。你可以放宽距离、价格或口味条件后再试。';
      const modelResult = await this.chat?.complete?.({
        userMessage: text,
        history: session.messages.slice(0, -1),
        facts: {
          stage: session.stage,
          intent,
          restaurants: restaurants.map((item) => ({
            id: item.id, name: item.name, address: item.address, cuisines: item.cuisines,
            tags: item.tags, averagePrice: item.averagePrice, rating: item.rating,
            isOpen: item.isOpen, openingHours: item.openingHours ?? '',
            recommendationReason: item.recommendationReason
          })),
          preferences: preferenceFacts(profile)
        },
        fallback: fallbackReply,
        flowNode: 'RECOMMEND'
      }) ?? { text: fallbackReply, usedModel: false };
      const replyText = `${modelResult.text}${refresh.warning && !modelResult.text.includes(refresh.warning) ? refresh.warning : ''}`;
      const reply = message('agent', replyText);
      session.messages.push(reply);
      const payload = this.payload(session, reply, restaurants, null, [], '', modelResult.usedModel);
      payload.amapDurationMs = refresh.durationMs ?? 0;
      payload.modelDurationMs = modelResult.durationMs ?? 0;
      payload.modelName = modelResult.model ?? '';
      payload.modelFallback = modelResult.usedModel !== true;
      return payload;
    });
  }

  async processMenuUpload(sessionId, request) {
    const deviceItems = Array.isArray(request.recognizedMenu) ? request.recognizedMenu : [];
    const images = Array.isArray(request.menuImages) ? request.menuImages : [];
    if (images.length > 3) throw httpError(413, 'TOO_MANY_IMAGES', '一次最多上传 3 张菜单图片');
    for (const image of images) {
      if (!image.base64 || Buffer.byteLength(image.base64, 'base64') > 4 * 1024 * 1024) {
        throw httpError(413, 'IMAGE_TOO_LARGE', '单张图片不能超过 4 MB');
      }
    }
    const modelVision = await this.chat?.recognizeMenu?.(
      images,
      deviceItems,
      preferenceFacts(request.profile)
    ) ?? { usedModel: false, items: deviceItems, lowConfidenceFields: [], reply: '' };

    if (modelVision.usedModel) {
      const payload = await this.acceptRecognizedMenu(
        sessionId, modelVision.items, modelVision.lowConfidenceFields, 'gpt-vision', true
      );
      payload.message.text = modelVision.reply || payload.message.text;
      const storedMessage = payload.session.messages.find((item) => item.id === payload.message.id);
      if (storedMessage) storedMessage.text = payload.message.text;
      payload.modelUsed = true;
      payload.modelDurationMs = modelVision.durationMs ?? 0;
      payload.modelName = modelVision.model ?? '';
      payload.ocrSource = 'gpt-vision';
      return payload;
    }

    if (deviceItems.length > 0) {
      const lowConfidenceFields = deviceItems
        .filter((item) => Number(item.confidence) < 0.8)
        .map((item) => `${item.name}.price`);
      const payload = await this.acceptRecognizedMenu(
        sessionId, deviceItems, lowConfidenceFields, 'device-ocr', true
      );
      payload.message.text = `大模型图片识别暂不可用，已采用端侧 OCR。${payload.message.text}`;
      payload.modelAttempted = images.length > 0;
      payload.modelDurationMs = modelVision.durationMs ?? 0;
      payload.modelFallback = images.length > 0;
      payload.ocrSource = 'device-ocr';
      return payload;
    }

    const payload = await this.recognizeMenu(sessionId, images);
    payload.message.text = `大模型图片识别暂不可用，已采用备用识别。${payload.message.text}`;
    payload.modelAttempted = true;
    payload.modelDurationMs = modelVision.durationMs ?? 0;
    payload.modelFallback = true;
    payload.ocrSource = payload.ocrSource || 'server-vision';
    return payload;
  }

  async selectRestaurant(sessionId, restaurantId) {
    return this.store.transaction((state) => {
      const session = state.sessions.find((item) => item.id === sessionId);
      if (!session) throw httpError(404, 'SESSION_NOT_FOUND', '会话不存在');
      const restaurant = state.restaurants.find((item) => item.id === restaurantId);
      if (!restaurant) throw httpError(404, 'RESTAURANT_NOT_FOUND', '餐厅不存在');
      const pendingVersion = (state.menuVersions ?? []).find((item) =>
        item.id === session.pendingMenuVersionId && item.status === 'PENDING');
      if (pendingVersion) pendingVersion.status = 'SUPERSEDED';
      session.selectedRestaurantId = restaurant.id;
      session.stage = 'RESTAURANT_SELECTED';
      session.menuStatus = 'NONE';
      session.intent = null;
      session.pendingMenuVersionId = '';
      session.confirmedMenuVersionId = '';
      session.recognizedMenu = [];
      session.updatedAt = nowIso();
      const reply = message('agent', `已选择${restaurant.name}。到店后点“我已抵达”，有菜单我会直接推荐；没有菜单时可拍照识别。`);
      session.messages = [reply];
      return this.payload(session, reply, [], restaurant, [], '');
    });
  }

  async arrive(sessionId) {
    return this.store.transaction((state) => {
      const session = state.sessions.find((item) => item.id === sessionId);
      if (!session) throw httpError(404, 'SESSION_NOT_FOUND', '会话不存在');
      const restaurant = state.restaurants.find((item) => item.id === session.selectedRestaurantId);
      if (!restaurant) throw httpError(409, 'RESTAURANT_REQUIRED', '请先选择餐厅');
      const profile = state.users.find((item) => item.id === session.userId) ?? session.profileSnapshot ?? null;
      return this.arrivalPayload(session, restaurant, profile);
    });
  }

  arrivalPayload(session, restaurant, profile) {
    session.stage = restaurant.menu.length ? 'DINING' : 'ARRIVED';
    session.menuStatus = restaurant.menu.length ? 'CONFIRMED' : 'NONE';
    session.confirmedMenuVersionId = restaurant.menuVersionId ?? '';
    session.recognizedMenu = restaurant.menu.length ? structuredClone(restaurant.menu) : [];
    session.updatedAt = nowIso();
    const suggestions = restaurant.menu.length ? suggestDishes(restaurant.menu, profile) : [];
    const text = suggestions.length
      ? `已读取${restaurant.name}的数据库菜单。建议优先考虑：${suggestions.map((item) => item.name).join('、')}。`
      : `${restaurant.name}目前没有完整菜单。请拍一张清晰菜单，我会识别菜名、价格和食材后给出建议。`;
    const reply = message('agent', text);
    session.messages.push(reply);
    return this.payload(session, reply, [], restaurant, suggestions,
      suggestions.length ? '过敏原判断请以餐厅实际说明为准。' : '');
  }

  async recognizeMenu(sessionId, images) {
    if (!Array.isArray(images) || images.length === 0) throw httpError(400, 'IMAGE_REQUIRED', '请至少上传一张菜单图片');
    if (images.length > 3) throw httpError(413, 'TOO_MANY_IMAGES', '一次最多上传 3 张菜单图片');
    for (const image of images) {
      if (!image.base64 || Buffer.byteLength(image.base64, 'base64') > 4 * 1024 * 1024) {
        throw httpError(413, 'IMAGE_TOO_LARGE', '单张图片不能超过 4 MB');
      }
    }
    const state = this.store.snapshot();
    const snapshot = state.sessions.find((item) => item.id === sessionId);
    if (!snapshot) throw httpError(404, 'SESSION_NOT_FOUND', '会话不存在');
    const restaurant = state.restaurants.find((item) => item.id === snapshot.selectedRestaurantId);
    if (!restaurant) throw httpError(409, 'RESTAURANT_REQUIRED', '请先选择餐厅');
    const recognized = await this.vision.recognize(images, restaurant);

    const payload = await this.acceptRecognizedMenu(
      sessionId, recognized.items, recognized.lowConfidenceFields ?? [], recognized.provider ?? 'server-vision', true
    );
    payload.ocrSource = recognized.provider ?? 'server-vision';
    return payload;
  }

  async acceptRecognizedMenu(sessionId, items, lowConfidenceFields = [], source = 'submitted-menu', append = false) {
    if (!Array.isArray(items) || items.length === 0) {
      throw httpError(400, 'MENU_ITEMS_REQUIRED', '菜单识别结果不能为空');
    }
    if (items.length > 100) throw httpError(413, 'TOO_MANY_MENU_ITEMS', '一次最多提交 100 道菜');
    const normalized = items.map((item, index) => ({
      id: String(item.id ?? `menu-${index + 1}`).slice(0, 128),
      name: String(item.name ?? '').trim().slice(0, 100),
      category: String(item.category ?? '待分类').trim().slice(0, 40),
      price: Math.max(0, Math.min(Number(item.price) || 0, 100000)),
      ingredients: Array.isArray(item.ingredients)
        ? item.ingredients.map((value) => String(value).trim().slice(0, 50)).filter(Boolean).slice(0, 30) : [],
      tags: Array.isArray(item.tags)
        ? item.tags.map((value) => String(value).trim().slice(0, 30)).filter(Boolean).slice(0, 20) : [],
      confidence: Math.max(0, Math.min(Number(item.confidence) || 0, 1))
    }));
    if (normalized.some((item) => !item.name)) {
      throw httpError(400, 'INVALID_MENU_ITEM', '每道菜都必须包含名称');
    }

    return this.store.transaction((state) => {
      const session = state.sessions.find((item) => item.id === sessionId);
      if (!session) throw httpError(404, 'SESSION_NOT_FOUND', '会话不存在');
      const restaurant = state.restaurants.find((item) => item.id === session.selectedRestaurantId);
      if (!restaurant) throw httpError(409, 'RESTAURANT_REQUIRED', '请先选择餐厅');
      const profile = state.users.find((item) => item.id === session.userId) ?? session.profileSnapshot ?? null;
      const existingMenu = append && session.recognizedMenu?.length ? session.recognizedMenu : [];
      const mergedItems = mergeMenuItems(existingMenu, normalized);
      if (mergedItems.length > 100) throw httpError(413, 'TOO_MANY_MENU_ITEMS', '累计菜单最多保留 100 道菜');
      const createdAt = nowIso();
      for (const version of state.menuVersions ?? []) {
        if (version.restaurantId === restaurant.id && version.status === 'PENDING') version.status = 'SUPERSEDED';
      }
      const version = {
        id: randomUUID(), restaurantId: restaurant.id, sessionId: session.id,
        source: String(source).slice(0, 40), status: 'PENDING',
        lowConfidenceFields: Array.isArray(lowConfidenceFields) ? lowConfidenceFields.slice(0, 100) : [],
        items: structuredClone(mergedItems), createdAt, confirmedAt: ''
      };
      state.menuVersions.push(version);
      session.recognizedMenu = mergedItems;
      session.stage = 'MENU_READY';
      session.menuStatus = 'PENDING';
      session.pendingMenuVersionId = version.id;
      session.menuVersionId = version.id;
      session.updatedAt = createdAt;
      const suggestions = suggestDishes(mergedItems, profile);
      const lowCount = Array.isArray(lowConfidenceFields) ? lowConfidenceFields.length : 0;
      const reply = message('agent', `本次识别 ${normalized.length} 道菜，待确认菜单累计 ${mergedItems.length} 道` +
        `${lowCount ? `，其中 ${lowCount} 个字段置信度较低` : ''}。` +
        `${suggestions.length ? `建议优先考虑：${suggestions.map((item) => item.name).join('、')}。` : ''}` +
        '请确认识别结果后再开始点菜。');
      session.messages.push(reply);
      return {
        session: publicSession(session),
        message: reply,
        items: mergedItems,
        suggestions,
        menuVersionId: version.id,
        menuStatus: 'PENDING',
        lowConfidenceFields: Array.isArray(lowConfidenceFields) ? lowConfidenceFields.slice(0, 100) : [],
        warning: '菜单与过敏原识别可能存在遗漏，请以餐厅实际说明为准。'
      };
    });
  }

  async confirmMenu(sessionId) {
    return this.store.transaction((state) => {
      const session = state.sessions.find((item) => item.id === sessionId);
      if (!session) throw httpError(404, 'SESSION_NOT_FOUND', '会话不存在');
      const restaurant = state.restaurants.find((item) => item.id === session.selectedRestaurantId);
      if (!restaurant) throw httpError(409, 'RESTAURANT_REQUIRED', '请先选择餐厅');
      if (session.menuStatus === 'CONFIRMED' && session.recognizedMenu?.length) {
        const suggestions = suggestDishes(session.recognizedMenu, session.profileSnapshot ?? null);
        return this.payload(session, message('agent', '菜单已经确认，可以继续点菜。'), [], restaurant, suggestions,
          '菜单与过敏原识别可能存在遗漏，请以餐厅实际说明为准。');
      }
      const version = (state.menuVersions ?? []).find((item) =>
        item.id === session.pendingMenuVersionId && item.status === 'PENDING');
      if (!version) throw httpError(409, 'PENDING_MENU_REQUIRED', '当前没有待确认的菜单');
      const confirmedAt = nowIso();
      for (const item of state.menuVersions) {
        if (item.restaurantId === restaurant.id && item.status === 'CONFIRMED') item.status = 'ARCHIVED';
      }
      version.status = 'CONFIRMED';
      version.confirmedAt = confirmedAt;
      restaurant.menu = structuredClone(version.items);
      restaurant.menuSource = version.source;
      restaurant.menuUpdatedAt = confirmedAt;
      restaurant.menuSourceSessionId = session.id;
      restaurant.menuVersionId = version.id;
      session.recognizedMenu = structuredClone(version.items);
      session.menuStatus = 'CONFIRMED';
      session.confirmedMenuVersionId = version.id;
      session.pendingMenuVersionId = '';
      session.menuVersionId = version.id;
      session.stage = 'DINING';
      session.updatedAt = confirmedAt;
      const profile = state.users.find((item) => item.id === session.userId) ?? session.profileSnapshot ?? null;
      const suggestions = suggestDishes(version.items, profile);
      const reply = message('agent', `已确认 ${version.items.length} 道菜并保存为当前餐厅菜单。` +
        `${suggestions.length ? `建议优先考虑：${suggestions.map((item) => item.name).join('、')}。` : ''}`);
      session.messages.push(reply);
      return { ...this.payload(session, reply, [], restaurant, suggestions,
        '菜单与过敏原识别可能存在遗漏，请以餐厅实际说明为准。'),
        items: version.items, menuVersionId: version.id, menuStatus: 'CONFIRMED' };
    });
  }

  async finishDining(sessionId) {
    return this.store.transaction((state) => {
      const session = state.sessions.find((item) => item.id === sessionId);
      if (!session) throw httpError(404, 'SESSION_NOT_FOUND', '会话不存在');
      const restaurant = state.restaurants.find((item) => item.id === session.selectedRestaurantId);
      if (!restaurant) throw httpError(409, 'RESTAURANT_REQUIRED', '请先选择餐厅');
      if (session.stage === 'END') {
        const reply = message('agent', '本次用餐与评价均已完成，无需重复提交。');
        return { ...this.payload(session, reply, [], restaurant, [], ''), modelAttempted: true, reviewSaved: true };
      }
      if (session.stage === 'REVIEW') {
        const reply = message('agent', '已记录就餐完成，请填写味道、服务或环境体验。');
        return { ...this.payload(session, reply, [], restaurant, [], ''), modelAttempted: true };
      }
      session.stage = 'REVIEW';
      session.updatedAt = nowIso();
      const reply = message('agent', '这次用餐体验怎么样？可以告诉我味道、服务、环境，也可以补充星级或标签。');
      session.messages.push(reply);
      return this.payload(session, reply, [], restaurant, [], '');
    });
  }

  reply(session, text, restaurant = null) {
    const reply = message('agent', text);
    session.messages.push(reply);
    return this.payload(session, reply, [], restaurant, [], '');
  }

  payload(session, reply, restaurants, selectedRestaurant, menuSuggestions, warning, modelUsed = false) {
    return {
      session: publicSession(session),
      message: reply,
      restaurants,
      selectedRestaurant,
      menuSuggestions,
      warning,
      modelUsed
    };
  }
}
