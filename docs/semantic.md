# 语义文档：dsh-semantic-docs（语义文档系统工具面）

| 项 | 值 |
|----|----|
| 能力名 | dsh-semantic-docs（插件内 `name = 'semantic-docs'`；组合行 id `agent-semantic-docs`） |
| 主副本路径 | `self-plugins/dsh-semantic-docs/docs/semantic.md` |
| 实现落点 | `self-plugins/dsh-semantic-docs/src/index.ts`（4 个工具 + 出参归一 + 错误面）<br>`.../src/collect.ts`（IO 适配：`FsLike` 注入、扫描根、事实采集、原子写、upsert 编排）<br>`.../src/registry.ts`（纯逻辑：schema 校验 / 状态重判 / D1–D6 / INDEX 渲染）<br>`.../src/markdown.ts`（纯函数：文档解析——10 必备节、验收统计、未决问题、元信息）<br>`.../scripts/smoke.mjs`、`.../scripts/check-doc.mjs`（直测工具面，无需挂载） |
| 版本 | 0.1.0（`package.json`） |
| 挂载位置 | `E:\alice\.dsh\profiles\web\cordis.patch.yml` 第 251 行 `- insert:` / 第 252 行 `- id: agent-semantic-docs` / 第 253 行 `name: dsh-semantic-docs`；第 254–256 行 `config`（`enabled: true`、`workspace: E:/alice`） |
| 状态 | **draft**（补课文档；本插件无既有文档，验收条目多数待线上复核） |
| 依赖服务 | `inject = ['tools']`（无 webServer、无 loader） |
| 外部依赖 | 无网络、无子进程；只读写 `<workspace>/docs/semantics/**` 与各能力仓库的 `docs/semantic*.md` |
| 契约来源 | `docs/semantics/README.md`（语义文档系统规范）§4/§5/§6/§8 + `docs/semantics/templates/semantic.md`（模板） |

---

## 1 · 定位与反定位

**定位**：把「每个能力都有一份说清自身语义的文档」做成**可执行、可检查的设施**——读写语义文档注册表（`docs/semantics/registry.json`）、
按证据**重判**条目状态（声明 ≠ 事实）、跑 D1–D6 drift 检查、生成人类索引（`docs/semantics/INDEX.md`）。

**反定位（本文不管什么）**：
- 不写文档正文：注册表只存**引用**（I2 文档随代码）——`semantic_register` 绝不代写 `docs/semantic.md`
- 不是门禁/阻断器：`semantic_check` **只报不改**（README §0「给检查、不给阻止」），处置归主体
- 不是文档站/知识库：不做全文检索、不渲染页面
- 不是记忆库的替代：记忆记「发生过什么」，语义文档记「这个东西现在是什么」
- **不是沙箱**：它读写 workspace 内文件，**不校验调用者**、不构成权限边界（见 §5）

## 2 · 术语表

| 术语 | 含义 |
|------|------|
| 注册表（registry） | `<workspace>/docs/semantics/registry.json`——条目引用的**唯一真源**（version/updatedAt/workspace/entries[]） |
| 条目（entry） | `{id,title,doc,docVersion,status,owners[],twins[],impl[],acceptance,openQuestions,lastReviewedAt,notes}` |
| 声明状态 vs 现算状态 | `status` 是写进注册表的**声明**；`computed` 由 `evaluateStatus()` 按 impl 落点 + 文档解析重判 |
| 主副本 / 同语义副本 | 主副本在能力自身仓库（I1）；跨插件契约的其余落点必须**互相指认**（`twins`） |
| 必备 10 节 | README §4：元信息/定位与反定位/术语表/概念模型+不变量/契约/边界与信任/可证伪验收/与实现的关系/实践修订记录/未决问题——**按标题语义匹配**，缺一节报 D4 |
| proven / pending | 证据列含通过标记（`PASS_RE = /[✔✓✅]\|已实测\|实测通过\|已通过验收/`）即 proven；`pending = total - proven`（**fail-closed**） |
| pendingMarked | 显式标「待线上验收/待验收」（`PENDING_RE`）的行数；与 `unprovenUnmarked`（既未证也未标）并列暴露 |
| D3 抑制标记（`needReview`） | 文档正文命中 `src/markdown.ts:341` 的 `needReview` 正则 ⇒ **抑制 D3**（impl 比文档新也不报警）。**本文刻意不写出该字面**——写出来就等于自我抑制，机器判据会永久闭嘴；字面以源码为准 |
| drift 代码 | D1 路径不存在 / D2 声明高于证据 / D3 实现比文档新 / D4 缺必备节 / D5 未注册的语义文档 / D6 缺「实践修订记录」 |

