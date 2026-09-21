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

export class VisionProvider {
  constructor(config) {
    this.url = config.visionApiUrl;
    this.key = config.visionApiKey;
    this.demoMode = config.demoMode;
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

export class ExplanationProvider {
  constructor(config) {
    this.url = config.llmApiUrl;
    this.key = config.llmApiKey;
  }

  async summarizeGrounded(facts, fallback) {
    if (!this.url) return fallback;
    try {
      const response = await fetch(this.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.key ? { authorization: `Bearer ${this.key}` } : {})
        },
        body: JSON.stringify({
          instruction: '仅根据 facts 用中文生成不超过80字的推荐解释，不得添加商家事实。',
          facts
        }),
        signal: timeoutSignal(8_000)
      });
      if (!response.ok) return fallback;
      const value = await response.json();
      return typeof value.text === 'string' && value.text.length > 0 ? value.text : fallback;
    } catch {
      return fallback;
    }
  }
}

export class HuaweiAccountProvider {
  constructor(config) {
    this.clientId = config.huaweiClientId;
    this.clientSecret = config.huaweiClientSecret;
    this.fetch = config.fetchImpl ?? fetch;
    this.jwks = null;
    this.jwksExpiresAt = 0;
  }

  async getSigningKey(keyId, forceRefresh = false) {
    if (forceRefresh || !this.jwks || this.jwksExpiresAt <= Date.now()) {
      const response = await this.fetch('https://oauth-login.cloud.huawei.com/oauth2/v3/certs', {
        headers: { accept: 'application/json' },
        signal: timeoutSignal(15_000)
      });
      const value = await response.json().catch(() => ({}));
      if (!response.ok || !Array.isArray(value.keys)) {
        throw new Error('无法获取华为账号签名公钥');
      }
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
    const signatureOptions = header.alg === 'PS256' ? {
      key, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32
    } : { key, padding: constants.RSA_PKCS1_PADDING };
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
      grant_type: 'authorization_code',
      code,
      client_id: this.clientId,
      client_secret: this.clientSecret,
      supportAlg: 'PS256'
    });
    const response = await this.fetch('https://oauth-login.cloud.huawei.com/oauth2/v3/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body,
      signal: timeoutSignal(15_000)
    });
    const value = await response.json().catch(() => ({}));
    if (!response.ok || !value.access_token || !value.id_token) {
      throw Object.assign(new Error(huaweiTokenError(value)), {
        statusCode: 401, code: 'HUAWEI_AUTH_FAILED', cause: value
      });
    }
    try {
      const claims = await this.verifyIdToken(value.id_token);
      return {
        openId: String(claims.openid),
        unionId: String(claims.sub),
        phone: '',
        nickname: String(claims.display_name ?? claims.name ?? '华为用户'),
        avatarUrl: String(claims.picture ?? '')
      };
    } catch (error) {
      throw Object.assign(new Error('华为账号身份校验失败，请重新登录'), {
        statusCode: 401, code: 'HUAWEI_ID_TOKEN_INVALID', cause: error
      });
    }
  }
}
