# 配置参考

所有配置都写在 `cordis.patch.yml` 里那一行的 `config:` 段；改动后重启 `dsh web` 生效。
全部可选项，缺省值来自 `src/config.ts`。

## 完整示例

```yaml
- insert:
    - id: llm-balance
      name: 'dsh-llm-balance'
      config:
        defaultMode: all          # current | summary | all
        percentMode: used         # used(已用) | left(剩余)；只影响订阅窗口的显示，配色恒按剩余
        thresholds: { warn: 40, error: 20 }        # 订阅窗口的剩余% 分档
        balanceThresholds:                          # 余额的绝对金额分档（默认不配 = 余额不变色）
          'deepseek-balance:CNY': { warnBelow: 40, errorBelow: 20 }
          'moonshot-balance:*':   { warnBelow: 5 }
        colors: { normal: '#4d6bfe', active: '#22c55e' }   # 可只覆盖其中一档（active = 在用绿点）
        sources: auto             # auto = 只读已注册 LLM 路由对应的来源；或显式数组 [{ id, label, apiKeyEnv, baseURL, region }]
        refreshMs: 60000
        timeoutMs: 8000
        deepseek: { apiKeyEnv: DEEPSEEK_API_KEY } # baseURL 可覆盖，默认跟随 llm-deepseek 设置
        moonshot: { region: cn }                  # cn=CNY(.cn 主机) | intl=USD(.ai 主机)
        kimiCode:
          apiKeyEnv: KIMI_API_KEY
          tokenFile: ~/.kimi-code/credentials/kimi-code.json
          persistRefreshedToken: true
        opencode:                                 # 仅当要覆盖 opencode* 族的默认端点/凭证时才需要
          baseURL: https://opencode.ai/zen/go
          apiKeyEnv: OPENCODE_GO_API_KEY
```

## 显示哪些来源（`sources`）

自动模式（`sources: auto`）以 **`ctx.llm.listProviders()` 里已注册的路由**为准：
未接入的账号即使本机有凭证也不读。**每个已注册路由都会出现在卡片上**——已实现探针的显示真实数据，
其余显示一行「无额度接口」占位（不发起任何请求），所以配置了 3 个提供商就会看到 3 行，不会莫名其妙少一个。

想监控一个尚未接入 harness 的账号，就显式列出来（会绕过路由门，此时它永远不算「当前使用中」）：

```yaml
sources:
  - { id: kimi-code, label: Kimi For Coding }
```

反过来，一旦在 DSH 里配好 `kimi-coding` 路由（例如通过 `llm-pi-ai`），Kimi 会自动出现，无需改配置。

## 余额的颜色

余额没有可信的分母，因此**不显示百分比**：只报金额，并按你在 `balanceThresholds` 里给的
**绝对金额**分档（键为 `"<sourceId>:<CURRENCY>"`，支持 `"<sourceId>:*"` 通配币种）。
默认不配 → 余额恒为正常色；余额为负（欠费）一律按红处理。

## 订阅窗口的颜色与格式

每个窗口一行：`频限（47%） 3d0h0m重置` = 窗口标签 +（已用百分比）+ 倒计时 + `重置`。
窗口标签按语义区分：`频限`（滚动限流窗）/ `周` / `月` / `日`——提供商标称几个窗口就显示几行
（OpenCode Go 报 3 个：频限 / 周 / 月）。倒计时用紧凑单位，不足一天给 `5h0m`，超过一天给 `3d0h0m`。

显示的是**已用 %**（`percentMode: left` 可切回剩余 %），但颜色始终由**剩余 %** 决定：
剩余 `<20%` 红、`<40%` 黄、其余蓝。也就是说「已用 92%」会是红的——因为只剩 8%。
原始计数与提供商标称的窗口长度（如 `5小时`）放在该行的悬浮提示里，不占正文。

## 凭证与端点跟随路由

来源读取的是**该 harness 实际路由到的账号**：若 `kimi-coding` / `opencode-go` 等路由在 `llm-pi-ai` 里声明了
`apiKeyEnv`（例如 `KIMI_CODING_API_KEY`、`OPENCODE_GO_API_KEY`），插件优先用它；DeepSeek 同理跟随
`llm-deepseek` 设置节。端点也随路由：`opencode-go` → `https://opencode.ai/zen/go/v1/usage`，
`opencode` / `opencode-zen` → `https://opencode.ai/zen/v1/usage`（可用 `opencode.baseURL` 覆盖）。

凭证按**候选链**依次尝试，而不是只猜一个名字：路由声明的引用 → 插件自己的配置 → **由路由 id 推导的名字**
（`opencode-go` → `OPENCODE_GO_API_KEY`）→ 目录默认名（`OPENCODE_API_KEY`）。设置节也**每次读取**而非挂载时快照，
所以运行中新增提供商、或插件与 `llm-pi-ai` 的挂载顺序不确定，都不会让某个来源误判为「没有凭证」。
若某来源最终仍读不到，卡片显示「无额度接口」，把鼠标悬停在该行可看到具体原因（例如它尝试过哪些凭证名）。

## Kimi For Coding 的登录态

优先该路由声明的 `apiKeyEnv`，其次 `KIMI_API_KEY`；都没有时读 Kimi Code CLI 的 OAuth 文件（access_token 只有约 15 分钟寿命）。
过期时插件用 `refresh_token` 换取新令牌，并且**只在凭证文件与读取时逐字节一致**时才原子回写
（CAS），因此永远不会覆盖 CLI 刚写入的新令牌。设 `persistRefreshedToken: false` 则纯只读、只在内存中
使用新令牌。
