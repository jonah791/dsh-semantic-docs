/**
 * 尸体样本测试（IO 级 · 临时 workspace）：
 *   坏 JSON / 缺条目字段 / 指向不存在路径 / 注册表缺失 → 必须报错或报 D1，**不许静默返回空清单**
 * 另含：D5 未注册发现（排除系统自身目录）、upsert 幂等 + INDEX.md 生成、坏注册表拒绝覆盖
 */
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createNodeFs, applyRegistration, factsAlignedWith, loadRegistryState } from '../lib/collect.js'
import { detectDrift } from '../lib/registry.js'
import { cleanupAll, freshWorkspace, writeText } from './helpers.mjs'

const fs = createNodeFs()
after(cleanupAll)

const DOC_MIN = `# 语义文档：样本

> 版本 v0.1 · 2026-01-01 · 状态：草案
> 实现落点：\`src/x.ts\`

## 1 · 定位与反定位
x

## 2 · 术语表
x

## 3 · 概念模型
x

## 4 · 契约
x

## 5 · 边界与信任
x

## 6 · 可证伪验收

| # | 命题 | 证据 |
|---|------|------|
| A1 | x | **待线上验收** |

## 7 · 与实现的关系
x

## 8 · 实践修订记录
x

## 9 · 未决问题
- **U1** x
`

function registryWith(entries) {
  return JSON.stringify({ version: 1, updatedAt: '2026-01-01T00:00:00Z', workspace: 'ws', entries }, null, 2)
}

test('尸体：注册表不存在 → 抛错并带绝对路径（不返回空清单）', () => {
  const ws = freshWorkspace('corpse-missing')
  assert.throws(
    () => loadRegistryState(ws, fs),
    (err) => {
      assert.match(err.message, /注册表不存在/)
      assert.ok(err.message.includes(join(ws, 'docs', 'semantics', 'registry.json')), '错误信息必须含路径')
      return true
    },
  )
})

test('尸体：注册表是坏 JSON → 抛 RegistryParseError（带路径）', () => {
  const ws = freshWorkspace('corpse-badjson')
  writeText(join(ws, 'docs', 'semantics', 'registry.json'), '{ "version": 1, "entries": [ {"id": ')
  assert.throws(
    () => loadRegistryState(ws, fs),
    (err) => {
      assert.match(err.message, /JSON 语法错误/)
      assert.ok(err.message.includes('registry.json'))
      return true
    },
  )
})

test('尸体：条目缺字段 → schemaIssues + skipped 显式上报（records 为空但不是「静默空清单」）', () => {
  const ws = freshWorkspace('corpse-missing-fields')
  writeText(join(ws, 'docs', 'semantics', 'registry.json'), registryWith([{ title: '三缺一' }]))
  const state = loadRegistryState(ws, fs)
  assert.equal(state.records.length, 0)
  assert.ok(state.schemaIssues.length >= 3, '缺 id/doc/status 应各自报一条')
  assert.equal(state.skipped.length, 1)
  assert.match(state.skipped[0].reason, /不参与 D1–D6/)
  assert.equal(state.skipped[0].index, 0)
})

test('尸体：条目指向不存在的文档/实现路径 → D1', () => {
  const ws = freshWorkspace('corpse-dangling')
  writeText(
    join(ws, 'docs', 'semantics', 'registry.json'),
    registryWith([
      {
        id: 'dangling',
        title: '悬空',
        doc: 'self-plugins/ghost/docs/semantic.md',
        status: 'implemented',
        owners: [],
        twins: [],
        impl: ['self-plugins/ghost/src/index.ts'],
        acceptance: null,
        openQuestions: null,
      },
    ]),
  )
  const state = loadRegistryState(ws, fs)
  const issues = detectDrift({ entries: state.registry.entries, facts: factsAlignedWith(state), nowMs: Date.now() })
  const d1 = issues.filter((i) => i.code === 'D1')
  assert.equal(d1.length, 2, 'doc 与 impl 各一条 D1')
  assert.ok(d1.every((i) => i.id === 'dangling'))
})

