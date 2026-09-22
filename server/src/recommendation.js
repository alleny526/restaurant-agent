const CUISINES = ['江浙菜', '杭帮菜', '川菜', '潮汕菜', '素食', '鲁菜', '北方菜', '融合菜'];
const TASTES = ['清淡', '麻辣', '咸鲜', '鲜味', '低负担'];

function includesAny(text, values) {
  return values.filter((value) => text.includes(value));
}

export function parseDiningIntent(text) {
  const priceMatch = text.match(/(?:人均|预算|每人)[^0-9]{0,4}(\d{2,4})/);
  const distanceMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:公里|千米|km)\s*(?:内|以内|附近)?/i);
  const ratingMatch = text.match(/(?:评分|星级)[^0-9]{0,4}(\d(?:\.\d)?)\s*(?:分|星)?\s*(?:以上|及以上|起)?/);
  const cuisines = includesAny(text, CUISINES);
  const tastes = includesAny(text, TASTES);
  const quoted = [];
  const quotedPattern = /[“"「『]([^”"」』]{2,40})[”"」』]/g;
  let quotedMatch;
  while ((quotedMatch = quotedPattern.exec(text)) !== null) quoted.push(quotedMatch[1].trim());
  const named = text.match(/(?:去|找|搜|换到|叫|店名是)\s*(?:一家|那家|这家)?\s*([\u4e00-\u9fffA-Za-z0-9·]{2,30})(?=店|餐厅|饭店|酒楼|小馆|馆子|吃|，|。|$)/);
  const dishMatch = text.match(/(?:想吃|吃点|吃|来份|来一份|找有)\s*([\u4e00-\u9fffA-Za-z0-9·]{2,16})(?=的店|的餐厅|，|。|$)/);
  const restaurantNames = [...new Set(quoted.concat(named ? [named[1]] : []))];
  const explicitDishes = dishMatch && ![...cuisines, ...tastes].some((value) => dishMatch[1].includes(value))
    ? [dishMatch[1].replace(/^(点|些)/, '').trim()] : [];
  // A short standalone term such as “炒饼” or “拉面” is normally a dish
  // search. Keep it as a keyword as well so store names and AMap tags can match.
  const bareText = String(text ?? '').trim().replace(/[，。！？?]/gu, '');
  const genericBareTerms = /^(推荐|搜索|查找|餐厅|饭店|美食|附近|更多|换一家|换一批|再来一些)$/u;
  const conversationalPrefix = /^(?:想|要|请|帮|推荐|换|找|搜|附近|这道|什么|怎么|为什么)/u;
  const bareDish = /^[\u4e00-\u9fffA-Za-z0-9·]{2,16}$/u.test(bareText) &&
    !genericBareTerms.test(bareText) && !conversationalPrefix.test(bareText)
    ? bareText : '';
  // The same bare term is also a possible store name, which keeps name-only
  // AMap results useful when the store has no menu data yet.
  if (bareDish && !restaurantNames.includes(bareDish)) restaurantNames.push(bareDish);
  const dishes = [...new Set([...explicitDishes, ...(bareDish ? [bareDish] : [])])];
  return {
    cuisines,
    tastes,
    restaurantNames,
    dishes,
    keywords: [...new Set([...restaurantNames, ...dishes, ...cuisines, ...tastes])],
    maxPrice: priceMatch ? Number(priceMatch[1]) : null,
    maxDistanceKm: distanceMatch ? Number(distanceMatch[1]) : (text.includes('附近') ? 3 : null),
    minRating: ratingMatch ? Number(ratingMatch[1]) : null,
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
    .filter((restaurant) => intent.maxDistanceKm === null || intent.maxDistanceKm === undefined ||
      (restaurant.distanceMeters > 0 && restaurant.distanceMeters <= intent.maxDistanceKm * 1000))
    .filter((restaurant) => intent.minRating === null || intent.minRating === undefined ||
      restaurant.rating >= intent.minRating)
    .filter((restaurant) => !restaurantHasRestrictedIngredient(restaurant, restrictions))
    .map((restaurant) => {
      const cuisineHits = restaurant.cuisines.filter((value) => intent.cuisines.includes(value)).length;
      const tasteHits = restaurant.tags.filter((value) => intent.tastes.includes(value)).length;
      const nameText = restaurant.name.toLowerCase();
      const restaurantNameHits = (intent.restaurantNames ?? []).filter((value) =>
        nameText.includes(String(value).toLowerCase()) || String(value).toLowerCase().includes(nameText)).length;
      const dishText = [
        ...restaurant.tags,
        ...(restaurant.menu ?? []).map((item) => item.name),
        ...(restaurant.menu ?? []).flatMap((item) => item.ingredients ?? [])
      ].join(' ').toLowerCase();
      const dishHits = (intent.dishes ?? []).filter((value) => dishText.includes(String(value).toLowerCase())).length;
      const keywordHits = (intent.keywords ?? []).filter((value) =>
        [restaurant.name, ...restaurant.cuisines, ...restaurant.tags].join(' ').toLowerCase()
          .includes(String(value).toLowerCase())).length;
      const profileCuisineHits = profile?.personalizationEnabled
        ? restaurant.cuisines.filter((value) => profile.cuisinePreferences.includes(value)).length : 0;
      const profileTasteHits = profile?.personalizationEnabled
        ? restaurant.tags.filter((value) => profile.tastePreferences.includes(value)).length : 0;
      const dataCompleteness = restaurant.menu.length > 0 ? 1 : 0;
      const distanceScore = restaurant.distanceMeters > 0 ? Math.max(0, 3 - restaurant.distanceMeters / 1000) : 0;
      const score = restaurantNameHits * 40 + dishHits * 16 + keywordHits * 8 + cuisineHits * 8 + tasteHits * 6 +
        profileCuisineHits * 3 + profileTasteHits * 2 + restaurant.rating * 1.5 + distanceScore + dataCompleteness;
      const reasons = [];
      if (cuisineHits > 0) reasons.push(`菜系匹配${restaurant.cuisines.filter((v) => intent.cuisines.includes(v)).join('、')}`);
      if (tasteHits > 0) reasons.push(`口味标签匹配${restaurant.tags.filter((v) => intent.tastes.includes(v)).join('、')}`);
      if (restaurantNameHits > 0) reasons.push('店名匹配');
      if (dishHits > 0) reasons.push('菜品或特色匹配');
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
