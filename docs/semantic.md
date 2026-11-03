# 语义文档：dsh-semantic-docs（语义文档系统工具面）

| 项 | 值 |
|----|----|
| 能力名 | dsh-semantic-docs（插件内 `name = 'semantic-docs'`；组合行 id `agent-semantic-docs`） |
| 主副本路径 | `self-plugins/dsh-semantic-docs/docs/semantic.md` |
| 实现落点 | `self-plugins/dsh-semantic-docs/src/index.ts`（5 个工具 + 出参归一 + 错误面）<br>`.../src/collect.ts`（IO 适配：`FsLike` 注入、扫描根、事实采集、原子写、upsert 编排）<br>`.../src/registry.ts`（纯逻辑：schema 校验 / 状态重判 / D1–D7 / 快照对账 / INDEX 渲染）<br>`.../src/markdown.ts`（纯函数：文档解析——10 必备节、验收统计、未决问题、元信息）<br>`.../scripts/smoke.mjs`、`.../scripts/check-doc.mjs`（直测工具面，无需挂载） |
| 版本 | 0.1.0（`package.json`） |
| 挂载位置 | `E:\alice\.dsh\profiles\web\cordis.patch.yml` 第 251 行 `- insert:` / 第 252 行 `- id: agent-semantic-docs` / 第 253 行 `name: dsh-semantic-docs`；第 254–256 行 `config`（`enabled: true`、`workspace: E:/alice`） |
| 状态 | **draft**（补课文档；本插件无既有文档，验收条目多数待线上复核） |
| 依赖服务 | `inject = ['tools']`（无 webServer、无 loader） |
| 外部依赖 | 无网络、无子进程；只读写 `<workspace>/docs/semantics/**` 与各能力仓库的 `docs/semantic*.md` |
| 契约来源 | `docs/semantics/README.md`（语义文档系统规范）§4/§5/§6/§8 + `docs/semantics/templates/semantic.md`（模板） |

---

## 1 · 定位与反定位

**定位**：把「每个能力都有一份说清自身语义的文档」做成**可执行、可检查的设施**——读写语义文档注册表（`docs/semantics/registry.json`）、 按证据**重判**条目状态（声明 ≠ 事实）、跑 D1–D7 drift 检查、生成人类索引（`docs/semantics/INDEX.md`）。

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
| D3 抑制标记（`needReview`） | 文档正文命中 `src/markdown.ts:378` 的 `needReview` 正则 ⇒ **抑制 D3**（impl 比文档新也不报警）。**本文刻意不写出该字面**——写出来就等于自我抑制，机器判据会永久闭嘴；字面以源码为准 |
| drift 代码 | D1 路径不存在 / D2 声明高于证据 / D3 实现比文档新 / D4 缺必备节 / D5 未注册的语义文档 / D6 缺「实践修订记录」 / **D7 近义词误读**（**证据格**以词表外写法开头 ⇒ 人读已证、机器读未验；**只报不拦**） / **快照对账**（非 D 码，走 `notes`+`summary`：注册表 `acceptance` 与文档解析对账，**缺失与不一致都报**） |
| 快照来源三态 | `doc`（文档解析回填，doc 缺省时回退条目既有 doc）· `explicit`（调用方显式给定，**只有它能清空**）· `untouched`（未动既有字段）——见 §4.4 |

## 3 · 概念模型

