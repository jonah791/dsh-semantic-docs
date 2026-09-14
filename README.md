<!--
  DSH 插件生态公约声明（plugin-ecosystem-convention · 组合优先/声明清晰/兼容优先）
  purpose: 语义文档系统——把「每个能力都有一份说清自身语义的文档」做成可执行、可检查的设施：注册表读写 + 状态按证据重判 + D1–D6 drift 检查 + 人类索引生成
  inject: 'tools'
  tools: semantic_list,semantic_get,semantic_check,semantic_register
  runtime: host-only（纯 Node 文件系统读写；无网络、无凭据）
  envDeps: 无（只需可写的 workspace 目录）
  boundary: **只报不改**（无门禁、不阻断）；不写文档正文（注册表只存引用）；**不是沙箱/权限边界**——它读写 workspace 内文件，不校验调用者
  compat: cordis ^4.0.1 / schemastery ^3.18.1-rc.1 / dsh-tools ^0.1.0-rc.6
-->
# dsh-semantic-docs

<p align="center">
  <a href="https://github.com/jonah791/dsh-semantic-docs"><img src="https://img.shields.io/badge/version-0.1.0-blue" alt="version"></a>
  <img src="https://img.shields.io/badge/License-MIT-green" alt="license">
  <img src="https://img.shields.io/badge/TypeScript-3178C6" alt="TypeScript">
  <img src="https://img.shields.io/badge/tests-41%20passed-brightgreen" alt="tests">
</p>

**一句话**：把「每个能力都有一份说清自身语义的文档」变成**可执行、可检查**的设施——4 个工具读写语义文档注册表、按证据**重判**条目状态、跑 D1–D6 drift 检查、生成人类索引。

**为什么值得用**：文档最危险的形态不是「没有」，而是**声称与事实不符**——注册表写着 `verified`，实际验收还有 pending；文档写着路径，那个文件早被搬走；实现改了，语义文档还停在上个版本。这类漂移**靠自觉发现不了**，靠人审又会漏。本插件把「声明」与「证据」（路径存在性、验收统计、mtime、必备结构节）分开维护，每次调用**现算**状态并报出判据理由——但它**只报不改**：报出来的是信号，处置归主体。

## 能力

| 工具 | 用途 | 关键语义 |
|------|------|---------|
| `semantic_list` | 列出语义文档注册表条目（可按 `status`/`owner` 过滤），并对每条**现算状态**（声明 ≠ 事实：按 `impl` 落点 + 文档解析出的验收 `pending` 重判） | 读注册表 + 现算 + 每条 drift 代码；`status` 过滤作用于**声明**，不是现算值 |
| `semantic_get` | 取单条语义文档条目详情：声明状态 + 现算状态（含判据理由）、文档大纲（标题树）、可证伪验收统计（总数/已证/待验）、未决问题数、`impl`/`twins` 落点存在性 | id 不存在 → `ok:false` 并列出已知 id（不静默返回空） |
| `semantic_check` | 语义文档 drift 检查（D1 路径不存在 / D2 状态与证据不符 / D3 实现比文档新 / D4 必备结构缺节 / D5 存在未注册的 `docs/semantic*.md` / D6 缺「实践修订记录」小节）+ 建议动作 | **只报不改**；缺省查全部条目，可传 `id` 单查；返回 `summary` + `actions` + `notes` |
| `semantic_register` | 登记/更新一条语义文档条目（幂等 upsert，同 id 不重复）并重新生成 `docs/semantics/INDEX.md` | 不写文档正文（I2：文档随代码）；`acceptance`/`openQuestions` 由文档解析**自动回填**；注册表坏 JSON → **拒绝覆盖**（坏注册表是证据，不许静默重建） |

**drift 判据**：

| 代号 | 判据 | 严重度 |
|------|------|-------|
| D1 | `doc` / `impl` / `twins` 路径不存在（含文档读取/解析失败） | error |
| D2 | 状态与证据不符（`verified` 但 `pending>0` 或 `total=0`；`implemented` 但 `impl` 全空） | error |
| D3 | 实现比文档新（impl 最新 mtime > 文档 mtime 且文档未标「待复核」） | warn |
| D4 | 必备结构缺节（10 项，按**标题语义**匹配） | error |
| D5 | 磁盘存在 `docs/semantic*.md` 但未注册（排除 `docs/semantics/**` 系统自身目录） | warn |
| D6 | 注册表指向的文档不含「实践修订记录」小节（实践回修载体缺失） | error |

**状态模型**：`draft → implemented → verified`（`deprecated` 保留留痕，只查 D1）。声明**低于**证据（可晋升）只提示 `⤴可晋升`，**不算 drift**——因为「draft 但 impl 已存在」也可能是实现进行中（语义精确性：不许用自己的判定掩盖合法状态）。

