/**
 * D3 误报治理夹具（t-c54b41c6 成因 A / B）
 *
 * ## 三种成因（2026-09-22 定标）
 * - **成因 A**：impl 清单是**文件粒度**，而 `src/index.ts` 这类装配点文件天然被多条语义登记
 *   ⇒ 别的语义的提交点亮本条（实测：`web-lifecycle` 被 wake-delivery 的提交点亮）。
 * - **成因 B**：工作区有**未提交改动**（或行尾归一）⇒ mtime 变新而语义没变
 *   ⇒ 空报（实测受害 8 条：agent-browser / telegram-outbound / skill-forge + 5 条行尾归一）。
 * - **成因 C**：twins 混进 mtime 比较 —— 已修（commit `130b682`，另有尸体测试）。
 *
 * ## 修法（本文件钉住的行为）
 * D3 的**真源从 mtime 换成「已提交」**；触发提交**同时更新了其它条目的文档**时降级为 `info`
 * 并把提交归因写进消息；git 不可用时退回 mtime **且消息里明说**「未经版本控制核对」。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectDrift, suppressedBySharedAssembly } from '../lib/registry.js'
import { parseSemanticDoc } from '../lib/markdown.js'
import { DOC_COMPLETE, makeEntry, makeFacts } from './helpers.mjs'

const T0 = Date.parse('2026-09-22T00:00:00Z')
const HOUR = 3_600_000
const DOC = parseSemanticDoc(DOC_COMPLETE)
const NOW = T0 + 24 * HOUR

const d3Of = (facts) =>
  detectDrift({ entries: [makeEntry()], facts: [facts], nowMs: NOW }).filter((i) => i.code === 'D3')

test('★ 成因 B 尸体样本：mtime 新但**提交**不新（工作区未提交改动/行尾归一）⇒ 不得报 D3', () => {
  const issues = d3Of(makeFacts({
    doc: DOC,
    docMtimeMs: T0, docCommitMs: T0,
    implLatestMtimeMs: T0 + HOUR,   // 工作区被 touch/renormalize 推新
    implLatestCommitMs: T0,         // 但没有任何新提交
    implLatestPath: 'self-plugins/sample/src/index.ts',
    implDirty: true,
  }))
  assert.deepEqual(issues, [], '未提交改动不是「实现比文档新」——这正是 8 条空报的形状')
})

test('对照组：真有**新提交** ⇒ 照常报 D3（修复不得把真 drift 一起静音）', () => {
  const issues = d3Of(makeFacts({
    doc: DOC,
    docMtimeMs: T0, docCommitMs: T0,
    implLatestMtimeMs: T0 + HOUR, implLatestCommitMs: T0 + HOUR,
    implLatestCommitSha: 'abc1234', implLatestCommitSubject: 'feat(sample): 改了实现',
    implLatestPath: 'self-plugins/sample/src/index.ts',
  }))
  assert.equal(issues.length, 1)
  assert.equal(issues[0].severity, 'warn')
  assert.ok(issues[0].message.includes('abc1234'), '消息要给出触发提交（归因不能只给一个 mtime）：' + issues[0].message)
})

test('★ 成因 A 尸体样本：触发提交**同时更新了别的条目的文档** ⇒ 本条 D3 **被抑制**（只报真变的那条）', () => {
  const facts = makeFacts({
    doc: DOC,
    docMtimeMs: T0, docCommitMs: T0,
    implLatestMtimeMs: T0 + HOUR, implLatestCommitMs: T0 + HOUR,
    implLatestCommitSha: 'deadbee', implLatestCommitSubject: 'fix(other): 改了别的语义',
    // 该提交触及的路径里出现了**别的**条目的语义文档（装配点被多条语义共用）
    implLatestCommitFiles: ['self-plugins/sample/src/index.ts', 'self-plugins/other/docs/semantic.md'],
    implLatestPath: 'self-plugins/sample/src/index.ts',
  })
  assert.deepEqual(d3Of(facts), [], '共享装配点不该按 D3 报警（那是成因 A 的空报）')
  // 抑制必须**可披露**（§5.17：跳过不等于健康）——同一判定函数供 notes 调用
  assert.equal(suppressedBySharedAssembly(facts, 'self-plugins/sample/docs/semantic.md'), true)
})

test('对照：同一提交**没碰**别的语义文档 ⇒ 仍是 D3 warn；判定函数也返回 false', () => {
  const facts = makeFacts({
    doc: DOC,
    docMtimeMs: T0, docCommitMs: T0,
    implLatestMtimeMs: T0 + HOUR, implLatestCommitMs: T0 + HOUR,
    implLatestCommitSha: 'cafe123', implLatestCommitSubject: 'feat(sample): 只有本条',
    implLatestCommitFiles: ['self-plugins/sample/src/index.ts', 'self-plugins/sample/README.md'],
    implLatestPath: 'self-plugins/sample/src/index.ts',
  })
  const issues = d3Of(facts)
  assert.equal(issues.length, 1)
  assert.equal(issues[0].severity, 'warn')
  assert.equal(suppressedBySharedAssembly(facts, 'self-plugins/sample/docs/semantic.md'), false)
  // 边界：提交碰的是**本条自己的**文档 ⇒ 不算共享装配点（那正是「文档已同步」的正常情形）
  assert.equal(
    suppressedBySharedAssembly({ ...facts, implLatestCommitFiles: ['self-plugins/sample/docs/semantic.md'] }, 'self-plugins/sample/docs/semantic.md'),
    false,
  )
})

test('git 不可用 ⇒ **退回 mtime 判据**，但消息必须明说「未经版本控制核对」（不静默换判据）', () => {
  const issues = d3Of(makeFacts({
    doc: DOC,
    docMtimeMs: T0, docCommitMs: null,          // 无提交信息（未纳入版本控制 / 无 git）
    implLatestMtimeMs: T0 + HOUR, implLatestCommitMs: null,
    implLatestPath: 'self-plugins/sample/src/index.ts',
  }))
  assert.equal(issues.length, 1, '兜底仍要能报（不能因为拿不到 git 就彻底闭眼）')
  assert.ok(issues[0].message.includes('未经版本控制核对'), '兜底必须自带范围标注：' + issues[0].message)
})

test('对照：文档也提交了更新的情况下不报（提交比较而非 mtime 比较）', () => {
  const issues = d3Of(makeFacts({
    doc: DOC,
    docMtimeMs: T0, docCommitMs: T0 + 2 * HOUR,   // 文档后提交
    implLatestMtimeMs: T0 + HOUR, implLatestCommitMs: T0 + HOUR,
    implLatestPath: 'self-plugins/sample/src/index.ts',
  }))
  assert.deepEqual(issues, [])
})