test('D5：磁盘有 docs/semantic*.md 未注册（且排除 docs/semantics/** 系统目录）', () => {
  const ws = freshWorkspace('corpse-unregistered')
  writeText(
    join(ws, 'docs', 'semantics', 'registry.json'),
    registryWith([
      {
        id: 'known',
        title: '已登记',
        doc: 'self-plugins/known/docs/semantic.md',
        status: 'draft',
        impl: [],
        owners: [],
        twins: [],
      },
    ]),
  )
  writeText(join(ws, 'self-plugins', 'known', 'docs', 'semantic.md'), DOC_MIN)
  writeText(join(ws, 'self-plugins', 'orphan', 'docs', 'semantic.md'), DOC_MIN)
  writeText(join(ws, 'docs', 'semantics', 'templates', 'semantic.md'), DOC_MIN) // 系统自身模板 → 必须排除
  writeText(join(ws, 'other', 'docs', 'semantic-lifecycle.md'), DOC_MIN)

  const state = loadRegistryState(ws, fs)
  assert.deepEqual(state.unregisteredDocs.sort(), [
    'other/docs/semantic-lifecycle.md',
    'self-plugins/orphan/docs/semantic.md',
  ])
  const d5 = detectDrift({
    entries: state.registry.entries,
    facts: factsAlignedWith(state),
    unregisteredDocs: state.unregisteredDocs,
    nowMs: Date.now(),
  }).filter((i) => i.code === 'D5')
  assert.equal(d5.length, 2)
  assert.ok(d5.every((i) => i.severity === 'warn'))
})

test('semantic_register 核心：幂等 upsert + 生成 INDEX.md + 回填文档统计', () => {
  const ws = freshWorkspace('register-idempotent')
  writeText(join(ws, 'self-plugins', 'sample', 'docs', 'semantic.md'), DOC_MIN)
  const patch = {
    id: 'sample',
    title: '样本能力',
    doc: 'self-plugins/sample/docs/semantic.md',
    status: 'implemented',
    owners: ['sample'],
    impl: ['self-plugins/sample/src/x.ts'],
  }
  writeText(join(ws, 'self-plugins', 'sample', 'src', 'x.ts'), '// impl\n')

  const first = applyRegistration(ws, fs, patch, '2026-01-01T00:00:00Z')
  assert.equal(first.action, 'created')
  assert.equal(first.entryCount, 1)
  assert.equal(first.acceptanceApplied, true)
  assert.equal(first.entry.acceptance.total, 1)
  assert.equal(first.entry.acceptance.pending, 1)
  assert.equal(first.entry.openQuestions, 1)

  const second = applyRegistration(ws, fs, patch, '2026-01-02T00:00:00Z')
  assert.equal(second.action, 'updated')
  assert.equal(second.entryCount, 1, '同 id 第二次写入不得重复条目')

  const indexAbs = join(ws, 'docs', 'semantics', 'INDEX.md')
  assert.ok(existsSync(indexAbs), 'INDEX.md 必须生成')
  const index = readFileSync(indexAbs, 'utf8')
  assert.match(index, /请勿手改/)
  assert.match(index, /\| sample \|/)

  const registryRaw = JSON.parse(readFileSync(join(ws, 'docs', 'semantics', 'registry.json'), 'utf8'))
  assert.equal(registryRaw.entries.length, 1)
})

test('semantic_register 尸体：注册表坏 JSON → 拒绝覆盖（不静默重建）', () => {
  const ws = freshWorkspace('register-corrupt')
  const regAbs = join(ws, 'docs', 'semantics', 'registry.json')
  writeText(regAbs, '{ broken json')
  assert.throws(() => applyRegistration(ws, fs, { id: 'x', title: 'X', doc: 'd.md' }, 'now'), /JSON 语法错误/)
  assert.equal(readFileSync(regAbs, 'utf8'), '{ broken json', '坏注册表必须原样保留（证据不许被销毁）')
})

test('好样本：结构完整的文档不被误报（D1–D6 全过）', () => {
  const ws = freshWorkspace('clean-sample')
  writeText(join(ws, 'docs', 'semantics', 'registry.json'), registryWith([
    {
      id: 'clean',
      title: '干净样本',
      doc: 'self-plugins/clean/docs/semantic.md',
      status: 'implemented',
      owners: [],
      twins: [],
      impl: ['self-plugins/clean/src/x.ts'],
      acceptance: { total: 1, proven: 0, pending: 1 },
      openQuestions: 1,
    },
  ]))
  writeText(join(ws, 'self-plugins', 'clean', 'docs', 'semantic.md'), DOC_MIN)
  writeText(join(ws, 'self-plugins', 'clean', 'src', 'x.ts'), '// impl\n')
  const state = loadRegistryState(ws, fs)
  const issues = detectDrift({ entries: state.registry.entries, facts: factsAlignedWith(state), nowMs: Date.now() })
  const codes = issues.map((i) => i.code)
  // D3 可能出现（impl 比 doc 新，视 mtime 而定），但 D1/D2/D4/D5/D6 必须干净
  assert.equal(codes.includes('D1'), false, JSON.stringify(issues))
  assert.equal(codes.includes('D2'), false, JSON.stringify(issues))
  assert.equal(codes.includes('D4'), false, JSON.stringify(issues))
  assert.equal(codes.includes('D5'), false, JSON.stringify(issues))
  assert.equal(codes.includes('D6'), false, JSON.stringify(issues))
})
