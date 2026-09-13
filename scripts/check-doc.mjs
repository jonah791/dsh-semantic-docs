#!/usr/bin/env node
/**
 * 单文件语义文档体检：解析任意 `semantic.md`（不必先注册进注册表）。
 *
 * 用途：写文档时即时反馈——必备 10 节是否齐全、验收表被解析器识别成什么
 * （proven/pending 计数直接对应 D2「声明高于证据」的判据）、未决问题几条。
 *
 * 与 `semantic_check` 的分工：本脚本面向**一个文件**（写稿阶段），工具面向**注册表**（治理阶段）。
 *
 * 用法：node scripts/check-doc.mjs <semantic.md> [更多文件…]
 */
import { readFileSync } from 'node:fs'
import { parseSemanticDoc } from '../lib/markdown.js'

const paths = process.argv.slice(2)
if (paths.length === 0) {
  console.error('用法：node scripts/check-doc.mjs <semantic.md> [更多文件…]')
  process.exit(2)
}

let failed = 0
for (const path of paths) {
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch (err) {
    console.log(`${path}\n  ✗ 读取失败：${err.message}`)
    failed += 1
    continue
  }
  const doc = parseSemanticDoc(text)
  const a = doc.acceptance
  const missing = doc.missingSections
  const ok = missing.length === 0
  if (!ok) failed += 1
  console.log(path)
  console.log(`  节：${ok ? '✔ 10 节齐全' : '✗ 缺 ' + missing.join(', ')} ｜ 标题 ${doc.headings.length} 个`)
  console.log(`  验收：total ${a.total} · proven ${a.proven} · pending ${a.pending}`
    + `（显式标「待线上验收」${a.pendingMarked} · 未标未证 ${a.unprovenUnmarked}）`)
  console.log(`  未决问题：${doc.openQuestions} 条 ｜ 元信息：${doc.meta.version ?? '?'} / ${doc.meta.status ?? '?'}`
    + ` ｜ 实践修订记录：${doc.hasRevisionLog ? '✔' : '✗'}`)
  // D2 预警：声明 verified 但存在未证实的验收行
  if ((doc.meta.status ?? '').includes('verified') && a.pending > 0) {
    console.log(`  ⚠ D2 预警：声明 verified，但 ${a.pending} 条验收未取得证据`)
    failed += 1
  }
  // 元信息盲区预警：字段写在了 §1 表格里（解析器只读 H1 之后的引用行）→ 系统看不见声明
  if (doc.meta.version === null || doc.meta.status === null) {
    console.log('  ⚠ 元信息未解析（version/status 至少一项为 null）：按模板写在 **H1 之后的引用行**——'
      + '`> 版本 vX · 日期 · 作者：… · 状态：**已实现**`')
    failed += 1
  }
}
console.log(`\n结果：${failed === 0 ? 'PASS' : 'FAIL（' + failed + ' 项）'}`)
process.exit(failed === 0 ? 0 : 1)
