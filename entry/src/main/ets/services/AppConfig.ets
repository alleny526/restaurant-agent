export class AppConfig {
  // 模拟器/真机通过 start-demo.ps1 建立的 HDC 反向端口访问电脑上的 Node 服务。
  static readonly USE_REMOTE_SERVER: boolean = true;
  static readonly FALLBACK_TO_LOCAL_DEMO: boolean = true;
  static readonly API_BASE_URL: string = 'http://127.0.0.1:8787';
  static readonly DEVICE_ID: string = 'restaurant-agent-dev-device';
}
