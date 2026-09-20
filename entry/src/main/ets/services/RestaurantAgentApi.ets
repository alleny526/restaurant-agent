import { AgentRequest, AgentResponse, MealStage } from '../model/Models';
import { ApiClient } from './ApiClient';
import { AppConfig } from './AppConfig';
import { MockAgent } from './MockAgent';

export class RestaurantAgentApi {
  private static readonly client: ApiClient = new ApiClient();

  static async execute(request: AgentRequest): Promise<AgentResponse> {
    if (!AppConfig.USE_REMOTE_SERVER) {
      return MockAgent.execute(request);
    }
    try {
      return await RestaurantAgentApi.client.executeAgent(request);
    } catch (error) {
      if (AppConfig.FALLBACK_TO_LOCAL_DEMO) {
        const local: AgentResponse = await MockAgent.execute(request);
        return {
          reply: `本地服务未连接，已自动使用端侧演示数据。${local.reply}`,
          state: local.state,
          restaurants: local.restaurants,
          recognizedMenu: local.recognizedMenu,
          dishRecommendations: local.dishRecommendations,
          reviewSaved: local.reviewSaved
        } as AgentResponse;
      }
      const message: string = (error as Error).message;
      throw new Error(message.length > 0 ? message : '本地演示服务调用失败');
    }
  }

  static async listRestaurants(): Promise<AgentResponse> {
    return RestaurantAgentApi.execute({
      action: 'discover',
      message: '',
      restaurantId: '',
      menuImages: [],
      recognizedMenu: [],
      rating: 0,
      state: { sessionId: 'preview', stage: MealStage.PRE_MEAL, selectedRestaurantId: '', userId: 'guest' },
      profile: {
        userId: 'guest', nickname: '', phone: '', hometown: '', dietaryRestrictions: [], tastePreferences: [],
        cuisinePreferences: [], personalizationEnabled: true
      }
    } as AgentRequest);
  }
}