```
模型（爱丽丝）/ 主人
  │  5 个工具（semantic_list / semantic_get / semantic_check / semantic_register / semantic_unregister）
  ▼
src/index.ts:apply ── ws = config.workspace ?? process.cwd()
  ├─ loadRegistryState(ws, fs)              src/collect.ts:349
  │     └─ applyRegistration → upsertEntry → renderIndexMarkdown（写盘：tmp → rename，原子）
  ├─ collectEntryFacts(entry, ws, fs)       src/collect.ts:253（doc/impl/twins mtime + 存在性）
  │     └─ parseSemanticDoc(text)           src/markdown.ts:269（纯函数：10 节 / 验收统计 / 未决问题 / 元信息；span 取层级最浅命中 L188）
  ├─ detectDrift({entries, facts, unregisteredDocs, nowMs})   src/registry.ts:343  ← D1..D7
  ├─ compareAcceptanceSnapshot(id, reg, parsed)                src/registry.ts:489  ← 快照对账（非 D 码）
  ├─ evaluateStatus(...)                     src/registry.ts:225（声明 → 现算 + canPromote）
  └─ discoverSemanticDocs(ws, fs)            src/collect.ts:222 ← SCAN_ROOTS 四根（排除 docs/semantics/**）

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

### 4.2 工具面（5 个，`src/index.ts`）
| 工具 | 注册行 | 关键裁决 |
|------|-------|---------|
| `semantic_list` | L129–130 | 读注册表 + 现算状态 + 每条 drift 代码；可按 `status`（**声明**）与 `owner`（子串）过滤 |
| `semantic_get` | L241–242 | 单条详情：声明/现算状态 + **判据理由** + 文档大纲（标题树，前 80 条）+ 验收统计 + 未决清单 + impl/twins 存在性；id 不存在 → `ok:false` 并列出已知 id |
| `semantic_check` | L356–357 | D1–D7 全量或单条；返回 `summary`（error/warn + 每码计数 + **快照对账计数**）+ `actions`（码表**从 `DRIFT_CODES` 派生**，判据扩张自动跟随）+ `notes`（deprecated 抑制、D3 被 `needReview` 标记抑制、**快照对账逐条**（缺失与不一致都报）、D5 未注册文档、扫描根） |
| `semantic_register` | L508–509 | 幂等 upsert（同 id 不重复）+ 重生成 `INDEX.md`；`acceptance`/`openQuestions` 按 §4.4 三来源写入（doc 缺省时**回退条目既有 doc**；解析不可得**保留原值、不写 `null`**）；坏注册表 → 拒绝 |
| `semantic_unregister` | L622–623 | 注销条目（**只删注册表条目，不删文档正文**——正文归 `plugin_purge`）；`dryRun:true` 先看 `referencedBy` 悬空引用；id 未命中 → 报错不静默；不写盘 |

**状态 → 裁决表（`evaluateStatus`，`src/registry.ts:225`）**：

| 输入状态 | 裁决 | 依据 |
|---------|------|------|
| `verified` 但 `pending > 0` 或 `total = 0` | **D2 error**（声明高于证据） | README §5 |
| `implemented` 但 `impl` 全空 | **D2 error** | 同上 |
| 证据已足而声明更低（如 impl 在、pending=0） | 只给 `⤴可晋升` 提示，**不算 drift** | §5 |
| `deprecated` | 只查 D1（不参与 D2/D3/D4/D6） | README §5 |
| 文档命中 `needReview` 正则且 impl 比文档新 | **抑制 D3**（note 里列出被抑制的条目） | `needReview`（`markdown.ts:341`） |

### 4.3 调用点清单 `[MUST]`

| 调用方 | 调用点（文件:符号 / 行号） | 时机 |
|-------|--------------------------|------|
| web profile 组合 | `.dsh/profiles/web/cordis.patch.yml:251-256`（`id: agent-semantic-docs` + `enabled/workspace`） | web 启动挂载 |
| 插件本体 | `src/index.ts:120 apply(ctx, config)` → **5 个** `ctx.tools.register(defineTool({…}))`（L129 / L241 / L356 / L508 / L622） | 挂载时注册 |
| 注册表读取 | `src/index.ts` 四处调 `loadRegistryState`（`semantic_list` / `semantic_get` / `semantic_check` / `semantic_unregister` 干跑）→ `src/collect.ts:349` | 每次调用 |
| 事实采集 | `src/collect.ts:253 collectEntryFacts` → `markdown.ts:256 parseSemanticDoc` + mtime 读取 | 每次调用 |
| drift 判定 | `src/registry.ts:343 detectDrift`（D1–D7；`DRIFT_HINTS` 于 L325） | `semantic_list` / `semantic_check` |
| 快照对账 | `src/registry.ts:489 compareAcceptanceSnapshot`（`semantic_check` 的 notes + summary 计数；`acceptanceFromDoc` 于 L460） | `semantic_check` |
| 状态重判 | `src/registry.ts:225 evaluateStatus` | `semantic_list`（要显示 computed/canPromote） |
| 未注册扫描 | `src/collect.ts:222 discoverSemanticDocs`（四根，排除系统目录）→ D5 | `semantic_list` / `semantic_check` |
| 注册表写入 | `src/collect.ts:438 applyRegistration` → `registry.ts:549 upsertEntry` + `registry.ts:602 renderIndexMarkdown` → `collect.ts:210-214`（tmp→rename） | `semantic_register` |
| 注册表移除 | `src/collect.ts:549 applyRemoval` → `registry.ts:649 removeEntry`（含 `referencedBy` 悬空引用） | `semantic_unregister` |
| schema 校验 | `src/registry.ts:80 parseRegistry` / `124 validateRegistry` / `181 partitionEntries`（非法条目 → `skipped` + `schemaIssues`） | 每次调用 |
| 落盘产物 | `<workspace>/docs/semantics/registry.json`（唯一真源，原子写）<br>`<workspace>/docs/semantics/INDEX.md`（生成物） | `semantic_register` |
| 只读输入 | `<ws>/docs/semantics/*.md`（系统自身，**不参与 D5**）与四根下的 `docs/semantic*.md` | 每次调用 |
| 消费方 | 爱丽丝（写文档前查规范/注册表、写完跑 `semantic_check` 验收）；`docs/semantics/README.md` §7 生命周期门禁；收口时由队长登记本批 5 个插件条目 | 运行时 |
| 测试 | `tests/markdown.test.mjs`（解析：10 节/验收统计/未决问题/D7 近义词）<br>`tests/status.test.mjs`（状态重判 + canPromote）<br>`tests/drift.test.mjs`（D1/D3/D4/D5/D6/D7 + deprecated 只查 D1）<br>`tests/d3-attribution.test.mjs`（D3 成因 A/B 归因 + git 不可用退回 mtime）<br>`tests/registry.test.mjs`（schema 校验 / upsert / INDEX 渲染）<br>`tests/corpse.test.mjs`（**尸体样本**：注册表缺失/坏 JSON/条目缺字段/文档路径不存在/D5 未注册/坏注册表拒写 + 好样本不误报）<br>`tests/unregister.test.mjs`（注销：命中/未命中/悬空引用/坏注册表）<br>`tests/snapshot.test.mjs`（**快照对账**：三态可区分 + 不带 doc 不清空 + doc 回退既有值）<br>`tests/doc-parity.test.mjs`（**文档 ↔ 源码对账**：工具集合 / 声明列表 / 测试清单 / drift 码表不漂移）<br>`tests/helpers.mjs`（夹具；`cleanupAll` **只清本进程**建的目录——并发文件共享 `.work` 会互相清场） | `npm test` = `node --test "tests/*.test.mjs"` |
| 免挂载冒烟 | `scripts/smoke.mjs`（直测 `execute` + `render` + `output.schema` 一致性）<br>`scripts/check-doc.mjs`（单文档结构自检） | 手工 |

### 4.4 快照来源与对账口径

`acceptance` / `openQuestions` 是**解析结果的快照**，来源三态（`SnapshotSource`，`collect.ts:432`）。

⚠ **本节标题曾经不得含「验收 / 可证伪」**——2026-10-09 当天该限制已由解析器修掉：`findSpan` 现取**层级最浅**的命中（同级取文档序最先），`##` 正式节永远赢过 `###` 子标题。事故与判据见 §5「解析脆弱面」与 §9。

| 来源 | 触发条件 | 结果 |
|------|---------|------|
| `doc` | doc 可解析（`patch.doc` 缺省时**回退条目既有 `doc`**——只改 title/status 也能刷新快照） | 按文档解析回填 `total/proven/pending` + `openQuestions` |
| `explicit` | 调用方**显式**给 `acceptance` / `openQuestions`（含显式 `null`） | 按给的写——**只有这条路能清空** |
| `untouched` | doc 不可得（未提供且既有无 doc / 文件不存在）或新建无 doc | **不动既有字段**（不是写 `null`） |

**对账**（`compareAcceptanceSnapshot`，`registry.ts:489`；`semantic_check` 逐条报进 `notes`，计数进 `summary`）：
- 比 **`total` 与 `pending` 两个字段**——只比 `pending` 会让「total 变化」的陈旧快照静默（2026-10-09 实测 9 条）。
- **快照缺失（`null`）单独报**：不可对账 ≠ 已对齐。旧判据 `if (reg === null || parsed === null) continue` 把两者压成同一输出，而 `reg === null` 恰是写侧缺陷的产物 ⇒ **缺陷把告警关掉了**。
- 文档不可用（缺失/读失败）⇒ 不在此报（那是 D1 的域，不重复）——对账**从不**对不可判定对象发火。

**失败面**：文档读取/解析异常 ⇒ **抛错、整个注册不写盘**（原快照因此天然保留；fail-loud，不写半个状态）。

## 5 · 边界与信任

- 能力边界 ≠ 沙箱（README §6 在本插件内的落实）：它有权限读写 workspace 内**文档与注册表**——有权限的调用方就能改任意路径。**不要把它宣传为安全边界**。
- 不越界清单：不写文档正文；不删条目（无删除接口，只能 `deprecated`）；不阻止任何修改（无门禁、无阻断）；不做全文检索；不联网。
- 失败面：
  - **读失败**：注册表缺失 → 抛错（`semantic_list` 返回 `ok:false` + `error`，`registryPath` 仍给出）；坏 JSON → `RegistryParseError`（带路径）；条目 schema 不合法 → **跳过并显式上报**（`notes` + `schemaIssues`），不静默。
  - **写失败**：`semantic_register` 只在注册表可解析或不存在时写；坏注册表 → **拒绝覆盖**（I3）。写入走 tmp → rename，避免读到半截文件。
  - **解析脆弱面（诚实声明）**：靠 Markdown **标题语义**匹配（`/定位/`、`/契约/` 等），标题写法差异会漏判/误判；`PASS_RE`/`PENDING_RE` 是**字面契约**——验收状态列写错措辞会被判成未验收（技能 `semantic-doc-first` 反模式 ⑥ 的实测教训）。
  - **节 span 的层级契约**（2026-10-09 修正后）：`findSpan` 取**层级最浅**的命中（同级取文档序最先）。此前取「文档序首个命中」，于是排在前面的子标题会抢走正式节的 span——`### 4.4 验收快照…` 曾抢走 `## 7 · 可证伪验收清单`，使 A1–A17 被读成子节那 3 行（`0/3/3`），**错读数被静默写进注册表**。只按层级择优即修好；全库 72 份文档实测该修正读数为**零变化**（注册表快照前后一致）。
  - **表格分块契约**（2026-09-22 修正后）：表头判据 = 「**第二行是分隔行**」。被空行切断的续块**没有分隔行**，故其首行按**数据行**计入（此前无条件丢首行 ⇒ 续块首行被静默吞掉）。⇒ 文档作者**不必**为美观而避免表格中间的空行，但**不要**在续块里重复写表头（那会被当数据行计入 `total`）。
  - **行内单元格口径（2026-11-03 修订，取代「只认最后一个非空单元格」）**：`parseTables` 先读**表头认列**——`命题`（同义词 `判据`/`主张`）、`证据`（同义词 `依据`/`佐证`/`装置`/`手段`）、`状态`（同义词 `结果`/`结论`）；证据取**证据列**、状态取**状态列**，两者不再混成一格。表头没点名证据列时**退回**旧口径（行内最后一个非空单元格）。两条不变：**非空单元格 < 2 的行整行丢弃**；`\|` 是**转义竖线**不是列分隔符（早先按竖线硬切会让列数虚增、后续全列错位——`dsh-llm-retry`/`dsh-code-search`/`dsh-clyan` 的验收行实测 5–6 格）。⚠ 已验判定是旧口径的**超集（只增不减）**：状态格写着「已实测」又写「线上验收未通过」的行**仍算已验**——这是**已知 fail-open**（已登记），改动会让 17 份文档共 29 行一起翻，属语义决定，留给文档作者单独裁决。
  - **D3 依赖 mtime**：只比「impl 最新 mtime vs 文档 mtime」，不感知内容变更；时钟回拨/跨时区会失真。

## 6 · 与既有机制的关系

- 与 **AGENTS.md §5.20（语义文档系统纪律）**：本插件是该纪律的工具面；规则管「何时必须写、验收怎么算过」，本插件管「放哪、什么状态、有没有 drift」。
- 与 **技能 `semantic-doc-first`**：技能讲方法论（三拍/反模式），本插件讲系统契约（注册表/状态/D1–D7）；`PASS_RE` 与 `PENDING_RE` 的具体字面（`✔✓✅`/`已实测`/`实测通过`/`已通过验收`；`待线上验收`/`待验收`）以 `src/markdown.ts:124-125` 为准。
- 与 **`preflight_check`**：**未接线**——README §10 U2 明确「先只报不拦，观察误报率两周」；故改代码后的组合变更预检**不会**因「能力缺文档」而被拦。
- 与 **`dsh-plugin-bootreport`/`dsh-panel`**：无依赖关系；面板宿主里的语义文档视图（若有）另属 `dsh-panel`。
- 与 **队列/并行实例（§5.14）**：`registry.json` 是**共享单写面**——只应由一个实例（队长收口时）登记；多实例并发写会互相覆盖（写是整文件替换）。

**生效判据（改代码后怎么证明真的生效）**：
1. **产物比进程新**：`self-plugins/dsh-semantic-docs/lib/index.js` mtime **晚于**当前 web 进程启动时刻（§5.11 进程级判据）。
2. **工具面在场**：本会话能调 4 个 `semantic_*` 工具；`semantic_list` 返回 `registryPath` = `<workspace>/docs/semantics/registry.json`。
3. **行为可答**：`semantic_check` 返回 `summary` 形如 `error N · warn M · D1×… D7×…`；`semantic_list` 里能看到「D5 扫描根」note——证明 `workspace` 配置生效（不是 cwd 兜底）。
4. **写路径物证**：`semantic_register` 后 `registry.json` 与 `INDEX.md` 的 mtime **前进**（这是「写真的落了盘」的物证）。
5. **免挂载等价**：`node scripts/smoke.mjs` 直测 `execute` + `output.schema` 一致（无需重启即可验证改动）。

**回退**：`git revert` 最近一次提交（或 `git checkout -- src/`）→ `pnpm build` → 预检 → 哨兵/`daemon_restart` 重启 web。 配置回退：`plugin_configure dsh-semantic-docs` 还原 `{enabled, workspace}`（写 patch 时留 `.bak-<时间戳>`）。 **数据回退**：`registry.json`/`INDEX.md` 是本插件的写入面——误写用 `git checkout -- docs/semantics/`（两者都在 E:\alice 仓库内，受版本控制）恢复；**不要**手工编辑已坏 JSON 后再让工具重写（那是销毁证据）。

## 7 · 可证伪验收清单

| # | 可证伪命题 | 证据（单测名/命令/日志行） | 状态 |
|---|-----------|--------------------------|------|
| A1 | 工具集合在**源码 / 本文件 §4.2 / `README.md` 声明头**三处一致（数量与名字） | `tests/doc-parity.test.mjs`（三处取集合比对）；源码侧独立复核 `grep -c "name: 'semantic_"` = **5** | ✔ 已实测（2026-10-09；此前 A1 写「4 个」已为假——一次实测被当成永久已实测） |
| A2 | 只报不改：`semantic_check` 不写文件 | 跑前后 `registry.json`/`INDEX.md` mtime 不变 | 待验收 |
| A3 | 不吞异常：注册表缺失/坏 JSON → 显式错误带路径 | `tests/corpse.test.mjs`「尸体：注册表不存在 → 抛错并带绝对路径」/「坏 JSON → 抛 RegistryParseError」 | 待验收 |
| A4 | 坏注册表拒绝覆盖（不为「修好」而重建） | `tests/corpse.test.mjs`「semantic_register 尸体：注册表坏 JSON → 拒绝覆盖」 | 待验收 |
| A5 | D4 按标题语义判缺节，且缺节逐点报出 | `tests/drift.test.mjs`「D4：必备结构缺节（缺 3 节，逐节点名）」 | 待验收 |
| A6 | D2 只报「声明高于证据」；证据够而声明低 → 只提示晋升 | `tests/status.test.mjs` + `registry.test.mjs` 对应用例 | 待验收 |
| A7 | D3 可被文档的 `needReview` 标记抑制 | `tests/drift.test.mjs` 的 D3 用例（「抑制」分支；用例名含该字面，本文不复述） | 待验收 |
| A8 | D5 排除 `docs/semantics/**`（系统自身不误报） | `tests/corpse.test.mjs`「D5：磁盘有 docs/semantic*.md 未注册（且排除 docs/semantics/**）」 | 待验收 |
| A9 | 未注册的新文档会被 D5 点名（本批 5 个插件即实例） | `semantic_check` 的 notes 里列出未注册的 `self-plugins/*/docs/semantic.md` | 待验收 |
| A10 | 写入原子（tmp → rename，无半截文件） | `grep -n "renameSync" src/collect.ts`（L111）+ 并发读压测未做 → 该项**只能算半验** | 待验收 |
| A11 | 表格被空行切成多块时，**续块的首数据行不被当表头吞掉**（表头判据 = 第二行是分隔行） | `tests/markdown.test.mjs`「表格中间的空行不得吃掉数据行（续块无表头——2026-09-22 实测缺陷）」+「有表头的正常表格仍不吃数据行（修正不得反噬正常形态）」；全量对账：64 份注册文档解析 `total` 合计 **961** == 人眼口径 961（mismatch 0） | 已实测 |
| A12 | **D3 的真源是「已提交」而非 mtime**：工作区未提交改动 / 行尾归一致 mtime 变新 ⇒ **不报** | `tests/d3-attribution.test.mjs`「成因 B 尸体样本…不得报 D3」+ 对照组「真有新提交 ⇒ 照常报 D3」；**进程外实测**（真工作区 64 条，同语料 A/B）：旧判据 8 条 → 新判据 7 条，差额 = `semantic-docs-tooling` | 已实测 |
| A13 | **共享装配点抑制**：触发提交同时更新了**别的条目**文档 ⇒ 抑制本条 D3，且在 notes 点名披露（不静默） | `tests/d3-attribution.test.mjs`「成因 A 尸体样本…被抑制」+「非共享对照仍是 warn」+ `suppressedBySharedAssembly` 边界（碰的是**本条自己的**文档 ⇒ 不算） | 已实测（单测）；⚠ 真实语料当前**无命中**（A 的活体面未出现），如实标注 |
| A14 | git 不可用/未纳入版本控制 ⇒ **退回 mtime 判据且消息自带范围标注**（不静默换判据） | `tests/d3-attribution.test.mjs`「git 不可用 ⇒ 退回 mtime…消息必须明说『未经版本控制核对』」 | 已实测 |
| A15 | **D7 近义词误读**：**证据格**首以词表外近义词（「已证 / 已验证 / 已验收」…）开头 ⇒ 报 warn 且**不改任何状态判定**；词表内写法与**长散文格** ⇒ 一条不报 | `tests/markdown.test.mjs`（尸体 2 命中 / 对照 0；夹具为**三列**表——四列表的状态格写「已验证」是结论，不是误读）+ `tests/drift.test.mjs`（D7 恰 1 条 warn · D2=0；对照 0）+ **全库 67 份真语料 nearMiss = 0**（2026-10-09 那轮已把 55 行词表外写法逐份改写） | ✔ 已实测 |
| A16 | **快照对账**：`total` 或 `pending` 任一不一致 ⇒ 报；**快照 `null` ⇒ 单独报「缺失」而非静默**；文档不可用 ⇒ 不报（D1 的域） | `tests/snapshot.test.mjs` 三例（含**两边一致 ⇒ 不报**的对照）；只读探针基线：72 条 ⇒ 缺失 0 · pending 差 0 · **total 差 9** · 对齐 60 | ✔ 已实测（探针 9 条已由登记动作回填归零） |
| A17 | **不带 `doc` 的注册不清空既有快照**；doc 缺省时**回退条目既有 `doc`** 重解析；只有**显式** `acceptance` 才能清空 | `tests/snapshot.test.mjs` 四例：尸体「不带 doc 不得清空既有快照」+「doc 指向不存在的文件 ⇒ 保留」+ 正路「只改 status ⇒ 用原有 doc 回填」+「显式给 acceptance ⇒ 按给的写」 | ✔ 已实测 |
| A18 | **节 span 取层级最浅的命中**：排在前面的 `### …验收…` 子标题**不得**抢走 `## …可证伪验收…` 的 span（同级取文档序最先；只有子标题命中时仍能解析） | `tests/markdown.test.mjs` 尸体「子标题不得抢走正式验收节的 span」（**先跑旧产物确认 RED**）+ 反向对照「只有子标题命中时仍能解析」；全库 72 份文档实测**读数为零变化** | ✔ 已实测 |
| A19 | **四列表（编号 / 命题 / 证据 / 状态）按列名取格**：状态格的「已验证」算已验；证据取自证据列；转义竖线不切列 | `tests/markdown.test.mjs` 三条（四列表正样本 / 转义竖线 / **caveat 钉住现状**）+ `tests/drift.test.mjs` 三列表夹具；**全库 67 份逐份比对 = 只增不减**：`proven` 合计 **+21 行、0 行下降**，`dsh-llm-probe` 由 `0/8/8` 变 `8/8/0`；`npm test` **82/82** | ✔ 已实测（2026-11-03） |

