import { AgentRequest, AgentResponse, MealStage, UserLocation } from '../model/Models';
import { ApiClient } from './ApiClient';
import { AppConfig } from './AppConfig';
import { MockAgent } from './MockAgent';

export class RestaurantAgentApi {
  private static readonly client: ApiClient = new ApiClient();

  private static wait(milliseconds: number): Promise<void> {
    return new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, milliseconds);
    });
  }

  private static async executeRemote(request: AgentRequest): Promise<AgentResponse> {
    try {
      return await RestaurantAgentApi.client.executeAgent(request);
    } catch (error) {
      const message: string = (error as Error).message;
      if (message.includes('502')) {
        await RestaurantAgentApi.wait(800);
        return await RestaurantAgentApi.client.executeAgent(request);
      }
      throw new Error(message.length > 0 ? message : '云端请求失败');
    }
  }

  static async execute(request: AgentRequest): Promise<AgentResponse> {
    if (!AppConfig.USE_REMOTE_SERVER) {
      return MockAgent.execute(request);
    }
    try {
      return await RestaurantAgentApi.executeRemote(request);
    } catch (error) {
      if (AppConfig.FALLBACK_TO_LOCAL_DEMO) {
        const local: AgentResponse = await MockAgent.execute(request);
        return {
          reply: `云端请求失败，已自动使用端侧演示数据。${local.reply}`,
          state: local.state,
          restaurants: local.restaurants,
          recognizedMenu: local.recognizedMenu,
          dishRecommendations: local.dishRecommendations,
          reviewSaved: local.reviewSaved
        } as AgentResponse;
      }
      const message: string = (error as Error).message;
      throw new Error(message.length > 0 ? message : '云端演示服务调用失败');
    }
  }

  static async listRestaurants(location?: UserLocation, page: number = 1, pageSize: number = 20,
    query: string = ''): Promise<AgentResponse> {
    return RestaurantAgentApi.execute({
      action: 'discover',
      clientRequestId: `discover-${Date.now()}`,
      message: query,
      restaurantId: '',
      menuImages: [],
      recognizedMenu: [],
      rating: 0,
      location,
      page,
      pageSize,
      state: { sessionId: 'preview', stage: MealStage.PRE_MEAL, selectedRestaurantId: '', userId: 'guest' },
      profile: {
        userId: 'guest', nickname: '', phone: '', hometown: '', dietaryRestrictions: [], tastePreferences: [],
        cuisinePreferences: [], personalizationEnabled: true
      }
    } as AgentRequest);
  }
}
