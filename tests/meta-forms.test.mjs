/**
 * meta-forms.test.mjs — 元信息的**四种合法写法**都要能解析出来，且**不许误吃正文**。
 *
 * 修的是什么（台账 lh-fb615cc1）：67 份语义文档里 21 份的 `version`/`status` 解析为 null
 * ⇒ `check-doc.mjs` 对它们**恒报 FAIL**（恒失败的判据与恒通过的同样没用），
 * 而更要紧的是 `semantic_check` 的 **D2「声明高于证据」对它们完全失明**——
 * 不是报错，是这一类检查静默不适用。修后：PASS 42→55，元信息未解析 21→11。
 *
 * 判据（每条都能区分新旧；改前 ①③④ 与「尸体」那条全红）：
 * ① 引用行**带**冒号（模板写法）          ② 引用行**不带**冒号（`状态 draft`）
 * ③ H1 后表格（`| 版本 | 0.1.0 |`）       ④ `## 1 · 元信息` 节里的表格（超出 headerText）
 * 尸体 A：正文里的「唯一状态持有者」不得被当成 status（这是**错值**，比 null 更危险）
 * 尸体 B：文档真的没有版本项 ⇒ version 必须是 null，不许编造
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseSemanticDoc } from '../lib/markdown.js'

/** 最小骨架：只关心 meta，其余节给占位 */
const wrap = (head) => `${head}\n\n## 1 · 定位与反定位\n\n本能力不适用：夹具。\n`
const meta = (md) => parseSemanticDoc(md).meta

test('① 引用行带冒号（模板写法）', () => {
  const m = meta(wrap('# 语义文档：X\n\n> 版本 v0.2 · 2026-09-22 · 作者：爱丽丝 · 状态：**implemented**（26 条已实测 17）'))
  assert.equal(m.version, 'v0.2')
  assert.match(m.status, /^implemented/, '加粗被 cleanInline 去掉后仍应读到值')
  assert.equal(m.date, '2026-09-22')
})

test('② 引用行不带冒号（`状态 draft`）——旧正则要求必须有冒号，这类全失配', () => {
  const m = meta(wrap('# 语义文档：X\n\n> 元信息：版本 v0.1 · 状态 draft · 最近复核 2026-10-09 · owner x'))
  assert.equal(m.version, 'v0.1')
  assert.equal(m.status, 'draft', '不带冒号也要读出来，且不许带尾空格')
})

test('③ H1 后表格', () => {
  const m = meta(wrap('# 语义文档：X\n\n| 项 | 值 |\n|---|---|\n| 版本 | 0.1.0（`package.json`） |\n| 状态 | implemented（部分待线上） |'))
  assert.equal(m.version, '0.1.0')
  assert.match(m.status, /^implemented/)
})

test('④ `## 1 · 元信息` 节里的表格（在 headerText 之外，靠前 40 行兜底）', () => {
  const md = `# 语义文档：X

## 1 · 元信息

| 项 | 值 |
|---|---|
| 版本 | v0.3.1 |
| 状态 | verified |

## 2 · 定位与反定位

本能力不适用：夹具。
`
  const m = meta(md)
  assert.equal(m.version, 'v0.3.1', 'headerText 读不出时应退回前 40 行')
  assert.equal(m.status, 'verified')
})

test('★ 尸体 A：正文里的「唯一状态持有者」不得被当成 status', () => {
  const md = wrap(
    '# 语义文档：X\n\n> 版本 v0.1 · 状态 implemented（真值）\n\n## 0 · 题记\n\n安全交战闭环（一次交战的唯一状态持有者与唯一执行入口）。',
  )
  const m = meta(md)
  assert.match(m.status, /^implemented/, `status 被误吃成正文：${m.status}`)
  assert.ok(!String(m.status).includes('持有者'), 'status 绝不能是正文里的那个「状态」')
})

test('★ 尸体 B：文档真的没有版本项 ⇒ version 为 null，不许编造', () => {
  const m = meta(wrap('# 语义文档：X\n\n| 项 | 值 |\n|---|---|\n| 状态 | verified |'))
  assert.equal(m.version, null, '缺项就是 null——「没有」与「没读到」在上一级还要再分，但这里不许填假值')
  assert.equal(m.status, 'verified')
})

test('对照组：完全没有任何元信息时两项都是 null（不抛、不猜）', () => {
  const m = meta(wrap('# 语义文档：X'))
  assert.equal(m.version, null)
  assert.equal(m.status, null)
})
