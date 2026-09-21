# 餐厅助手（HarmonyOS 演示版）

这是一个 HarmonyOS 餐饮助手 toy project，覆盖“自然语言推荐餐厅 → 选店 → 到店 → 菜单 OCR → 点菜建议 → 餐后评价”的完整流程。应用内对话通过 Cloudflare HTTPS 调用 Node.js 服务，服务端接入高德 POI、SQLite 和 OpenAI-compatible 大模型 API。

工程不依赖 Cloud Foundation 或系统级智能体组件。美团/饿了么数据未获门店授权，因此不接入相关接口、不抓取网页；菜单仅使用自有/获授权数据或用户现场拍摄后的端侧 OCR 结果。

## 端云链路

```text
HarmonyOS 对话页 -> Cloudflare 受限网关 -> Node 编排服务
  -> DeepSeek 意图解析/候选重排 -> 高德 + SQLite 查询
  -> DeepSeek 基于查询事实生成回复 -> App 消息与业务卡片
```

大模型参与餐厅推荐、选店确认、到店引导、菜单图片识别与分析、用餐问答和评价回应。数据库查询、固定状态机、评论脱敏以及餐厅/菜品字段校验仍由服务端执行，模型不能补造商家事实或跳过流程。菜单视觉不可用时自动采用端侧 Core Vision Kit OCR；其他云端错误会明确提示，不再伪装成成功的端侧会话。

## 工程组成

- `entry/`：ArkTS/ArkUI 客户端，包含发现、对话、我的和 Core Vision Kit 端侧菜单 OCR。
- `server/`：Node.js 编排服务，包含 DeepSeek-compatible 客户端、高德 POI、SQLite 和就餐状态机。
- `server/catalog/`：自有或已获授权的餐厅/菜单 JSON 导入模板。
- `docs/`：架构、部署和验收说明。

## 配置 DeepSeek

在 `server` 目录执行 `npm install`，将 `.env.example` 复制为 `.env`，填写：

```dotenv
LLM_BASE_URL=https://api.deepseek.com
LLM_PROVIDER=deepseek
LLM_API_KEY=你的DeepSeek_API_Key
LLM_MODEL=deepseek-chat
LLM_TIMEOUT_MS=20000
```

API Key 只保存在服务端 `.env`，不得写入 ArkTS 客户端或提交 Git。服务启动后访问 `GET /healthz`，`llmConfigured: true` 表示模型参数已加载。还可填写 `AMAP_WEB_KEY` 启用南京餐厅实时检索。

同一适配层也支持 Qwen 百炼；切换时无需修改 ArkTS 或业务编排：

```dotenv
LLM_PROVIDER=qwen
LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
LLM_API_KEY=你的百炼_API_Key
LLM_MODEL=qwen3.8-flash
```

Qwen 路径会自动关闭思考模式，使意图解析和候选 ID 排序稳定返回 JSON。若使用子业务空间，请将 Base URL 换成百炼控制台给出的地域/Workspace 地址。

## 启动与演示

```powershell
cd D:\RestaurantAgent\server
npm start
```

另开终端启动受限网关与 Cloudflare Quick Tunnel：

```powershell
cd D:\RestaurantAgent\server
npm run public-gateway
& "$env:LOCALAPPDATA\Programs\cloudflared\cloudflared.exe" tunnel --url http://127.0.0.1:8788 --no-autoupdate
```

将隧道地址写入 `entry/src/main/ets/services/AppConfig.ets` 的 `API_BASE_URL`，用 DevEco Studio 构建并运行。公网网关只开放 `GET /healthz` 和 `POST /v1/agent/execute`。

推荐演示输入：“推荐南京清淡、人均 100 元以内且现在营业的餐厅”。选择餐厅后依次点击“我已抵达”、上传菜单和“就餐完毕”，所有回复都会显示在应用对话页。

## 验证

```powershell
cd D:\RestaurantAgent\server
npm test
```

```powershell
cd D:\RestaurantAgent
$env:DEVECO_SDK_HOME='C:\Program Files\Huawei\DevEco Studio\sdk'
& 'C:\Program Files\Huawei\DevEco Studio\tools\node\node.exe' `
  'C:\Program Files\Huawei\DevEco Studio\tools\hvigor\bin\hvigorw.js' `
  --mode module -p product=default -p module=entry@default `
  -p buildMode=debug --no-daemon assembleHap
```

更多说明见 [部署说明](docs/deployment.md)、[系统架构](docs/architecture.md) 和 [验收映射](docs/acceptance.md)。
