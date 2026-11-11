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
  /** 「状态」格原文（表格没有状态列 ⇒ 空串）。与 evidence 分开：它是结论，证据是依据。 */
  status: string
  /** 显式标注「待线上验收」（I5 的字面标记） */
  pendingMarked: boolean
  /** 证据单元格含通过标记（✔/✓/✅ 或「已实测」等），或状态格判定为已验 */
  proven: boolean
  /** 最后一格**以词表外近义词开头**（人读=已证，机器读=未验）——D7 的依据，只报不拦 */
  nearMiss: boolean
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
  /** 近义词误读风险行数（未证未标 ∩ 格首近义词）——D7 的依据，只报不拦 */
  nearMiss: number
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
  /** 「待复核至 YYYY-MM-DD」的期限（null = 旧标记，无期限）；过期后 D3 恢复报警（2026-10-21 · t-7216205f） */
  needReviewUntil: string | null
  acceptance: AcceptanceStats
  openQuestions: number
  openQuestionItems: OpenQuestionItem[]
  meta: DocMetaFields
}

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/
const FENCE_RE = /^\s*(?:```|~~~)/
const PASS_RE = /[✔✓✅]|已实测|实测通过|已通过验收/
const PENDING_RE = /待线上验收|待验收/
/**
 * 近义词误读的判据（D7 的依据）：**格首**出现词表外的「已通过」写法。
 *
 * 为什么锚定格首：2026-10-09 全库实测（69 份文档 / 1,132 验收行）——不锚定时 4 条**长散文格**被误报
 * （最后一格是整段说明，只是行文里出现「已由…实现」）。锚定后 **55 行真命中 / 8 份文档**，长散文假阳性 **0**。
 * 为什么要有它：`proven` 是**严格词表**——「已证 / 已验证 / 已验收」这类**人读等于已证**的写法落在词表外
 * ⇒ 机器读作「毫无证据」。2026-09-15 `agent-cluster` 18 条「已验证」⇒ 0/18/18；2026-10-09
 * `agent-reconstruction` 9 条「已证」⇒ 0/11。**同一个坑换了词，两次都靠人碰巧看见 `semantic_get`。**
 */
const NEAR_MISS_RE = /^(?:\*\*)?(已证|已验证|已验收|已检验|已核对|已确认|已跑通|实测通过)/
const LIST_ITEM_RE = /^(\s{0,1})(?:[-*+]|\d+[.)])\s+(.*)$/

/**
 * 表头所列「这一列是什么」——2026-11-03 补的四列表支持。
 *
 * 存在理由：早先的证据格一律取「最后一个非空格」。三列表（`# | 命题 | 证据`）那样取是对的，
 * 四列表（`# | 命题 | 证据 | 状态`）就**取到了状态格**：`dsh-llm-probe` 8 条写着 `已验证`，
 * 于是被当成「证据是『已验证』」——它不在 `PASS_RE` 词表里 ⇒ 8 条真·已验被读成未验，
 * 而且**静默**：读数只是一个偏小的数字，没有任何东西提示我「取错列了」。
 *
 * 判据因此要从「位置」改成「角色」：读表头，按列名认列。
 */
const COL_PROPOSITION_RE = /命题|判据|主张|proposition/i
/** `装置` / `手段` 是本项目语料里的「证据」同义词（夹具与本仓文档都用过），不认就会退回旧口径。 */
const COL_EVIDENCE_RE = /证据|依据|佐证|装置|手段|evidence/i
const COL_STATUS_RE = /状态|结果|结论|验收状态|verdict|status/i
/**
 * 状态格里表示「已验」的词，**在 `PASS_RE` 词表之外**还要认的（`PASS_RE` 那批照认）。
 * 为什么是「之外」而不是「另起一套」：三列表 `| 命题 | 证据 | 状态 |` 的状态格本来就常写
 * `已实测`（那是 `PASS_RE` 的词）；只认新词表会把 20 多份文档的已验读数一次打到 0。
 * 2026-11-03 第一版就是这么错的——改口径时必须先量全库，别只盯要修的那一份。
 */
const STATUS_PASS_EXTRA_RE = /已验证|已验|已证|已验收|已通过|通过|pass|done/i

/**
 * 状态格里表示「还没验完」的词。命中即判定该行**未验**，哪怕同一格里也写了「已实测」。
 *
 * 2026-11-12 加这条否决，推翻了 2026-11-03 的「刻意不加」决定。推翻的理由不是改口味：
 *
 * ① **当时的恐惧建立在没量过的数字上**。原注释写「加否决会让 17 份文档共 29 行一起翻」。
 *    用插件自己的解析器实测（`scripts/semantic-failopen-scan.mjs`）：**11 行 / 6 份**，
 *    全库 67 份 1255 行里占 0.9%。17/29 这个数字没被量过就当了决策依据。
 * ② **这不是价值裁决，是两个字段对同一件事给出相反答案**。11 行里有 **9 行**的
 *    `pendingMarked` 同时为真（`PENDING_RE` 命中「待验收」），于是同一行既 `proven` 又
 *    `pendingMarked` ⇒ `pending = total - proven` 说「没有待验」，而 `pendingMarked > 0`
 *    说「有待验」。另 2 行用的是「线上验收未通过」「有意未验」措辞，`pendingMarked` 不认它们
 *    （`PENDING_RE` 只认「待验收」），但「未通过 / 有意未验」在任何读法下都不等于「已验」。
 *    文档作者写下这几个词时意思明确是「还没验完」——解析器不该替他改口。
 * ③ 「单测已过」这件事**没有被丢掉**：它还在 `evidence` 格里，人读得到；`proven` 只回答
 *    「这条验收算不算过了」这一个问题。
 *
 * 翻转面已对账：改前 1007 proven / 改后 996，**正好 −11**，与扫描清单逐条对上。
 */
const STATUS_PENDING_RE = /待验收|待验|未通过|未验|未过|未上线|有意未验/

/**
 * 状态格是否表示「已验」。空串 = 没有状态列 / 该格为空 ⇒ 不由它下判断（返回 false，交回证据格）。
 */
function statusProven(status: string): boolean {
  if (status === '') return false
  if (STATUS_PENDING_RE.test(status)) return false
  return PASS_RE.test(status) || STATUS_PASS_EXTRA_RE.test(status)
}

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

/**
 * 定位某一节的 span（标题行 → 下一个**同级或更浅**的标题）。
 *
 * **命中取层级最浅者**（同级取文档序最先），不是「文档序第一个命中」。
 * 理由（2026-10-09 实测）：按文档序取首个时，排在前面的**子标题**会抢走正式节的 span——
 * `docs/semantic.md` 里新加的 `### 4.4 验收快照…` 抢走了 `## 7 · 可证伪验收清单`，
 * 于是 A1–A17 被读成子节那 3 行（`0/3/3`），**且这个错读数被静默写进注册表**。
 * 只按层级择优，`##` 正式节永远赢过 `###` 子标题；全库 72 份文档实测该改动的读数为**零变化**。
 */
function findSpan(lines: readonly string[], headings: readonly Heading[], test: RegExp): Span | null {
  let hit: Heading | undefined
  for (const h of headings) {
    if (!test.test(h.title)) continue
    if (hit === undefined || h.level < hit.level) hit = h
  }
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
  /** 首行是否**真是表头**（第二行是分隔行）。false ⇒ `header` 其实是首条数据行，不许当列名读。 */
  hasHeader: boolean
  rows: string[][]
  lineNumbers: number[]
}

const SEP_RE = /^[\s:|-]*-[\s:|-]*$/

/**
 * 拆一行表格为单元格。
 *
 * ⚠ `\|` 是 Markdown 表格里的**转义竖线**（单元格内容自身含 `|`，如命令行/正则片段），
 * 它不是列分隔符。早先直接 `split('|')` 会把它切成两格 ⇒ **列数虚增、后续所有列错位**。
 * 2026-11-03 实测：`dsh-llm-retry` / `dsh-code-search` / `dsh-clyan` 的验收行因此变成 5–6 格，
 * 「证据」与「状态」各自被切成碎片。这个 bug 一直在，只是旧口径「取最后一格」把它掩盖了；
 * 一旦按列名取格，它就变成硬伤。
 */
function splitRow(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
  const cells: string[] = []
  let buf = ''
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i] ?? ''
    if (c === '\\' && s[i + 1] === '|') {
      buf += '\\|'
      i += 1
      continue
    }
    if (c === '|') {
      cells.push(buf)
      buf = ''
      continue
    }
    buf += c
  }
  cells.push(buf)
  return cells.map((c) => cleanInline(c.replace(/\\\|/g, '|')))
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
    // 表头判据（2026-09-22 修正）：**只有第二行是分隔行时，首行才是表头**。
    // 原实现无条件 `block.slice(1)` 丢掉首行 ⇒ 表格被空行切成多块时，后续块既无表头也无分隔行，
    // 它的首**数据行**被静默吃掉——实测 6 份文档共 8 行验收因此未计入（如 memory-continuity 的 A45），
    // 后果是 total 偏小、`verified` 判据（pending==0）偏松。
    const second = block[1]
    const hasSeparator = second !== undefined
      && second.cells.length > 0
      && second.cells.every((c) => SEP_RE.test(c) || c.length === 0)
      && second.cells.join('').includes('-')
    const body = hasSeparator ? block.slice(2) : block
    tables.push({
      header: first.cells,
      hasHeader: hasSeparator,
      rows: body.map((b) => b.cells),
      lineNumbers: body.map((b) => b.line),
    })
  }
  return tables
}

