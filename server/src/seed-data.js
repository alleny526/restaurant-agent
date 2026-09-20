export const seedRestaurants = [
  {
    id: 'rest-lanxi',
    name: '兰溪小馆',
    address: '科技园南区 18 号',
    location: { latitude: 22.5354, longitude: 113.9421 },
    distanceMeters: 620,
    cuisines: ['江浙菜'],
    tags: ['清淡', '时令菜', '安静'],
    averagePrice: 96,
    rating: 4.7,
    isOpen: true,
    imageUrl: '',
    reviewSummary: '食材新鲜，口味清爽，午间可能需要等位。',
    menu: [
      { id: 'dish-lx-1', name: '清蒸鲈鱼', category: '热菜', price: 88, ingredients: ['鲈鱼', '葱', '姜'], tags: ['清淡', '高蛋白'], confidence: 1 },
      { id: 'dish-lx-2', name: '龙井虾仁', category: '热菜', price: 78, ingredients: ['虾仁', '龙井茶'], tags: ['清淡', '招牌'], confidence: 1 },
      { id: 'dish-lx-3', name: '上汤时蔬', category: '蔬菜', price: 36, ingredients: ['时令蔬菜', '高汤'], tags: ['清淡'], confidence: 1 }
    ],
    dataUpdatedAt: '2026-09-18T08:00:00.000Z'
  },
  {
    id: 'rest-heshan',
    name: '荷山宴',
    address: '湖滨路 66 号',
    location: { latitude: 22.5298, longitude: 113.9312 },
    distanceMeters: 1400,
    cuisines: ['杭帮菜', '江浙菜'],
    tags: ['清淡', '适合聚餐', '临湖'],
    averagePrice: 138,
    rating: 4.8,
    isOpen: true,
    imageUrl: '',
    reviewSummary: '环境舒适，菜品精致，周末建议提前到店。',
    menu: [
      { id: 'dish-hs-1', name: '西湖醋鱼', category: '热菜', price: 108, ingredients: ['草鱼', '醋'], tags: ['招牌'], confidence: 1 },
      { id: 'dish-hs-2', name: '宋嫂鱼羹', category: '羹汤', price: 48, ingredients: ['鱼肉', '香菇', '蛋'], tags: ['鲜香'], confidence: 1 }
    ],
    dataUpdatedAt: '2026-09-17T08:00:00.000Z'
  },
  {
    id: 'rest-suyuan',
    name: '素源里',
    address: '创意街 9 号',
    location: { latitude: 22.5321, longitude: 113.9498 },
    distanceMeters: 860,
    cuisines: ['素食', '融合菜'],
    tags: ['清淡', '无肉', '低负担'],
    averagePrice: 72,
    rating: 4.6,
    isOpen: true,
    imageUrl: '',
    reviewSummary: '调味克制，蔬菜选择丰富。',
    menu: [],
    dataUpdatedAt: '2026-09-16T08:00:00.000Z'
  },
  {
    id: 'rest-chuanyu',
    name: '川渝里巷',
    address: '中心广场 B1 层',
    location: { latitude: 22.5388, longitude: 113.9364 },
    distanceMeters: 980,
    cuisines: ['川菜'],
    tags: ['麻辣', '下饭', '热闹'],
    averagePrice: 82,
    rating: 4.5,
    isOpen: true,
    imageUrl: '',
    reviewSummary: '香辣突出，可按需调整辣度。',
    menu: [
      { id: 'dish-cy-1', name: '水煮牛肉', category: '热菜', price: 68, ingredients: ['牛肉', '辣椒', '花椒'], tags: ['麻辣'], confidence: 1 },
      { id: 'dish-cy-2', name: '清炒时蔬', category: '蔬菜', price: 26, ingredients: ['时令蔬菜'], tags: ['清淡'], confidence: 1 }
    ],
    dataUpdatedAt: '2026-09-18T08:00:00.000Z'
  },
  {
    id: 'rest-chaoxiang',
    name: '潮香小院',
    address: '海德二道 21 号',
    location: { latitude: 22.5266, longitude: 113.9451 },
    distanceMeters: 1800,
    cuisines: ['潮汕菜'],
    tags: ['鲜味', '清淡', '适合家庭'],
    averagePrice: 118,
    rating: 4.7,
    isOpen: true,
    imageUrl: '',
    reviewSummary: '汤品鲜甜，食材处理细致。',
    menu: [
      { id: 'dish-cx-1', name: '潮汕牛肉火锅', category: '火锅', price: 158, ingredients: ['牛肉', '牛骨汤'], tags: ['鲜味'], confidence: 1 },
      { id: 'dish-cx-2', name: '蚝烙', category: '小吃', price: 48, ingredients: ['生蚝', '鸡蛋', '薯粉'], tags: ['地方特色'], confidence: 1 }
    ],
    dataUpdatedAt: '2026-09-15T08:00:00.000Z'
  },
  {
    id: 'rest-beifang',
    name: '北方家宴',
    address: '深南大道 1018 号',
    location: { latitude: 22.5411, longitude: 113.9277 },
    distanceMeters: 2300,
    cuisines: ['鲁菜', '北方菜'],
    tags: ['咸鲜', '分量足', '适合聚餐'],
    averagePrice: 105,
    rating: 4.4,
    isOpen: false,
    imageUrl: '',
    reviewSummary: '分量充足，口味偏咸。',
    menu: [],
    dataUpdatedAt: '2026-09-12T08:00:00.000Z'
  }
];

export function createSeedState() {
  return {
    version: 1,
    restaurants: structuredClone(seedRestaurants),
    sessions: [],
    reviews: [],
    users: [],
    otpRequests: []
  };
}

