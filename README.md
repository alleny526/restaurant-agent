# 小艺餐厅 Agent（演示版）

这是一个可直接演示的 HarmonyOS 餐饮 Agent toy project。它覆盖“自然语言推荐餐厅 → 选店 → 到店 → 读取或拍照识别菜单 → 推荐菜品 → 餐后评价”的完整流程。

工程不依赖 Cloud Foundation、AGC 云数据库或外部 OCR。端侧通过 HTTP 调用电脑上的 Node.js 服务；餐厅、菜单和图片识别结果均为仓库内预置数据，服务端将会话和评价写入本地 JSON。若 Node 服务没有启动，应用会自动切换到端侧演示数据，保证现场仍可操作。

## 工程组成

- `entry/`：ArkTS/ArkUI 客户端，包含发现、对话、我的三个页面及菜单图片选择；演示版本不加载设备专属 Agent HSP。
- `server/`：零第三方依赖的 Node.js 本地服务，提供预置数据、状态机、菜单模拟识别和评价保存。
- `xiaoyi/`：可选的小艺 Agent 提示词和 OpenAPI 示例；不影响应用本体运行。
- `docs/`：架构、运行说明和 PRD 验收映射。

## 最快演示方式

1. 用 DevEco Studio 打开 `D:\RestaurantAgent`，等待工程同步完成。
2. 启动 HarmonyOS 模拟器或连接真机。
3. 双击 `server\start-demo.cmd`。脚本会建立 HDC 反向端口并启动 `http://127.0.0.1:8787`。
4. 在 DevEco Studio 选择 `entry`，点击运行。
5. 在对话页输入“想吃清淡的素食”，选择“素源里”，点击“我已抵达”，上传任意菜单图片，然后完成用餐并评价。

服务未启动时，首次网络请求最多等待约 2 秒，随后自动使用端侧数据；消息前会显示“已自动使用端侧演示数据”。

## 验证命令

Node 服务测试：

```powershell
cd D:\RestaurantAgent\server
npm test
```

DevEco 命令行构建：

```powershell
cd D:\RestaurantAgent
$env:DEVECO_SDK_HOME='C:\Program Files\Huawei\DevEco Studio\sdk'
& 'C:\Program Files\Huawei\DevEco Studio\tools\node\node.exe' `
  'C:\Program Files\Huawei\DevEco Studio\tools\hvigor\bin\hvigorw.js' `
  --mode module -p product=default -p module=entry@default `
  -p buildMode=debug --no-daemon assembleHap
```

当前生成物为 `entry/build/default/outputs/default/entry-default-unsigned.hap`。工程未配置项目方证书，所以命令行产物为未签名 HAP；直接从 DevEco Studio 运行时可使用 IDE 的调试签名配置。

更多说明见 [本地运行](docs/deployment.md)、[系统架构](docs/architecture.md) 和 [验收映射](docs/acceptance.md)。