function emptyAcceptance(): AcceptanceStats {
  return { total: 0, proven: 0, pending: 0, pendingMarked: 0, unprovenUnmarked: 0, nearMiss: 0, rows: [] }
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
      // 列角色只在**真有表头**时才可用：表格被空行切成多块时，后续块的首行是数据行，
      // 拿它当列名会把「命题」里的字读成列名（2026-09-22 修正过的同一个坑）。
      const colProposition = table.hasHeader ? table.header.findIndex((h) => COL_PROPOSITION_RE.test(h)) : -1
      const colEvidence = table.hasHeader ? table.header.findIndex((h) => COL_EVIDENCE_RE.test(h)) : -1
      const colStatus = table.hasHeader ? table.header.findIndex((h) => COL_STATUS_RE.test(h)) : -1
      table.rows.forEach((cells, idx) => {
        const meaningful = cells.filter((c) => c.length > 0)
        if (meaningful.length < 2) return
        /** 按**列下标**取格（越界给空串）——不许先把空格滤掉再取位置，那会让列错位。 */
        const at = (i: number): string => (i >= 0 && i < cells.length ? (cells[i] ?? '') : '')
        const proposition = colProposition >= 0 ? at(colProposition) : (meaningful[1] ?? '')
        const status = at(colStatus)
        /** 旧口径的「最后一格」——**必须留着**：见下面 proven 的注释。 */
        const legacyEvidence = meaningful.length >= 3 ? (meaningful[meaningful.length - 1] ?? '') : ''
        // 证据格：表头点名了这一列就用它（这样 `证据` 与 `状态` 不再被混成一格）；
        // 表头没点名才退回旧口径。
        const evidence = colEvidence >= 0 ? at(colEvidence) : legacyEvidence
        const raw = `${lines[(table.lineNumbers[idx] ?? 1) - 1] ?? ''}`
        const pendingMarked = PENDING_RE.test(evidence) || PENDING_RE.test(status) || PENDING_RE.test(raw)
        // 行级否决（2026-11-12）：状态格显式写了「待验收 / 未通过 / 有意未验」⇒ 这行未验，
        // **不管证据格里有几个 ✔**。理由：proven 是「evidence ∨ status」的或，只把否决塞进
        // statusProven 是无效的——证据格的 ✔ 会立刻把它拉回真（实测：只改 statusProven 时
        // 11 行里仅 1 行翻转）。否决必须作用在「或」的外面。
        const statusSaysPending = STATUS_PENDING_RE.test(status)
        // 已验判定 = 旧口径的**超集**（只增不减）：
        //   `PASS_RE(legacyEvidence)` 保住旧行为（多份文档把通过标记写在第 3/4 格，取哪格不该由我改）；
        //   `statusProven(status)` 认状态列写的「已验证」。
        const proven = !statusSaysPending
          && (PASS_RE.test(evidence) || statusProven(status) || PASS_RE.test(legacyEvidence))
        rows.push({
          id: meaningful[0] ?? '',
          proposition,
          evidence,
          status,
          pendingMarked,
          proven,
          // 只报不拦：格首出现词表外近义词 ⇒ 人读「已证」而机器读「未验」（D7 的依据）。
          // 注意这条只对**证据格**成立——状态列里的「已验证」是结论，不是误读。
          nearMiss: !proven && !pendingMarked && NEAR_MISS_RE.test(evidence),
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
      nearMiss: rows.filter((r) => r.nearMiss).length,
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
    // 元信息分隔符：`：`（引用行 / 正文）、`|`（表格单元格），或**没有**（`状态 draft`）。
    const SEP = '[：:|]'
    const plain = scope.split('\n').map(cleanInline).join('\n')
    // 元信息不一定在 headerText 里（2026-11-03 实测四种写法）：① H1 后引用行带冒号（模板）
    // ② 引用行**不带**冒号（`> 元信息：版本 v0.1 · 状态 draft · …`）③ H1 后表格
    // ④ `## 1 · 元信息` 节里的表格。③ 已由分隔符含 `|` 覆盖；②④ 需要两步：
    //   ② 分隔符设为**可选**；④ 窄范围读不出就退回**前 40 行**（元信息总在开头，
    //     且只在窄范围失败时才用 ⇒ 正文里的「状态」不会抢先命中）。
    // 为什么必须修：`status` 解析不出的文档，`semantic_check` 的 D2「声明高于证据」
    // **对它完全失明**——不是报错，是这一整类检查静默不适用。
    const plainWide = text.split('\n').slice(0, 40).map(cleanInline).join('\n')
    const pick = (re: RegExp): string | null => re.exec(plain)?.[1] ?? re.exec(plainWide)?.[1] ?? null
    const version = pick(new RegExp(`版本\\s*${SEP}?\\s*(v?\\d+(?:\\.\\d+)*)`, 'i'))
    const date = pick(/(20\d{2}-\d{2}-\d{2})/)
    // `状态` 必须是**元信息上下文里的**那一个：前置字符限定为行首 / 空白 / `|` / `·` / `>` / `：`。
    // 不加这条边界会误吃正文——2026-11-03 实测：`安全交战闭环（一次交战的唯一状态持有者与唯一执行入口）`
    // 被解析成 status = `持有者与唯一执行入口）`，而真正的 status 在另一行 ⇒ D2 判的是错的东西。
    const status = pick(/(?:^|[\s|·>：])状态\s*[：:|]?\s*([^·|\n]+)/)?.trim() ?? null
    const implHints = [...plain.matchAll(/实现落点[^\n]*/g)].map((m) => cleanInline(m[0])).slice(0, 3)
    return { version, date, status, implHints }
  })()

  // 抑制期限（2026-10-21 · t-7216205f）：`待复核至 2026-11-01` ⇒ 过期后 D3 **自动恢复报警**；
  // 旧写法 `待复核：…`（无日期）⇒ null，仍抑制（向后兼容），其「无期限」状态由 semantic_check 的 notes 明示。
  const needReviewUntil = /待复核\s*(?:至|截止)\s*[：:]?\s*(\d{4}-\d{2}-\d{2})/.exec(text)?.[1] ?? null

  return {
    headings,
    sections: finalSections,
    missingSections: missing.map((s) => s.key),
    missingSectionNames: missing.map((s) => s.name),
    presentSections: finalSections.filter((s) => s.present).map((s) => s.key),
    hasMeta,
    hasRevisionLog: finalSections.some((s) => s.key === 'revision-log' && s.present),
    needReview: /待复核/.test(text),
    needReviewUntil,
    acceptance,
    openQuestions: items.length,
    openQuestionItems: items.slice(0, 50),
    meta,
  }
}
