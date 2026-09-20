import {
  AgentRequest,
  AgentResponse,
  DishRecommendation,
  MealStage,
  MenuItem,
  Restaurant,
  SessionState
} from '../model/Models';

const MENU_JIANGNAN: MenuItem[] = [
  { id: 'm-101', name: '清蒸鲈鱼', category: '江鲜', price: 88, ingredients: ['鲈鱼', '葱', '姜'], confidence: 0.98 },
  { id: 'm-102', name: '龙井虾仁', category: '热菜', price: 78, ingredients: ['虾仁', '龙井茶'], confidence: 0.97 },
  { id: 'm-103', name: '莼菜豆腐羹', category: '汤羹', price: 36, ingredients: ['莼菜', '豆腐'], confidence: 0.94 }
];

const MENU_VEGAN: MenuItem[] = [
  { id: 'm-201', name: '菌菇时蔬煲', category: '热菜', price: 48, ingredients: ['香菇', '口蘑', '青菜'], confidence: 0.96 },
  { id: 'm-202', name: '桂花糯米藕', category: '凉菜', price: 32, ingredients: ['莲藕', '糯米', '桂花'], confidence: 0.93 }
];

const RESTAURANTS: Restaurant[] = [
  {
    id: 'demo-r-001', name: '江南小馆（演示）', cuisine: '江浙菜', tags: ['清淡', '江鲜', '家庭聚餐'],
    address: '示例市滨江路 18 号', distanceKm: 1.2, pricePerPerson: 96, rating: 4.7, open: true,
    reason: '江浙风味与清淡偏好匹配，菜单中有多道少油蒸菜。', menuAvailable: true, menu: MENU_JIANGNAN
  },
  {
    id: 'demo-r-002', name: '荷风素宴（演示）', cuisine: '素食', tags: ['清淡', '素食', '安静'],
    address: '示例市学府街 6 号', distanceKm: 2.0, pricePerPerson: 72, rating: 4.6, open: true,
    reason: '菜品整体清淡，适合希望控制油盐或偏爱蔬食的用户。', menuAvailable: true, menu: MENU_VEGAN
  },
  {
    id: 'demo-r-003', name: '湖畔家宴（演示）', cuisine: '杭帮菜', tags: ['本帮', '时令', '包间'],
    address: '示例市湖滨南路 33 号', distanceKm: 2.8, pricePerPerson: 128, rating: 4.8, open: true,
    reason: '杭帮菜契合江浙诉求，近期评价中清淡菜品反馈较好。', menuAvailable: false, menu: []
  },
  {
    id: 'demo-r-004', name: '邻里蒸味（演示）', cuisine: '家常菜', tags: ['蒸菜', '少油', '性价比'],
    address: '示例市人民路 52 号', distanceKm: 3.4, pricePerPerson: 58, rating: 4.5, open: true,
    reason: '蒸菜与少油标签符合清淡需求，人均价格更友好。', menuAvailable: false, menu: []
  }
];

export class MockAgent {
  static restaurants(): Restaurant[] {
    return RESTAURANTS;
  }