## 8 · 与实现的关系

- 主实现：`src/index.ts`（工具面）；分层：`markdown.ts`（纯解析）→ `registry.ts`（纯逻辑）→ `collect.ts`（IO 适配，`FsLike` + `GitLike` **双注入**）→ `index.ts`（Cordis 工具面）。时间与文件系统**都是注入的**，故 `tests/*.test.mjs` 可对 `lib/` 产物离线跑。`GitLike` 缺省 `createNullGit()`（D3 退回 mtime），生产由 `index.ts` 注入 `createNodeGit(workspace)`（按仓库聚合一次 `git log --name-only`，整个 state 装载共用一份缓存）。
- 规范主副本：`docs/semantics/README.md`（系统契约）+ `docs/semantics/templates/semantic.md`（模板）——本插件是它们的**执行者**，不是它们的替代；规范变更须同步本文件 §4.2/§4.3 的字面常量。
- 同语义副本：无（本插件是 D1–D7 的唯一实现）。
- 未实现/未验证部分（显式标注）：
  - `Config.enabled` 是**声明性配置**：`apply` 内无任何 `if (!config.enabled) return` —— 设 `false` 不会禁用工具（`grep -n "config.enabled" src/index.ts` 无命中）。
  - **未接入 `preflight_check`**（README §10 U2：先只报不拦）。
  - 无自证轨迹/侧车日志（§5.22 五问中的「线上跑的是哪个构建 / 断在哪一段」目前只能靠进程 mtime 与工具返回推断）——本插件本身是**取证工具**，但缺少自己的运行留痕。
  - `semantic_check` 的 `issues` 不区分「同一码多条目」的聚合视图（仍逐条列出）。

