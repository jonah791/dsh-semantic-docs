/**
 * 验收快照对账测试（2026-10-09 · t-cdb92e72）
 *
 * 事故形状：`semantic_register` 不带 `doc` 时把 `acceptance` 写成 `null`；
 * 而 `semantic_check` 的对账判据是 `if (reg === null || parsed === null) continue`
 * ⇒ **快照被清空**与**快照真对齐**在输出上完全同形（第三次同型的「机器读不到 ⇒ 报没问题」）。
 *
 * 本文件两组判据：
 *   纯函数（registry.ts · compareAcceptanceSnapshot）——三态必须可区分；
 *   IO 级（collect.ts · applyRegistration）——**任何路径都不得把既有快照静默写成 null**。
 */
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { applyRegistration, createNodeFs } from '../lib/collect.js'
import { compareAcceptanceSnapshot } from '../lib/registry.js'
import { cleanupAll, docWithAcceptanceRows, freshWorkspace, writeText } from './helpers.mjs'

const fs = createNodeFs()
after(cleanupAll)

const DOC_REL = 'self-plugins/sample/docs/semantic.md'
const DOC_TWO_ROWS = docWithAcceptanceRows(['| A1 | 一 | 装置 | ✔ 已实测 |', '| A2 | 二 | 装置 | 待线上验收 |'])
const DOC_ONE_ROW = docWithAcceptanceRows(['| A1 | 一 | 装置 | ✔ 已实测 |'])

function readEntry(ws, id) {
  const reg = JSON.parse(readFileSync(join(ws, 'docs', 'semantics', 'registry.json'), 'utf8'))
  return reg.entries.find((e) => e.id === id) ?? null
}

/** 造一个「已登记且已有快照」的工作区（快照由文档解析回填，不是手写） */
function seedRegisteredWorkspace(name, docText) {
  const ws = freshWorkspace(name)
  writeText(join(ws, DOC_REL), docText)
  const first = applyRegistration(
    ws,
    fs,
    { id: 'sample', title: '样本', doc: DOC_REL, status: 'implemented', impl: ['self-plugins/sample/src/x.ts'] },
    '2026-01-01T00:00:00Z',
  )
  assert.equal(first.acceptanceApplied, true, '前置条件：首登记应已回填快照')
  assert.equal(first.entry.acceptance.total, 2)
  assert.equal(first.entry.acceptance.pending, 1)
  return ws
}

// ---------------------------------------------------------------------------
// 纯函数：三态必须可区分
// ---------------------------------------------------------------------------

test('compareAcceptanceSnapshot：文档不可用 ⇒ 不报（那是 D1 的域，不重复）', () => {
  assert.equal(compareAcceptanceSnapshot('x', { total: 1, pending: 0 }, null), null)
  assert.equal(compareAcceptanceSnapshot('x', null, null), null)
})

test('compareAcceptanceSnapshot：快照缺失 ≠ 已对齐（必须报 missing-snapshot）', () => {
  const hit = compareAcceptanceSnapshot('x', null, { total: 5, proven: 3, pending: 2 })
  assert.notEqual(hit, null, 'null 快照必须报出——静默它是本缺陷的本体')
  assert.equal(hit.code, 'missing-snapshot')
  assert.match(hit.message, /无法对账/)
  assert.match(hit.message, /3\/2\/5/, '消息要带文档侧读数，便于直接判断影响面')
})

