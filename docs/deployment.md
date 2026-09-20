# 本地演示运行说明

## 1. 环境

- DevEco Studio 6.0+，HarmonyOS SDK API 20 或更高版本。
- HarmonyOS 模拟器或已开启调试的真机。
- Node.js 18+。若电脑未单独安装 Node.js，启动脚本会尝试使用 DevEco Studio 自带的 Node.js。

本演示不需要华为开发者账号、Cloud Foundation、Cloud DB、云函数或公网服务器。

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

## 3. 演示流程

1. 对话：“想吃清淡的素食”或“人均 100 元以内的江浙菜”。
2. 从推荐卡选择餐厅。
3. 点击“我已抵达”。有预置菜单的餐厅会直接给出菜品建议；“素源里”会引导上传菜单。
4. 上传任意小于 4 MB 的图片。演示服务会返回预置的识别结果，并标记低置信度字段。
5. 可输入“这道菜不是鱼，是豆腐”演示菜单纠错。
6. 点击“就餐完毕”，输入评价。评价会绑定当前会话与餐厅并保存到本地 JSON。

运行数据位于 `server/data/runtime.json`。需要恢复初始数据时，停止服务后删除该文件，再次启动即可重新生成。

## 4. 降级行为

- Node 服务未启动或端口未映射：端侧在短暂超时后自动使用 `MockAgent`，核心流程仍可演示。
- 模拟器缺少系统级 Agent HSP：演示版不引用 Agent Framework Kit，使用“快捷推荐”按钮进入同一端云业务链路。
- 上传图片：只用于演示交互，不调用真实 OCR，也不上传第三方平台。

## 5. 构建与常见问题

DevEco Studio 中使用 `Build > Build Hap(s)/APP(s) > Build Hap(s)`。命令行构建见根目录 README。

- `The root node is not yet available for build`：删除工程根目录误装的 `node_modules`，使用 DevEco Studio 自带的 Hvigor，不要在根目录安装 `@ohos/hvigor`。
- 应用总是显示端侧降级提示：确认模拟器已启动，再重新运行 `start-demo.cmd`，并检查控制台是否显示端口映射成功。
- `8787` 端口被占用：停止占用该端口的旧 Node 进程后重启脚本。
- 无法安装 unsigned HAP：在 DevEco Studio 中配置自动调试签名，然后直接点击运行。