## 3 · 概念模型

```
模型（爱丽丝）/ 主人
  │  4 个工具（semantic_list / semantic_get / semantic_check / semantic_register）
  ▼
src/index.ts:apply ── ws = config.workspace ?? process.cwd()
  ├─ loadRegistryState(ws, fs)              src/collect.ts:220
  │     └─ applyRegistration → upsertEntry → renderIndexMarkdown（写盘：tmp → rename，原子）
  ├─ collectEntryFacts(entry, ws, fs)       src/collect.ts:150（doc/impl/twins mtime + 存在性）
  │     └─ parseSemanticDoc(text)           src/markdown.ts:237（纯函数：10 节 / 验收统计 / 未决问题 / 元信息）
  ├─ detectDrift({entries, facts, unregisteredDocs, nowMs})   src/registry.ts:307  ← D1..D6
  ├─ evaluateStatus(...)                     src/registry.ts:225（声明 → 现算 + canPromote）
  └─ discoverSemanticDocs(ws, fs)            src/collect.ts:119 ← SCAN_ROOTS 四根（排除 docs/semantics/**）

落盘：<ws>/docs/semantics/registry.json（唯一真源） + <ws>/docs/semantics/INDEX.md（生成物，勿手改）
只读输入：<ws>/{docs,docs/*,*/docs,self-plugins/*/docs} 下的 docs/semantic*.md
```

不变量（invariants）：
1. **I1 只报不改**：`semantic_check` 绝不写文件（可测：跑 `semantic_check` 前后注册表与文档 mtime 不变）。
2. **I2 不吞异常**：注册表缺失/空文件/坏 JSON → **显式错误**（带绝对路径），绝不静默返回空清单；schema 不合法条目进 `schemaIssues` + `skipped`（**显式上报，不静默丢弃**）。
3. **I3 坏注册表拒绝覆盖**：`semantic_register` 遇到坏 JSON → 报错拒绝（坏注册表是证据，不许静默重建）。
4. **I4 原子写**：注册表与索引均 `writeFileSync(tmp)` → `renameSync`，无 BOM（`collect.ts:109-111`）。
5. **I5 状态现算**：任何工具返回的状态都经 `evaluateStatus` 重判；「声明高于证据」报 D2，「证据够而声明更低」只提示 `⤴可晋升`（不算 drift）。
6. **I6 出参纯 JSON**：所有返回值先过 `toJson`（`JSON.parse(JSON.stringify(...))`），满足 `output.schema` 与 deepFreeze 约束。

## 4 · 契约

### 4.1 配置与路径约定
| 项 | 值 |
|----|----|
| `enabled` | `true`（默认）——`false` 时 `apply` 内所有工具仍注册但工具本身不做开关判断（**配置为纯声明**，见 §8） |
| `workspace` | 可选；缺省 `process.cwd()`——注册表/索引/扫描根的基准 |
| 注册表 | `docs/semantics/registry.json`（`REGISTRY_REL`，`collect.ts:33`） |
| 索引 | `docs/semantics/INDEX.md`（`INDEX_REL`，`collect.ts:34`）——由 `semantic_register` 生成，**可重放，勿手改** |
| D5 扫描根 | `docs`、`docs/*`、`*/docs`、`self-plugins/*/docs`（`SCAN_ROOTS`，`collect.ts:39`）；**排除 `docs/semantics/**`**（`SYSTEM_DIR_PREFIX`，L36）与 `node_modules/.git/dist/lib` 等噪音 |
| 文档命名约定 | `docs/semantic.md`（固定名）；一仓多能力用 `docs/semantic-<topic>.md` |

