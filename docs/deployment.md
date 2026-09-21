# 本地演示运行说明

## 1. 环境

- DevEco Studio 6.0+，HarmonyOS SDK API 20 或更高版本。
- HarmonyOS 模拟器或已开启调试的真机。
- Node.js 18+。若电脑未单独安装 Node.js，启动脚本会尝试使用 DevEco Studio 自带的 Node.js。

餐厅推荐主流程不需要 Cloud Foundation、Cloud DB、云函数或公网服务器。测试华为账号登录需要按第 3 节配置 AppGallery Connect。

## 2. 启动端云交互

先启动模拟器或连接真机，然后运行：

```powershell
D:\RestaurantAgent\server\start-demo.cmd
```

脚本执行两件事：

1. 调用 DevEco SDK 中的 HDC，建立 `设备 tcp:8787 -> 电脑 tcp:8787` 的反向端口映射。
2. 启动 Node 服务，监听 `http://0.0.0.0:8787`。

应用固定请求 `http://127.0.0.1:8787/v1/agent/execute`。因此无须查询模拟器或电脑局域网 IP，也无须改源码。服务启动后可在电脑浏览器打开 `http://127.0.0.1:8787/healthz` 检查状态。

需要手动执行时：

```powershell
& 'C:\Program Files\Huawei\DevEco Studio\sdk\default\openharmony\toolchains\hdc.exe' `
  rport tcp:8787 tcp:8787
cd D:\RestaurantAgent\server
npm start
```

## 3. 配置华为账号登录

登录页使用 Account Kit 的标准华为账号登录，账号与密码由华为系统页面处理，应用不接触用户密码。客户端将一次性 Authorization Code 传给 Node 服务，Node 服务通过 `/oauth2/v3/token` 换取并校验 ID Token，最后使用 UnionID/OpenID 关联本地用户。

1. 在 AppGallery Connect 创建 HarmonyOS 应用，包名必须与 `AppScope/app.json5` 的 `bundleName` 一致。
2. 配置调试签名和公钥指纹，并获取 OAuth 2.0 Client ID 与 Client Secret。
3. 将 Client ID 填入 `entry/src/main/resources/base/element/string.json` 的 `huawei_account_client_id`。
4. 复制 `server/.env.example` 为 `server/.env`，填入同一 OAuth 客户端的 `HUAWEI_CLIENT_ID` 和 `HUAWEI_CLIENT_SECRET`。
5. 用 DevEco Studio 的调试签名运行应用，不要直接安装 unsigned HAP。

Client Secret 只能保存在 Node 服务端，不得写入 HarmonyOS 工程或提交到 Git。Client ID、包名、调试证书指纹必须属于同一 AGC 应用。

## 4. 演示流程

1. 对话：“想吃清淡的素食”或“人均 100 元以内的江浙菜”。
2. 从推荐卡选择餐厅。
3. 点击“我已抵达”。有预置菜单的餐厅会直接给出菜品建议；“素源里”会引导上传菜单。
4. 上传任意小于 4 MB 的图片。演示服务会返回预置的识别结果，并标记低置信度字段。
5. 可输入“这道菜不是鱼，是豆腐”演示菜单纠错。
6. 点击“就餐完毕”，输入评价。评价会绑定当前会话与餐厅并保存到本地 JSON。

运行数据位于 `server/data/runtime.json`。需要恢复初始数据时，停止服务后删除该文件，再次启动即可重新生成。

## 5. 降级行为

- Node 服务未启动或端口未映射：端侧在短暂超时后自动使用 `MockAgent`，核心流程仍可演示。
- 模拟器缺少系统级 Agent HSP：演示版不引用 Agent Framework Kit，使用“快捷推荐”按钮进入同一端云业务链路。
- 上传图片：只用于演示交互，不调用真实 OCR，也不上传第三方平台。

## 6. 构建与常见问题

DevEco Studio 中使用 `Build > Build Hap(s)/APP(s) > Build Hap(s)`。命令行构建见根目录 README。

- `The root node is not yet available for build`：删除工程根目录误装的 `node_modules`，使用 DevEco Studio 自带的 Hvigor，不要在根目录安装 `@ohos/hvigor`。
- 应用总是显示端侧降级提示：确认模拟器已启动，再重新运行 `start-demo.cmd`，并检查控制台是否显示端口映射成功。
- `8787` 端口被占用：停止占用该端口的旧 Node 进程后重启脚本。
- 无法安装 unsigned HAP：在 DevEco Studio 中配置自动调试签名，然后直接点击运行。
