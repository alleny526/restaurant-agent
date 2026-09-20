import { Restaurant } from './Models';

export const DEMO_RESTAURANTS: Restaurant[] = [
  {
    id: 'rest-lanxi',
    name: '兰溪小馆',
    address: '科技园南区 18 号',
    distanceKm: 0.62,
    cuisine: '江浙菜',
    tags: ['清淡', '时令菜', '安静'],
    pricePerPerson: 96,
    rating: 4.7,
    open: true,
    reason: '清淡度与江浙菜需求高度匹配，距离较近；推荐理由来自商家标签与菜单。',
    menuAvailable: true,
    menu: [
      { id: 'dish-1', name: '清蒸鲈鱼', category: '热菜', price: 88, ingredients: ['鲈鱼', '葱', '姜'], confidence: 1 },
      { id: 'dish-2', name: '龙井虾仁', category: '热菜', price: 78, ingredients: ['虾仁', '龙井茶'], confidence: 1 }
    ]
  },
  {
    id: 'rest-heshan',
    name: '荷山宴',
    address: '湖滨路 66 号',
    distanceKm: 1.4,
    cuisine: '杭帮菜',
    tags: ['清淡', '适合聚餐', '临湖'],
    pricePerPerson: 138,
    rating: 4.8,
    open: true,
    reason: '杭帮菜与清淡偏好匹配，评分较高，适合多人就餐。',
    menuAvailable: true,
    menu: [
      { id: 'dish-3', name: '西湖醋鱼', category: '热菜', price: 108, ingredients: ['草鱼', '醋'], confidence: 1 }
    ]
  },
  {
    id: 'rest-suyuan',
    name: '素源里',
    address: '创意街 9 号',
    distanceKm: 0.86,
    cuisine: '素食',
    tags: ['清淡', '无肉', '低负担'],
    pricePerPerson: 72,
    rating: 4.6,
    open: true,
    reason: '整体口味清淡，适合希望低负担用餐的场景。',
    menuAvailable: false,
    menu: []
  },
  {
    id: 'rest-chuanyu',
    name: '川渝里巷',
    address: '中心广场 B1 层',
    distanceKm: 0.98,
    cuisine: '川菜',
    tags: ['麻辣', '下饭', '热闹'],
    pricePerPerson: 82,
    rating: 4.5,
    open: true,
    reason: '适合明确想吃麻辣川菜的用户。',
    menuAvailable: false,
    menu: []
  }
];
