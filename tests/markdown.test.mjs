/**
 * Markdown 解析层测试：真实文档样本 + 残缺样本
 * 契约：docs/semantics/README.md §4（必备结构 10 项）/ §6（验收与未决问题计数回填）
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseSemanticDoc } from '../lib/markdown.js'
import { SENTINEL_DOC, PANEL_DOC, DOC_COMPLETE, DOC_INCOMPLETE } from './helpers.mjs'

test('真实样本：哨兵 docs/semantic.md（9 条验收 / 3 条未验收 / 5 个未决问题 / 10 节齐全）', () => {
  const text = readFileSync(SENTINEL_DOC, 'utf8')
  const doc = parseSemanticDoc(text)

  assert.equal(doc.acceptance.total, 9, '验收表行数应为 9（A1–A9）')
  assert.equal(doc.acceptance.proven, 6, '证据列带 ✔ 的应为 6 条（A1–A6）')
  // pending = 未取得通过证据的行数（A7 未做压测 + A8/A9 待线上验收）——与 registry.json 的 pending=3 一致
  assert.equal(doc.acceptance.pending, 3)
  // 字面口径：显式标「待线上验收」的只有 A8/A9 两行（任务描述里的「3 条」是 pending 口径，非字面标记口径）
  assert.equal(doc.acceptance.pendingMarked, 2, '显式标注「待线上验收」的行数应为 2（A8/A9）')
  assert.equal(doc.acceptance.unprovenUnmarked, 1, '未通过且未标注的应为 1 行（A7）')
  assert.equal(doc.acceptance.rows[6].id, 'A7')
  assert.equal(doc.acceptance.rows[6].proven, false)
  assert.equal(doc.acceptance.rows[6].pendingMarked, false)
  assert.equal(doc.acceptance.rows[7].pendingMarked, true)

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