## 9 · 实践修订记录

- **2026-09-14 补课：本插件此前无语义文档（可维护性工程）**
  - 语义**被确认**：只报不改 / 不吞异常 / 坏注册表拒绝覆盖 / 原子写 / 状态现算（声明 ≠ 事实）/ fail-closed 的 `pending` 口径 / D5 四扫描根且排除 `docs/semantics/**`。
  - 语义**被补充**：① `PASS_RE`/`PENDING_RE` 的**字面契约**（`markdown.ts:120-121`）——文档「给机器读的部分」是契约不是措辞；② `pendingMarked` / `unprovenUnmarked` 的双口径暴露（口径见 §2 / §4.4；此处是实现落点）；③ D3 的 `needReview` 抑制通道（本文刻意不复述其字面，见 §2）。
  - 语义**被修正**：无（首次成文）。记录一处**配置语义缺口**：`enabled` 声明了但未门控任何行为（§8）——不是 bug 但违反「声明即契约」直觉，需要显式写进文档而不是留在代码里。
  - 教训：**检查器自身也必须被检查**——本插件是 D1–D7 的判官，但它自己的 `enabled` 字段、写入面回退路径此前都无文档；「谁检查检查器」的答案是**语义文档 + 尸体测试**（`tests/corpse.test.mjs` 正是这一思路的先例）。

