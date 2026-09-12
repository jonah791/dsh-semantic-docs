/**
 * drift 判据测试（README §8）：D1 路径不存在 / D4 必备结构缺节 / D5 未注册文档 / D6 缺实践修订记录 / D3 与「待复核」抑制
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseSemanticDoc } from '../lib/markdown.js'
import { detectDrift } from '../lib/registry.js'
import { DOC_COMPLETE, DOC_INCOMPLETE, makeEntry, makeFacts } from './helpers.mjs'

const docIncomplete = parseSemanticDoc(DOC_INCOMPLETE)

test('D1：doc 路径不存在', () => {
  const issues = detectDrift({
    entries: [makeEntry({ id: 'x' })],
    facts: [makeFacts({ docExists: false, doc: null })],
  })
  const d1 = issues.filter((i) => i.code === 'D1')
  assert.equal(d1.length, 1)
  assert.equal(d1[0].severity, 'error')
  assert.match(d1[0].message, /doc 路径不存在/)
  assert.equal(d1[0].id, 'x')
})

test('D1：impl / twins 路径不存在（逐条列出）', () => {
  const issues = detectDrift({
    entries: [makeEntry({ id: 'y', impl: ['a.ts'], twins: ['b.ts'] })],
    facts: [makeFacts({ doc: parseSemanticDoc(DOC_COMPLETE), implMissing: ['a.ts'], twinsMissing: ['b.ts'] })],
  })
  const d1 = issues.filter((i) => i.code === 'D1').map((i) => i.message)
  assert.equal(d1.length, 2)
  assert.ok(d1.some((m) => m.includes('impl 路径不存在：a.ts')))
  assert.ok(d1.some((m) => m.includes('twins 路径不存在：b.ts')))
})

test('D1：文档存在但解析读取失败（不吞异常）', () => {
  const issues = detectDrift({
    entries: [makeEntry({ id: 'z' })],
    facts: [makeFacts({ docExists: true, docReadError: 'EACCES: permission denied（X:/doc.md）', doc: null })],
  })
  const d1 = issues.filter((i) => i.code === 'D1')
  assert.equal(d1.length, 1)
  assert.match(d1[0].message, /读取\/解析失败/)
  assert.match(d1[0].message, /EACCES/)
})

test('D4：必备结构缺节（缺 3 节，逐节点名）', () => {
  const issues = detectDrift({
    entries: [makeEntry({ id: 'short' })],
    facts: [makeFacts({ doc: docIncomplete })],
  })
  const d4 = issues.filter((i) => i.code === 'D4')
  assert.equal(d4.length, 1)
  assert.equal(d4[0].severity, 'error')
  assert.match(d4[0].message, /必备结构缺节（3\/10）/)
  assert.match(d4[0].message, /概念模型 \+ 不变量/)
  assert.match(d4[0].message, /可证伪验收/)
  assert.match(d4[0].message, /实践修订记录/)
})

test('D5：磁盘有 docs/semantic*.md 未注册（warn，无 id）', () => {
  const issues = detectDrift({
    entries: [],
    facts: [],
    unregisteredDocs: ['self-plugins/foo/docs/semantic.md', 'self-plugins/bar/docs/semantic-lifecycle.md'],
  })
  const d5 = issues.filter((i) => i.code === 'D5')
  assert.equal(d5.length, 2)
  assert.equal(d5[0].severity, 'warn')
  assert.equal(d5[0].id, undefined)
  assert.match(d5[0].message, /未注册的语义文档/)
})

test('D6：文档不含「实践修订记录」小节', () => {
  const issues = detectDrift({
    entries: [makeEntry({ id: 'no-revision' })],
    facts: [makeFacts({ doc: docIncomplete })],
  })
  const d6 = issues.filter((i) => i.code === 'D6')
  assert.equal(d6.length, 1)
  assert.equal(d6[0].severity, 'error')
  assert.match(d6[0].message, /实践修订记录/)
  assert.equal(d6[0].id, 'no-revision')
})

test('D3：实现 mtime 晚于文档 mtime → warn；文档标「待复核」则抑制', () => {
  const doc = parseSemanticDoc(DOC_COMPLETE)
  const base = {
    entries: [makeEntry({ id: 'stale' })],
    facts: [makeFacts({ doc, docMtimeMs: 1_000, implLatestMtimeMs: 500_000 })],
  }
  const issues = detectDrift({ ...base, nowMs: 1_000_000 })
  const d3 = issues.filter((i) => i.code === 'D3')
  assert.equal(d3.length, 1)
  assert.equal(d3[0].severity, 'warn')
  assert.match(d3[0].message, /实现比文档新/)

  const docPendingReview = parseSemanticDoc(`${DOC_COMPLETE}\n\n<!-- 待复核：实现改动尚未回写 -->\n`)
  assert.equal(docPendingReview.needReview, true)
  const suppressed = detectDrift({
    entries: [makeEntry({ id: 'stale' })],
    facts: [makeFacts({ doc: docPendingReview, docMtimeMs: 1_000, implLatestMtimeMs: 500_000 })],
    nowMs: 1_000_000,
  })
  assert.deepEqual(suppressed.filter((i) => i.code === 'D3'), [])
})

test('deprecated 条目只查 D1（README §5：不再参与 drift 告警）', () => {
  const issues = detectDrift({
    entries: [makeEntry({ id: 'old', status: 'deprecated' })],
    facts: [makeFacts({ doc: docIncomplete })],
  })
  assert.deepEqual(issues, [])
})

test('facts 为 null 的条目（schema 不合法）不参与判定，也不崩', () => {
  const issues = detectDrift({ entries: [makeEntry({ id: 'broken' })], facts: [null] })
  assert.deepEqual(issues, [])
})
