/**
 * 状态判定测试（README §5）：verified 但 pending>0 → D2；implemented 但 impl 全空 → D2
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseSemanticDoc } from '../lib/markdown.js'
import { detectDrift, evaluateStatus } from '../lib/registry.js'
import { DOC_COMPLETE, makeEntry, makeFacts } from './helpers.mjs'

const docOk = parseSemanticDoc(DOC_COMPLETE) // 验收 3 行：2 已证 + 1 待线上验收 → pending = 1

test('verified 但 acceptance.pending > 0 → D2 error', () => {
  const entry = makeEntry({ id: 'v-pending', status: 'verified' })
  const facts = makeFacts({ doc: docOk })
  const issues = detectDrift({ entries: [entry], facts: [facts] })
  const d2 = issues.filter((i) => i.code === 'D2')
  assert.equal(d2.length, 1)
  assert.equal(d2[0].severity, 'error')
  assert.match(d2[0].message, /状态与证据不符/)
  assert.match(d2[0].message, /pending=1/)
  assert.equal(d2[0].id, 'v-pending')
})

test('implemented 但 impl 全空 → D2 error', () => {
  const entry = makeEntry({ id: 'no-impl', status: 'implemented', impl: [] })
  const facts = makeFacts({ doc: docOk })
  const issues = detectDrift({ entries: [entry], facts: [facts] })
  const d2 = issues.filter((i) => i.code === 'D2')
  assert.equal(d2.length, 1)
  assert.match(d2[0].message, /impl 落点为空/)
})

test('verified 且 pending == 0 且 total > 0 → 无 drift（好样本不误报）', () => {
  const doc = parseSemanticDoc(DOC_COMPLETE.replace('| **待线上验收**：重启后统计 |', '| 单测 ✔ |'))
  assert.equal(doc.acceptance.pending, 0)
  const entry = makeEntry({ id: 'v-clean', status: 'verified' })
  const issues = detectDrift({ entries: [entry], facts: [makeFacts({ doc })] })
  assert.deepEqual(issues, [])
})

test('implemented 且 pending > 0 → 合法（不报 D2）', () => {
  const entry = makeEntry({ id: 'i-ok', status: 'implemented' })
  const issues = detectDrift({ entries: [entry], facts: [makeFacts({ doc: docOk })] })
  assert.deepEqual(issues.filter((i) => i.code === 'D2'), [])
})

test('evaluateStatus：可晋升只提示不报警（draft + impl 已存在）', () => {
  const ev = evaluateStatus(makeEntry({ status: 'draft' }), { total: 3, pending: 1 }, true)
  assert.equal(ev.declared, 'draft')
  assert.equal(ev.computed, 'implemented')
  assert.equal(ev.overClaim, false)
  assert.equal(ev.canPromote, true)
})

test('evaluateStatus：verified 判据（pending=0 且 total>0）', () => {
  const ev = evaluateStatus(makeEntry({ status: 'implemented' }), { total: 3, pending: 0 }, true)
  assert.equal(ev.computed, 'verified')
  assert.equal(ev.canPromote, true)
})

test('evaluateStatus：deprecated 不参与重判', () => {
  const ev = evaluateStatus(makeEntry({ status: 'deprecated' }), { total: 1, pending: 1 }, false)
  assert.equal(ev.overClaim, false)
  assert.equal(ev.computed, 'deprecated')
})
