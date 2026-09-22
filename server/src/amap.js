const RESTAURANT_TYPE = '050000';

function textValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function splitValues(value) {
  return textValue(value).split(/[,，;；|]/).map((item) => item.trim()).filter(Boolean);
}

function numberValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizePhotos(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const title = textValue(item?.title);
    return {
      title,
      url: textValue(item?.url),
      menuCandidate: /菜单|菜谱|价目表|点菜单/.test(title)
    };
  }).filter((item) => /^https:\/\//i.test(item.url)).slice(0, 12);
}

function openingState(openingHours, now = new Date()) {
  if (!openingHours) return { known: false, open: false };
  const minutes = now.getHours() * 60 + now.getMinutes();
  const ranges = [...openingHours.matchAll(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/g)];
  if (ranges.length === 0) return { known: false, open: false };
  const open = ranges.some((match) => {
    const start = Number(match[1]) * 60 + Number(match[2]);
    const end = Number(match[3]) * 60 + Number(match[4]);
    return end >= start ? minutes >= start && minutes <= end : minutes >= start || minutes <= end;
  });
  return { known: true, open };
}

function keywordFor(query) {
  const cuisines = ['江浙菜', '杭帮菜', '川菜', '潮汕菜', '素食', '鲁菜', '粤菜', '湘菜', '火锅', '烧烤'];
  const text = textValue(query);
  const cuisine = cuisines.find((item) => text.includes(item));
  if (cuisine) return cuisine;
  const cleaned = text.replace(/推荐|搜索|查找|帮我|想吃|想找|换一家|换个|附近|南京市?|餐厅|美食|人均|以内|元|营业/g, '').trim();
  return cleaned.length > 0 && cleaned.length <= 24 ? cleaned : '餐厅';
}

function normalizePoi(poi, now = new Date()) {
  const business = poi.business && typeof poi.business === 'object' ? poi.business : {};
  const openingHours = textValue(business.opentime_today) || textValue(business.opentime_week);
  const status = openingState(openingHours, now);
  const typeParts = textValue(poi.type).split(';').filter(Boolean);
  const businessTags = splitValues(business.tag);
  const cuisine = textValue(poi.atag) || typeParts.at(-1) || '餐饮服务';
  const coordinates = textValue(poi.location).split(',').map(Number);
  const address = textValue(poi.address) || [poi.pname, poi.cityname, poi.adname].map(textValue).filter(Boolean).join('');
  const photos = normalizePhotos(poi.photos);
  return {
    id: `amap:${textValue(poi.id)}`,
    externalPoiId: textValue(poi.id),
    source: 'amap',
    name: textValue(poi.name) || '未命名餐厅',
    address: address || '地址待补充',
    location: { longitude: coordinates[0] || 0, latitude: coordinates[1] || 0 },
    distanceMeters: numberValue(poi.distance),
    cuisines: [cuisine],
    tags: businessTags.length ? businessTags.slice(0, 8) : typeParts.slice(-2),
    averagePrice: numberValue(business.cost),
    rating: numberValue(business.rating),
    isOpen: status.open,
    openStatusKnown: status.known,
    openingHours,
    telephone: textValue(business.tel),
    imageUrl: photos[0]?.url ?? '',
    images: photos,
    reviewSummary: '餐厅基础信息来自高德地图 Web 服务 API。',
    menu: [],
    dataUpdatedAt: now.toISOString()
  };
}

export class AmapPlaceProvider {
  constructor(config, fetchImpl = globalThis.fetch) {
    this.key = config.amapWebKey ?? '';
    this.region = config.amapDefaultRegion ?? '南京市';
    this.location = config.amapLocation ?? '';
    this.radius = Math.min(Math.max(Number(config.amapRadiusMeters) || 5000, 100), 50000);
    this.cacheTtlMs = Math.max(Number(config.amapCacheTtlSeconds) || 300, 0) * 1000;
    this.cache = new Map();
    this.fetch = fetchImpl;
  }

  isConfigured() {
    return this.key.length > 0;
  }

  async search(query, limit = 20, userLocation = null, page = 1) {
    if (!this.isConfigured()) return [];
    const keyword = keywordFor(String(query ?? ''));
    const suppliedLocation = userLocation && Number.isFinite(Number(userLocation.longitude)) &&
      Number.isFinite(Number(userLocation.latitude))
      ? `${Number(userLocation.longitude).toFixed(6)},${Number(userLocation.latitude).toFixed(6)}` : '';
    const searchLocation = suppliedLocation || this.location;
    const pageNumber = Math.min(Math.max(Number(page) || 1, 1), 100);
    const cacheKey = `${searchLocation}|${this.region}|${keyword}|${limit}|${pageNumber}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return structuredClone(cached.items);
    const nearby = /^-?\d{1,3}\.\d+,-?\d{1,2}\.\d+$/.test(searchLocation);
    const url = new URL(nearby
      ? 'https://restapi.amap.com/v5/place/around'
      : 'https://restapi.amap.com/v5/place/text');
    url.searchParams.set('key', this.key);
    url.searchParams.set('keywords', keyword);
    url.searchParams.set('types', RESTAURANT_TYPE);
    url.searchParams.set('show_fields', 'business,photos');
    url.searchParams.set('page_size', String(Math.min(Math.max(limit, 1), 25)));
    url.searchParams.set('page_num', String(pageNumber));
    url.searchParams.set('output', 'json');
    if (nearby) {
      url.searchParams.set('location', searchLocation);
      url.searchParams.set('radius', String(this.radius));
      url.searchParams.set('sortrule', 'distance');
    } else if (this.region) {
      url.searchParams.set('region', this.region);
      url.searchParams.set('city_limit', 'true');
    }

    const response = await this.fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`高德 POI 请求失败（${response.status}）`);
    const payload = await response.json();
    if (payload.status !== '1') throw new Error(`高德 POI 返回错误：${payload.info || payload.infocode || '未知错误'}`);
    const items = Array.isArray(payload.pois)
      ? payload.pois.filter((poi) => poi?.id).map((poi) => normalizePoi(poi)) : [];
    this.cache.set(cacheKey, { items, expiresAt: Date.now() + this.cacheTtlMs });
    return structuredClone(items);
  }
}

export const amapInternals = { normalizePoi, openingState, keywordFor, normalizePhotos };
