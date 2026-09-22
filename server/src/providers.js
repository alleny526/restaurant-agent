import { constants, createPublicKey, verify } from 'node:crypto';

function timeoutSignal(milliseconds) {
  return AbortSignal.timeout(milliseconds);
}

function decodeJwtPart(value) {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
}

function huaweiTokenError(value) {
  const subError = Number(value?.sub_error);
  if (subError === 20152) return '华为账号授权码无效、已使用或与当前 Client ID 不匹配，请重新登录';
  if (subError === 20154) return '端侧与服务端的华为账号 Client ID 不一致';
  if (subError === 12304) return '华为账号 Client Secret 不正确';
  return '华为账号授权码校验失败，请重新授权';
}

function userFacingText(value, fallback) {
  const withoutThinking = String(value ?? '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  if (!withoutThinking || /^[\[{]/.test(withoutThinking) || /```(?:json)?/i.test(withoutThinking)) return fallback;
  const cleaned = withoutThinking.split(/\r?\n/)
    .filter((line) => !/^\s*(?:FACTS_JSON|action|stage|flowNode|处理逻辑|分析过程|内部状态)\s*[:=]/i.test(line))
    .join('\n').replace(/^\s*(?:最终回复|回复)\s*[:：]\s*/i, '').trim();
  return cleaned || fallback;
}

const FLOW_INSTRUCTIONS = {
  DISCOVER: '概括可浏览的餐厅数据，只说明数据已就绪，不进行选店。',
  RECOMMEND: '从候选中给出最多3家推荐及直接理由，最后只追问一个偏好。',
  SELECT: '确认已选餐厅，下一步只能提示到店后点击“我已抵达”。',
  ARRIVE: '确认已经到店；没有菜单时，下一步只能提示拍照或上传菜单。',
  MENU: '确认菜单来源与菜品数量，从已有建议中推荐最多3道菜，保留过敏提示。',
  DINING: '只围绕已确认菜单回答或确认纠错，不推荐菜单外菜品。',
  FINISH: '确认用餐结束，只询问味道、服务和环境体验。',
  REVIEW: '确认评价已保存，不复述隐私信息，并说明本次流程已完成。'
};

export class VisionProvider {
  constructor(config) {
    this.url = config.visionApiUrl;
    this.key = config.visionApiKey;
    this.demoMode = config.visionDemoMode;
  }

  async recognize(images, restaurant) {
    if (this.url) {
      const response = await fetch(this.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.key ? { authorization: `Bearer ${this.key}` } : {})
        },
        body: JSON.stringify({ images }),
        signal: timeoutSignal(25_000)
      });
      if (!response.ok) throw new Error(`视觉模型调用失败（${response.status}）`);
      const value = await response.json();
      if (!Array.isArray(value.items)) throw new Error('视觉模型响应缺少 items');
      return value;
    }

    if (!this.demoMode) {
      const error = new Error('生产环境尚未配置菜单识别服务');
      error.statusCode = 503;
      error.code = 'VISION_NOT_CONFIGURED';
      throw error;
    }

    const knownMenu = restaurant?.menu?.length ? restaurant.menu : [
      { id: 'ocr-1', name: '清蒸时蔬鱼', category: '热菜', price: 68, ingredients: ['鱼', '时令蔬菜'], tags: ['清淡'], confidence: 0.92 },
      { id: 'ocr-2', name: '菌菇豆腐煲', category: '热菜', price: 42, ingredients: ['菌菇', '豆腐'], tags: ['清淡', '素食'], confidence: 0.88 },
      { id: 'ocr-3', name: '招牌小炒', category: '热菜', price: 48, ingredients: [], tags: [], confidence: 0.61 }
    ];
    return {
      items: structuredClone(knownMenu),
      lowConfidenceFields: knownMenu.filter((item) => item.confidence < 0.8).map((item) => `${item.name}.ingredients`),
      provider: 'demo'
    };
  }
}