### 4.2 工具面（4 个，`src/index.ts`）
| 工具 | 注册行 | 关键裁决 |
|------|-------|---------|
| `semantic_list` | L119–120 | 读注册表 + 现算状态 + 每条 drift 代码；可按 `status`（**声明**）与 `owner`（子串）过滤 |
| `semantic_get` | L231–232 | 单条详情：声明/现算状态 + **判据理由** + 文档大纲（标题树，前 80 条）+ 验收统计 + 未决清单 + impl/twins 存在性；id 不存在 → `ok:false` 并列出已知 id |
| `semantic_check` | L340–341 | D1–D6 全量或单条；返回 `summary`（error/warn + 每码计数）+ `actions`（按码给建议）+ `notes`（deprecated 抑制、D3 被 `needReview` 标记抑制、注册表快照与文档解析不一致、D5 未注册文档、扫描根） |
| `semantic_register` | L469–470 | 幂等 upsert（同 id 不重复）+ 重生成 `INDEX.md`；`acceptance`/`openQuestions` 由文档解析**自动回填**；坏注册表 → 拒绝 |

**状态 → 裁决表（`evaluateStatus`，`src/registry.ts:225`）**：

| 输入状态 | 裁决 | 依据 |
|---------|------|------|
| `verified` 但 `pending > 0` 或 `total = 0` | **D2 error**（声明高于证据） | README §5 |
| `implemented` 但 `impl` 全空 | **D2 error** | 同上 |
| 证据已足而声明更低（如 impl 在、pending=0） | 只给 `⤴可晋升` 提示，**不算 drift** | README §8.1 口径 3 |
| `deprecated` | 只查 D1（不参与 D2/D3/D4/D6） | README §5 |
| 文档命中 `needReview` 正则且 impl 比文档新 | **抑制 D3**（note 里列出被抑制的条目） | `needReview`（`markdown.ts:341`） |

### 4.3 调用点清单 `[MUST]`

| 调用方 | 调用点（文件:符号 / 行号） | 时机 |
|-------|--------------------------|------|
| web profile 组合 | `.dsh/profiles/web/cordis.patch.yml:251-256`（`id: agent-semantic-docs` + `enabled/workspace`） | web 启动挂载 |
| 插件本体 | `src/index.ts:110 apply(ctx, config)` → 四个 `ctx.tools.register(defineTool({…}))`（L119 / L231 / L340 / L469） | 挂载时注册 |
| 注册表读取 | `src/index.ts` 三处调 `loadRegistryState(workspace, fs)`（`semantic_list` / `semantic_get` / `semantic_check`）→ `src/collect.ts:220` | 每次调用 |
| 事实采集 | `src/collect.ts:150 collectEntryFacts` → `markdown.ts:237 parseSemanticDoc` + mtime 读取 | 每次调用 |
| drift 判定 | `src/registry.ts:307 detectDrift`（D1–D6；`DRIFT_HINTS` 于 L290） | `semantic_list` / `semantic_check` |
| 状态重判 | `src/registry.ts:225 evaluateStatus` | `semantic_list`（要显示 computed/canPromote） |
| 未注册扫描 | `src/collect.ts:119 discoverSemanticDocs`（四根，排除系统目录）→ D5 | `semantic_list` / `semantic_check` |
| 注册表写入 | `src/collect.ts:297 applyRegistration` → `registry.ts:431 upsertEntry` + `registry.ts:484 renderIndexMarkdown` → `collect.ts:109-111`（tmp→rename） | `semantic_register` |
| schema 校验 | `src/registry.ts:80 parseRegistry` / `124 validateRegistry` / `181 partitionEntries`（非法条目 → `skipped` + `schemaIssues`） | 每次调用 |
| 落盘产物 | `<workspace>/docs/semantics/registry.json`（唯一真源，原子写）<br>`<workspace>/docs/semantics/INDEX.md`（生成物） | `semantic_register` |
| 只读输入 | `<ws>/docs/semantics/*.md`（系统自身，**不参与 D5**）与四根下的 `docs/semantic*.md` | 每次调用 |
| 消费方 | 爱丽丝（写文档前查规范/注册表、写完跑 `semantic_check` 验收）；`docs/semantics/README.md` §7 生命周期门禁；收口时由队长登记本批 5 个插件条目 | 运行时 |
| 测试 | `tests/markdown.test.mjs`（解析：10 节/验收统计/未决问题）<br>`tests/status.test.mjs`（状态重判 + canPromote）<br>`tests/drift.test.mjs`（D1/D3/D4/D5/D6 + deprecated 只查 D1）<br>`tests/registry.test.mjs`（schema 校验 / upsert / INDEX 渲染）<br>`tests/corpse.test.mjs`（**尸体样本**：注册表缺失/坏 JSON/条目缺字段/文档路径不存在/D5 未注册/坏注册表拒写 + 好样本不误报）<br>`tests/helpers.mjs`（夹具） | `npm test` = `node --test "tests/*.test.mjs"` |
| 免挂载冒烟 | `scripts/smoke.mjs`（直测 `execute` + `render` + `output.schema` 一致性）<br>`scripts/check-doc.mjs`（单文档结构自检） | 手工 |

