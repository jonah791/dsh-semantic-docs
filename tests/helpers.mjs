/** 测试共用工具（非 .test.mjs，不参与 node --test 的目录发现） */
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/** 插件根目录（tests/ 的上一级） */
export const PLUGIN_DIR = dirname(here)
/** 测试临时工作区根（只在插件目录内写入，绝不碰真实工作区其它文件） */
export const WORK_ROOT = join(here, '.work')

/**
 * 真实工作区（只读使用：语义文档与注册表）。
 * 从插件位置推导（<workspace>/self-plugins/<plugin>），跨 OS / 跨检出可用；
 * 非标准布局用 `SEMANTIC_DOCS_WORKSPACE` 覆盖。
 */
export const REAL_WORKSPACE = process.env['SEMANTIC_DOCS_WORKSPACE'] ?? dirname(dirname(PLUGIN_DIR))
export const PANEL_DOC = join(REAL_WORKSPACE, 'self-plugins', 'dsh-panel', 'docs', 'semantic.md')

/**
 * 真语料：工作区里**实际存在**的所有插件语义文档。
 *
 * 存在理由（2026-11-03）：原来只钉一份 `dsh-agent-sentinel/docs/semantic.md` 当「真样本」，
 * 而那个插件早已不存在 ⇒ 两条测试常年以 `ENOENT` 失败，**读起来像解析器坏了**。
 * 更糟的是：即使它当年存在，单文件也不配叫「真语料对照」——一个被重命名/退役的插件
 * 就能让整个对照失效。改成扫全库：判据跟着**语料**走，不跟着某个名字走。
 * ⚠ 返回空数组时调用方必须响亮报错（否则「全库 nearMiss 为 0」会在零样本上恒真）。
 */
export function realCorpus() {
  const dir = join(REAL_WORKSPACE, 'self-plugins')
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => join(dir, e.name, 'docs', 'semantic.md'))
    .filter((p) => existsSync(p))
}

/** 本进程建过的工作区（清场只清自己的——见 cleanupAll 的注释） */
const created = new Set()

export function freshWorkspace(name) {
  const dir = join(WORK_ROOT, name)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  created.add(dir)
  return dir
}

export function writeText(abs, text) {
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, text, 'utf8')
  return abs
}

/**
 * 清掉**本进程**建过的工作区。
 *
 * ⚠ **不许删整个 `WORK_ROOT`**（2026-10-09 实测 · t-cdb92e72 附带发现）：
 * `node --test` 对每个测试文件起**独立进程且并发**——某个文件的 `after()` 去删共享根目录时，
 * 另一个文件正在里面建目录 ⇒ Windows 抛 `ENOTEMPTY, Directory not empty: ….work`
 * ⇒ **5 跑 1 红**的间歇失败，看起来像被测代码不稳（实际是夹具互相清场）。
 * 每个进程建的目录互不相交，所以「只清自己建的」既够了又无竞态。
 */
export function cleanupAll() {
  for (const dir of created) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch (err) {
      // 清场失败不该变成假红（残留目录会在下次 freshWorkspace 的同名 rm 里被覆盖），
      // 但也不许静默——写到 stderr，测试输出里看得见。
      console.error(`[helpers] 清理临时工作区失败：${dir} —— ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  created.clear()
}

/** 构造 EntryFacts（纯逻辑测试用；IO 事实由 collect.ts 采集） */
export function makeFacts(overrides = {}) {
  return {
    docExists: true,
    docMtimeMs: null,
    docReadError: null,
    implMissing: [],
    twinsMissing: [],
    implLatestMtimeMs: null,
    doc: null,
    ...overrides,
  }
}

export function makeEntry(overrides = {}) {
  return {
    id: 'sample',
    title: '示例能力',
    doc: 'self-plugins/sample/docs/semantic.md',
    status: 'implemented',
    owners: ['sample'],
    twins: [],
    impl: ['self-plugins/sample/src/index.ts'],
    ...overrides,
  }
}

/** 一份「结构完整」的语义文档（10 节齐全；验收 3 行：2 已证 + 1 显式待线上验收） */
export const DOC_COMPLETE = `# 语义文档：示例能力

> 版本 v0.1 · 2026-01-01 · 作者：爱丽丝 · 状态：**已实现**
> 实现落点：\`sample/src/index.ts\`

---

## 1 · 定位与反定位

**定位**：示例。
**反定位**：不是别的东西。

## 2 · 术语表

| 术语 | 含义 |
|------|------|
| A | B |

## 3 · 概念模型

\`\`\`
A → B
\`\`\`

不变量：
1. **I1 示例**：可测量。

## 4 · 契约

- 路径：x

## 5 · 边界与信任

- 能力 ≠ 沙箱。

## 6 · 可证伪验收

| # | 可证伪命题 | 证据 |
|---|-----------|------|
| A1 | 命题一 | 单测 ✔ |
| A2 | 命题二 | 单测 ✔ |
| A3 | 命题三 | **待线上验收**：重启后统计 |

## 7 · 与实现的关系

- 主实现：sample/src/index.ts

## 8 · 实践修订记录

- **2026-01-02 首次实践**
  - 语义**被确认**：x

## 9 · 未决问题

- **U1** 第一个问题
- **U2** 第二个问题
`

/** 残缺样本：缺 概念模型 / 可证伪验收 / 实践修订记录 三个必备节 */
export const DOC_INCOMPLETE = `# 语义文档：残缺样本

> 版本 v0.1 · 2026-01-01 · 状态：草案

---

## 1 · 定位与反定位

定位：x

## 2 · 术语表

| 术语 | 含义 |
|------|------|
| A | B |

## 3 · 契约

- x

## 4 · 边界与信任

- x

## 5 · 与实现的关系

- x

## 6 · 未决问题

- **U1** x
`

/**
 * 造一份 **10 节齐全** 的语义文档，只替换「可证伪验收」表的数据行。
 * 用途：单变量地测验收解析（nearMiss / proven / pendingMarked），不受别节内容干扰。
 * 2026-10-09 加（t-a49e40a8 · D7 近义词误读）。
 */
export function docWithAcceptanceRows(rows) {
  return [
    '# 语义文档：测试夹具', '',
    '> 版本 v0.1 · 2026-01-01 · 状态：已实现',
    '> 实现落点：`x.ts`', '',
    '## 1 定位与反定位', 'x',
    '## 2 术语表', '| 术语 | 含义 |', '|---|---|', '| a | b |',
    '## 3 概念模型与不变量', 'x',
    '## 4 契约', 'x',
    '## 5 边界与信任', 'x',
    '## 6 可证伪验收', '| # | 判据 | 装置 | 状态 |', '|---|---|---|---|',
    ...rows,
    '## 7 与实现的关系', 'x',
    '## 8 实践修订记录', 'x',
    '## 9 未决问题', '- U1 x', '',
  ].join('\n')
}
