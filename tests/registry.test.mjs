/**
 * 注册表模型测试：schema 校验 / 幂等 upsert / INDEX.md 生成 / 坏 JSON 显式报错
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  emptyRegistry,
  isValidEntryId,
  parseRegistry,
  partitionEntries,
  renderIndexMarkdown,
  upsertEntry,
  validateRegistry,
} from '../lib/registry.js'

const REGISTRY_JSON = JSON.stringify({
  version: 1,
  updatedAt: '2026-01-01T00:00:00+08:00',
  workspace: 'E:\\alice',
  entries: [
    {
      id: 'web-lifecycle',
      title: 'web 生命周期',
      doc: 'self-plugins/dsh-agent-sentinel/docs/semantic.md',
      status: 'implemented',
      owners: ['dsh-agent-sentinel'],
      twins: [],
      impl: ['self-plugins/dsh-agent-sentinel/src/lease.ts'],
      acceptance: { total: 9, proven: 6, pending: 3 },
      openQuestions: 5,
    },
  ],
})

test('parseRegistry：合法 JSON 解析出条目', () => {
  const { registry } = parseRegistry(REGISTRY_JSON, 'X:/registry.json')
  assert.equal(registry.entries.length, 1)
  assert.equal(registry.entries[0].id, 'web-lifecycle')
})

test('parseRegistry：坏 JSON / 空文件 / 顶层非对象 → 抛错并带路径（不许静默返回空清单）', () => {
  assert.throws(() => parseRegistry('{ "entries": [', 'X:/docs/semantics/registry.json'), (err) => {
    assert.match(err.message, /JSON 语法错误/)
    assert.match(err.message, /X:\/docs\/semantics\/registry\.json/)
    return true
  })
  assert.throws(() => parseRegistry('   ', 'X:/registry.json'), /为空文件/)
  assert.throws(() => parseRegistry('[1,2,3]', 'X:/registry.json'), /顶层必须是对象/)
  assert.throws(() => parseRegistry('{"version":1}', 'X:/registry.json'), /缺少 entries 数组/)
})

test('validateRegistry：缺 id/doc/status 全部报出（不是只报第一个）', () => {
  const raw = { version: 1, entries: [{ title: '缺三样' }] }
  const issues = validateRegistry(raw, 'X:/registry.json')
  const fields = issues.map((i) => i.field)
  assert.ok(fields.includes('id'))
  assert.ok(fields.includes('doc'))
  assert.ok(fields.includes('status'))
  assert.ok(issues.every((i) => i.index === 0))
})

test('validateRegistry：id 非法 / 重复 id / 数组字段类型错', () => {
  const raw = {
    version: 1,
    entries: [
      { id: 'Bad_ID', title: 't', doc: 'd.md', status: 'draft' },
      { id: 'dup', title: 't', doc: 'd.md', status: 'draft', impl: 'not-array' },
      { id: 'dup', title: 't', doc: 'd.md', status: 'unknown' },
    ],
  }
  const issues = validateRegistry(raw, 'X:/registry.json')
  assert.ok(issues.some((i) => i.field === 'id' && /非法/.test(i.message)))
  assert.ok(issues.some((i) => i.field === 'duplicate-id'))
  assert.ok(issues.some((i) => i.field === 'impl'))
  assert.ok(issues.some((i) => i.field === 'status'))
})

test('partitionEntries：schema 不合法的条目进 skipped（不静默丢弃）', () => {
  const raw = { version: 1, entries: [{ title: 'x' }, { id: 'ok', title: 'y', doc: 'd.md', status: 'draft', impl: [] }] }
  const { registry } = parseRegistry(JSON.stringify(raw), 'X:/registry.json')
  const issues = validateRegistry(raw, 'X:/registry.json')
  const { usable, usableIndices, skipped } = partitionEntries(registry, issues)
  assert.equal(usable.length, 1)
  assert.deepEqual(usableIndices, [1])
  assert.equal(skipped.length, 1)
  assert.equal(skipped[0].index, 0)
  assert.match(skipped[0].reason, /schema 不合法/)
})

test('upsertEntry：同 id 两次 = 幂等（不重复条目，内容一致）', () => {
  const base = emptyRegistry('E:\\alice', '2026-01-01T00:00:00Z')
  const patch = {
    id: 'panel-host',
    title: '面板宿主',
    doc: 'self-plugins/dsh-panel/docs/semantic.md',
    status: 'implemented',
    owners: ['dsh-panel'],
    impl: ['self-plugins/dsh-panel/src/index.ts'],
  }
  const first = upsertEntry(base, patch, '2026-01-01T00:00:00Z')
  assert.equal(first.action, 'created')
  const second = upsertEntry(first.registry, patch, '2026-01-02T00:00:00Z')
  assert.equal(second.action, 'updated')
  assert.equal(second.registry.entries.length, 1)
  assert.equal(JSON.stringify(first.registry.entries), JSON.stringify(second.registry.entries))
  assert.equal(second.registry.updatedAt, '2026-01-02T00:00:00Z')
})

test('upsertEntry：id 非法直接抛错；未提供的字段保持原值', () => {
  const base = emptyRegistry('E:\\alice', 'now')
  assert.throws(() => upsertEntry(base, { id: 'Bad_ID' }, 'now'), /id 非法/)
  const created = upsertEntry(base, { id: 'a-b', title: 'A', doc: 'd.md', status: 'draft' }, 'now')
  const updated = upsertEntry(created.registry, { id: 'a-b', status: 'implemented' }, 'now2')
  assert.equal(updated.entry.title, 'A')
  assert.equal(updated.entry.doc, 'd.md')
  assert.equal(updated.entry.status, 'implemented')
})

test('isValidEntryId', () => {
  assert.equal(isValidEntryId('web-lifecycle'), true)
  assert.equal(isValidEntryId('a'), true)
  assert.equal(isValidEntryId('Web'), false)
  assert.equal(isValidEntryId('-a'), false)
  assert.equal(isValidEntryId('a_b'), false)
})

test('renderIndexMarkdown：可重放投影（含条目与验收计数）', () => {
  const { registry } = parseRegistry(REGISTRY_JSON, 'X:/registry.json')
  const md = renderIndexMarkdown(registry, { generatedAt: '2026-02-01T00:00:00Z' })
  assert.match(md, /语义文档索引/)
  assert.match(md, /请勿手改/)
  assert.match(md, /2026-02-01T00:00:00Z/)
  assert.match(md, /\| web-lifecycle \|/)
  assert.match(md, /6\/3\/9/)
  assert.match(md, /状态分布/)
})