## 快速开始

**1) 装依赖**（自研插件家园 `self-plugins/`，在目标 profile 的 `package.json` 加 link 依赖）：

```jsonc
"dsh-semantic-docs": "link:<工作区>/self-plugins/dsh-semantic-docs"
```

**2) 挂组合**（agent 预设行）：

```yaml
- insert:
    - id: agent-semantic-docs
      name: dsh-semantic-docs
      config:
        enabled: true
        workspace: <工作区>
```

**3) 30 秒验证**：调 `semantic_check`（无参数 = 全量）

期望：返回 `summary`（error/warn 计数 + 每码计数）与 `actions`（按码给建议）。工作区里**没有任何已注册条目**时，你会看到一批 D5 warn（磁盘上有 `docs/semantic*.md` 但没登记）——这正是它该报的，不是故障。用一个已注册条目 id 调 `semantic_get`，应能看到「声明状态 vs 现算状态」两栏同时出现。

## 配置

| 项 | 默认 | 说明 |
|----|------|------|
| `enabled` | `true` | **当前是纯声明**：置 `false` 时 4 个工具仍注册（工具本身不做开关判断），见 `docs/semantic.md` §10 U1 |
| `workspace` | `process.cwd()` | 注册表/索引/扫描根的基准目录；建议由组合层显式给出 |

**路径约定**（固定，不改配置）：注册表 `<workspace>/docs/semantics/registry.json`（唯一真源）· 索引 `<workspace>/docs/semantics/INDEX.md`（生成物，**可重放，勿手改**）· 能力文档习惯命名 `docs/semantic.md`（一仓多能力用 `docs/semantic-<topic>.md`）。

## 落盘与自证（出问题时先看这里）

**本插件无侧车轨迹**（`<DSH_HOME>/semantic-docs-trace.jsonl` 之类尚不存在——「上次 drift 检查是什么时候、结果如何」目前**不可从外部回答**，见 §10 U4）。它的持久产物就是它管理的两个文件：

| 落点 | 写者 | 说明 |
|------|------|------|
| `<workspace>/docs/semantics/registry.json` | `semantic_register` | **唯一真源**；原子写（tmp → rename），无 BOM；坏 JSON 时**拒绝覆盖** |
| `<workspace>/docs/semantics/INDEX.md` | `semantic_register` | 人类索引；由注册表**可重放**生成——手改必被覆盖 |

`semantic_list` / `semantic_get` / `semantic_check` **只读**：跑前后两个文件的 mtime 应完全不变（这是「只报不改」的可证伪判据）。

**行为级替代（无 trace 时的五问）**：

```bash
node scripts/smoke.mjs && ls -l <workspace>/docs/semantics/
# ① 线上跑的是哪个构建 → 无 build 字段；改为比 lib/index.js mtime 与 web 进程启动时间（见「生效判据」）
# ② 谁发起             → 无 caller 字段；发起者可查会话事件流（工具调用记录）
# ③ 断在哪一段         → 阶段枚举由返回值给出：注册表缺失(显式错误+路径) → 解析失败(D1) → schema 不合法(skipped + schemaIssues) → 判定完成(summary/actions)
# ④ 结果质量           → summary 的 error/warn 计数 + 每码计数；notes 里列出被抑制项（deprecated / needReview 抑制 D3 / 未注册文档）
# ⑤ 耗时与预算         → 无耗时字段；D5 扫描面 = 4 个根目录（跳过 node_modules/.git/dist/lib），条目多时为主要成本
```

**不吞异常**是硬约束：注册表缺失 / 空文件 / 坏 JSON / 条目 schema 不合法 → **显式错误或 issues（带绝对路径）**，绝不静默返回空清单。

## 生效判据与回退

**生效判据**（三选一）：
1. 行为级：`semantic_check` 可调用并返回结构化 `summary`；`semantic_get` 传一个已知 id 能返回「声明 vs 现算」两栏；
2. 产物级：`lib/index.js` 的 mtime **早于** web 进程启动时间 ⇒ 进程在跑当前构建；
3. 生态级：`plugin_boot_status`（`dsh-plugin-bootreport`）的 `live` 含 `dsh-semantic-docs`、`stale` 为空 ⇒ 判据 2 的机器化版本。

> 注意：**重新构建 ≠ 生效**——`npx tsc -p tsconfig.json` 只写了一个新产物，**进程启动时间必须晚于产物 mtime** 才算「在跑它」。缺这一条时不得宣称「已生效」。
> 另注意：**配置写着 `enabled: false` ≠ 工具被摘掉**（当前实现如此，§10 U1）——要真正停用请用组合层 `disabled: true`。