export class ChatModelProvider {
  constructor(config, fetchImpl = globalThis.fetch) {
    this.baseUrl = String(config.llmBaseUrl ?? '').replace(/\/+$/, '');
    this.key = config.llmApiKey ?? '';
    this.model = config.llmModel ?? '';
    this.fastModel = config.llmFastModel ?? '';
    this.providerName = String(config.llmProvider ?? '').trim().toLowerCase() ||
      (/dashscope|aliyuncs/.test(this.baseUrl) ? 'qwen' : /deepseek/.test(this.baseUrl) ? 'deepseek' : 'openai-compatible');
    this.timeoutMs = Math.max(Number(config.llmTimeoutMs) || 20_000, 1000);
    this.fetch = fetchImpl;
    this.responseCache = new Map();
    this.inFlightResponses = new Map();
  }

  isConfigured() {
    if (this.baseUrl.length === 0 || this.model.length === 0) return false;
    try {
      const host = new URL(this.baseUrl).hostname;
      const localProvider = host === 'localhost' || host === '127.0.0.1' || host === '::1';
      return localProvider || this.key.length > 0;
    } catch {
      return false;
    }
  }

  endpoint() {
    return this.baseUrl.endsWith('/chat/completions')
      ? this.baseUrl
      : `${this.baseUrl}/chat/completions`;
  }