## 5 · 边界与信任

- 能力边界 ≠ 沙箱（README §6 在本插件内的落实）：它有权限读写 workspace 内**文档与注册表**——有权限的调用方就能改任意路径。**不要把它宣传为安全边界**。
- 不越界清单：不写文档正文；不删条目（无删除接口，只能 `deprecated`）；不阻止任何修改（无门禁、无阻断）；不做全文检索；不联网。
- 失败面：
  - **读失败**：注册表缺失 → 抛错（`semantic_list` 返回 `ok:false` + `error`，`registryPath` 仍给出）；坏 JSON → `RegistryParseError`（带路径）；条目 schema 不合法 → **跳过并显式上报**（`notes` + `schemaIssues`），不静默。
  - **写失败**：`semantic_register` 只在注册表可解析或不存在时写；坏注册表 → **拒绝覆盖**（I3）。写入走 tmp → rename，避免读到半截文件。
  - **解析脆弱面（诚实声明）**：靠 Markdown **标题语义**匹配（`/定位/`、`/契约/` 等），标题写法差异会漏判/误判；`PASS_RE`/`PENDING_RE` 是**字面契约**——验收状态列写错措辞会被判成未验收（技能 `semantic-doc-first` 反模式 ⑥ 的实测教训）。
  - **D3 依赖 mtime**：只比「impl 最新 mtime vs 文档 mtime」，不感知内容变更；时钟回拨/跨时区会失真。

## 6 · 与既有机制的关系

- 与 **AGENTS.md §5.20（语义文档系统纪律）**：本插件是该纪律的工具面；规则管「何时必须写、验收怎么算过」，本插件管「放哪、什么状态、有没有 drift」。
- 与 **技能 `semantic-doc-first`**：技能讲方法论（三拍/反模式），本插件讲系统契约（注册表/状态/D1–D6）；`PASS_RE` 与 `PENDING_RE` 的具体字面（`✔✓✅`/`已实测`/`实测通过`/`已通过验收`；`待线上验收`/`待验收`）以 `src/markdown.ts:120-121` 为准。
- 与 **`preflight_check`**：**未接线**——README §10 U2 明确「先只报不拦，观察误报率两周」；故改代码后的组合变更预检**不会**因「能力缺文档」而被拦。
- 与 **`dsh-plugin-bootreport`/`dsh-panel`**：无依赖关系；面板宿主里的语义文档视图（若有）另属 `dsh-panel`。
- 与 **队列/并行实例（§5.14）**：`registry.json` 是**共享单写面**——只应由一个实例（队长收口时）登记；多实例并发写会互相覆盖（写是整文件替换）。

