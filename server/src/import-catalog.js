import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { SqliteStore } from './store.js';

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function normalizeRestaurant(value, index, existingRestaurants) {
  const externalPoiId = String(value.externalPoiId ?? '').trim();
  const requestedId = String(value.id ?? '').trim();
  const existing = existingRestaurants.find((item) =>
    (externalPoiId && item.externalPoiId === externalPoiId) || (requestedId && item.id === requestedId));
  const id = (existing?.id ?? requestedId) || (externalPoiId ? `amap:${externalPoiId}` : '');
  const name = String(value.name ?? existing?.name ?? '').trim();
  if (!id || !name) throw new Error(`第 ${index + 1} 家餐厅缺少 id/name，且无法按 externalPoiId 关联`);
  const menu = Array.isArray(value.menu) ? value.menu.map((item, menuIndex) => {
    const itemName = String(item.name ?? '').trim();
    if (!itemName) throw new Error(`${name} 的第 ${menuIndex + 1} 道菜缺少 name`);
    return {
      id: String(item.id ?? `${id}:dish:${menuIndex + 1}`),
      name: itemName,
      category: String(item.category ?? '待分类'),
      price: Math.max(0, Number(item.price) || 0),
      ingredients: Array.isArray(item.ingredients) ? item.ingredients.map(String) : [],
      tags: Array.isArray(item.tags) ? item.tags.map(String) : [],
      confidence: 1
    };
  }) : [];
  return {
    ...existing,
    id,
    externalPoiId: externalPoiId || existing?.externalPoiId || '',
    source: existing?.source ?? 'manual',
    name,
    address: String(value.address ?? existing?.address ?? '地址待补充'),
    location: value.location ?? existing?.location ?? { longitude: 0, latitude: 0 },
    distanceMeters: Math.max(0, Number(value.distanceMeters ?? existing?.distanceMeters) || 0),
    cuisines: Array.isArray(value.cuisines) && value.cuisines.length
      ? value.cuisines.map(String) : existing?.cuisines ?? ['餐饮服务'],
    tags: Array.isArray(value.tags) ? value.tags.map(String) : existing?.tags ?? [],
    averagePrice: Math.max(0, Number(value.averagePrice ?? existing?.averagePrice) || 0),
    rating: Math.max(0, Math.min(Number(value.rating ?? existing?.rating) || 0, 5)),
    isOpen: value.isOpen === undefined ? existing?.isOpen ?? false : Boolean(value.isOpen),
    openStatusKnown: value.openStatusKnown === undefined
      ? existing?.openStatusKnown ?? false : value.openStatusKnown === true,
    openingHours: String(value.openingHours ?? existing?.openingHours ?? ''),
    imageUrl: existing?.imageUrl ?? '',
    reviewSummary: existing?.reviewSummary ?? '菜单由项目方提供并导入。',
    menu,
    dataUpdatedAt: new Date().toISOString()
  };
}

const inputPath = process.argv[2];
if (!inputPath) {
  fail('用法：npm run import:catalog -- ./catalog/restaurants.example.json');
} else {
  try {
    const document = JSON.parse(await readFile(resolve(inputPath), 'utf8'));
    const values = Array.isArray(document) ? document : document.restaurants;
    if (!Array.isArray(values) || values.length === 0) throw new Error('文件中没有 restaurants 数组');
    const store = await new SqliteStore(resolve(process.env.DATA_FILE ?? './data/restaurant-agent.sqlite')).init();
    const existingRestaurants = store.snapshot().restaurants;
    const restaurants = values.map((value, index) => normalizeRestaurant(value, index, existingRestaurants));
    await store.upsertRestaurants(restaurants);
    console.log(`已导入 ${restaurants.length} 家餐厅、${restaurants.reduce((sum, item) => sum + item.menu.length, 0)} 道菜。`);
  } catch (error) {
    fail(`导入失败：${error.message}`);
  }
}
