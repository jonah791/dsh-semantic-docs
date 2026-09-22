/**
 * Markdown 解析层测试：真实文档样本 + 残缺样本
 * 契约：docs/semantics/README.md §4（必备结构 10 项）/ §6（验收与未决问题计数回填）
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseSemanticDoc } from '../lib/markdown.js'
import { SENTINEL_DOC, PANEL_DOC, DOC_COMPLETE, DOC_INCOMPLETE } from './helpers.mjs'

test('真实样本：哨兵 docs/semantic.md（结构断言 + 恒真关系，不硬编码具体数字）', () => {
  const text = readFileSync(SENTINEL_DOC, 'utf8')
  const doc = parseSemanticDoc(text)

  assert.equal(doc.acceptance.total, 9, '验收表行数应为 9（A1–A9）')
  // ⚠ 这里**刻意不硬编码** proven/pending 的具体值：本测试读的是一份**生产文档**，
  // 任何人按 D3 回写它都会让数字变（2026-09-22 实测：把 A8/A9 从「待线上验收」改为「已实测」
  // 就让 `proven should be 6` 崩了——而那次改动本身是正确的，是**测试太脆**，不是文档错）。
  // 改为断言**恒真关系 + 方向性下界**：既有分辨力，又不会被一次正当回写打崩。
  assert.equal(
    doc.acceptance.proven + doc.acceptance.pending,
    doc.acceptance.total,
    'proven + pending 必须等于 total（计数口径的自洽性）',
  )
  assert.ok(doc.acceptance.proven >= 6, `proven 不应低于历史已知值 6（实测 ${doc.acceptance.proven}）——只应随复核上升`)
  assert.ok(doc.acceptance.pending <= 3, `pending 不应高于历史已知值 3（实测 ${doc.acceptance.pending}）`)
  assert.equal(
    doc.acceptance.pendingMarked + doc.acceptance.unprovenUnmarked,
    doc.acceptance.pending,
    'pendingMarked + unprovenUnmarked 必须等于 pending（字面口径与 pending 口径的分类要完备）',
  )
  assert.equal(doc.acceptance.rows[6].id, 'A7')
  assert.equal(doc.acceptance.rows[6].proven, false, 'A7 至今未做压测 ⇒ 应仍判未通过')
  assert.equal(doc.acceptance.rows[6].pendingMarked, false, 'A7 未显式标注「待线上验收」⇒ 应落在 unprovenUnmarked')

  assert.equal(doc.openQuestions, 5, '未决问题 U1–U5 应为 5 条')
  assert.equal(doc.openQuestionItems[0].label, 'U1')

  assert.deepEqual(doc.missingSections, [], '哨兵文档 10 节齐全')
  assert.equal(doc.hasMeta, true)
  assert.equal(doc.hasRevisionLog, true)
  assert.equal(doc.needReview, false)
  assert.equal(doc.meta.version, 'v0.1')
})

test('真实样本：面板 docs/semantic.md（只断言结构性不变量，不锁内容）', () => {
  // 说明：面板文档正在被并行实例持续编辑（实测：§11.5「实践修订记录」在本次作业期间被补入），
  // 因此这里只断言**契约级不变量**，不锁具体计数——内容级断言放在固定夹具（DOC_COMPLETE / DOC_INCOMPLETE）里。
  const text = readFileSync(PANEL_DOC, 'utf8')
  const doc = parseSemanticDoc(text)

  assert.ok(doc.headings.length > 10, '真实文档应解析出标题树')
  assert.equal(doc.acceptance.pending, doc.acceptance.total - doc.acceptance.proven, 'pending 口径自洽')
  assert.equal(doc.hasRevisionLog, !doc.missingSections.includes('revision-log'), 'D6 载体判定与缺节列表一致')
  assert.equal(doc.missingSections.length + doc.presentSections.length, 10, '10 项必备结构必须全部被判定（不丢项）')
  assert.ok(doc.acceptance.total >= 0 && doc.openQuestions >= 0)
  for (const row of doc.acceptance.rows) assert.ok(row.id.length > 0, '验收行必须有编号')
  for (const q of doc.openQuestionItems) assert.ok(q.text.length > 0, '未决问题条目必须有正文')
})

test('残缺样本：缺 3 个小节必须能被报出（不是「解析成功就万事大吉」）', () => {
  const doc = parseSemanticDoc(DOC_INCOMPLETE)
  assert.deepEqual(doc.missingSections, ['concept', 'acceptance', 'revision-log'])
  assert.deepEqual(doc.missingSectionNames, ['概念模型 + 不变量', '可证伪验收', '实践修订记录'])
  assert.equal(doc.hasRevisionLog, false)
  assert.equal(doc.acceptance.total, 0)
})

test('完整样本：10 节齐全、验收与未决问题计数正确', () => {
  const doc = parseSemanticDoc(DOC_COMPLETE)
  assert.deepEqual(doc.missingSections, [])
  assert.equal(doc.acceptance.total, 3)
  assert.equal(doc.acceptance.proven, 2)
  assert.equal(doc.acceptance.pending, 1)
  assert.equal(doc.acceptance.pendingMarked, 1)
  assert.equal(doc.openQuestions, 2)
  assert.equal(doc.hasRevisionLog, true)
})

test('解析是纯函数：同输入两次结果一致（无 IO / 无时间依赖）', () => {
  const a = parseSemanticDoc(DOC_COMPLETE)
  const b = parseSemanticDoc(DOC_COMPLETE)
  assert.deepEqual(a, b)
})

// ---- 元信息解析（2026-09-13 实测修正：模板推荐的加粗状态读不出来）----

const HEADER_BLOCKQUOTE = [
  '# 语义文档：样本能力',
  '',
  '> 版本 v0.3 · 2026-09-13 · 作者：爱丽丝 · 状态：**已实现（M1：租约）**',
  '> 开发方式：语义文档优先',
  '> 实现落点：`src/x.ts`（主）',
  '',
  '## 1 · 元信息',
  '',
  '| 字段 | 值 |',
  '|------|-----|',
  '| 载体 | 插件 |',
].join('\n')

test('元信息：加粗状态可解析（模板推荐写法，此前一律 null）', () => {
  const doc = parseSemanticDoc(HEADER_BLOCKQUOTE)
  assert.equal(doc.meta.version, 'v0.3')
  assert.equal(doc.meta.date, '2026-09-13')
  assert.equal(doc.meta.status, '已实现（M1：租约）', '加粗标记被剥掉，值在行尾截断')
  assert.equal(doc.meta.implHints.length, 1)
  assert.ok(doc.meta.implHints[0].includes('src/x.ts'))
})

test('元信息：状态值在 · 分隔符处截断，不吃掉后续内容', () => {
  const doc = parseSemanticDoc([
    '# 语义文档：样本',
    '',
    '> 版本 v1 · 2026-01-01 · 状态：已验收 · 作者：爱丽丝',
    '> 实现落点：`src/y.ts`',
    '',
    '## 1 · 元信息',
  ].join('\n'))
  assert.equal(doc.meta.status, '已验收')
  assert.equal(doc.meta.version, 'v1')
})

test('元信息：写在 §1 表格里的版本/状态不被头部解析（规范位置是 H1 后的引用块）', () => {
  const doc = parseSemanticDoc([
    '# 语义文档：样本',
    '',
    '## 1 · 元信息',
    '',
    '| 字段 | 值 |',
    '|------|-----|',
    '| 版本 | v0.9 |',
    '| 状态 | verified |',
  ].join('\n'))
  assert.equal(doc.meta.version, null)
  assert.equal(doc.meta.status, null)
})

// ---- 表格分块（2026-09-22 修正：续块首行曾被当表头吃掉）----

test('表格中间的空行不得吃掉数据行（续块无表头——2026-09-22 实测缺陷）', () => {
  // 反例来源：dsh-agent-memory/docs/semantic.md 的 §7 在 A44 与 A45 之间有一个空行，
  // 原实现无条件 `block.slice(1)` 丢首行 ⇒ A45 被当表头静默吞掉（total 78 行报 77）。
  const doc = parseSemanticDoc([
    '# 语义文档：样本',
    '',
    '## 7 · 可证伪验收清单',
    '',
    '| # | 命题 | 证据 | 状态 |',
    '|---|------|------|------|',
    '| A1 | 第一条 | 单测 | ✔ 已实测 |',
    '| A2 | 第二条 | 单测 | ✔ 已实测 |',
    '',
    '| A3 | 空行之后的第三条 | 单测 | ✔ 已实测 |',
    '| A4 | 第四条 | 单测 | 待验收 |',
  ].join('\n'))
  assert.equal(doc.acceptance.total, 4, '空行切断后的续块首行仍是数据行，不能被当表头吃掉')
  assert.deepEqual(doc.acceptance.rows.map((r) => r.id), ['A1', 'A2', 'A3', 'A4'])
  assert.equal(doc.acceptance.proven, 3)
  assert.equal(doc.acceptance.pending, 1)
})

test('有表头的正常表格仍不吃数据行（修正不得反噬正常形态）', () => {
  const doc = parseSemanticDoc([
    '# 语义文档：样本',
    '',
    '## 7 · 可证伪验收清单',
    '',
    '| # | 命题 | 证据 | 状态 |',
    '|---|------|------|------|',
    '| A1 | 甲 | 单测 | ✔ 已实测 |',
    '| A2 | 乙 | 单测 | 待线上验收 |',
  ].join('\n'))
  assert.equal(doc.acceptance.total, 2)
  assert.deepEqual(doc.acceptance.rows.map((r) => r.id), ['A1', 'A2'])
})
