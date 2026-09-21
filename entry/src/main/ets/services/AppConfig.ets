export class AppConfig {
  // 真机通过临时 Cloudflare HTTPS 隧道访问受限的 Node 公网入口。
  static readonly USE_REMOTE_SERVER: boolean = true;
  static readonly FALLBACK_TO_LOCAL_DEMO: boolean = false;
  static readonly API_BASE_URL: string = 'https://effective-howto-agreements-brought.trycloudflare.com';
  static readonly DEVICE_ID: string = 'restaurant-agent-dev-device';
}
