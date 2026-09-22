import { http } from '@kit.NetworkKit';
import { AuthResponse, AuthUser, RestaurantReview, UserProfile } from '../model/Models';
import { AppConfig } from './AppConfig';

interface ErrorPayload {
  message?: string;
}

export class AuthApi {
  private static async request<T>(path: string, method: http.RequestMethod, body: string = '',
    token: string = ''): Promise<T> {
    const client = http.createHttp();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-Device-Id': AppConfig.DEVICE_ID
    };
    if (token.length > 0) {
      headers.Authorization = `Bearer ${token}`;
    }
    const options: http.HttpRequestOptions = {
      method,
      header: headers,
      connectTimeout: 3000,
      readTimeout: 15000,
      expectDataType: http.HttpDataType.STRING
    };
    if (body.length > 0) {
      options.extraData = body;
    }
    try {
      const response = await client.request(`${AppConfig.API_BASE_URL}${path}`, options);
      const text = response.result as string;
      if (response.responseCode < 200 || response.responseCode >= 300) {
        throw new Error(AuthApi.extractError(text, response.responseCode));
      }
      return JSON.parse(text) as T;
    } catch (error) {
      const message: string = (error as Error).message;
      throw new Error(message.length > 0 ? message : '认证服务暂时不可用');
    } finally {
      client.destroy();
    }
  }

  private static extractError(text: string, status: number): string {
    try {
      const value = JSON.parse(text) as ErrorPayload;
      return value.message ?? `认证请求失败（${status}）`;
    } catch (_error) {
      return `认证请求失败（${status}）`;
    }
  }

  static loginWithHuawei(authorizationCode: string): Promise<AuthResponse> {
    return AuthApi.request<AuthResponse>('/v1/auth/huawei', http.RequestMethod.POST,
      JSON.stringify({ authorizationCode }));
  }

  static login(account: string, password: string): Promise<AuthResponse> {
    return AuthApi.request<AuthResponse>('/v1/auth/login', http.RequestMethod.POST,
      JSON.stringify({ account, password }));
  }

  static register(nickname: string, account: string, password: string): Promise<AuthResponse> {
    return AuthApi.request<AuthResponse>('/v1/auth/register', http.RequestMethod.POST,
      JSON.stringify({ nickname, account, password }));
  }

  static getProfile(token: string): Promise<AuthUser> {
    return AuthApi.request<AuthUser>('/v1/users/me/profile', http.RequestMethod.GET, '', token);
  }

  static updateProfile(token: string, profile: UserProfile): Promise<AuthUser> {
    return AuthApi.request<AuthUser>('/v1/users/me/profile', http.RequestMethod.PUT, JSON.stringify({
      nickname: profile.nickname,
      hometown: profile.hometown,
      avatarUrl: profile.avatarUrl,
      dietaryRestrictions: profile.dietaryRestrictions,
      tastePreferences: profile.tastePreferences,
      cuisinePreferences: profile.cuisinePreferences,
      personalizationEnabled: profile.personalizationEnabled
    }), token);
  }

  static submitRestaurantReview(token: string, restaurantId: string, text: string,
    rating: number): Promise<RestaurantReview> {
    return AuthApi.request<RestaurantReview>(`/v1/restaurants/${encodeURIComponent(restaurantId)}/reviews`,
      http.RequestMethod.POST, JSON.stringify({ text, rating }), token);
  }
}
