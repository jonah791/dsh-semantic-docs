/** 测试共用工具（非 .test.mjs，不参与 node --test 的目录发现） */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
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
export const SENTINEL_DOC = join(REAL_WORKSPACE, 'self-plugins', 'dsh-agent-sentinel', 'docs', 'semantic.md')
export const PANEL_DOC = join(REAL_WORKSPACE, 'self-plugins', 'dsh-panel', 'docs', 'semantic.md')

export function freshWorkspace(name) {
  const dir = join(WORK_ROOT, name)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  return dir
}

export function writeText(abs, text) {
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, text, 'utf8')
  return abs
}

export function cleanupAll() {
  rmSync(WORK_ROOT, { recursive: true, force: true })
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