- **2026-09-22 修正：表格续块的首数据行被当表头吞掉（`parseTables`）**
  - 语义**被修正**：原实现无条件 `body = block.slice(1)` 丢首行，**只有**见到分隔行时才再丢一行。⇒ 表格被空行切成多块时，后续块既无表头也无分隔行，其**首数据行被静默吃掉**。实测受害：`panel-host` 与 `memory-continuity` 各漏 1 行验收（后者的 A45 因此长期不在 `total` 里，使其 `verified` 判据（`pending==0`）**偏松**）。修正后表头判据 = 「**第二行是分隔行**时首行才是表头」，无分隔行 ⇒ 整块按数据行计入。
  - 判据：新增两条单测，**先确认修正前会红**（RED 已记录：期望 `total=4`，实得 3）；修后全套 **43/43 pass**；**全量对账**：64 份注册文档解析 `total` 合计 **961**，与「逐块：有分隔行减 2、无分隔行全计」的人眼口径 **961** 完全一致（mismatch 0）。
  - **我的量尺也错了两次（同批留档）**：① 先用 `| A\d+ |` 计数 ⇒ 把 `pipeRows=0` 的文档（实际用 `| 1 |` / `| U1 |` 编号）误判成漏行；② 改用「管道行 − 分隔行」⇒ **漏减表头**，把 4 份**完全正常**的文档判成 MISMATCH（其中 `dream-tavern` 的「表头」是 `| 轮 | 请求字数 |…` 这类数据化表头）。⇒ 教训：**判定他人漏行之前，先证明自己的计数口径与解析器语义等价**——两次都是尺子错，不是被量对象错。
  - 方法论：**新判据先喂已知坏样本、确认它会亮**（AGENTS.md §5.9 规则 2，同日布线）——本次严格执行 RED → 修 → GREEN，因此「修好了」是读数而不是感觉。

