/**
 * dsh-semantic-docs · Markdown 解析层（纯函数）
 *
 * 契约来源：`docs/semantics/README.md`
 *   §4 文档必备结构 10 项（缺节 → D4）
 *   §5 状态模型（verified 需 acceptance.pending == 0 且 total > 0）
 *   §6 注册表 schema（acceptance / openQuestions 由解析回填，手写值仅作占位）
 *   §8 D6（实践修订记录 = I3 载体）
 *
 * 纯函数纪律：输入字符串 → 输出结构；本文件不读文件、不看时间、不依赖 cwd。
 * 已知局限（README §10 U3 的实证）：靠标题语义匹配解析，写法差异会漏判——
 *   故本层把「解析出的原始证据」（命中标题/命中行号/命中行原文）一并返回，便于人工复核。
 */

/** 一级/多级标题 */
export interface Heading {
  level: number
  title: string
  /** 1-based 行号 */
  line: number
}

/** 必备结构的匹配规则（README §4 的 10 项） */
export interface RequiredSection {
  key: string
  name: string
  test: RegExp
}

/**
 * 必备结构 10 项。
 * 注意：README §4 的编号是「必备项的序号」，不是文档自己的节号——
 * 实际文档的节号各不相同（哨兵文档 1..9、面板文档 0..12），故一律按**标题语义**匹配。
 */
export const REQUIRED_SECTIONS: readonly RequiredSection[] = [
  { key: 'meta', name: '元信息', test: /元信息|元数据|^meta\b/i },
  { key: 'positioning', name: '定位与反定位', test: /定位/ },
  { key: 'glossary', name: '术语表', test: /术语/ },
  { key: 'concept', name: '概念模型 + 不变量', test: /概念|不变量|模型/ },
  { key: 'contract', name: '契约', test: /契约/ },
  { key: 'boundary', name: '边界与信任', test: /边界|信任/ },
  { key: 'acceptance', name: '可证伪验收', test: /可证伪|验收/ },
  { key: 'impl-relation', name: '与实现的关系', test: /与实现的关系|实现的关系/ },
  { key: 'revision-log', name: '实践修订记录', test: /实践修订记录|实践回修/ },
  { key: 'open-questions', name: '未决问题', test: /未决问题|待决问题/ },
]

/** 一条可证伪验收（README §4 第 7 项 / I4 / I5） */
export interface AcceptanceRow {
  id: string
  proposition: string
  evidence: string
  /** 显式标注「待线上验收」（I5 的字面标记） */
  pendingMarked: boolean
  /** 证据单元格含通过标记（✔/✓/✅ 或「已实测」等） */
  proven: boolean
  /** 1-based 行号 */
  line: number
  raw: string
}

export interface AcceptanceStats {
  total: number
  /** 证据列含通过标记的行数 */
  proven: number
  /**
   * 未通过验收的行数 = total - proven（fail-closed 口径）。
   * 依据：README §5「verified 需 acceptance.pending == 0」+ I5「不得用『已实现』笼统掩盖」——
   * 一条既没有实测证据、也没有显式标注的验收行，属于「未验收」，计入 pending 才安全。
   */
  pending: number
  /** 显式标注「待线上验收」的行数（README I5 的字面口径，单独暴露以便对照） */
  pendingMarked: number
  /** 既未通过、也未显式标注的行数（口径差异的来源，单独暴露） */
  unprovenUnmarked: number
  rows: AcceptanceRow[]
}

export interface OpenQuestionItem {
  label: string
  text: string
}

/** 元信息字段（尽力解析，非判据；判据只有「元信息是否存在」） */
export interface DocMetaFields {
  version: string | null
  date: string | null
  status: string | null
  implHints: string[]
}

export interface DocSection {
  key: string
  name: string
  present: boolean
  titles: string[]
}

