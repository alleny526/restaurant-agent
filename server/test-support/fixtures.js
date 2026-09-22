export const testRestaurants = [
  {
    id: 'rest-lanxi', source: 'test', name: '兰溪小馆', address: '测试路 1 号',
    location: { latitude: 32.04, longitude: 118.79 }, distanceMeters: 620,
    cuisines: ['江浙菜'], tags: ['清淡', '时令菜'], averagePrice: 96, rating: 4.7,
    isOpen: true, openStatusKnown: true, imageUrl: '', reviewSummary: '测试餐厅',
    menu: [{ id: 'dish-lx-1', name: '清蒸鲈鱼', category: '热菜', price: 88,
      ingredients: ['鲈鱼', '葱', '姜'], tags: ['清淡'], confidence: 1 }],
    dataUpdatedAt: '2026-09-18T08:00:00.000Z'
  },
  {
    id: 'rest-heshan', source: 'test', name: '荷山宴', address: '测试路 2 号',
    location: { latitude: 32.041, longitude: 118.791 }, distanceMeters: 700,
    cuisines: ['江浙菜', '杭帮菜'], tags: ['清淡', '聚餐'], averagePrice: 138, rating: 4.8,
    isOpen: true, openStatusKnown: true, imageUrl: '', reviewSummary: '测试餐厅', menu: [],
    dataUpdatedAt: '2026-09-18T08:00:00.000Z'
  },
  {
    id: 'rest-suyuan', source: 'test', name: '素源里', address: '测试路 3 号',
    location: { latitude: 32.05, longitude: 118.78 }, distanceMeters: 860,
    cuisines: ['江浙菜', '素食'], tags: ['清淡', '素食'], averagePrice: 72, rating: 4.6,
    isOpen: true, openStatusKnown: true, imageUrl: '', reviewSummary: '测试餐厅', menu: [],
    dataUpdatedAt: '2026-09-18T08:00:00.000Z'
  },
  {
    id: 'rest-chuanyu', source: 'test', name: '川味测试餐厅', address: '测试路 4 号',
    location: { latitude: 32.051, longitude: 118.781 }, distanceMeters: 900,
    cuisines: ['川菜'], tags: ['麻辣'], averagePrice: 82, rating: 4.5,
    isOpen: true, openStatusKnown: true, imageUrl: '', reviewSummary: '测试餐厅', menu: [],
    dataUpdatedAt: '2026-09-18T08:00:00.000Z'
  },
  {
    id: 'rest-chaoxiang', source: 'test', name: '潮味测试餐厅', address: '测试路 5 号',
    location: { latitude: 32.052, longitude: 118.782 }, distanceMeters: 1000,
    cuisines: ['潮汕菜'], tags: ['鲜味'], averagePrice: 118, rating: 4.7,
    isOpen: true, openStatusKnown: true, imageUrl: '', reviewSummary: '测试餐厅', menu: [],
    dataUpdatedAt: '2026-09-18T08:00:00.000Z'
  },
  {
    id: 'rest-beifang', source: 'test', name: '北方家宴', address: '测试路 6 号',
    location: { latitude: 32.06, longitude: 118.77 }, distanceMeters: 1200,
    cuisines: ['北方菜'], tags: ['家常菜'], averagePrice: 105, rating: 4.4,
    isOpen: false, openStatusKnown: true, imageUrl: '', reviewSummary: '测试餐厅', menu: [],
    dataUpdatedAt: '2026-09-18T08:00:00.000Z'
  }
];