- **2026-09-22 判据域修正：D3 的真源从 mtime 换成「已提交」（t-c54b41c6 成因 A/B）**
  - 语义**被修正（判据域）**：D3 原为「impl 最新 **mtime** > doc mtime」，而 mtime 会被**未提交改动**与**行尾归一（renormalize）**推新而语义没变 ⇒ 空报。真源改为**最后一次提交**：新增 `GitLike` seam（`collect.ts`，按仓库聚合一次 `git log --name-only` 并全 state 共用缓存；有界窗口 `-n3000`，查不到即返回 `null` 并**退回 mtime 且消息里明说「未经版本控制核对」**——不静默换判据）。
  - 语义**被补充（成因 A 的处置）**：触发提交**同时更新了别的条目文档** ⇒ 判为**共享装配点**（`src/index.ts` 这类被多条语义登记的文件）⇒ **抑制本条 D3**，并在 `semantic_check` 的 notes 里**点名披露**（抑制若无声 = 另一种静默失效，§5.17）。判定抽成 `suppressedBySharedAssembly`（**唯一真源**：抑制与 notes 调同一个函数）。
  - 语义**被修正（我的实现自伤，当场改掉）**：抑制一度写成 `return` ⇒ 会连本条后面的 **D4/D6 检查一起跳过**（一个缺陷换另一个）⇒ 改为条件包裹。
  - 判据：单测 **43 → 49/49**（新增 6，见 A12–A14）；**进程外运行期实测**（真工作区 64 条）：新判据 D3 = 7 条且全部有真实新提交；5 条「有未提交改动」的条目**一条都不在 D3 里**。
  - ⚠ **读数范围更正（我自己的措辞错）**：那 5 条是「修复覆盖的**候选集**」，而本语料上旧判据**实测**只多报 1 条（`semantic-docs-tooling`）——其余 4 条的 doc mtime 本就更晚、从未触发过 D3。**不把候选集说成实测差额**（同族纪律：读数必须自带范围）。
  - 另记一处低级自伤：一度把 JSDoc 写成 `mtime/**提交**/…`，其中 `*/` **提前闭合注释**导致 tsc 报错——注释里写 `/**` 序列要当心。