test('compareAcceptanceSnapshot：pending 或 total 任一不一致 ⇒ mismatch', () => {
  // 对照（不响）：两边完全一致 ⇒ 必须返回 null，否则判据恒为真、等于没判据
  assert.equal(compareAcceptanceSnapshot('x', { total: 5, pending: 2 }, { total: 5, proven: 3, pending: 2 }), null)
  // 形状一：pending 不一致（total 相同）
  const p = compareAcceptanceSnapshot('x', { total: 5, pending: 2 }, { total: 5, proven: 4, pending: 1 })
  assert.notEqual(p, null, 'pending 不一致必须报出')
  assert.equal(p.code, 'mismatch')
  assert.match(p.message, /pending 注册表 2 ≠ 文档 1/)
  // 形状二：pending 相同但 total 不同（旧判据只比 pending ⇒ 这条被静默，实测 9 条）
  const t = compareAcceptanceSnapshot('x', { total: 3, pending: 2 }, { total: 5, proven: 3, pending: 2 })
  assert.equal(t.code, 'mismatch', 'pending 相同但 total 不同也是陈旧快照（旧判据只比 pending ⇒ 静默）')
  assert.match(t.message, /total 注册表 3 ≠ 文档 5/)
})

// ---------------------------------------------------------------------------
// 写侧尸体：任何路径都不得把既有快照静默写成 null
// ---------------------------------------------------------------------------

test('尸体：不带 doc 的注册**不得**清空既有快照（事故本体）', () => {
  const ws = seedRegisteredWorkspace('snapshot-corpus-no-doc', DOC_TWO_ROWS)
  const out = applyRegistration(ws, fs, { id: 'sample', status: 'implemented' }, '2026-01-02T00:00:00Z')
  const after = readEntry(ws, 'sample')
  assert.deepEqual(
    { total: after.acceptance.total, pending: after.acceptance.pending },
    { total: 2, pending: 1 },
    '既有快照必须原样保留（旧实现在这里写成了 null）',
  )
  assert.equal(out.entry.acceptance.total, 2)
})

test('尸体：doc 指向不存在的文件 ⇒ 保留既有快照，且把原因如实带出（不静默）', () => {
  const ws = seedRegisteredWorkspace('snapshot-corpus-missing-doc', DOC_TWO_ROWS)
  const out = applyRegistration(
    ws,
    fs,
    { id: 'sample', doc: 'self-plugins/ghost/docs/semantic.md', status: 'implemented' },
    '2026-01-02T00:00:00Z',
  )
  assert.equal(out.acceptanceApplied, false)
  assert.equal(out.snapshotSource, 'untouched')
  assert.match(out.snapshotNote, /保留/)
  const after = readEntry(ws, 'sample')
  assert.equal(after.acceptance.total, 2, 'doc 换成了不存在的路径，但已解析过的快照不该因此蒸发')
})

test('正路：只改 status（不带 doc）⇒ 用条目**原有 doc** 重新解析回填', () => {
  const ws = seedRegisteredWorkspace('snapshot-backfill', DOC_TWO_ROWS)
  // 文档加了一行「✔ 已实测」⇒ total 2→3、proven 1→2、pending 保持 1
  writeText(join(ws, DOC_REL), docWithAcceptanceRows([
    '| A1 | 一 | 装置 | ✔ 已实测 |',
    '| A2 | 二 | 装置 | 待线上验收 |',
    '| A3 | 三 | 装置 | ✔ 已实测 |',
  ]))
  const out = applyRegistration(ws, fs, { id: 'sample', status: 'verified' }, '2026-01-02T00:00:00Z')
  assert.equal(out.acceptanceApplied, true, 'doc 回退既有值 ⇒ 单参数注册也应刷新快照')
  assert.equal(out.snapshotSource, 'doc')
  assert.equal(out.entry.acceptance.total, 3)
  assert.equal(out.entry.acceptance.proven, 2)
  const after = readEntry(ws, 'sample')
  assert.equal(after.acceptance.total, 3)
  assert.equal(after.status, 'verified')
})

test('正路：显式给 acceptance ⇒ 按给的写（「清空」必须是显式的，不能是副产物）', () => {
  const ws = seedRegisteredWorkspace('snapshot-explicit', DOC_TWO_ROWS)
  const out = applyRegistration(ws, fs, { id: 'sample', acceptance: null }, '2026-01-02T00:00:00Z')
  assert.equal(out.snapshotSource, 'explicit')
  assert.equal(readEntry(ws, 'sample').acceptance, null)
})
