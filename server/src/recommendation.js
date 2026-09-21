const CUISINES = ['江浙菜', '杭帮菜', '川菜', '潮汕菜', '素食', '鲁菜', '北方菜', '融合菜'];
const TASTES = ['清淡', '麻辣', '咸鲜', '鲜味', '低负担'];

function includesAny(text, values) {
  return values.filter((value) => text.includes(value));
}

export function parseDiningIntent(text) {
  const priceMatch = text.match(/(?:人均|预算|每人)[^0-9]{0,4}(\d{2,4})/);
  const cuisines = includesAny(text, CUISINES);
  const tastes = includesAny(text, TASTES);
  return {
    cuisines,
    tastes,
    keywords: [...new Set([...cuisines, ...tastes])],
    maxPrice: priceMatch ? Number(priceMatch[1]) : null,
    openNow: !text.includes('稍后') && !text.includes('明天'),
    raw: text
  };
}

function restaurantHasRestrictedIngredient(restaurant, restrictions) {
  if (!restrictions?.length || !restaurant.menu?.length) return false;
  return restaurant.menu.some((dish) => dish.ingredients.some((ingredient) =>
    restrictions.some((restriction) => ingredient.includes(restriction) || restriction.includes(ingredient))));
}

export function recommendRestaurants(restaurants, intent, profile = null, limit = 5) {
  const restrictions = profile?.personalizationEnabled ? profile.dietaryRestrictions : [];
  const candidates = restaurants
    .filter((restaurant) => !intent.openNow || restaurant.openStatusKnown === false || restaurant.isOpen)
    .filter((restaurant) => intent.maxPrice === null ||
      (restaurant.averagePrice > 0 && restaurant.averagePrice <= intent.maxPrice))
    .filter((restaurant) => !restaurantHasRestrictedIngredient(restaurant, restrictions))
    .map((restaurant) => {
      const cuisineHits = restaurant.cuisines.filter((value) => intent.cuisines.includes(value)).length;
      const tasteHits = restaurant.tags.filter((value) => intent.tastes.includes(value)).length;
      const profileCuisineHits = profile?.personalizationEnabled
        ? restaurant.cuisines.filter((value) => profile.cuisinePreferences.includes(value)).length : 0;
      const profileTasteHits = profile?.personalizationEnabled
        ? restaurant.tags.filter((value) => profile.tastePreferences.includes(value)).length : 0;
      const dataCompleteness = restaurant.menu.length > 0 ? 1 : 0;
      const distanceScore = restaurant.distanceMeters > 0 ? Math.max(0, 3 - restaurant.distanceMeters / 1000) : 0;
      const score = cuisineHits * 8 + tasteHits * 6 + profileCuisineHits * 3 + profileTasteHits * 2 +
        restaurant.rating * 1.5 + distanceScore + dataCompleteness;
      const reasons = [];
      if (cuisineHits > 0) reasons.push(`菜系匹配${restaurant.cuisines.filter((v) => intent.cuisines.includes(v)).join('、')}`);
      if (tasteHits > 0) reasons.push(`口味标签匹配${restaurant.tags.filter((v) => intent.tastes.includes(v)).join('、')}`);
      if (restaurant.distanceMeters > 0 && restaurant.distanceMeters < 1000) reasons.push('距离较近');
      if (restaurant.rating >= 4.7) reasons.push('商家评分较高');
      if (reasons.length === 0) reasons.push('综合评分、距离与数据完整度较优');
      const featureTags = restaurant.tags.slice(0, 4);
      const details = [];
      if (featureTags.length > 0) details.push(`热门特色：${featureTags.join('、')}`);
      else if (restaurant.cuisines.length > 0) details.push(`主营${restaurant.cuisines.slice(0, 2).join('、')}`);
      if (restaurant.openingHours) details.push(`营业时间 ${restaurant.openingHours}`);
      return {
        ...restaurant,
        score,
        recommendationReason: `${reasons.join('，')}。${details.join('；')}${details.length ? '。' : ''}`
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ score, ...restaurant }) => restaurant);
  return candidates;
}

export function filterRestaurants(restaurants, params) {
  const query = (params.query ?? '').trim().toLowerCase();
  const cuisine = (params.cuisine ?? '').trim();
  const taste = (params.taste ?? '').trim();
  const openNow = params.openNow === 'true';
  const maxPrice = params.maxPrice ? Number(params.maxPrice) : null;
  return restaurants.filter((restaurant) => {
    const haystack = [restaurant.name, restaurant.address, ...restaurant.cuisines, ...restaurant.tags].join(' ').toLowerCase();
    return (!query || haystack.includes(query)) &&
      (!cuisine || restaurant.cuisines.includes(cuisine)) &&
      (!taste || restaurant.tags.includes(taste)) &&
      (!openNow || restaurant.openStatusKnown === false || restaurant.isOpen) &&
      (maxPrice === null || (restaurant.averagePrice > 0 && restaurant.averagePrice <= maxPrice));
  });
}

export function suggestDishes(menu, profile = null, limit = 4) {
  const restrictions = profile?.personalizationEnabled ? profile.dietaryRestrictions : [];
  const tastes = profile?.personalizationEnabled ? profile.tastePreferences : [];
  return menu
    .filter((dish) => !dish.ingredients.some((ingredient) => restrictions.some((item) => ingredient.includes(item))))
    .map((dish) => ({
      ...dish,
      _score: dish.confidence * 5 + dish.tags.filter((tag) => tastes.includes(tag)).length * 3 +
        (dish.tags.includes('清淡') ? 1 : 0)
    }))
    .sort((a, b) => b._score - a._score)
    .slice(0, limit)
    .map(({ _score, ...dish }) => dish);
}
