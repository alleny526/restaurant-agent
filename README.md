# 吃了么 HarmonyOS 演示版

这是一个面向真机演示的 HarmonyOS “吃了么” toy project。应用从自然语言餐厅检索开始，串联选店、到店、菜单识别、点菜建议、餐后评价和个人偏好管理。当前版本不依赖 Cloud Foundation，也不抓取美团或饿了么网页；商家基础数据来自高德 Web 服务 API 和自有/授权 SQLite 数据，菜单数据来自自有/授权目录、用户上传图片和端侧 OCR。

## 当前能力

- 发现页：南京餐厅搜索、分页加载、菜系/距离/价格/营业状态筛选、商家缩略图、详情页和直接评论。
- 对话页：自然语言提取店名、菜品、菜系、口味、人均、距离、评分和营业要求；候选通过高德与 SQLite 查询后再排序。
- 连续用餐流程：`PRE_MEAL → RESTAURANT_SELECTED → ARRIVED → MENU_READY → DINING → REVIEW → END`。
- 换店流程：评价前任意阶段可以自然语言要求换店；返回候选时保留原餐厅节点，并提供“不用换了”恢复当前节点，选择新店后清空旧餐厅对话并开始新流程。
- 菜单识别：端侧 Core Vision Kit OCR 作为前置/回退；云端优先调用百度通用文字识别，GPT 只接收百度或端侧 OCR 文本进行清理和结构化，不接收菜单图片。百度与端侧 OCR 均无有效结果时返回明确错误，不显示预置菜单。
- 账户与资料：普通账号注册/登录、华为账号登录、头像、昵称、籍贯、忌口、口味和菜系偏好统一编辑；评论按用户和时间戳独立保存。
- 商家图片：高德 `show_fields=business,photos` 图片用于卡片和详情展示；只有标题明确标注菜单/菜谱/价目表的图片才会尝试识别菜单。
- 页面切换：发现、对话、我的三个一级页面由原生 `Swiper` 承载，支持底部导航按钮和手指左右滑动；滑动过程中相邻页面同时渲染并连续跟手移动，使用轻量左右滑入动效；二级页面使用 `Navigation/NavPathStack`，继续支持华为侧边返回和系统 `SLIDE_RIGHT` 转场。

## 端云链路

```text
HarmonyOS ArkUI
  └─ RestaurantAgentApi / AuthApi (HTTPS JSON)
      └─ Cloudflare Quick Tunnel
          └─ 受限公网网关 :8788
              └─ Node.js 编排服务 :8787
                  ├─ 会话状态机、SQLite、评论和资料
                  ├─ 高德 Web 服务 POI/图片
                  ├─ OpenAI-compatible LLM：意图解析、候选重排、回复、OCR 文本清理
                  └─ 固定流程校验、字段校验、脱敏和幂等
```

模型只负责意图解析、候选 ID 重排、用户可见回复和 OCR 文本清理；菜单上传链路不调用 GPT 视觉识别。商家事实、菜单写入、会话跳转、评论保存和权限校验由 Node 服务执行。客户端网络失败时才进入明确标注的本地演示降级，不把降级结果伪装成云端成功。

## 工程结构

- `entry/`：ArkTS/ArkUI 客户端，包含发现、对话、我的、路由栈、图库选择、端侧 OCR 和账号资料。
- `server/`：Node.js 服务，包含编排器、状态机、高德适配、SQLite 存储、认证、评论和 OpenAI-compatible 适配层。
- `server/catalog/`：自有或已授权的餐厅/菜单导入目录。
- `docs/`：架构、部署、配置和验收说明。
- `xiaoyi/`：小艺插件/Agent 配置样例。当前 App 主链路不依赖小艺私有云插件。

## 配置

### 1. 服务端 `.env`

```powershell
cd D:\RestaurantAgent\server
Copy-Item .env.example .env
npm install
```

最小可用配置：

```dotenv
AMAP_WEB_KEY=你的高德Web服务Key
AMAP_DEFAULT_REGION=南京市
LLM_PROVIDER=openai-compatible
LLM_BASE_URL=https://你的OpenAI兼容网关/v1
LLM_API_KEY=服务端专用Key
LLM_MODEL=gpt-5.6-sol
LLM_FAST_MODEL=gpt-5.6-luna
LLM_TIMEOUT_MS=20000
BAIDU_OCR_APP_ID=百度OCR应用ID
BAIDU_OCR_API_KEY=百度OCR API Key
BAIDU_OCR_SECRET_KEY=百度OCR Secret Key
```