**生效判据（改代码后怎么证明真的生效）**：
1. **产物比进程新**：`self-plugins/dsh-semantic-docs/lib/index.js` mtime **晚于**当前 web 进程启动时刻（§5.11 进程级判据）。
2. **工具面在场**：本会话能调 4 个 `semantic_*` 工具；`semantic_list` 返回 `registryPath` = `<workspace>/docs/semantics/registry.json`。
3. **行为可答**：`semantic_check` 返回 `summary` 形如 `error N · warn M · D1×… D6×…`；`semantic_list` 里能看到「D5 扫描根」note——证明 `workspace` 配置生效（不是 cwd 兜底）。
4. **写路径物证**：`semantic_register` 后 `registry.json` 与 `INDEX.md` 的 mtime **前进**（这是「写真的落了盘」的物证）。
5. **免挂载等价**：`node scripts/smoke.mjs` 直测 `execute` + `output.schema` 一致（无需重启即可验证改动）。

**回退**：`git revert` 最近一次提交（或 `git checkout -- src/`）→ `pnpm build` → 预检 → 哨兵/`daemon_restart` 重启 web。
配置回退：`plugin_configure dsh-semantic-docs` 还原 `{enabled, workspace}`（写 patch 时留 `.bak-<时间戳>`）。
**数据回退**：`registry.json`/`INDEX.md` 是本插件的写入面——误写用 `git checkout -- docs/semantics/`（两者都在 E:\alice 仓库内，受版本控制）恢复；**不要**手工编辑已坏 JSON 后再让工具重写（那是销毁证据）。

## 7 · 可证伪验收清单