- **2026-10-09 · D7 近义词误读（任务 `t-a49e40a8`）：把「人读已证、机器读未验」从靠人碰巧看见，变成机制自己举手。**
  - 语义**被补充**：drift 家族加 **D7**（warn · **只报不拦**）——「已证 / 已验证 / 已验收」这类**人读等于已证**的写法落在 `proven` 的严格词表外 ⇒ 机器读作「毫无证据」。同型两次：2026-09-15 `agent-cluster` 18 条「已验证」⇒ `0/18/18`；2026-10-09 `agent-reconstruction` 9 条「已证」⇒ `0/11`——**同一个坑换了词，两次都靠人碰巧看见 `semantic_get`**。
  - 判据**先标定后上线**（§5.9 规则 2）：① **金标准** = 词表内写法（`✔✓✅`/「已实测」）与显式「待线上验收」⇒ 不得发火；② **尸体样本取自真实语料**（修复前的两张表 + 全库扫描）；③ **锚点由量决定**：宽口径（格内任意位置）时 4 条**长散文格**误报（最后一格是整段说明，行文里出现「已由…实现」）⇒ 收敛为**锚定格首**后，全库 **55 行 / 8 份**真命中、长散文假阳性 **0**。
  - 语义**被修正（写夹具时的自伤）**：断言写成硬编码 `行 3、4`，而机制报的是真实行号 `21、22`——**红的是我的断言，不是机制**。改为**从解析结果取行号**（既有测试早已踩过「硬编码 → 一次正当回写就打崩」）。教训：**夹具断言别写脆值**。
  - 读数：`npm test` **62/62**（新增 5 例：markdown 3 + drift 2）；全库 69 份 / 1,132 行 ⇒ 已证 835 · 显式待验 213 · 未证未标 84 · 其中**近义词误读 55 行 / 8 份文档**。
  - ⚠ **本判据只解决「看得见」，不解决那 55 行本身**——逐份改写是**另一批活**（已开任务）。

- **2026-10-09 · 快照对账闭环（任务 `t-cdb92e72`）：把「不可对账」从「没问题」里拆出来。**
  - 语义**被修正（写侧）**：`applyRegistration` 原为 `let acceptance = patch.acceptance ?? null`，把「未提供」折叠成 `null`；`upsertEntry` 只判 `!== undefined` ⇒ **不带 `doc` 的注册把既有快照清成 `null`**（我用单参数 `semantic_register` 回填时亲手中招）。现为三来源（§4.4），且 doc 缺省时**回退条目既有 `doc`** 重解析。
  - 语义**被修正（判据侧 · 同型第三、四次）**：判据原为 `if (reg === null || parsed === null) continue` ⇒ **「无法对账」与「已对齐」在输出上完全同形**，而 `reg === null` 恰是写侧缺陷的产物 ⇒ **缺陷把告警关掉，输出反而更干净**。现在缺失单独报，对账**含 `total`**（同日实测 9 条只差 total 的陈旧快照本来静默）。判定抽成纯函数 `compareAcceptanceSnapshot`。
  - 语义**被补充（手写枚举）**：`semantic_check` 的 `actions`/`summary` 硬写 `['D1'…'D6']` ⇒ **D7 上线后既没进 `actions` 也没进 `summary`**，上一轮写的 `DRIFT_HINTS.D7` 没有任何界面会显示它。改为**从 `DRIFT_CODES` 派生**。
  - 语义**被修正（源码 ↔ 文档漂移）**：`semantic_unregister` 早已存在，而 §3 图 / §4.2 表 / §4.3 调用点 / **A1 验收行** / `README.md` 声明头与能力表 / 源码头注释全写「4 个工具」——**A1 标着「已实测」却已为假**（一次实测被当成永久已实测）。修正并新增 `tests/doc-parity.test.mjs`，把「同一事实在三处出现」变成**集合相等的门禁**（上线即抓出 README 能力表、§4.3 测试清单、README drift 码表三处漂移）。
  - 判据**先标定后上线**：先跑只读探针拿基线（真注册表 72 条 ⇒ 快照缺失 **0** / pending 差 **0** / **total 差 9** / doc 缺失 3 / 对齐 60），再改代码；新判据先 RED（`compareAcceptanceSnapshot` 不存在）后 GREEN。
  - 附带抓出**夹具并发竞态**：`cleanupAll()` 删共享 `tests/.work` 根，而 `node --test` 每文件一进程并发 ⇒ Windows `ENOTEMPTY`，**5 跑 1 红**，看起来像被测代码不稳（实际是夹具互相清场）。改为**只清本进程建的目录**，复测 **12 跑 0 红**。
  - 附带抓出**解析器的节 span 缺陷（第 2 个「静默错读数」）**：`findSpan` 原按**文档序**取首个命中 `/可证伪|验收/` 的标题 ⇒ 我在本节原名 `### 4.4 验收快照…` 的小标题抢走了 `## 7 · 可证伪验收清单` 的 span，A1–A17 被读成那张 3 行来源表（**`0/3/3`**），且错读数被 `semantic_register` **静默写进注册表**。修为**取层级最浅的命中**并加尸体样本（先跑旧产物确认 RED）。爆炸半径实测 **0/72**，全库读数**零变化**。
  - 读数：`npm test` **69 → 76 → 78/78**；`docs/semantics/README.md` §6 改指针 + 本文件 §4.4 为准；同批完成上一轮 D7 报出的 **55 行**验收改写（`D7×` 归零）；线上 `semantic_check` 的 `快照对账×9 → ×0`。

