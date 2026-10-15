/**
 * 文档 ↔ 源码对账（2026-10-09 · t-cdb92e72 附带发现）
 *
 * 为什么要有它：`semantic_unregister` 早已存在，而 `docs/semantic.md`（§3 图 / §4.2 表 /
 * §4.3 调用点 / **A1 验收行**）、`README.md` 声明头与能力表、源码头注释**全都写着「4 个工具」**
 * ——A1 标着「已实测」却已经为假：**一次实测被当成永久已实测**，没有任何机制会在漂移时叫醒它。
 *
 * 本文件把「同一事实在三处出现」变成**可机器判定的对账**（§5.30 显式先于隐式 / 一事实一归宿）。
 * 判据是**集合相等**，不做文本近似——多一个少一个都算漂移。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { PLUGIN_DIR } from './helpers.mjs'

const SRC = readFileSync(join(PLUGIN_DIR, 'src', 'index.ts'), 'utf8')
const DOC = readFileSync(join(PLUGIN_DIR, 'docs', 'semantic.md'), 'utf8')
const README = readFileSync(join(PLUGIN_DIR, 'README.md'), 'utf8')

/** 源码里**注册**的工具名（`name: 'semantic_x'`） */
function sourceTools() {
  return [...new Set([...SRC.matchAll(/name: '(semantic_\w+)'/g)].map((m) => m[1]))].sort()
}

/** 文本里**提到**的工具名（反引号包裹） */
function quotedTools(text) {
  return [...new Set([...text.matchAll(/`(semantic_\w+)`/g)].map((m) => m[1]))].sort()
}

function slice(md, startMark, endMark) {
  const i = md.indexOf(startMark)
  assert.notEqual(i, -1, `文档缺少小节起点：${startMark}`)
  const j = endMark === null ? md.length : md.indexOf(endMark, i + startMark.length)
  assert.notEqual(j, -1, `文档缺少小节终点：${endMark}`)
  return md.slice(i, j)
}

const EXPECTED = sourceTools()

test('前提：源码里至少注册了 1 个 semantic_* 工具（判据不空转）', () => {
  assert.ok(EXPECTED.length >= 4, `源码解析出的工具过少：${JSON.stringify(EXPECTED)}`)
  assert.ok(EXPECTED.every((t) => t.startsWith('semantic_')), JSON.stringify(EXPECTED))
})

test('工具集合：docs/semantic.md §4.2 表 == 源码', () => {
  const sec = slice(DOC, '### 4.2 工具面', '### 4.3')
  assert.deepEqual(quotedTools(sec), EXPECTED, '§4.2 表格与源码的工具集合必须相同')
  // 标题里的数字也必须对（「4 个」这类计数在漂移时最容易被漏掉）
  const m = /### 4\.2 工具面（(\d+) 个/.exec(DOC)
  assert.notEqual(m, null, '§4.2 标题必须写明工具个数')
  assert.equal(Number(m[1]), EXPECTED.length, '§4.2 标题的工具个数与源码不一致')
})

test('工具集合：README.md 声明头 tools == 源码（契约声明，不是散文）', () => {
  const m = /^ *tools: *(.+)$/m.exec(README)
  assert.notEqual(m, null, 'README.md 声明头必须有 tools 行')
  const declared = m[1].split(',').map((s) => s.trim()).filter(Boolean).sort()
  assert.deepEqual(declared, EXPECTED, 'README 声明头的工具列表与源码不一致')
})

test('工具集合：README.md 能力表 == 源码', () => {
  const sec = slice(README, '## 能力', '## 快速开始')
  assert.deepEqual(quotedTools(sec), EXPECTED, 'README 能力表与源码的工具集合必须相同')
})

test('工具集合：docs/semantic.md §3 概念图的工具清单与数字 == 源码', () => {
  const sec = slice(DOC, '模型（爱丽丝）/ 主人', 'src/index.ts:apply')
  const listed = [...new Set([...sec.matchAll(/(semantic_\w+)/g)].map((m) => m[1]))].sort()
  assert.deepEqual(listed, EXPECTED, '§3 概念图的工具清单与源码不一致')
  const m = /(\d+) 个工具/.exec(sec)
  assert.notEqual(m, null, '§3 概念图必须写明工具个数')
  assert.equal(Number(m[1]), EXPECTED.length, '§3 概念图的工具个数与源码不一致')
})

test('测试清单：docs/semantic.md §4.3 提到的 tests/*.test.mjs == 磁盘上的 == 真实文件', () => {
  const onDisk = readdirSync(join(PLUGIN_DIR, 'tests'))
    .filter((f) => f.endsWith('.test.mjs'))
    .map((f) => `tests/${f}`)
    .sort()
  const sec = slice(DOC, '### 4.3 调用点清单', '### 4.4')
  const listed = [...new Set([...sec.matchAll(/tests\/[A-Za-z0-9._-]+\.test\.mjs/g)].map((m) => m[0]))].sort()
  assert.deepEqual(listed, onDisk, '§4.3 的测试清单与磁盘上的测试文件必须一一对应（新增测试文件要登记）')
  assert.deepEqual(quotedTools(sec).length > 0 ? quotedTools(sec) : EXPECTED, EXPECTED, '§4.3 里出现的工具名必须都属于工具集合')
})

test('drift 码表：README 判据表覆盖源码的 DRIFT_CODES（不许只写 D1–D6）', () => {
  const srcCodes = [...new Set([...readFileSync(join(PLUGIN_DIR, 'src', 'registry.ts'), 'utf8')
    .matchAll(/DRIFT_CODES = \[([^\]]+)\]/g)]
    .flatMap((m) => [...m[1].matchAll(/'(D\d)'/g)].map((x) => x[1])))].sort()
  assert.ok(srcCodes.length >= 7, `DRIFT_CODES 解析结果异常：${JSON.stringify(srcCodes)}`)
  const sec = slice(README, '**drift 判据**', '**状态模型**')
  const listed = [...new Set([...sec.matchAll(/^\| (D\d) /gm)].map((m) => m[1]))].sort()
  assert.deepEqual(listed, srcCodes, 'README 的 drift 判据表必须覆盖源码 DRIFT_CODES 的每一码')
})
