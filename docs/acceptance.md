# PRD V1.0 演示验收映射

| 编号 | 实现位置 | 状态 |
|---|---|---|
| AC-01 默认进入对话页 | `Index.ets` 的 `selectedTab = 1` | 已实现 |
| AC-02 自然语言推荐 | `/v1/agent/execute` + 确定性推荐 | 已实现并测试 |
| AC-03 推荐展开 | `AllRecommendationsPage()` | 已实现 |
| AC-04 商家详情 | `DetailPage()` | 已实现 |
| AC-05 选择餐厅 | 推荐卡/详情页 + `select_restaurant` | 已实现并测试 |
| AC-06 菜单缺失引导 | `arrive` 返回上传菜单提示 | 已实现并测试 |
| AC-07 菜单识别 | PhotoPicker/Base64 + 服务端预置识别结果 | 演示实现 |
| AC-08 完成就餐 | `finish_meal` 进入 REVIEW | 已实现并测试 |
| AC-09 评论保存 | Node JSON store，绑定 sessionId 与 restaurantId | 已实现并测试 |
| AC-10 发现页 | 搜索、菜系/口味筛选、详情入口 | 已实现 |
| AC-11 我的页 | 登录展示、昵称/籍贯/忌口/偏好 UI | 演示实现 |

## 已执行验证（2026-09-20）

- DevEco Studio 6.1.1/API 24 工具链构建成功，ArkTS 类型检查通过。
- 生成 `entry/build/default/outputs/default/entry-default-unsigned.hap`；未配置项目方签名。
- Node 服务 11/11 测试通过。
- 应用专用接口测试覆盖发现、推荐、选店、到店、菜单上传、菜品推荐、完成用餐和评论保存。
- 服务测试覆盖菜单纠错、评论脱敏、华为账号授权码登录、ID Token 校验、可选小艺 API Key 与餐厅上下文防串写。

## 本 toy project 不包含

- Cloud Foundation、Cloud DB、云函数和 AGC 云资源。
- 真实 OCR/大模型调用、真实商家数据、短信验证码和生产数据库。
- 应用商店发布签名、隐私合规材料及生产监控。

这些内容不影响本地端云交互演示；若后续转为正式项目，应单独设计生产级身份认证、数据源、存储、HTTPS 和隐私合规方案。
