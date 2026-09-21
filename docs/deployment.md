# 真机与 OpenAI-compatible 部署说明

## 1. 环境

- DevEco Studio 6.0+，HarmonyOS SDK API 20 或更高版本。
- HarmonyOS 真机或模拟器；菜单 OCR 建议用支持 Core Vision Kit 的真机验证。
- Node.js 18+、Cloudflare Tunnel 可执行文件。
- OpenAI-compatible Router API Key；Key 只配置在服务端。

本项目不需要 Cloud Foundation、Cloud DB 或系统 Agent HSP。

## 2. 服务端配置

在 `server/.env` 中配置：

```dotenv
AMAP_WEB_KEY=你的高德Web服务Key
AMAP_DEFAULT_REGION=南京市
LLM_BASE_URL=https://rehdasu.cn/v1
LLM_PROVIDER=openai-compatible
LLM_API_KEY=你的Router_API_Key
LLM_MODEL=gpt-5.6-sol
LLM_FAST_MODEL=gpt-5.6-luna
LLM_TIMEOUT_MS=20000
```

复杂推荐和菜单视觉使用 `LLM_MODEL`；选店确认、到店提示和结束提示使用可选的 `LLM_FAST_MODEL`。不配置快速模型时所有节点回退到主模型。Qwen/DeepSeek 仍可通过兼容接口替换，但需要相应模型和请求参数支持。

启动业务服务与受限网关：

```powershell
cd D:\RestaurantAgent\server
npm install
npm start
```

```powershell
cd D:\RestaurantAgent\server
npm run public-gateway
```

验证 `http://127.0.0.1:8787/healthz`。`amapConfigured` 和 `llmConfigured` 均为 `true` 时，两类外部服务均已加载。

仅本机诊断：`http://127.0.0.1:8787/internal/diagnostics`。该接口只返回餐厅/会话数量、模型名称和脱敏的耗时聚合，不经过公网网关。

## 3. 公网 HTTPS

```powershell
& "$env:LOCALAPPDATA\Programs\cloudflared\cloudflared.exe" `
  tunnel --url http://127.0.0.1:8788 --no-autoupdate
```

把输出的 `https://*.trycloudflare.com` 写入 `entry/src/main/ets/services/AppConfig.ets` 的 `API_BASE_URL`，重新构建安装。Quick Tunnel 地址每次可能变化；变化后必须同步更新 App。受限网关不会暴露登录、OTP、用户资料或直接数据库查询接口。

## 4. 验证流程

1. 输入“推荐南京人均 100 元以内、现在营业的清淡餐厅”。
2. 确认回复与餐厅卡片都出现在应用对话页。
3. 选择餐厅并点击“我已抵达”，检查模型根据已选餐厅给出下一步；允许定位时验证距离来自高德周边检索。
4. 上传菜单照片，检查图片最长边压缩到约 1600px、端侧 OCR 与视觉识别并行执行。
5. 检查菜单处于“待确认”，可继续上传；点击“确认菜单”后进入用餐状态，确认版本才写入餐厅默认菜单。
6. 点击“就餐完毕”并提交评价，检查状态进入 `END` 且评价已脱敏保存。
7. 重复发送同一个 `clientRequestId`，确认写操作只产生一次状态变更。
6. 暂时填错 `LLM_API_KEY`，重复流程，确认应用仍使用本地规则完成流程且不会编造餐厅。

## 5. 常见问题

- `llmConfigured: false`：缺少 `LLM_BASE_URL` 或 `LLM_MODEL`；同时检查服务进程是否在修改 `.env` 后重启。
- 返回本地规则回复：检查 Router Key、账户余额、网络和服务端日志。模型失败会静默降级，不影响业务状态。
- 真机提示云端未连接：确认 Node、8788 网关和 Cloudflare Tunnel 都在运行，并核对 `API_BASE_URL`。
- `The root node is not yet available for build`：使用 DevEco Studio 自带 Hvigor，不要在工程根目录安装 `@ohos/hvigor`。
- 无法安装 HAP：在 DevEco Studio 关联已注册应用并配置调试签名。
