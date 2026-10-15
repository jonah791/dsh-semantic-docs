/**
 * tests/unregister.test.mjs —— `semantic_unregister` 的判据回归（纯层 + IO 层，跑 lib 产物）。
 *
 * 覆盖三件必须成立的事：
 *   ① 未命中 id ⇒ `removed:false` 且**不写盘**（「无处可删」不得伪装成「已删」）；
 *   ② 悬空引用（其它条目仍指向被删条目的 doc/twins/impl）必须被列出来；
 *   ③ 注册表坏 JSON ⇒ 拒绝覆盖（坏注册表是证据）。
 *
 * 跑法：node --test tests/unregister.test.mjs（先 tsc -p tsconfig.json 构建）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { removeEntry } from '../lib/registry.js'
import { applyRemoval, createNodeFs } from '../lib/collect.js'

const HERE = new Date().toISOString()

function reg(entries) {
  return { version: 1, updatedAt: HERE, workspace: '/ws', entries }
}

/** 造一个带 registry.json 的临时 workspace。 */
async function wsWith(registryText) {
  const dir = await mkdtemp(join(tmpdir(), 'unreg-'))
  const p = join(dir, 'docs', 'semantics', 'registry.json')
  await mkdir(dirname(p), { recursive: true })
  await writeFile(p, registryText, 'utf8')
  return dir
}

// ── 纯层：removeEntry ────────────────────────────────────────────────────
test('removeEntry：命中 ⇒ removed、条目移出、余项保持', () => {
  const r = removeEntry(reg([{ id: 'a' }, { id: 'b' }]), 'a', HERE)
  assert.equal(r.removed, true)
  assert.equal(r.entry.id, 'a')
  assert.deepEqual(r.registry.entries.map(e => e.id), ['b'])
})

test('removeEntry：未命中 ⇒ removed=false 且 registry 原样（**调用方须据此报错**）', () => {
  const before = reg([{ id: 'a' }])
  const r = removeEntry(before, 'nope', HERE)
  assert.equal(r.removed, false)
  assert.equal(r.entry, null)
  assert.equal(r.registry, before, '未命中不得产生新对象（避免无谓 updatedAt 变更）')
})

test('removeEntry：扫出指向被删条目文档路径的**悬空引用**（doc/twins/impl 三字段）', () => {
  const r = removeEntry(reg([
    { id: 'gone', doc: 'self-plugins/x/docs/semantic.md' },
    { id: 'ref-doc', doc: 'self-plugins/x/docs/semantic.md' },
    { id: 'ref-twin', doc: 'other.md', twins: ['self-plugins/x/docs/semantic.md'] },
    { id: 'ref-impl', doc: 'other.md', impl: ['self-plugins/x/docs/semantic.md'] },
    { id: 'clean', doc: 'unrelated.md' },
  ]), 'gone', HERE)
  assert.equal(r.removed, true)
  const by = Object.fromEntries(r.referencedBy.map(x => [x.id, x.field]))
  assert.equal(by['ref-doc'], 'doc')
  assert.equal(by['ref-twin'], 'twins')
  assert.equal(by['ref-impl'], 'impl')
  assert.equal('clean' in by, false, '无关条目不得被列为引用者')
})

test('removeEntry：被删条目无 doc 路径 ⇒ 不产生悬空引用（不误报）', () => {
  const r = removeEntry(reg([{ id: 'gone' }, { id: 'x', doc: 'a.md' }]), 'gone', HERE)
  assert.equal(r.removed, true)
  assert.deepEqual(r.referencedBy, [])
})

// ── IO 层：applyRemoval ─────────────────────────────────────────────────
test('applyRemoval：命中 ⇒ 写盘 + 条目数减一 + INDEX.md 同步重生成', async () => {
  const dir = await wsWith(JSON.stringify(reg([
    { id: 'a', title: 'A', status: 'draft', doc: 'a.md', owners: [], twins: [], impl: [], acceptance: null, openQuestions: null },
    { id: 'b', title: 'B', status: 'draft', doc: 'b.md', owners: [], twins: [], impl: [], acceptance: null, openQuestions: null },
  ]), null, 2))
  const out = applyRemoval(dir, createNodeFs(), 'a', HERE)
  assert.equal(out.removed, true)
  assert.equal(out.entryCount, 1)
  const after = JSON.parse(await readFile(join(dir, 'docs', 'semantics', 'registry.json'), 'utf8'))
  assert.deepEqual(after.entries.map(e => e.id), ['b'])
  const idx = await readFile(join(dir, 'docs', 'semantics', 'INDEX.md'), 'utf8')
  assert.match(idx, /\| b \|/, 'INDEX 应含剩余条目')
  assert.doesNotMatch(idx, /\| a \|/, 'INDEX 不应再含被删条目')
})

test('applyRemoval：未命中 ⇒ removed=false 且**不写盘**（updatedAt 不动）', async () => {
  const original = JSON.stringify(reg([{ id: 'a' }]), null, 2)
  const dir = await wsWith(original)
  const out = applyRemoval(dir, createNodeFs(), 'nope', '2099-01-01T00:00:00.000Z')
  assert.equal(out.removed, false)
  assert.equal(out.entryCount, 1)
  const after = await readFile(join(dir, 'docs', 'semantics', 'registry.json'), 'utf8')
  assert.equal(after, original, '未命中不得改盘（否则 updatedAt 会被无谓刷新）')
})

test('applyRemoval：注册表不存在 ⇒ 抛错（「无处可删」不是「已删」）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'unreg-empty-'))
  assert.throws(() => applyRemoval(dir, createNodeFs(), 'a', HERE), /注册表不存在/)
})

test('applyRemoval：注册表坏 JSON ⇒ 抛错并拒绝覆盖（坏注册表是证据）', async () => {
  const dir = await wsWith('{ 这不是 json')
  // 判据打在**错误类型 / 语义类别**上，不绑具体文案（文案会演化，绑文案的断言会假红）
  assert.throws(() => applyRemoval(dir, createNodeFs(), 'a', HERE), /RegistryParseError|语法错误|注册表/)
  const after = await readFile(join(dir, 'docs', 'semantics', 'registry.json'), 'utf8')
  assert.equal(after, '{ 这不是 json', '坏注册表必须原样保留')
  assert.equal(existsSync(join(dir, 'docs', 'semantics', 'INDEX.md')), false, '失败时不得生成 INDEX')
})