| # | 可证伪命题 | 证据（单测名/命令/日志行） | 状态 |
|---|-----------|--------------------------|------|
| A1 | 4 个工具、名字与源码一致 | `grep -n "name: 'semantic_" src/index.ts` 恰 4 行 | 已实测（独立复核：恰 4 行） |
| A2 | 只报不改：`semantic_check` 不写文件 | 跑前后 `registry.json`/`INDEX.md` mtime 不变 | 待验收 |
| A3 | 不吞异常：注册表缺失/坏 JSON → 显式错误带路径 | `tests/corpse.test.mjs`「尸体：注册表不存在 → 抛错并带绝对路径」/「坏 JSON → 抛 RegistryParseError」 | 待验收 |
| A4 | 坏注册表拒绝覆盖（不为「修好」而重建） | `tests/corpse.test.mjs`「semantic_register 尸体：注册表坏 JSON → 拒绝覆盖」 | 待验收 |
| A5 | D4 按标题语义判缺节，且缺节逐点报出 | `tests/drift.test.mjs`「D4：必备结构缺节（缺 3 节，逐节点名）」 | 待验收 |
| A6 | D2 只报「声明高于证据」；证据够而声明低 → 只提示晋升 | `tests/status.test.mjs` + `registry.test.mjs` 对应用例 | 待验收 |
| A7 | D3 可被文档的 `needReview` 标记抑制 | `tests/drift.test.mjs` 的 D3 用例（「抑制」分支；用例名含该字面，本文不复述） | 待验收 |
| A8 | D5 排除 `docs/semantics/**`（系统自身不误报） | `tests/corpse.test.mjs`「D5：磁盘有 docs/semantic*.md 未注册（且排除 docs/semantics/**）」 | 待验收 |
| A9 | 未注册的新文档会被 D5 点名（本批 5 个插件即实例） | `semantic_check` 的 notes 里列出未注册的 `self-plugins/*/docs/semantic.md` | 待验收 |
| A10 | 写入原子（tmp → rename，无半截文件） | `grep -n "renameSync" src/collect.ts`（L111）+ 并发读压测未做 → 该项**只能算半验** | 待验收 |

## 8 · 与实现的关系

- 主实现：`src/index.ts`（工具面）；分层：`markdown.ts`（纯解析）→ `registry.ts`（纯逻辑）→ `collect.ts`（IO 适配，`FsLike` 注入）→ `index.ts`（Cordis 工具面）。时间与文件系统**都是注入的**，故 `tests/*.test.mjs` 可对 `lib/` 产物离线跑。
- 规范主副本：`docs/semantics/README.md`（系统契约）+ `docs/semantics/templates/semantic.md`（模板）——本插件是它们的**执行者**，不是它们的替代；规范变更须同步本文件 §4.2/§4.3 的字面常量。
- 同语义副本：无（本插件是 D1–D6 的唯一实现）。
- 未实现/未验证部分（显式标注）：
  - `Config.enabled` 是**声明性配置**：`apply` 内无任何 `if (!config.enabled) return` —— 设 `false` 不会禁用工具（`grep -n "config.enabled" src/index.ts` 无命中）。
  - **未接入 `preflight_check`**（README §10 U2：先只报不拦）。
  - 无自证轨迹/侧车日志（§5.22 五问中的「线上跑的是哪个构建 / 断在哪一段」目前只能靠进程 mtime 与工具返回推断）——本插件本身是**取证工具**，但缺少自己的运行留痕。
  - `semantic_check` 的 `issues` 不区分「同一码多条目」的聚合视图（仍逐条列出）。

## 9 · 实践修订记录

- **2026-09-14 补课：本插件此前无语义文档（可维护性工程）**
  - 语义**被确认**：只报不改 / 不吞异常 / 坏注册表拒绝覆盖 / 原子写 / 状态现算（声明 ≠ 事实）/ fail-closed 的 `pending` 口径 / D5 四扫描根且排除 `docs/semantics/**`。
  - 语义**被补充**：① `PASS_RE`/`PENDING_RE` 的**字面契约**（`markdown.ts:120-121`）——文档「给机器读的部分」是契约不是措辞；② `pendingMarked` / `unprovenUnmarked` 的双口径暴露（README §8.1 口径 1 的实现落点）；③ D3 的 `needReview` 抑制通道（本文刻意不复述其字面，见 §2）。
  - 语义**被修正**：无（首次成文）。记录一处**配置语义缺口**：`enabled` 声明了但未门控任何行为（§8）——不是 bug 但违反「声明即契约」直觉，需要显式写进文档而不是留在代码里。
  - 教训：**检查器自身也必须被检查**——本插件是 D1–D6 的判官，但它自己的 `enabled` 字段、写入面回退路径此前都无文档；「谁检查检查器」的答案是**语义文档 + 尸体测试**（`tests/corpse.test.mjs` 正是这一思路的先例）。

## 10 · 未决问题

- **U1 `enabled` 语义**：删除该字段、还是让它真正门控工具注册（`apply` 首行 return）？倾向：**接上门控**——否则「配置写着 false 但工具还在」是最坏的信息形态。
- **U2 门禁强度（承 README §10 U2）**：是否接入 `preflight_check`（改代码后若触及无文档能力 → 告警）？倾向：保持只报不拦，等误报率数据。
- **U3 解析强度（承 README §10 U3）**：Markdown 标题语义 + 正则是脆弱契约（本次补课就踩过措辞问题）。是否要求文档携带 YAML front-matter（机器可读的 status/acceptance）？倾向：**加 front-matter 为可选增强**，正则保留为回退。
- **U4 本插件自身的留痕**（§5.22 五问）：是否给自己加一条侧车轨迹（如最新一次 drift 检查的 `atMs/scope/error/warn` 计数）？倾向：值得——「上次检查是什么时候、结果如何」目前不可从外部回答。
- **U5 D5 的扫面与新增文档的时序**：本批 5 份补课文档落盘后，`semantic_check` 会立刻报 5 条 D5（未注册），直到队长登记。是否需要「已登记但文档在途」的过渡态？（倾向：不需要——D5 是 warn，正是提醒队长收口的信号）
- **U6 `twins` 的判据**：目前只是路径数组、只做存在性检查（D1），不校验「是否互相指认」。是否需要更严的判据（如双向声明检查）？