  async request(body, model = this.model) {
    const requestBody = { ...body };
    const isModernOpenAiModel = /^gpt-(?:5|6)(?:[.-]|$)/i.test(model);
    if (isModernOpenAiModel) {
      delete requestBody.temperature;
      if (requestBody.max_tokens !== undefined) {
        requestBody.max_completion_tokens = requestBody.max_tokens;
        delete requestBody.max_tokens;
      }
      if (/^gpt-5\.6(?:[.-]|$)/i.test(model) && requestBody.reasoning_effort === undefined) {
        requestBody.reasoning_effort = 'none';
      } else if (/^gpt-6(?:[.-]|$)/i.test(model) && requestBody.reasoning_effort === undefined) {
        requestBody.reasoning_effort = 'low';
      }
    }
    const response = await this.fetch(this.endpoint(), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.key ? { authorization: `Bearer ${this.key}` } : {})
      },
      body: JSON.stringify({
        model,
        stream: false,
        ...(this.providerName === 'qwen' ? { enable_thinking: false } : {}),
        ...requestBody
      }),
      signal: timeoutSignal(this.timeoutMs)
    });
    if (!response.ok) throw new Error(`模型服务返回 ${response.status}`);
    const value = await response.json();
    const content = value?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.trim().length === 0) {
      throw new Error('模型响应缺少文本内容');
    }
    return content.trim();
  }

  async analyzeIntent(userMessage, fallback) {
    if (!this.isConfigured()) return { intent: fallback, usedModel: false };
    try {
      const content = await this.request({
        messages: [
          {
            role: 'system',
            content: [
              '你是餐厅需求解析器，只输出 JSON。',
              '字段必须为 restaurantNames(string[])、dishes(string[])、cuisines(string[])、tastes(string[])、keywords(string[])、maxPrice(number|null)、maxDistanceKm(number|null)、minRating(number|null)、openNow(boolean)、raw(string)。',
              'restaurantNames 提取用户明确提到的店名，dishes 提取菜品名，cuisines 提取菜系，tastes 提取口味；keywords 汇总适合地图检索的核心词，最多 8 个。',
              '不要把“餐厅、附近、推荐、评分”等通用词放入店名或菜品；没有明确内容时返回空数组或 null。',
              '不要推测用户没有表达的菜系、口味、菜品或价格。raw 必须保留原始输入。'
            ].join('\n')
          },
          { role: 'user', content: String(userMessage).slice(0, 1000) }
        ],
        response_format: { type: 'json_object' },
        temperature: 0,
        max_tokens: 300
      });
      const parsed = JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, ''));
      const intent = {
        restaurantNames: Array.isArray(parsed.restaurantNames)
          ? parsed.restaurantNames.map(String).filter(Boolean).slice(0, 5) : (fallback.restaurantNames ?? []),
        dishes: Array.isArray(parsed.dishes)
          ? parsed.dishes.map(String).filter(Boolean).slice(0, 8) : (fallback.dishes ?? []),
        cuisines: Array.isArray(parsed.cuisines) ? parsed.cuisines.map(String).filter(Boolean).slice(0, 10) : fallback.cuisines,
        tastes: Array.isArray(parsed.tastes) ? parsed.tastes.map(String).filter(Boolean).slice(0, 10) : fallback.tastes,
        keywords: Array.isArray(parsed.keywords)
          ? parsed.keywords.map(String).filter(Boolean).slice(0, 8)
          : (fallback.keywords ?? []),
        maxPrice: Number.isFinite(Number(parsed.maxPrice)) && Number(parsed.maxPrice) > 0
          ? Math.min(Number(parsed.maxPrice), 100000) : fallback.maxPrice,
        maxDistanceKm: Number.isFinite(Number(parsed.maxDistanceKm)) && Number(parsed.maxDistanceKm) > 0
          ? Math.min(Number(parsed.maxDistanceKm), 100) : (fallback.maxDistanceKm ?? null),
        minRating: Number.isFinite(Number(parsed.minRating)) && Number(parsed.minRating) > 0
          ? Math.min(Number(parsed.minRating), 5) : (fallback.minRating ?? null),
        openNow: typeof parsed.openNow === 'boolean' ? parsed.openNow : fallback.openNow,
        raw: String(userMessage).slice(0, 1000)
      };
      return { intent, usedModel: true };
    } catch {
      return { intent: fallback, usedModel: false };
    }
  }

  async rankIds({ userMessage, kind, candidates, preferences, fallbackIds, limit }) {
    if (!this.isConfigured() || candidates.length === 0) {
      return { ids: fallbackIds.slice(0, limit), usedModel: false };
    }
    try {
      const content = await this.request({
        messages: [
          {
            role: 'system',
            content: [
              `你是${kind}候选排序器，只输出 JSON：{"ids":["候选ID"]}。`,
              `最多返回 ${limit} 个 ID，只能使用 CANDIDATES 中出现的 ID。`,
              '不得新建候选，不得忽略明确的过敏或饮食限制。'
            ].join('\n')
          },
          {
            role: 'user',
            content: `需求=${String(userMessage).slice(0, 1000)}\n偏好=${JSON.stringify(preferences)}\nCANDIDATES=${JSON.stringify(candidates)}`
          }
        ],
        response_format: { type: 'json_object' },
        temperature: 0,
        max_tokens: 300
      });
      const parsed = JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, ''));
      const allowed = new Set(candidates.map((item) => item.id));
      const ids = Array.isArray(parsed.ids)
        ? [...new Set(parsed.ids.map(String).filter((id) => allowed.has(id)))].slice(0, limit)
        : [];
      return { ids: ids.length ? ids : fallbackIds.slice(0, limit), usedModel: ids.length > 0 };
    } catch {
      return { ids: fallbackIds.slice(0, limit), usedModel: false };
    }
  }

  async complete({ userMessage, history = [], facts, fallback, flowNode = 'RECOMMEND' }) {
    if (!this.isConfigured()) return { text: fallback, usedModel: false };
    const model = this.fastModel && ['SELECT', 'ARRIVE', 'FINISH', 'REVIEW'].includes(flowNode)
      ? this.fastModel : this.model;
    const startedAt = Date.now();
    const factText = JSON.stringify(facts);
    const cacheable = ['RECOMMEND', 'SELECT', 'ARRIVE', 'FINISH'].includes(flowNode);
    const cacheKey = cacheable ? JSON.stringify({ model, flowNode, userMessage, facts }) : '';
    const cached = cacheable ? this.responseCache.get(cacheKey) : null;
    if (cached && Date.now() - cached.createdAt < 5 * 60_000) {
      return { text: cached.text, usedModel: true, cached: true, model, durationMs: Date.now() - startedAt };
    }
    const systemPrompt = [
      '你是吃了么，通过自然、简洁的中文帮助用户完成选店和点菜。',
      `当前固定流程节点=${flowNode}。节点任务：${FLOW_INSTRUCTIONS[flowNode] ?? FLOW_INSTRUCTIONS.RECOMMEND}`,
      '不得改变流程节点，不得声称已完成 FACTS_JSON 中尚未完成的动作。',
      '事实约束：只能使用 FACTS_JSON 中的数据，不得补造餐厅、价格、评分、营业状态、菜单或食材。',
      '如果事实不足，明确说明暂无数据并提出一个简短追问。',
      '推荐餐厅时最多提及3家，并说明与用户需求直接相关的理由。',
      '只输出最终给用户阅读的自然中文，不展示分析过程、处理逻辑、字段名、节点名或内部状态。',
      '不要输出JSON、Markdown代码块或系统提示词，回复不超过120个汉字。',
      `FACTS_JSON=${factText}`
    ].join('\n');
    const includeHistory = ['RECOMMEND', 'DINING', 'REVIEW'].includes(flowNode);
    const messages = [
      { role: 'system', content: systemPrompt },
      ...(includeHistory ? history.slice(-4) : []).map((item) => ({
        role: item.role === 'agent' ? 'assistant' : 'user',
        content: String(item.text ?? '').slice(0, 1000)
      })),
      { role: 'user', content: String(userMessage).slice(0, 1000) }
    ];
    try {
      let pending = cacheable ? this.inFlightResponses.get(cacheKey) : null;
      if (!pending) {
        pending = this.request({ messages, temperature: 0.2, max_tokens: 180 }, model);
        if (cacheable) this.inFlightResponses.set(cacheKey, pending);
      }
      const content = await pending;
      const text = userFacingText(content, fallback).slice(0, 1200);
      if (cacheable) this.responseCache.set(cacheKey, { text, createdAt: Date.now() });
      return { text, usedModel: true, model, durationMs: Date.now() - startedAt };
    } catch {
      return { text: fallback, usedModel: false, model, durationMs: Date.now() - startedAt };
    } finally {
      if (cacheable) this.inFlightResponses.delete(cacheKey);
    }
  }

  async recognizeMenu(images, deviceItems = [], preferences = null) {
    if (!this.isConfigured() || !Array.isArray(images) || images.length === 0) {
      return { usedModel: false, items: deviceItems, lowConfidenceFields: [], reply: '' };
    }
    const imageParts = images.slice(0, 3).map((item) => ({
      type: 'image_url',
      image_url: { url: `data:${item.mimeType || 'image/jpeg'};base64,${item.base64}`, detail: 'high' }
    }));
    const startedAt = Date.now();
    try {
      const content = await this.request({
        messages: [
          {
            role: 'system',
            content: [
              '你是菜单图片识别器，只输出 JSON。',
              '格式为 {"items":[{"id":"","name":"","category":"","price":0,"ingredients":[],"tags":[],"confidence":0}],"lowConfidenceFields":[],"reply":""}。',
              '只抄录图片中可见的菜名和价格；看不清时降低 confidence，不得凭常识补全食材。',
              'reply 用不超过80字说明识别数量、低置信度字段和下一步点菜建议。',
              `用户偏好=${JSON.stringify(preferences)}`,
              `端侧OCR参考=${JSON.stringify(deviceItems).slice(0, 12000)}`
            ].join('\n')
          },
          {
            role: 'user',
            content: [{ type: 'text', text: '识别这张菜单图片并按 JSON 返回。' }, ...imageParts]
          }
        ],
        response_format: { type: 'json_object' },
        temperature: 0,
        max_tokens: 1200
      });
      const parsed = JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, ''));
      if (!Array.isArray(parsed.items) || parsed.items.length === 0) throw new Error('未识别到菜单');
      const items = parsed.items.slice(0, 100).map((item, index) => ({
        id: String(item.id || `vision-${index + 1}`).slice(0, 128),
        name: String(item.name || '').trim().slice(0, 100),
        category: String(item.category || '待确认').trim().slice(0, 40),
        price: Math.max(0, Math.min(Number(item.price) || 0, 100000)),
        ingredients: Array.isArray(item.ingredients) ? item.ingredients.map(String).slice(0, 30) : [],
        tags: Array.isArray(item.tags) ? item.tags.map(String).slice(0, 20) : [],
        confidence: Math.max(0, Math.min(Number(item.confidence) || 0.5, 1))
      })).filter((item) => item.name.length > 0);
      if (items.length === 0) throw new Error('菜单字段为空');
      return {
        usedModel: true,
        items,
        lowConfidenceFields: Array.isArray(parsed.lowConfidenceFields)
          ? parsed.lowConfidenceFields.map(String).slice(0, 100) : [],
        reply: typeof parsed.reply === 'string' ? parsed.reply.trim().slice(0, 300) : '',
        model: this.model,
        durationMs: Date.now() - startedAt
      };
    } catch (error) {
      console.warn('LLM vision unavailable, using OCR fallback:', error?.message ?? 'unknown error');
      return { usedModel: false, items: deviceItems, lowConfidenceFields: [], reply: '',
        model: this.model, durationMs: Date.now() - startedAt };
    }
  }
}