可选配置：`AMAP_LOCATION=经度,纬度` 开启固定周边检索；留空时按南京市文本检索。`HUAWEI_CLIENT_ID` 和 `HUAWEI_CLIENT_SECRET` 放在服务端，用于华为账号登录。`VISION_API_URL`、`VISION_API_KEY` 仅用于可选的详情图片识别路径，不参与用户上传菜单流程。菜单上传必须配置百度 OCR 的 API Key 和 Secret Key；AppID 用于记录应用配置，百度鉴权实际使用 API Key 与 Secret Key。

API Key、华为 Client Secret 和 Cloudflare 凭据不能写入 ArkTS、不能提交 Git。完整字段见 [`server/.env.example`](server/.env.example)。

### 2. 启动服务

```powershell
cd D:\RestaurantAgent\server
npm start
```

另开终端启动受限网关：

```powershell
cd D:\RestaurantAgent\server
npm run public-gateway
```

检查 `http://127.0.0.1:8787/healthz` 或 `http://127.0.0.1:8788/healthz`。`amapConfigured: true`、`llmConfigured: true`、`baiduOcrConfigured: true` 表示对应外部配置已加载；`menuUploadFlow` 应为 `baidu-ocr-text-only-gpt-cleanup`。

### 3. Cloudflare HTTPS

```powershell
& "$env:LOCALAPPDATA\Programs\cloudflared\cloudflared.exe" `
  tunnel --url http://127.0.0.1:8788 --no-autoupdate
```

将输出的 `https://*.trycloudflare.com` 写入 [`AppConfig.ets`](entry/src/main/ets/services/AppConfig.ets) 的 `API_BASE_URL`，然后重新构建安装。Quick Tunnel 地址重启后可能变化。公网网关只转发健康检查、Agent 执行、登录、资料和评论接口，不开放数据库查询。

### 4. DevEco Studio 与真机

1. 用 DevEco Studio 打开 `D:\RestaurantAgent`。
2. 在 `build-profile.json5` 使用自动签名或已注册应用对应的调试 Profile。
3. 确认真机已登录华为账号并打开 USB 调试。
4. 构建 `entry` 模块并运行，或执行：

```powershell
$env:DEVECO_SDK_HOME='C:\Program Files\Huawei\DevEco Studio\sdk'
& 'C:\Program Files\Huawei\DevEco Studio\tools\node\node.exe' `
  'C:\Program Files\Huawei\DevEco Studio\tools\hvigor\bin\hvigorw.js' `
  --mode module -p product=default assembleHap --analyze=normal --parallel --incremental --daemon
```

## 演示流程

推荐输入：`推荐南京清淡、人均100元以内、2公里内评分4.5以上的餐厅`。也可输入 `找福味家宴，想吃盐水鸭`。选择餐厅后依次执行“我已抵达”、上传菜单、确认菜单和“就餐完毕”。在评价前输入“想换一家火锅店”会返回新的高德候选，并显示“不用换了”；选择候选会开启新餐厅流程。

## 测试与诊断

```powershell
cd D:\RestaurantAgent\server
npm test
```

服务端测试覆盖 SQLite 持久化、高德归一化和图片、自然语言意图、距离/评分过滤、状态机、换店、OCR 降级、认证、评论、幂等和模型适配，共 36 项。仅本机可访问的 `GET /internal/diagnostics` 只返回脱敏计数和耗时。

## 适配性与限制

- 支持 HarmonyOS Stage 模型和手机真机/模拟器；端侧 OCR 能力依赖设备 Core Vision Kit 支持情况。
- 高德 POI、图片、营业时间和评分以 API 实际返回为准；无数据时不由模型补造。
- 菜单只来自自有/授权数据、用户照片的百度 OCR/端侧 OCR 结果，不接入未授权外卖平台菜单；GPT 不直接读取菜单图片。
- 小艺开放平台适合作为系统入口或 Agent Server 调用方；当前应用主对话链路使用 OpenAI-compatible API，避免依赖个人开发者不可上架的私有云插件。
- 本项目是 toy project，不包含支付、团购、预约、导航、生产级短信、生产监控和正式商店发布材料。

更多细节见 [`docs/architecture.md`](docs/architecture.md)、[`docs/deployment.md`](docs/deployment.md) 和 [`docs/acceptance.md`](docs/acceptance.md)。
