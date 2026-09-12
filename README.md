# dsh-semantic-docs

> 版本 v0.1.0 · 2026-09-12 · 作者：爱丽丝 · License MIT
> 契约来源：`docs/semantics/README.md`（语义文档系统规范）§4 / §5 / §6 / §8

## 1 · 定位与反定位

**这是什么**：把「每个能力都有一份说清自身语义的文档」这件事在 DSH 里**做成可执行、可检查的设施**——
提供语义文档注册表（`docs/semantics/registry.json`）的读写工具、状态重判、D1–D6 drift 检查与人类索引生成。

**这不是什么（反定位）**：
- **不是文档站/知识库**：不追求好看、不做全文检索站，只服务「写代码前先说清语义」
- **不是 README 的替代**：README 面向使用者（安装/用法），语义文档面向实现者与未来的我（是什么/什么关系/怎么裁决/边界在哪）
- **不是门禁/阻断器**：`semantic_check` **只报不改**——drift 报出来，处置归主体（主人/爱丽丝）
- **不是沙箱**：见 §6 能力边界诚实声明
- **不写文档正文**：注册表只存引用（I2 文档随代码），本插件绝不代写 `docs/semantic.md`

## 2 · 功能（四个工具）

| 工具 | 用途 | 关键语义 |
|------|------|---------|
| `semantic_list` | 列出注册表条目（可按 `status` / `owner` 过滤） | 读注册表 + **现算状态**（声明 ≠ 事实）+ 每条 drift 代码 |
| `semantic_get` | 取单条详情（文档大纲 + 验收统计 + 未决问题） | 解析文档小节存在性与计数 |
| `semantic_check` | drift 检查 D1–D6 + 建议动作 | **只报不改**；缺省全部条目，可传 `id` 单查 |
| `semantic_register` | 新增/更新条目（写注册表 + 重新生成 `INDEX.md`） | 幂等 upsert；`acceptance`/`openQuestions` 由文档解析回填 |

**drift 判据（README §8）**：

| 代号 | 判据 | 严重度 |
|------|------|-------|
| D1 | `doc` / `impl` / `twins` 路径不存在（含文档读取/解析失败） | error |
| D2 | 状态与证据不符（`verified` 但 `pending>0` 或 `total=0`；`implemented` 但 `impl` 全空） | error |
| D3 | 实现比文档新（impl 最新 mtime > 文档 mtime 且文档未标「待复核」） | warn |
| D4 | 必备结构缺节（README §4 的 10 项，按**标题语义**匹配） | error |
| D5 | 磁盘存在 `docs/semantic*.md` 但未注册（排除 `docs/semantics/**` 系统自身目录） | warn |
| D6 | 注册表指向的文档不含「实践修订记录」小节（I3 载体缺失） | error |

**状态模型（README §5）**：`draft → implemented → verified`（`deprecated` 保留留痕，只查 D1）。
声明不与证据同向时报 D2；**证据够而声明更低**（可晋升）只在 `semantic_list` / `semantic_get` 里提示 `⤴可晋升`，
不算 drift——因为「draft 但 impl 文件已存在」也可能是实现进行中（语义精确性：不许用自己的判定掩盖合法状态）。

## 3 · 安装与配置

作为 DSH Cordis 插件挂载（`type: module`，入口 `lib/index.js`）。配置：

```yaml
- name: dsh-semantic-docs
  config:
    enabled: true
    workspace: E:\alice   # 缺省 = process.cwd()
```

- 注册表：`<workspace>/docs/semantics/registry.json`（唯一真源）
- 索引：`<workspace>/docs/semantics/INDEX.md`（**由 `semantic_register` 生成，可重放，勿手改**）

## 4 · 构建与测试

**构建前提**：`node_modules/@types/node` 是本目录内指向 `dsh-agent-sentinel/node_modules/.pnpm/@types+node@22.20.1/...` 的 junction
（仅供 tsc 解析 node 类型，等价于 `pnpm install` 的结果）；`@deepseek-ai/*` 不落本地副本，由宿主 link farm（`E:/alice/node_modules`）解析——
符合「类型源与运行时同源、单实例」纪律（AGENTS.md §5.15）。

```bash
cd self-plugins/dsh-semantic-docs
npx tsc -p tsconfig.json                       # 构建到 lib/
node --test tests/markdown.test.mjs            # 逐文件跑（本机 node --test tests/ 会把目录当模块加载而失败）
node --test tests/status.test.mjs
node --test tests/drift.test.mjs
node --test tests/registry.test.mjs
node --test tests/corpse.test.mjs
node scripts/smoke.mjs                         # 直测 execute + render + output.schema 一致性（不需挂载）
```

## 5 · 技术要点

- **三层分离，纯逻辑可测**：`src/markdown.ts`（纯函数解析）→ `src/registry.ts`（纯逻辑：schema/状态判定/D1–D6/INDEX 渲染）→ `src/collect.ts`（IO 适配：`FsLike` 注入）→ `src/index.ts`（Cordis 工具面）。
  时间与文件系统都是**注入**的，所以 `tests/*.test.mjs` 能对 `lib/` 产物离线跑，无需挂载插件。
- **不吞异常**：注册表缺失/空文件/坏 JSON/条目 schema 不合法 → 显式错误或 issues（**带绝对路径**），
  **绝不静默返回空清单**；`semantic_register` 遇到坏注册表**拒绝覆盖**（坏注册表是证据，不许静默重建）。
- **fail-closed 的 pending 口径**：`acceptance.pending` = 未取得通过证据的验收行数（`total - proven`），
  而非仅统计字面标「待线上验收」的行数；字面口径另以 `pendingMarked` 单独暴露（I5 两面都可见）。
- **配置即约定**：文档固定名 `docs/semantic*.md`（README §3「路径即约定」），D5 扫描根
  `<ws>/docs`、`<ws>/docs/*`、`<ws>/*/docs`、`<ws>/self-plugins/*/docs`（排除 `docs/semantics/**`；跳过 node_modules/.git/dist/lib 等）。
- **写入原子**：注册表与索引均 tmp → rename，避免读到半截文件；无 BOM。

## 6 · 能力边界诚实声明（capability ≠ sandbox）

- 本插件是**便利与一致性设施**，不是隔离机制、不是权限边界：它读写 workspace 内**文档与注册表**，
  有权限的调用方就能改任意路径——**不要把它宣传为安全边界**。
- 它**不阻止**任何修改（无门禁、无阻断）：drift 只报不改，处置归主体（README §0「给检查、不给阻止」）。
- 解析基于 Markdown 标题语义（README §10 U3 的已知脆弱点）：标题写法差异会漏判/误判——
  故工具输出附带「命中的原始证据」（标题/行号/行原文），便于人工复核；机器可读 front-matter 属未决问题。
- D3 依赖文件 mtime：仅比较「impl 最新 mtime vs 文档 mtime」，不感知内容变更；跨时区/时钟回拨会失真。
- 未验证项：本版**未接入** `preflight_check`（README §10 U2：先只报不拦，观察误报率两周）。

## 7 · License

MIT