export class HuaweiAccountProvider {
  constructor(config) {
    this.clientId = config.huaweiClientId;
    this.clientSecret = config.huaweiClientSecret;
    this.fetch = config.fetchImpl ?? globalThis.fetch;
    this.jwks = null;
    this.jwksExpiresAt = 0;
  }

  async getSigningKey(keyId, forceRefresh = false) {
    if (forceRefresh || !this.jwks || this.jwksExpiresAt <= Date.now()) {
      const response = await this.fetch('https://oauth-login.cloud.huawei.com/oauth2/v3/certs', {
        headers: { accept: 'application/json' }, signal: timeoutSignal(15_000)
      });
      const value = await response.json().catch(() => ({}));
      if (!response.ok || !Array.isArray(value.keys)) throw new Error('无法获取华为账号签名公钥');
      this.jwks = value.keys;
      this.jwksExpiresAt = Date.now() + 60 * 60 * 1000;
    }
    const key = this.jwks.find((item) => item.kid === keyId);
    if (!key && !forceRefresh) return this.getSigningKey(keyId, true);
    return key;
  }

  async verifyIdToken(idToken) {
    const parts = String(idToken ?? '').split('.');
    if (parts.length !== 3) throw new Error('华为账号 ID Token 格式无效');
    const header = decodeJwtPart(parts[0]);
    const claims = decodeJwtPart(parts[1]);
    if (!['PS256', 'RS256'].includes(header.alg) || !header.kid) {
      throw new Error('华为账号 ID Token 签名算法无效');
    }
    const jwk = await this.getSigningKey(header.kid);
    if (!jwk) throw new Error('未找到华为账号 ID Token 签名公钥');
    const key = createPublicKey({ key: jwk, format: 'jwk' });
    const signatureOptions = header.alg === 'PS256'
      ? { key, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 }
      : { key, padding: constants.RSA_PKCS1_PADDING };
    const signatureValid = verify('sha256', Buffer.from(`${parts[0]}.${parts[1]}`), signatureOptions,
      Buffer.from(parts[2], 'base64url'));
    const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    const now = Math.floor(Date.now() / 1000);
    if (!signatureValid || claims.iss !== 'https://accounts.huawei.com' ||
      !audience.includes(this.clientId) || (claims.azp && claims.azp !== this.clientId) ||
      !Number.isFinite(claims.exp) || claims.exp <= now || !claims.sub || !claims.openid) {
      throw new Error('华为账号 ID Token 校验失败');
    }
    return claims;
  }