**回退**：
- 源码级：`git -C self-plugins/dsh-semantic-docs revert <commit>` → 重新构建 → 预检 → 重启；
- 组合级：预设里给 `agent-semantic-docs` 行加 `disabled: true`（或移除该行）→ 哨兵重启；
- 运行期：本插件**只写自己管理的两个文件**，回退后它们仍是合法 JSON/Markdown（可继续被人读）；如需回到登记前的状态，用 git 回滚 `docs/semantics/registry.json` 即可（`INDEX.md` 可由注册表重新生成）。

## 测试

```bash
npm test        # = node --test "tests/*.test.mjs"（跑 lib/ 产物，与运行时同源）
```

**41 例离线测试**（41/41 通过）：

- `tests/markdown.test.mjs` —— 纯解析层：标题树、必备节语义匹配、验收清单解析、`needReview` 标记；
- `tests/status.test.mjs` —— 状态重判：`verified` 但 `pending>0` → D2；证据够而声明低 → 只提示晋升；`deprecated` 不参与重判；
- `tests/drift.test.mjs` —— D1–D6 逐码判据，含 D4 缺节逐点名与 D3 被 `needReview` 抑制的分支；
- `tests/registry.test.mjs` —— schema 校验、非法条目 partition 到 `skipped` + `schemaIssues`、INDEX 渲染可重放；
- `tests/corpse.test.mjs` —— **尸体测试**：注册表不存在 → 抛错并带绝对路径；坏 JSON → `RegistryParseError`；`semantic_register` 遇坏注册表 → **拒绝覆盖**；D5 排除 `docs/semantics/**`。

**离线单测不需要网络、不需要挂载插件、不需要 WSL**：时间与文件系统都是**注入**的（`FsLike`），纯逻辑层可直跑 `lib/` 产物。补充冒烟：`node scripts/smoke.mjs`（直测 `execute` + `render` + `output.schema` 一致性，不需挂载）。

## 设计要点

- **分层是测试性的前提**：`markdown.ts`（纯函数解析）→ `registry.ts`（纯逻辑：schema/状态判定/D1–D6/INDEX 渲染）→ `collect.ts`（IO 适配，`FsLike` 注入）→ `index.ts`（Cordis 工具面）。**时间与文件系统都是注入的**，所以能离线对产物跑测试——新增判定逻辑必须落在纯逻辑层，不要写进工具闭包。
- **声明与事实分离**：注册表存的是**声明**；每次调用按证据**现算**。二者不一致就报 drift，而不是自动改写声明——「自动把状态改成一致」会掩盖问题（且会破坏「坏注册表是证据」的原则）。
- **fail-closed 的 `pending` 口径**：`acceptance.pending` = 未取得通过证据的验收行数（`total - proven`），而非仅统计字面标「待线上验收」的行数；字面口径另以 `pendingMarked` 单独暴露（两面都可见，避免口径漂移）。
- **写入原子**：注册表与索引均 tmp → rename，避免读到半截文件。
- **只报不改是刻意的能力边界**：本插件**不阻止**任何修改、不接入 `preflight_check`（先观察误报率）。若把它当门禁用，会得到「检查过了」的错觉而实际无阻断。
- **解析基于 Markdown 标题语义**是已知脆弱点：标题写法差异会漏判/误判，故工具输出附带「命中的原始证据」（标题/行号/行原文）便于人工复核；机器可读 front-matter 属未决问题（§10 U3）。
- **D3 只比 mtime**：不感知内容变更；跨时区/时钟回拨会失真。

### 能力边界诚实声明（capability ≠ sandbox）

本插件读写 workspace 内的**文档与注册表**，有权限的调用方就能改任意路径——**不要把它宣传为安全边界或隔离机制**。

## 相关文档

| 文档 | 内容 |
|------|------|
| [`docs/semantic.md`](docs/semantic.md) | **权威契约**：定位与反定位、术语、契约（配置与路径约定 + 状态→裁决表 + 调用点清单）、可证伪验收清单（A1–A10）、未决问题（U1–U6） |
| `docs/semantics/README.md`（工作区内） | 语义文档**系统规范**（路径约定、必备 10 节、状态模型、D1–D6 定义、模板） |
| [alice-digital-life](https://github.com/jonah791/alice-digital-life) | 本插件所属生态的中心索引（全部自研插件） |
| 技能 `semantic-doc-first` / `dsh-plugin-development` | 语义文档优先开发模式（先写「是什么」再动手）、插件开发契约 |

## License

MIT © jonah791

---

本插件属于我的数字生命爱丽丝（[alice-digital-life](https://github.com/jonah791/alice-digital-life)）的 DSH 自研插件生态——**50 个插件**按生命/认知/感知/行动/通信/治理/呈现七层组织。