  static async execute(request: AgentRequest): Promise<AgentResponse> {
    let state: SessionState = {
      sessionId: request.state.sessionId,
      stage: request.state.stage,
      selectedRestaurantId: request.state.selectedRestaurantId,
      userId: request.state.userId
    };

    if (request.action === 'discover' || request.action === 'recommend') {
      return MockAgent.response('我根据你的口味与当前条件，从演示商家库筛选了 4 家。推荐理由只使用库内已有字段。',
        state, RESTAURANTS, [], [], false);
    }

    if (request.action === 'select_restaurant') {
      const selected: Restaurant | undefined = RESTAURANTS.find((item: Restaurant) => item.id === request.restaurantId);
      if (selected === undefined) {
        return MockAgent.response('没有找到该餐厅，请重新选择。', state, [], [], [], false);
      }
      state = { sessionId: state.sessionId, stage: MealStage.RESTAURANT_SELECTED,
        selectedRestaurantId: selected.id, userId: state.userId };
      return MockAgent.response(`已选择${selected.name}。到店后告诉我“我已抵达”，我会继续帮你选菜。`,
        state, [selected], [], [], false);
    }

    if (request.action === 'arrive') {
      const selected: Restaurant | undefined = RESTAURANTS.find((item: Restaurant) => item.id === state.selectedRestaurantId);
      if (selected === undefined) {
        return MockAgent.response('你还没有选择餐厅。请先从推荐结果中选择一家。', state, [], [], [], false);
      }
      if (!selected.menuAvailable) {
        state = { sessionId: state.sessionId, stage: MealStage.ARRIVED,
          selectedRestaurantId: state.selectedRestaurantId, userId: state.userId };
        return MockAgent.response('这家餐厅暂无完整菜单。请拍照或上传菜单，我会先展示识别结果供你确认。',
          state, [selected], [], [], false);
      }
      state = { sessionId: state.sessionId, stage: MealStage.MENU_READY,
        selectedRestaurantId: state.selectedRestaurantId, userId: state.userId };
      return MockAgent.response('已读取商家库菜单。下面是结合清淡偏好生成的建议。涉及过敏原时仍请以餐厅实际说明为准。',
        state, [selected], selected.menu, MockAgent.recommendDishes(selected.menu, request.profile.dietaryRestrictions), false);
    }

    if (request.action === 'upload_menu') {
      if (state.selectedRestaurantId.length === 0) {
        return MockAgent.response('请先选择餐厅，到店后再上传菜单。', state, [], [], [], false);
      }
      const recognized: MenuItem[] = [
        { id: 'ocr-1', name: '清炖狮子头', category: '热菜', price: 58, ingredients: ['猪肉', '青菜'], confidence: 0.95 },
        { id: 'ocr-2', name: '时令河鲜（名称待确认）', category: '时令', price: 0, ingredients: [], confidence: 0.62 },
        { id: 'ocr-3', name: '鸡汁干丝', category: '热菜', price: 38, ingredients: ['豆腐干', '鸡汤'], confidence: 0.90 }
      ];
      state = { sessionId: state.sessionId, stage: MealStage.MENU_READY,
        selectedRestaurantId: state.selectedRestaurantId, userId: state.userId };
      return MockAgent.response('识别到 3 道菜，其中 1 道置信度较低，已标记“待确认”。请核对菜单后再参考建议。',
        state, [], recognized, MockAgent.recommendDishes(recognized, request.profile.dietaryRestrictions), false);
    }

    if (request.action === 'finish_meal') {
      if (state.selectedRestaurantId.length === 0) {
        return MockAgent.response('请先选择餐厅，再完成本次用餐。', state, [], [], [], false);
      }
      state = { sessionId: state.sessionId, stage: MealStage.REVIEW,
        selectedRestaurantId: state.selectedRestaurantId, userId: state.userId };
      return MockAgent.response('这次用餐体验怎么样？可以告诉我味道、服务、环境，也可以补充星级。',
        state, [], [], [], false);
    }

    if (request.action === 'submit_review') {
      if (state.selectedRestaurantId.length === 0 || request.message.trim().length === 0) {
        return MockAgent.response('评论内容或当前餐厅缺失，请补充后重试。', state, [], [], [], false);
      }
      state = { sessionId: state.sessionId, stage: MealStage.END,
        selectedRestaurantId: state.selectedRestaurantId, userId: state.userId };
      return MockAgent.response('评价已与当前餐厅和本次会话关联。演示模式不会上传个人数据。',
        state, [], [], [], true);
    }

    const message: string = request.message.trim();
    if (message.includes('抵达') || message.includes('到店')) {
      request.action = 'arrive';
      return MockAgent.execute(request);
    }
    if (message.includes('就餐完毕') || message.includes('吃完')) {
      request.action = 'finish_meal';
      return MockAgent.execute(request);
    }
    if (state.stage === MealStage.REVIEW && message.length > 0) {
      request.action = 'submit_review';
      return MockAgent.execute(request);
    }
    if ((state.stage === MealStage.MENU_READY || state.stage === MealStage.DINING) && request.recognizedMenu.length > 0) {
      const menu: MenuItem[] = request.recognizedMenu.map((item: MenuItem) => {
        return {
          id: item.id, name: item.name, category: item.category, price: item.price,
          ingredients: item.ingredients.slice(), confidence: item.confidence
        } as MenuItem;
      });
      const correction: RegExpMatchArray | null = message.match(/不是\s*([^，,。\s]+)[，,]?\s*是\s*([^，,。\s]+)/);
      let corrected: number = 0;
      if (correction !== null) {
        menu.forEach((item: MenuItem) => {
          const index: number = item.ingredients.findIndex((ingredient: string) => ingredient.includes(correction[1]));
          if (index >= 0) {
            item.ingredients[index] = correction[2];
            item.confidence = Math.min(item.confidence, 0.8);
            corrected += 1;
          }
        });
      }
      state = { sessionId: state.sessionId, stage: MealStage.DINING,
        selectedRestaurantId: state.selectedRestaurantId, userId: state.userId };
      const reply: string = corrected > 0 ? '已更新识别食材并重新生成建议。' : '我会继续基于已确认菜单回答。';
      return MockAgent.response(`${reply}模型识别可能遗漏过敏原，请以餐厅实际说明为准。`, state, [], menu,
        MockAgent.recommendDishes(menu, request.profile.dietaryRestrictions), false);
    }
    return MockAgent.response('我把你的描述转换成了菜系、口味与距离条件。以下结果来自演示商家库，你可以查看详情或直接选择。',
      state, RESTAURANTS.slice(0, 3), [], [], false);
  }

  private static recommendDishes(menu: MenuItem[], restrictions: string[]): DishRecommendation[] {
    const blocked: string = restrictions.join('、');
    return menu.filter((item: MenuItem) => item.confidence >= 0.8).slice(0, 3).map((item: MenuItem) => {
      return {
        menuItemId: item.id,
        name: item.name,
        reason: '口味相对清淡，且菜单字段置信度较高。',
        allergenWarning: blocked.length > 0 ? `你设置了忌口/过敏：${blocked}；模型无法保证食材完整，请向餐厅确认。` :
          '食材信息可能不完整，如有过敏请向餐厅确认。'
      } as DishRecommendation;
    });
  }

  private static response(reply: string, state: SessionState, restaurants: Restaurant[], recognizedMenu: MenuItem[],
    dishRecommendations: DishRecommendation[], reviewSaved: boolean): AgentResponse {
    return { reply, state, restaurants, recognizedMenu, dishRecommendations, reviewSaved } as AgentResponse;
  }
}
