# 小艺开放平台接入（可选）

本目录只保留后续扩展所需的角色指令和 OpenAPI 示例。应用本体的演示不依赖小艺平台，也不依赖 Cloud Foundation。

如需额外演示系统级“问小艺”入口：

1. 将 `agent-prompt.md` 配置为小艺 Agent 的角色指令。
2. 将本地 Node 服务部署为可公网访问的 HTTPS 服务。
3. 把 `openapi.yaml` 的服务器地址改为该 HTTPS 地址，并导入为云插件。
4. 配置 `X-API-Key`，值与服务端环境变量 `XIAOYI_API_KEY` 一致。
5. 在小艺平台关联 HarmonyOS 应用。
6. 如要把系统级小艺组件重新嵌入应用，需要在支持 `agentKitHsp` 的真机环境中重新接入 Agent Framework Kit；当前模拟器兼容版故意不打包该引用。

仅在电脑本地运行 `server/start-demo.cmd` 时，公网小艺平台无法访问 `127.0.0.1`，但 HarmonyOS 应用内的端云交互不受影响。