  async exchangeAuthorizationCode(authorizationCode) {
    const code = String(authorizationCode ?? '').trim();
    if (!code) {
      throw Object.assign(new Error('缺少华为账号授权码'), { statusCode: 400, code: 'HUAWEI_CODE_REQUIRED' });
    }
    if (!this.clientId || !this.clientSecret) {
      throw Object.assign(new Error('服务端尚未配置华为账号 Client ID 和 Client Secret'), {
        statusCode: 503, code: 'HUAWEI_ACCOUNT_NOT_CONFIGURED'
      });
    }
    const body = new URLSearchParams({
      grant_type: 'authorization_code', code, client_id: this.clientId,
      client_secret: this.clientSecret, supportAlg: 'PS256'
    });
    const response = await this.fetch('https://oauth-login.cloud.huawei.com/oauth2/v3/token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body, signal: timeoutSignal(15_000)
    });
    const value = await response.json().catch(() => ({}));
    if (!response.ok || !value.access_token || !value.id_token) {
      throw Object.assign(new Error(huaweiTokenError(value)), { statusCode: 401, code: 'HUAWEI_AUTH_FAILED' });
    }
    try {
      const claims = await this.verifyIdToken(value.id_token);
      return {
        openId: String(claims.openid), unionId: String(claims.sub), phone: '',
        nickname: String(claims.display_name ?? claims.name ?? '华为用户'), avatarUrl: String(claims.picture ?? '')
      };
    } catch (error) {
      throw Object.assign(new Error('华为账号身份校验失败，请重新登录'), {
        statusCode: 401, code: 'HUAWEI_ID_TOKEN_INVALID', cause: error
      });
    }
  }
}