- **2026-11-03 · 四列表支持（长时域 `lh-c6ba677d`）：把「取最后一格」换成「按表头认列」。**
  - 语义**被修正（判据域）**：证据格原为「行内最后一个非空单元格」。三列表（`# | 命题 | 证据`）那样取是对的，**四列表**（`# | 命题 | 证据 | 状态`）就取到了状态格——`dsh-llm-probe` 8 条写着 `已验证`，于是被当成「证据是『已验证』」，它不在 `PASS_RE` 词表里 ⇒ **8 条真·已验被读成未验**，而且是**静默**的：读数只是一个偏小的数字，没有任何东西提示我取错列了。
  - 语义**被修正（口径即位置 → 口径即角色）**：改为读表头认列（命题 / 证据〔依据·佐证·装置·手段〕/ 状态〔结果·结论〕），证据与状态分开成两个字段。
  - 语义**被修正（转义竖线，隐藏缺陷）**：`splitRow` 原直接按竖线切，**不认 `\|`**。真实语料里 `dsh-llm-retry` / `dsh-code-search` / `dsh-clyan` 的证据格含命令行或正则里的转义竖线 ⇒ 列数虚增到 5–6，「证据」「状态」都被切成碎片。这个 bug 一直在，只是旧口径「取最后一格」把它掩盖了；一按列名取格它就成硬伤。
  - **第一版改错了，靠全库读数当场抓住**：先给「状态格显式写未通过」加了一票否决 ⇒ 17 份文档 29 行 `proven` 一起翻（`dsh-agent-self-rewrite` 66 行里 59 行、`dsh-agent-quant` 8 行全灭）。原因是这些行的状态格把「已实测（单测）」与「⚠ 线上验收未通过」写在同一格。⇒ 判据改成**旧口径的超集（只增不减）**，并把这个 fail-open **钉成一条 caveat 测试 + 单独登记**，不藏进「修解析」里。
  - 判据**先标定后上线**：先用旧产物跑一遍全库 67 份逐份读数存基线（`.dsh/tmp/census-before.txt`），改完再跑同一脚本做 diff ⇒ 验收线是「**零下降**」，不是「测试绿了」。
  - 读数：`npm test` **78 → 82/82**（新增 5 例、改 2 例夹具）；全库 67 份 ⇒ `proven` **+21 行 / 0 行下降**，`nearMiss` **8 → 0**（`KNOWN_GAP` 从 `['…llm-probe…: 8 条']` 清空为 `[]`）；`dsh-llm-probe` 由 `0/8/8` 变 `8/8/0`，`dsh-model-test` 5→12。
  - ⚠ **未修（如实声明）**：「状态格同一格里既有已实测又有线上未通过」仍算已验（fail-open，29 行 / 17 份）。修它需要文档作者决定「单测过、线上没过」算不算已验，不是解析层能单方面裁的。

## 10 · 未决问题

- **U1 `enabled` 语义**：删除该字段、还是让它真正门控工具注册（`apply` 首行 return）？倾向：**接上门控**——否则「配置写着 false 但工具还在」是最坏的信息形态。
- **U2 门禁强度（承 README §10 U2）**：是否接入 `preflight_check`（改代码后若触及无文档能力 → 告警）？倾向：保持只报不拦，等误报率数据。
- **U3 解析强度（承 README §10 U3）**：Markdown 标题语义 + 正则是脆弱契约（本次补课就踩过措辞问题）。是否要求文档携带 YAML front-matter（机器可读的 status/acceptance）？倾向：**加 front-matter 为可选增强**，正则保留为回退。
- **U4 本插件自身的留痕**（§5.22 五问）：是否给自己加一条侧车轨迹（如最新一次 drift 检查的 `atMs/scope/error/warn` 计数）？倾向：值得——「上次检查是什么时候、结果如何」目前不可从外部回答。
- **U5 D5 的扫面与新增文档的时序**：本批 5 份补课文档落盘后，`semantic_check` 会立刻报 5 条 D5（未注册），直到队长登记。是否需要「已登记但文档在途」的过渡态？（倾向：不需要——D5 是 warn，正是提醒队长收口的信号）
- **U6 `twins` 的判据**：目前只是路径数组、只做存在性检查（D1），不校验「是否互相指认」。是否需要更严的判据（如双向声明检查）？