export interface DocParse {
  headings: Heading[]
  sections: DocSection[]
  /** 缺失必备节的 key（D4 的依据） */
  missingSections: string[]
  /** 缺失必备节的中文名（人读用） */
  missingSectionNames: string[]
  presentSections: string[]
  hasMeta: boolean
  /** 「实践修订记录」小节存在（D6 的依据） */
  hasRevisionLog: boolean
  /** 文档含「待复核」标记（抑制 D3） */
  needReview: boolean
  acceptance: AcceptanceStats
  openQuestions: number
  openQuestionItems: OpenQuestionItem[]
  meta: DocMetaFields
}

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/
const FENCE_RE = /^\s*(?:```|~~~)/
const PASS_RE = /[✔✓✅]|已实测|实测通过|已通过验收/
const PENDING_RE = /待线上验收|待验收/
const LIST_ITEM_RE = /^(\s{0,1})(?:[-*+]|\d+[.)])\s+(.*)$/

function cleanInline(text: string): string {
  return text
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 代码围栏标记：围栏内的一切都不参与标题/表格/条目解析 */
function fenceMask(lines: readonly string[]): boolean[] {
  const mask: boolean[] = []
  let inFence = false
  for (const line of lines) {
    if (FENCE_RE.test(line)) {
      mask.push(true)
      inFence = !inFence
      continue
    }
    mask.push(inFence)
  }
  return mask
}

function parseHeadings(lines: readonly string[], mask: readonly boolean[]): Heading[] {
  const out: Heading[] = []
  for (let i = 0; i < lines.length; i += 1) {
    if (mask[i] === true) continue
    const m = HEADING_RE.exec(lines[i] ?? '')
    if (m === null) continue
    out.push({ level: (m[1] ?? '#').length, title: cleanInline(m[2] ?? ''), line: i + 1 })
  }
  return out
}

interface Span {
  /** 0-based 起始行（标题行本身） */
  start: number
  /** 0-based 结束行（不含） */
  end: number
}

function findSpan(lines: readonly string[], headings: readonly Heading[], test: RegExp): Span | null {
  const hit = headings.find((h) => test.test(h.title))
  if (hit === undefined) return null
  const start = hit.line - 1
  let end = lines.length
  for (const h of headings) {
    const idx = h.line - 1
    if (idx <= start) continue
    if (h.level <= hit.level) {
      end = idx
      break
    }
  }
  return { start, end }
}

interface TableBlock {
  header: string[]
  rows: string[][]
  lineNumbers: number[]
}

const SEP_RE = /^[\s:|-]*-[\s:|-]*$/

function splitRow(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|')) s = s.slice(0, -1)
  return s.split('|').map((c) => cleanInline(c))
}

function parseTables(lines: readonly string[], mask: readonly boolean[], span: Span): TableBlock[] {
  const tables: TableBlock[] = []
  let i = span.start
  while (i < span.end) {
    const raw = lines[i] ?? ''
    if (mask[i] === true || !raw.trim().startsWith('|')) {
      i += 1
      continue
    }
    const block: { line: number; cells: string[] }[] = []
    while (i < span.end) {
      const cur = lines[i] ?? ''
      if (mask[i] === true || !cur.trim().startsWith('|')) break
      block.push({ line: i + 1, cells: splitRow(cur) })
      i += 1
    }
    if (block.length === 0) continue
    const first = block[0]
    if (first === undefined) continue
    let body = block.slice(1)
    const second = block[1]
    if (second !== undefined && second.cells.length > 0 && second.cells.every((c) => SEP_RE.test(c) || c.length === 0) && second.cells.join('').includes('-')) {
      body = block.slice(2)
    }
    tables.push({
      header: first.cells,
      rows: body.map((b) => b.cells),
      lineNumbers: body.map((b) => b.line),
    })
  }
  return tables
}

function emptyAcceptance(): AcceptanceStats {
  return { total: 0, proven: 0, pending: 0, pendingMarked: 0, unprovenUnmarked: 0, rows: [] }
}

/**
 * 解析语义文档。
 * 纯函数：同输入必得同输出（不读文件、不看时钟）。
 */
export function parseSemanticDoc(text: string): DocParse {
  const lines = text.split(/\r?\n/)
  const mask = fenceMask(lines)
  const headings = parseHeadings(lines, mask)

  const sections: DocSection[] = REQUIRED_SECTIONS.map((spec) => {
    const titles = headings.filter((h) => spec.test.test(h.title)).map((h) => h.title)
    return { key: spec.key, name: spec.name, present: titles.length > 0, titles }
  })

  // 元信息块 = 首个**章节标题**（level ≥ 2）之前的一切：
  // 实际文档的元信息写在 H1 标题之后、第一个 `##` 之前的引用块里（模板即此形态），
  // 故不能以「第一个标题」为界，否则 H1 会把它切掉（2026-09-12 实测修正）。
  const firstSection = headings.find((h) => h.level >= 2)
  const headerText = lines.slice(0, firstSection === undefined ? lines.length : firstSection.line - 1).join('\n')
  const metaSection = sections.find((s) => s.key === 'meta')
  const hasMeta = (metaSection?.present ?? false) || /版本|状态|日期|实现落点/.test(headerText)

  const finalSections = sections.map((s) => (s.key === 'meta' ? { ...s, present: hasMeta } : s))
  const missing = finalSections.filter((s) => !s.present)

  // ---- 可证伪验收（README §4 第 7 项）----
  const acceptanceSpec = REQUIRED_SECTIONS.find((s) => s.key === 'acceptance')
  const acceptanceSpan = acceptanceSpec === undefined ? null : findSpan(lines, headings, acceptanceSpec.test)
  let acceptance = emptyAcceptance()
  if (acceptanceSpan !== null) {
    const rows: AcceptanceRow[] = []
    for (const table of parseTables(lines, mask, acceptanceSpan)) {
      table.rows.forEach((cells, idx) => {
        const meaningful = cells.filter((c) => c.length > 0)
        if (meaningful.length < 2) return
        const evidence = meaningful.length >= 3 ? (meaningful[meaningful.length - 1] ?? '') : ''
        const raw = `${lines[(table.lineNumbers[idx] ?? 1) - 1] ?? ''}`
        rows.push({
          id: meaningful[0] ?? '',
          proposition: meaningful[1] ?? '',
          evidence,
          pendingMarked: PENDING_RE.test(evidence) || PENDING_RE.test(raw),
          proven: PASS_RE.test(evidence),
          line: table.lineNumbers[idx] ?? 0,
          raw: raw.trim(),
        })
      })
    }
    const proven = rows.filter((r) => r.proven).length
    const pendingMarked = rows.filter((r) => r.pendingMarked).length
    const pending = rows.length - proven
    acceptance = {
      total: rows.length,
      proven,
      pending,
      pendingMarked,
      unprovenUnmarked: pending - pendingMarked,
      rows,
    }
  }

  // ---- 未决问题（README §4 第 10 项）：列表条目 + 表格行两种形态 ----
  const oqSpec = REQUIRED_SECTIONS.find((s) => s.key === 'open-questions')
  const oqSpan = oqSpec === undefined ? null : findSpan(lines, headings, oqSpec.test)
  const items: OpenQuestionItem[] = []
  if (oqSpan !== null) {
    for (let i = oqSpan.start + 1; i < oqSpan.end; i += 1) {
      if (mask[i] === true) continue
      const line = lines[i] ?? ''
      if (line.trim().startsWith('|')) continue
      const m = LIST_ITEM_RE.exec(line)
      if (m === null) continue
      const bodyText = cleanInline(m[2] ?? '')
      if (bodyText.length === 0) continue
      const labelMatch = /^([A-Z]?\d+[.)]?)\s*[:：]?/.exec(bodyText)
      const label = labelMatch?.[1] ?? `#${items.length + 1}`
      items.push({ label, text: bodyText.slice(0, 200) })
    }
    for (const table of parseTables(lines, mask, oqSpan)) {
      for (const cells of table.rows) {
        const meaningful = cells.filter((c) => c.length > 0)
        if (meaningful.length < 2) continue
        items.push({ label: meaningful[0] ?? '', text: (meaningful[1] ?? '').slice(0, 200) })
      }
    }
  }

  const meta: DocMetaFields = (() => {
    const scope = headerText.trim().length > 0 ? headerText : text
    // 逐行去 Markdown 强调/行内代码（**保留换行**，否则状态值会吞掉后续行）。
    // 2026-09-13 实测修正：模板推荐的 `状态：**已实现**` 加粗写法曾因正则 `[^·|\n*]+` 遇 `*`
    // 直接失配 → 状态一律解析为 null（连按模板写的文档也读不出来）。
    const plain = scope.split('\n').map(cleanInline).join('\n')
    const version = /版本\s*[：:]?\s*(v?\d+(?:\.\d+)*)/i.exec(plain)?.[1] ?? null
    const date = /(20\d{2}-\d{2}-\d{2})/.exec(plain)?.[1] ?? null
    const status = /状态\s*[：:]\s*([^·|\n]+)/.exec(plain)?.[1]?.trim() ?? null
    const implHints = [...plain.matchAll(/实现落点[^\n]*/g)].map((m) => cleanInline(m[0])).slice(0, 3)
    return { version, date, status, implHints }
  })()

  return {
    headings,
    sections: finalSections,
    missingSections: missing.map((s) => s.key),
    missingSectionNames: missing.map((s) => s.name),
    presentSections: finalSections.filter((s) => s.present).map((s) => s.key),
    hasMeta,
    hasRevisionLog: finalSections.some((s) => s.key === 'revision-log' && s.present),
    needReview: /待复核/.test(text),
    acceptance,
    openQuestions: items.length,
    openQuestionItems: items.slice(0, 50),
    meta,
  }
}
