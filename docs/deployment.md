# 真机与端云部署说明

## 前置条件

- DevEco Studio 6.0+，HarmonyOS SDK API 20+。
- HarmonyOS 手机真机或模拟器；菜单 OCR 推荐真机。
- Node.js 18+、Cloudflare `cloudflared`。
- 高德 Web 服务 Key。
- 一个 OpenAI-compatible 模型网关和服务端 API Key。

本项目不需要 Cloud Foundation、Cloud DB、云函数或系统 Agent HSP。

## 服务端配置

```powershell
cd D:\RestaurantAgent\server
Copy-Item .env.example .env
npm install
```

建议配置：

```dotenv
AMAP_WEB_KEY=你的高德Web服务Key
AMAP_DEFAULT_REGION=南京市
LLM_PROVIDER=openai-compatible
LLM_BASE_URL=https://你的兼容网关/v1
LLM_API_KEY=服务端专用Key
LLM_MODEL=gpt-5.6-sol
LLM_FAST_MODEL=gpt-5.6-luna
LLM_TIMEOUT_MS=20000
```

华为登录额外配置：

```dotenv
HUAWEI_CLIENT_ID=OAuth2客户端ID
HUAWEI_CLIENT_SECRET=OAuth2客户端Secret
```

图片视觉服务为可选项。未配置时，端侧 Core Vision Kit OCR 仍可完成演示：

```dotenv
VISION_DEMO_MODE=true
VISION_API_URL=
VISION_API_KEY=
```

## 启动本地服务

```powershell
cd D:\RestaurantAgent\server
npm start
```

另开终端：

```powershell
cd D:\RestaurantAgent\server
npm run public-gateway
```

验证：

```powershell
Invoke-RestMethod http://127.0.0.1:8787/healthz
Invoke-RestMethod http://127.0.0.1:8788/healthz
```

必须看到 `status=ok`。`amapConfigured`、`llmConfigured` 可用于判断外部配置是否加载。

## 公网 HTTPS

```powershell
& "$env:LOCALAPPDATA\Programs\cloudflared\cloudflared.exe" `
  tunnel --url http://127.0.0.1:8788 --no-autoupdate
```

把输出的 `https://*.trycloudflare.com` 写入 `entry/src/main/ets/services/AppConfig.ets`：

```ts
static readonly USE_REMOTE_SERVER: boolean = true;
static readonly FALLBACK_TO_LOCAL_DEMO: boolean = false;
static readonly API_BASE_URL: string = 'https://你的隧道地址';
```

Quick Tunnel 地址重启后可能变化，修改后需重新构建 App。网关只开放健康检查、Agent 执行、认证、资料和评论接口。

## DevEco Studio 构建

1. 打开 `D:\RestaurantAgent`。
2. 使用自动签名，或选择 AppGallery Connect 已注册应用对应的调试 Profile。
3. 连接真机并开启 USB 调试。
4. 运行 `entry` 模块，或使用根目录 Hvigor 构建 HAP。

签名错误 `9568322` 通常表示 Profile、证书、包名或设备来源不一致；优先使用 DevEco 自动签名并确认包名 `com.alleny526.restaurantagent`。

## 验收路径

1. 输入“推荐南京清淡、人均100元以内、2公里内评分4.5以上的餐厅”。
2. 确认返回高德/SQLite 商家卡片、图片和筛选结果。
3. 选择餐厅，点击“我已抵达”。
4. 上传一张或多张菜单，确认识别结果进入待确认状态。
5. 点击“确认菜单”，检查个性化建议和忌口提示。
6. 在 DINING 阶段输入“想换一家火锅店”，检查候选和“不用换了”。
7. 点击“不用换了”，确认回到原节点；选择新店，确认旧餐厅对话清空。
8. 点击“就餐完毕”并提交评论，确认评论保存并自动开启新对话。
9. 进入“我的 → 编辑个人信息”，测试头像、昵称、籍贯和偏好同步。

## 常见问题

- `llmConfigured: false`：检查 `.env` 的 Base URL、Model 和服务进程重启。
- 真机云端未连接：检查 8787、8788、Cloudflare 和 AppConfig 地址。
- 高德无结果：检查 Key、南京区域、设备定位和关键词；无定位时使用城市文本检索。
- 菜单视觉不可用：确认端侧 OCR 权限和设备能力，查看低置信度结果并手动确认。
- 小艺 Agent 不存在或无法上架：个人开发者不能依赖私有云插件；本 App 主链路不依赖小艺私有插件。
