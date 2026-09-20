import { http } from '@kit.NetworkKit';
import { AgentRequest, AgentResponse } from '../model/Models';
import { AppConfig } from './AppConfig';

interface ErrorPayload {
  message?: string;
}

export class ApiClient {
  private async request(path: string, method: http.RequestMethod, body: string = ''): Promise<string> {
    const client = http.createHttp();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-Device-Id': AppConfig.DEVICE_ID
    };
    const options: http.HttpRequestOptions = {
      method: method,
      header: headers,
      connectTimeout: 2000,
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
        throw new Error(this.extractError(text, response.responseCode));
      }
      return text;
    } catch (error) {
      const message: string = (error as Error).message;
      throw new Error(message.length > 0 ? message : '无法连接本地演示服务');
    } finally {
      client.destroy();
    }
  }

  private extractError(text: string, status: number): string {
    try {
      const value = JSON.parse(text) as ErrorPayload;
      return value.message ?? `请求失败（${status}）`;
    } catch (_error) {
      return `请求失败（${status}）`;
    }
  }

  async executeAgent(payload: AgentRequest): Promise<AgentResponse> {
    const text = await this.request('/v1/agent/execute', http.RequestMethod.POST, JSON.stringify(payload));
    try {
      const response = JSON.parse(text) as AgentResponse;
      if (response.reply === undefined || response.state === undefined) {
        throw new Error('服务端响应缺少必要字段');
      }
      return response;
    } catch (error) {
      const message: string = (error as Error).message;
      throw new Error(message.length > 0 ? message : '服务端返回了无法解析的数据');
    }
  }
}
