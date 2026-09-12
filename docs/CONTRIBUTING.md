# 参与开发

## 环境与脚本

```sh
pnpm install
pnpm run check        # typecheck + build + test + preflight
pnpm run verify-live  # 只读真机探测：打印归一化后的余额/窗口与档位（不回显任何密钥）
```

## 结构

- **宿主半**（`src/*.ts`）零运行时依赖：只通过结构化接口消费 DSH 服务，产物里没有需要 profile 解析的裸包 import。
- **浏览器半**（`src/client/*`）以 `window.__ModuleLoader__.load({ id, factory })` 闭包工厂产出，
  仅 `require` 平台模块表里的 `react` / `react/jsx-runtime`。
- 浏览器 bundle 的样式全部走主题 CSS 变量（`--dsw-alias-*`），明暗主题自动适配。

## 扩展新的提供商

一个文件 + 一行即可（`src/providers/`）：

1. 新建 `src/providers/<name>.ts`，导出 `Probe`：`id`、`label`、`match(routeId)`、`probe(host, signal)`。
   无凭证时 `throw new SkipSource('NO_CREDENTIAL', …)`，该来源就会自动隐藏。
2. 返回 `{ kind: 'balance', entries }` 或 `{ kind: 'quota', windows }`（见 `src/protocol.ts`）。
   余额只给金额（`{ currency, total }`），百分比只属于订阅窗口。
3. 在 `src/providers/index.ts` 的 `PROBES` 里加一条。

注意 `match(routeId)` 要与 DSH 的路由 id 对得上，否则自动模式永远不会读它——除非在 `sources` 里显式列出。

## 发布

发布走 GitHub Actions 的 **npm trusted publishing（OIDC）**：仓库里没有也不需要有 NPM_TOKEN。
给 `package.json` 提升版本号、提交后打一个 `v*` tag 并推送，`Publish` 工作流会自动
`npm publish --provenance`。详见 `.github/workflows/publish.yml` 头部的注释。

```sh
npm version patch -m "v%s"   # 或手改 package.json 的 version
git push --follow-tags
```

## 已知限制

- Moonshot 余额按官方规范实现；本机未配置该 Key，未经真机验证。
- 余额不做百分比与趋势预测：没有可信分母，低余额告警需要你配 `balanceThresholds`。
- 未在 harness 注册路由的账号默认不显示（这是刻意的；用 `sources` 可强制显示）。
- 订阅套餐名/会员等级（如 `ADVANCED`）不展示：卡片只保留「还剩多少」这一个问题。
- OpenCode 的 `/v1/usage` 未写入官方文档（由社区发现），字段可能变动；若某套餐没有该接口，卡片显示「无额度接口」。
- 热挂载要求行不带 `config:`；带配置的行需要重启 `dsh web`。
