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
    recognizedMenu: session.recognizedMenu ?? [],
    messages: session.messages
  };
}

function appRestaurant(restaurant) {
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
    reason: restaurant.recommendationReason ?? '信息来自服务端预置商家数据。',
    menuAvailable: restaurant.menu.length > 0,
    menu: restaurant.menu
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
    this.explanation = providers.explanation;
  }

  async createSession({ deviceId, userId = '' }) {
    return this.store.transaction((state) => {
      const session = {
        id: randomUUID(),
        deviceId: deviceId || 'anonymous',
        userId,
        stage: 'PRE_MEAL',
        selectedRestaurantId: '',
        intent: null,
        recognizedMenu: [],
        messages: [message('agent', '你好，我是小艺餐厅助手。告诉我今天想吃什么，我会基于真实商家数据为你推荐。')],
        createdAt: nowIso(),
        updatedAt: nowIso()
      };
      state.sessions.push(session);
      return publicSession(session);
    });
  }

  async ensureExternalSession(externalId, userId = '') {
    const state = this.store.snapshot();
    const existing = state.sessions.find((item) => item.externalId === externalId);
    if (existing) return publicSession(existing);
    return this.store.transaction((mutable) => {
      const session = {
        id: randomUUID(), externalId, deviceId: `xiaoyi:${externalId}`, userId,
        stage: 'PRE_MEAL', selectedRestaurantId: '', intent: null, recognizedMenu: [], messages: [],
        createdAt: nowIso(), updatedAt: nowIso()
      };
      mutable.sessions.push(session);
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
          stage: 'PRE_MEAL', selectedRestaurantId: '', intent: null, recognizedMenu: [], messages: [],
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
    const action = request?.action || 'chat';
    const requestState = request?.state ?? {};
    const userId = request?.profile?.userId || requestState.userId || 'guest';

    if (action === 'discover') {
      const restaurants = this.store.snapshot().restaurants.map((item) => appRestaurant(item));
      return {
        reply: `已从服务端读取 ${restaurants.length} 家演示餐厅。`,
        state: {
          sessionId: requestState.sessionId || `preview-${Date.now()}`,
          stage: requestState.stage || 'PRE_MEAL',
          selectedRestaurantId: requestState.selectedRestaurantId || '',
          userId
        },
        restaurants,
        recognizedMenu: [],
        dishRecommendations: [],
        reviewSaved: false
      };
    }

    const session = await this.ensureAppSession(requestState.sessionId || randomUUID(), userId, request.profile ?? null);
    let payload;
    if (action === 'select_restaurant') {
      payload = await this.selectRestaurant(session.id, request.restaurantId);
    } else if (action === 'arrive') {
      payload = await this.arrive(session.id);
    } else if (action === 'upload_menu') {
      payload = await this.recognizeMenu(session.id, request.menuImages);
    } else if (action === 'finish_meal') {
      payload = await this.finishDining(session.id);
    } else if (action === 'submit_review') {
      payload = await this.handleMessage(session.id, request.message, userId);
    } else {
      payload = await this.handleMessage(session.id, request.message, userId);
    }
    return this.toAppResponse(payload, request, action);
  }

  toAppResponse(payload, request, action) {
    const session = payload.session;
    const selectedRestaurant = payload.selectedRestaurant ?? null;
    let recognizedMenu = payload.items ?? session.recognizedMenu ?? [];
    if (recognizedMenu.length === 0 && action === 'arrive' && selectedRestaurant) {
      recognizedMenu = selectedRestaurant.menu;
    }
    const suggestions = payload.suggestions ?? payload.menuSuggestions ?? [];
    const restaurants = (payload.restaurants ?? []).map((item) => appRestaurant(item));
    const reply = payload.message?.text ??
      (action === 'upload_menu' ? `识别到 ${recognizedMenu.length} 道菜，请先确认识别结果。` : '操作已完成。');
    return {
      reply,
      state: {
        sessionId: session.id,
        stage: session.stage,
        selectedRestaurantId: session.selectedRestaurantId ?? '',
        userId: request?.profile?.userId || request?.state?.userId || 'guest'
      },
      restaurants,
      recognizedMenu,
      dishRecommendations: suggestions.map((item) => appDishRecommendation(item, payload.warning)),
      reviewSaved: session.stage === 'END' && (action === 'submit_review' || request?.state?.stage === 'REVIEW')
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

  async handleMessage(sessionId, text, userId = '') {
    if (!text?.trim()) throw httpError(400, 'INVALID_TEXT', '消息内容不能为空');
    return this.store.transaction(async (state) => {
      const session = state.sessions.find((item) => item.id === sessionId);
      if (!session) throw httpError(404, 'SESSION_NOT_FOUND', '会话不存在');
      if (userId && !session.userId) session.userId = userId;
      session.messages.push(message('user', text.trim()));
      session.updatedAt = nowIso();

      const restaurant = state.restaurants.find((item) => item.id === session.selectedRestaurantId) ?? null;
      const profile = state.users.find((item) => item.id === session.userId || item.deviceId === userId) ??
        session.profileSnapshot ?? null;

      if (session.stage === 'REVIEW') {
        const reviewText = sanitizeReview(text);
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

      if (/(已就餐完毕|就餐完毕|吃完了|吃好了)/.test(text)) {
        if (!restaurant) {
          return this.reply(session, '我还不知道你在哪家餐厅用餐。请先选择餐厅，再记录体验。');
        }
        session.stage = 'REVIEW';
        return this.reply(session, '这次用餐体验怎么样？可以告诉我味道、服务、环境，也可以补充星级或标签。', restaurant);
      }

      if (/(已抵达|我到了|到店了)/.test(text)) {
        if (!restaurant) {
          return this.reply(session, '你还没有选择餐厅。请告诉我餐厅名称，或先从推荐结果中选择一家。');
        }
        return this.arrivalPayload(session, restaurant, profile);
      }

      const namedRestaurant = state.restaurants.find((item) => text.includes(item.name) ||
        (text.includes('我选') && text.includes(item.name.replace(/小馆|小院|宴|里巷/g, ''))));
      if (namedRestaurant) {
        session.selectedRestaurantId = namedRestaurant.id;
        session.stage = 'RESTAURANT_SELECTED';
        const reply = message('agent', `好的，已记住${namedRestaurant.name}。到店后告诉我“已抵达”，我会根据菜单继续帮你选菜。`);
        session.messages.push(reply);
        return this.payload(session, reply, [], namedRestaurant, [], '');
      }

      if (restaurant && ['ARRIVED', 'MENU_READY', 'DINING'].includes(session.stage)) {
        let menu = session.recognizedMenu.length ? session.recognizedMenu : restaurant.menu;
        const correction = applyMenuCorrection(menu, text);
        if (correction.corrected > 0) {
          menu = correction.menu;
          session.recognizedMenu = menu;
        }
        const suggestions = suggestDishes(menu, profile);
        session.stage = suggestions.length ? 'DINING' : 'ARRIVED';
        const replyText = correction.corrected > 0
          ? `已把 ${correction.corrected} 道菜中的“${correction.from}”改为“${correction.to}”，并重新生成建议。`
          : suggestions.length
          ? `结合你的偏好，建议优先考虑：${suggestions.map((item) => item.name).join('、')}。涉及过敏原时请以餐厅实际说明为准。`
          : '当前还没有可用菜单。请上传一张清晰、完整的菜单照片。';
        const reply = message('agent', replyText);
        session.messages.push(reply);
        return this.payload(session, reply, [], restaurant, suggestions,
          suggestions.length ? '模型识别可能遗漏过敏原，请以餐厅实际说明为准。' : '');
      }

      const intent = parseDiningIntent(text);
      session.intent = intent;
      const restaurants = recommendRestaurants(state.restaurants, intent, profile, 5);
      const replyText = restaurants.length
        ? `我从商家库中找到了 ${restaurants.length} 家候选，先为你展示相关性最高的结果。推荐理由只使用商家数据与已表达偏好。`
        : '暂时没有完全匹配的营业中餐厅。你可以放宽距离、价格或口味条件后再试。';
      const reply = message('agent', replyText);
      session.messages.push(reply);
      return this.payload(session, reply, restaurants, null, [], '');
    });
  }

  async selectRestaurant(sessionId, restaurantId) {
    return this.store.transaction((state) => {
      const session = state.sessions.find((item) => item.id === sessionId);
      if (!session) throw httpError(404, 'SESSION_NOT_FOUND', '会话不存在');
      const restaurant = state.restaurants.find((item) => item.id === restaurantId);
      if (!restaurant) throw httpError(404, 'RESTAURANT_NOT_FOUND', '餐厅不存在');
      session.selectedRestaurantId = restaurant.id;
      session.stage = 'RESTAURANT_SELECTED';
      session.updatedAt = nowIso();
      const reply = message('agent', `已选择${restaurant.name}。到店后点“我已抵达”，有菜单我会直接推荐；没有菜单时可拍照识别。`);
      session.messages.push(reply);
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
    session.stage = restaurant.menu.length ? 'MENU_READY' : 'ARRIVED';
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

    return this.store.transaction((mutable) => {
      const session = mutable.sessions.find((item) => item.id === sessionId);
      const profile = mutable.users.find((item) => item.id === session.userId) ?? session.profileSnapshot ?? null;
      session.recognizedMenu = recognized.items;
      session.stage = 'MENU_READY';
      session.updatedAt = nowIso();
      const suggestions = suggestDishes(recognized.items, profile);
      const lowCount = recognized.lowConfidenceFields?.length ?? 0;
      const text = `识别到 ${recognized.items.length} 道菜${lowCount ? `，其中 ${lowCount} 个字段置信度较低` : ''}。` +
        `${suggestions.length ? `建议优先考虑：${suggestions.map((item) => item.name).join('、')}。` : '请补拍更清晰的菜单区域。'}`;
      const reply = message('agent', text);
      session.messages.push(reply);
      return {
        session: publicSession(session),
        message: reply,
        items: recognized.items,
        suggestions,
        lowConfidenceFields: recognized.lowConfidenceFields ?? [],
        warning: '菜单与过敏原识别可能存在遗漏，请以餐厅实际说明为准。'
      };
    });
  }

  async acceptRecognizedMenu(sessionId, items, lowConfidenceFields = []) {
    if (!Array.isArray(items) || items.length === 0) {
      throw httpError(400, 'MENU_ITEMS_REQUIRED', '菜单识别结果不能为空');
    }
    if (items.length > 100) throw httpError(413, 'TOO_MANY_MENU_ITEMS', '一次最多提交 100 道菜');
    const normalized = items.map((item, index) => ({
      id: String(item.id ?? `xiaoyi-menu-${index + 1}`).slice(0, 128),
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
      session.recognizedMenu = normalized;
      session.stage = 'MENU_READY';
      session.updatedAt = nowIso();
      const suggestions = suggestDishes(normalized, profile);
      const lowCount = Array.isArray(lowConfidenceFields) ? lowConfidenceFields.length : 0;
      const reply = message('agent', `已确认 ${normalized.length} 道菜单识别结果` +
        `${lowCount ? `，其中 ${lowCount} 个字段置信度较低` : ''}。` +
        `${suggestions.length ? `建议优先考虑：${suggestions.map((item) => item.name).join('、')}。` : ''}`);
      session.messages.push(reply);
      return {
        session: publicSession(session),
        message: reply,
        items: normalized,
        suggestions,
        lowConfidenceFields: Array.isArray(lowConfidenceFields) ? lowConfidenceFields.slice(0, 100) : [],
        warning: '菜单与过敏原识别可能存在遗漏，请以餐厅实际说明为准。'
      };
    });
  }

  async finishDining(sessionId) {
    return this.store.transaction((state) => {
      const session = state.sessions.find((item) => item.id === sessionId);
      if (!session) throw httpError(404, 'SESSION_NOT_FOUND', '会话不存在');
      const restaurant = state.restaurants.find((item) => item.id === session.selectedRestaurantId);
      if (!restaurant) throw httpError(409, 'RESTAURANT_REQUIRED', '请先选择餐厅');
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

  payload(session, reply, restaurants, selectedRestaurant, menuSuggestions, warning) {
    return {
      session: publicSession(session),
      message: reply,
      restaurants,
      selectedRestaurant,
      menuSuggestions,
      warning
    };
  }
}
