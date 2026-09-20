function timeoutSignal(milliseconds) {
  return AbortSignal.timeout(milliseconds);
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
