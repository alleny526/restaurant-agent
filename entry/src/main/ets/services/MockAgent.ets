import {
  AgentRequest,
  AgentResponse,
  DishRecommendation,
  MealStage,
  MenuItem,
  Restaurant,
  SessionState
} from '../model/Models';

const RESTAURANTS: Restaurant[] = [];

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
      return MockAgent.response('当前没有可用的本地餐厅数据，请连接云端商家库后重试。',
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
    return MockAgent.response('当前没有可用的本地餐厅数据，请连接云端商家库后重试。',
      state, [], [], [], false);
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
