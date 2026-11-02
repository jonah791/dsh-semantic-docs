/**
 * dsh-semantic-docs · 注册表模型与判定层（纯逻辑）
 *
 * 契约来源：`docs/semantics/README.md`
 *   §5 状态模型与晋升判据（draft / implemented / verified / deprecated）
 *   §6 注册表 schema（entries / doc / impl / twins / acceptance / openQuestions …）
 *   §8 drift 判据 D1–D6
 *
 * 纯逻辑纪律：本文件不做任何 IO（读文件/看时钟/取 cwd 一律由调用方注入）；
 *   「文件是否存在」「mtime 是多少」「文档解析结果」都以 EntryFacts 的形式传入。
 * 判定方向纪律（AGENTS.md 进化规则 §1 语义精确性）：
 *   D2 只在**声明高于证据**时报警（over-claim）；
 *   「证据已够、声明却更低」（可晋升）只作为 canPromote 提示返回，不算 drift——
 *   因为「draft 但 impl 文件已存在」完全可能是「实现进行中」，那是合法状态。
 */

import type { DocParse } from './markdown.ts'

export const STATUSES = ['draft', 'implemented', 'verified', 'deprecated'] as const
export type SemanticStatus = (typeof STATUSES)[number]

export const DRIFT_CODES = ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7'] as const
export type DriftCode = (typeof DRIFT_CODES)[number]
export type DriftSeverity = 'error' | 'warn'

/** 验收统计（注册表存的是快照；真值由文档解析回填，见 README §6） */
export interface Acceptance {
  total?: number | null
  proven?: number | null
  pending?: number | null
  note?: string
}

export interface RegistryEntry {
  /** 小写 kebab，全局唯一 */
  id: string
  title: string
  /** 主副本路径（相对 workspace 的 POSIX 风格） */
  doc: string
  docVersion?: string
  status: SemanticStatus
  /** 涉及的能力/仓库 */
  owners?: string[]
  /** 同语义副本路径（I1） */
  twins?: string[]
  /** 实现落点路径 */
  impl?: string[]
  acceptance?: Acceptance | null
  openQuestions?: number | null
  lastReviewedAt?: string
  notes?: string
}

export interface Registry {
  version: number
  updatedAt: string
  workspace?: string
  entries: RegistryEntry[]
}

export class RegistryParseError extends Error {
  readonly source: string
  constructor(detail: string, source: string) {
    super(`${detail} —— ${source}`)
    this.name = 'RegistryParseError'
    this.source = source
  }
}

export interface ParsedRegistry {
  registry: Registry
  /** 原始 JSON 值（供 schema 校验逐字段检查；不丢任何条目） */
  raw: unknown
}

/**
 * 解析注册表 JSON。
 * 坏 JSON / 空文件 / 顶层形状非法 → 抛 RegistryParseError（带路径），绝不静默返回空清单。
 */
export function parseRegistry(text: string, source: string): ParsedRegistry {
  if (text.trim().length === 0) throw new RegistryParseError('注册表为空文件', source)
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (err) {
    throw new RegistryParseError(`JSON 语法错误：${err instanceof Error ? err.message : String(err)}`, source)
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new RegistryParseError('顶层必须是对象 { version, updatedAt, entries }', source)
  }
  const obj = raw as Record<string, unknown>
  if (!Array.isArray(obj.entries)) throw new RegistryParseError('缺少 entries 数组', source)
  return {
    raw,
    registry: {
      version: typeof obj.version === 'number' ? obj.version : 1,
      updatedAt: typeof obj.updatedAt === 'string' ? obj.updatedAt : '',
      ...(typeof obj.workspace === 'string' ? { workspace: obj.workspace } : {}),
      entries: obj.entries as RegistryEntry[],
    },
  }
}

export function isValidEntryId(id: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)
}

export function normalizeRelPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '')
}

/** 注册表 schema 违规（结构问题，非 drift） */
export interface SchemaIssue {
  code: 'schema'
  /** entries 下标；-1 = 顶层问题 */
  index: number
  id: string | null
  field: string
  message: string
  hint: string
}

/** 逐字段校验注册表（不丢条目：非法条目也留在 issues 里） */
export function validateRegistry(raw: unknown, source: string): SchemaIssue[] {
  const issues: SchemaIssue[] = []
  const push = (index: number, id: string | null, field: string, message: string, hint: string): void => {
    issues.push({ code: 'schema', index, id, field, message, hint })
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    push(-1, null, 'root', `注册表顶层不是对象（${source}）`, '修 registry.json 顶层为 { version, updatedAt, entries }')
    return issues
  }
  const obj = raw as Record<string, unknown>
  if (!Array.isArray(obj.entries)) {
    push(-1, null, 'root', '缺少 entries 数组', '补 entries（其元素为条目对象）')
    return issues
  }
  const seen = new Map<string, number>()
  obj.entries.forEach((item, index) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      push(index, null, 'entry', `entries[${index}] 不是对象`, '删掉该元素或改成条目对象')
      return
    }
    const e = item as Record<string, unknown>
    const id = typeof e.id === 'string' && e.id.trim().length > 0 ? e.id : null
    if (id === null) push(index, null, 'id', `entries[${index}] 缺 id`, '补 id（小写 kebab，全局唯一）')
    else {
      if (!isValidEntryId(id)) push(index, id, 'id', `entries[${index}] id 非法：${id}`, 'id 必须是小写 kebab（[a-z0-9-]）')
      const prev = seen.get(id)
      if (prev !== undefined) push(index, id, 'duplicate-id', `id 重复：${id}（首次出现在 entries[${prev}]）`, '删掉重复条目或改 id')
      else seen.set(id, index)
    }
    if (typeof e.doc !== 'string' || e.doc.trim().length === 0) {
      push(index, id, 'doc', `entries[${index}] 缺 doc（主副本路径）`, '补 doc（相对 workspace 的 POSIX 路径）')
    }
    if (typeof e.status !== 'string' || !(STATUSES as readonly string[]).includes(e.status)) {
      push(index, id, 'status', `entries[${index}] status 非法/缺失：${String(e.status)}`, 'status ∈ draft|implemented|verified|deprecated')
    }
    if (typeof e.title !== 'string' || e.title.trim().length === 0) {
      push(index, id, 'title', `entries[${index}] 缺 title`, '补 title（人类可读名）')
    }
    for (const field of ['owners', 'twins', 'impl'] as const) {
      const v = e[field]
      if (v !== undefined && v !== null && !Array.isArray(v)) {
        push(index, id, field, `entries[${index}].${field} 不是数组`, `${field} 必须是字符串数组`)
      }
    }
  })
  return issues
}

/** 阻断性字段：命中即该条目不可用于 D1–D6 判定（但**不静默丢弃**，进 skipped 上报） */
const BLOCKING_FIELDS = new Set(['entry', 'id', 'doc', 'status', 'duplicate-id'])

export interface PartitionedEntries {
  usable: RegistryEntry[]
  usableIndices: number[]
  skipped: { index: number; id: string | null; reason: string }[]
}

export function partitionEntries(registry: Registry, issues: readonly SchemaIssue[]): PartitionedEntries {
  const blocked = new Map<number, Set<string>>()
  for (const it of issues) {
    if (it.index < 0 || !BLOCKING_FIELDS.has(it.field)) continue
    const set = blocked.get(it.index) ?? new Set<string>()
    set.add(it.field)
    blocked.set(it.index, set)
  }
  const usable: RegistryEntry[] = []
  const usableIndices: number[] = []
  const skipped: { index: number; id: string | null; reason: string }[] = []
  registry.entries.forEach((entry, index) => {
    const bad = blocked.get(index)
    if (bad !== undefined && bad.size > 0) {
      const rawId = (entry as { id?: unknown } | null | undefined)?.id
      skipped.push({
        index,
        id: typeof rawId === 'string' ? rawId : null,
        reason: `注册表条目 schema 不合法（字段：${[...bad].join(', ')}）——该条不参与 D1–D6`,
      })
      return
    }
    usable.push(entry)
    usableIndices.push(index)
  })
  return { usable, usableIndices, skipped }
}

export interface StatusEvaluation {
  declared: SemanticStatus
  /** 机器按 README §5 判据重算的状态（证据支持到的最高状态） */
  computed: SemanticStatus
  reason: string
  /** 声明高于证据（D2 报警条件） */
  overClaim: boolean
  /** 证据已够、声明更低（提示，不算 drift） */
  canPromote: boolean
}

/**
 * 状态重判（README §5：晋升不由声明决定）。
 * @param acceptance 文档解析出的验收统计（null = 不可得，跳过重判）
 * @param hasImpl impl 落点是否非空
 */
export function evaluateStatus(
  entry: RegistryEntry,
  acceptance: { total: number; pending: number } | null,
  hasImpl: boolean,
): StatusEvaluation {
  const declared = entry.status
  if (declared === 'deprecated') {
    return { declared, computed: 'deprecated', reason: 'deprecated：保留留痕，不参与 drift 告警', overClaim: false, canPromote: false }
  }
  let computed: SemanticStatus
  let reason: string
  if (!hasImpl) {
    computed = 'draft'
    reason = 'impl 落点为空（README §5：draft = 文档存在、实现可为空/未完成）'
  } else if (acceptance === null) {
    computed = declared === 'verified' ? 'implemented' : 'implemented'
    reason = '文档验收统计不可得（文档缺失或不可解析），保守判为 implemented'
  } else if (acceptance.total > 0 && acceptance.pending === 0) {
    computed = 'verified'
    reason = `acceptance.pending=0 且 total=${acceptance.total}（README §5：verified 判据满足）`
  } else {
    computed = 'implemented'
    reason = acceptance.total === 0
      ? '无可证伪验收条目（acceptance.total=0）——不满足 verified 判据'
      : `acceptance.pending=${acceptance.pending}/${acceptance.total} > 0——不满足 verified 判据`
  }

  let overClaim = false
  if (declared === 'verified' && acceptance !== null && (acceptance.pending > 0 || acceptance.total === 0)) overClaim = true
  if (declared === 'implemented' && !hasImpl) overClaim = true

  const rank: Record<SemanticStatus, number> = { draft: 0, implemented: 1, verified: 2, deprecated: 3 }
  const canPromote = !overClaim && rank[computed] > rank[declared]
  return { declared, computed, reason, overClaim, canPromote }
}

export interface EntryFacts {
  docExists: boolean
  docMtimeMs: number | null
  /** 文档存在但读/解析失败时的错误串（不吞异常） */
  docReadError: string | null
  implMissing: string[]
  twinsMissing: string[]
  /**
   * **impl 落点**中最新的 mtime。
   * ⚠ twins **不参与**：它们是"同语义副本"（文档），不是实现。
   * 混算会让「编辑一份文档」点亮另一条语义的 D3（2026-09-22 实测：修 web-lifecycle 点亮了 wake-delivery）。
   * ⚠ 2026-09-22 二次修正（t-c54b41c6 成因 B）：mtime **降级为兜底与展示**——真源是下面的**提交**。
   * 工作区未提交改动 / 行尾归一都会推新 mtime 而语义没变（实测受害 8 条）。
   */
  implLatestMtimeMs: number | null
  /** 上述最新 mtime 对应的 impl 相对路径——D3 消息里给出来，便于直接归因（只报一个 mtime 值等于把归因推给人）。 */
  implLatestPath: string | null
  /** 文档最后一次**提交**的时刻（与 impl 提交比较出 D3）；git 不可用 ⇒ null。 */
  docCommitMs?: number | null
  /** impl 落点中**最新提交**的时刻；null = 无一纳入版本控制或 git 不可用。 */
  implLatestCommitMs?: number | null
  /** 上述提交的短 sha 与标题——D3 消息里给出，让「哪个提交触发的」一眼可见。 */
  implLatestCommitSha?: string | null
  implLatestCommitSubject?: string | null
  /** 该提交触及的仓库相对路径全集（成因 A 归因用：见 D3 的「共享装配点」判定）。 */
  implLatestCommitFiles?: string[]
  /** impl 文件是否存在**未提交**的工作区改动（成因 B：不判 D3，改由调用方标注）。 */
  implDirty?: boolean
  /** twins（同语义副本）中最新的 mtime。**不参与 D3**，仅供排查展示。 */
  twinsLatestMtimeMs: number | null
  doc: DocParse | null
}

export interface DriftIssue {  code: DriftCode
  severity: DriftSeverity
  id?: string
  message: string
  hint: string
}

/**
 * 成因 A 的判定（**唯一真源**：D3 的抑制与 `semantic_check` 的 notes 都调它，不各写一遍）。
 *
 * 形状：impl 的最新提交**晚于**文档的最近提交（看起来是 drift），但该提交**同时更新了别的条目文档**
 * ⇒ 这个文件很可能是**共享装配点**（`src/index.ts` 这类被多条语义登记的文件），改动多半不属于本条。
 * ⇒ D3 **抑制**（夹具 1：同一文件两条语义，只报真变的那条），但**必须在 notes 里披露**
 *   （§5.17：跳过不等于健康——抑制若无声，就退化成另一种静默失效）。
 */
export function suppressedBySharedAssembly(facts: EntryFacts, docRel: string): boolean {
  if (facts.implLatestCommitMs == null || facts.docCommitMs == null) return false
  if (facts.implLatestCommitMs <= facts.docCommitMs) return false
  const files = facts.implLatestCommitFiles ?? []
  return files.some((f) => /(^|\/)docs\/semantic.*\.md$/i.test(f) && f !== docRel)
}

export interface DriftInput {
  entries: readonly RegistryEntry[]
  /** 与 entries 同序；null = 该条不可判定（schema 不合法） */
  facts: readonly (EntryFacts | null)[]
  unregisteredDocs?: readonly string[]
  /** 注入时间（消息里给「距今多久」，便于人读） */
  nowMs?: number
}

export const DRIFT_HINTS: Record<DriftCode, string> = {
  D1: '修路径或补文件：文档缺失先写 docs/semantic.md（模板见 docs/semantics/templates/）；impl 落点不存在则补实现或改注册表',
  D2: '按 README §5 对齐声明与证据：先把验收证据补齐使 pending=0（或把状态降回 implemented/draft）——声明不得高于证据',
  D3: '做一次复核：补齐文档验收证据后更新 lastReviewedAt；若实现改动尚未回写文档，在文档里显式标「待复核」',
  D4: '按 README §4 补节（模板 docs/semantics/templates/semantic.md）；不适用的小节也要保留标题并写明原因',
  D5: '把该文档登记进 registry.json（semantic_register），或确认它不是语义文档',
  D6: '补「实践修订记录」小节（I3 载体）：即使没有实践也要保留节标题——D6 检查的是它存在',
  D7: '把最后一格改写成机器可读的形状：已证的写 `✔ 已实测`（✔ 必须在**最后一列**），未验的写「待线上验收」。「已证 / 已验证 / 已验收」这类近义词落在词表外 ⇒ 机器读作毫无证据（README §4.1）',
}

function fmtTime(ms: number | null): string {
  return ms === null ? '?' : new Date(ms).toISOString()
}

/**
 * D1–D6 drift 判定（纯逻辑）。
 * deprecated 条目只查 D1（README §5：「不再参与 drift 告警」）。
 */
export function detectDrift(input: DriftInput): DriftIssue[] {
  const issues: DriftIssue[] = []
  const nowMs = input.nowMs ?? Date.now()

  input.entries.forEach((entry, index) => {
    const facts = input.facts[index] ?? null
    if (facts === null) return
    const id = typeof entry?.id === 'string' ? entry.id : undefined
    const push = (code: DriftCode, severity: DriftSeverity, message: string, hint: string): void => {
      const issue: DriftIssue = { code, severity, message, hint }
      if (id !== undefined) issue.id = id
      issues.push(issue)
    }

    // ---- D1 路径不存在 ----
    if (!facts.docExists) push('D1', 'error', `doc 路径不存在：${String(entry.doc)}`, DRIFT_HINTS.D1)
    else if (facts.docReadError !== null) push('D1', 'error', `doc 读取/解析失败：${facts.docReadError}`, DRIFT_HINTS.D1)
    if (facts.implMissing.length > 0) push('D1', 'error', `impl 路径不存在：${facts.implMissing.join(', ')}`, DRIFT_HINTS.D1)
    if (facts.twinsMissing.length > 0) push('D1', 'error', `twins 路径不存在：${facts.twinsMissing.join(', ')}`, DRIFT_HINTS.D1)

    if (entry.status === 'deprecated') return

    const implList = entry.impl ?? []
    const docUsable = facts.docExists && facts.docReadError === null && facts.doc !== null

    // ---- D2 状态与证据不符 ----
    if (docUsable && facts.doc !== null) {
      const ev = evaluateStatus(
        entry,
        { total: facts.doc.acceptance.total, pending: facts.doc.acceptance.pending },
        implList.length > 0,
      )
      if (ev.overClaim) push('D2', 'error', `状态与证据不符：声明 ${ev.declared}，但${ev.reason}`, DRIFT_HINTS.D2)
    } else if (entry.status === 'implemented' && implList.length === 0) {
      push('D2', 'error', '状态与证据不符：声明 implemented，但 impl 落点为空（机器判定 = draft）', DRIFT_HINTS.D2)
    }

    // ---- D3 实现比文档新 ----
    // 判据域（2026-09-22 二次修正 · t-c54b41c6）：
    //  · 真源 = **已提交**的改动（成因 B：工作区未提交改动 / 行尾归一都会推新 mtime 而语义没变，
    //    实测受害 8 条：agent-browser / telegram-outbound / skill-forge + 5 条行尾归一）⇒ 不再报警；
    //  · 触发提交**同时更新了别的条目的文档** ⇒ 疑为**共享装配点**（成因 A：`src/index.ts` 这类装配文件
    //    天然被多条语义登记）⇒ 降级为 `info` 并把提交归因写进消息，而不是照样报 warn；
    //  · git 不可用 ⇒ **退回 mtime 判据**，并在消息里明说「未经版本控制核对」（不静默换判据）。
    const committedBasis = facts.implLatestCommitMs != null && facts.docCommitMs != null
    const fires = committedBasis
      ? facts.implLatestCommitMs! > facts.docCommitMs!
      : facts.implLatestMtimeMs !== null && facts.docMtimeMs !== null && facts.implLatestMtimeMs > facts.docMtimeMs
    if (docUsable && fires) {
      // 抑制带期限（2026-10-21 · t-7216205f）：`待复核至 YYYY-MM-DD` 过期后**自动恢复报警**
      // ——否则一个标记永久闭嘴，漂移越大越不会被报（抑制判据与最该被问到的对象反相关）。
      // 无日期的旧标记仍抑制（向后兼容）；其「无期限」状态由 semantic_check 的 notes 明示。
      const nrUntil = facts.doc?.needReviewUntil ?? null
      const nrExpired = nrUntil !== null && nowMs > Date.parse(`${nrUntil}T23:59:59`)
      const suppressed = facts.doc !== null && facts.doc.needReview && !nrExpired
      if (!suppressed) {
        const newerMs = committedBasis ? facts.implLatestCommitMs! : (facts.implLatestMtimeMs as number)
        const olderMs = committedBasis ? facts.docCommitMs! : (facts.docMtimeMs as number)
        const lagHours = Math.max(0, (nowMs - olderMs) / 3_600_000)
        const who = facts.implLatestPath === null ? '（最新文件未知）' : ` ${facts.implLatestPath}`
        const basis = committedBasis
          ? 'impl 最近提交'
          : 'impl 最新 mtime（**未经版本控制核对**：git 不可用或该文件未纳入版本控制）'
        const attr = facts.implLatestCommitSha
          ? ` · 触发提交 ${facts.implLatestCommitSha}「${facts.implLatestCommitSubject ?? ''}」`
          : ''
        // 成因 A：共享装配点 ⇒ **抑制本条 D3**（不报警），由 semantic_check 的 notes 披露同一判定结果。
        // ⚠ 不能 `return`——那会连本条后面的 D4/D6 检查一起跳过（一个缺陷换另一个）。
        if (!suppressedBySharedAssembly(facts, typeof entry.doc === 'string' ? entry.doc : '')) {
          push(
            'D3',
            'warn',
            `实现比文档新：${basis} ${fmtTime(newerMs)} > doc ${fmtTime(olderMs)}（文档已 ${lagHours.toFixed(1)} 小时未动，且未标「待复核」）· 触发文件：${who}${attr}`,
            DRIFT_HINTS.D3,
          )
        }
      }
    }

    // ---- D4 必备结构缺节 / D6 实践修订记录缺失 ----
    if (docUsable && facts.doc !== null) {
      if (facts.doc.missingSections.length > 0) {
        push(
          'D4',
          'error',
          `必备结构缺节（${facts.doc.missingSections.length}/10）：${facts.doc.missingSectionNames.join('、')}`,
          DRIFT_HINTS.D4,
        )
      }
      if (!facts.doc.hasRevisionLog) {
        push('D6', 'error', '注册表指向的文档不含「实践修订记录」小节（I3 载体缺失）', DRIFT_HINTS.D6)
      }
      // ---- D7 近义词误读（只报不拦）----
      // 「已证 / 已验证 / 已验收」这类**人读等于已证**的写法落在 `proven` 的词表外 ⇒ 机器读作「毫无证据」。
      // 2026-09-15 agent-cluster 18 条「已验证」⇒ 0/18/18；2026-10-09 agent-reconstruction 9 条「已证」⇒ 0/11。
      // ⚠ 严重度是 warn 且**不改任何状态判定**：它只说「你的写法机器读不到」，处置归主体（README §4.1）。
      if (facts.doc.acceptance.nearMiss > 0) {
        const rowLines = facts.doc.acceptance.rows.filter((r) => r.nearMiss).map((r) => r.line)
        push(
          'D7',
          'warn',
          `近义词误读风险 ${facts.doc.acceptance.nearMiss} 条（行 ${rowLines.slice(0, 6).join('、')}${rowLines.length > 6 ? ' …' : ''}）：最后一格用了词表外的写法——机器读作未验`,
          DRIFT_HINTS.D7,
        )
      }
    }
  })

  // ---- D5 磁盘有 docs/semantic*.md 未注册 ----
  for (const doc of input.unregisteredDocs ?? []) {
    issues.push({
      code: 'D5',
      severity: 'warn',
      message: `磁盘存在未注册的语义文档：${doc}`,
      hint: DRIFT_HINTS.D5,
    })
  }

  return issues
}

/** 从文档解析结果取验收统计（供状态重判与回填） */
export function acceptanceFromDoc(doc: DocParse | null): { total: number; proven: number; pending: number } | null {
  if (doc === null) return null
  return { total: doc.acceptance.total, proven: doc.acceptance.proven, pending: doc.acceptance.pending }
}

/** 注册表快照与文档解析对账的结果（null = 一致或不可比） */
export interface SnapshotMismatch {
  code: 'missing-snapshot' | 'mismatch'
  id: string
  message: string
}

function numOr(v: number | null | undefined): string {
  return typeof v === 'number' ? String(v) : '—'
}

/**
 * 注册表验收快照 ↔ 文档解析的对账（纯函数 · 2026-10-09 · t-cdb92e72）。
 *
 * 为什么要有它——「机器读不到 ⇒ 报没问题」的**第三次**同型：
 * 旧判据是 `if (reg === null || parsed === null) continue`，把「无法对账」与「已对齐」
 * 压成同一个输出；而 `reg === null` 恰恰是写侧缺陷（不带 doc 的注册把快照清成 null）的产物
 * ⇒ **缺陷把告警关掉了**，输出看起来反而更干净（2026-10-09 实测：10 条不一致「很干净地」消失）。
 * 第二个形状同根：旧判据只比 `pending` ⇒ `total` 变化的陈旧快照同样静默
 * （同日实测 9 条：panel-host 15→17、agent-self-rewrite 16→28 …）。
 *
 * @param reg   注册表里存的快照（null/undefined = 缺失）
 * @param parsed 文档解析出的统计；**null = 文档不可用**（缺失/读失败）——那属 D1 的域，此处不重复报
 */
export function compareAcceptanceSnapshot(
  id: string,
  reg: Acceptance | null | undefined,
  parsed: { total: number; proven: number; pending: number } | null,
): SnapshotMismatch | null {
  if (parsed === null) return null
  if (reg === null || reg === undefined) {
    return {
      code: 'missing-snapshot',
      id,
      message:
        `注册表验收快照**缺失** [${id}]：文档解析得 ${parsed.proven}/${parsed.pending}/${parsed.total}，` +
        '但注册表 acceptance=null ⇒ **无法对账**（这不是「已对齐」）。' +
        '用 semantic_register 回填（带 doc 或只给 id——会用条目原有的 doc）。',
    }
  }
  const diffs: string[] = []
  if ((reg.pending ?? null) !== parsed.pending) {
    diffs.push(`pending 注册表 ${numOr(reg.pending)} ≠ 文档 ${parsed.pending}`)
  }
  if ((reg.total ?? null) !== parsed.total) {
    diffs.push(`total 注册表 ${numOr(reg.total)} ≠ 文档 ${parsed.total}`)
  }
  if (diffs.length === 0) return null
  return { code: 'mismatch', id, message: `注册表验收快照与文档解析不一致 [${id}]：${diffs.join('；')}（用 semantic_register 回填）` }
}

// ---------------------------------------------------------------------------
// upsert + INDEX.md 生成（纯函数：进注册表，出注册表/文本）
// ---------------------------------------------------------------------------

export interface EntryPatch {
  id: string
  title?: string
  doc?: string
  docVersion?: string
  status?: SemanticStatus
  owners?: string[]
  twins?: string[]
  impl?: string[]
  acceptance?: Acceptance | null
  openQuestions?: number | null
  lastReviewedAt?: string
  notes?: string
}

export function emptyRegistry(workspace: string, updatedAt: string): Registry {
  return { version: 1, updatedAt, workspace, entries: [] }
}

export interface UpsertResult {
  registry: Registry
  action: 'created' | 'updated'
  entry: RegistryEntry
}

/**
 * 幂等 upsert：同 id 重复写入不会产生重复条目；
 * 只覆盖 patch 里**显式提供**的字段（未提供者保持原值/默认值）。
 */
export function upsertEntry(registry: Registry, patch: EntryPatch, updatedAt: string): UpsertResult {
  if (!isValidEntryId(patch.id)) {
    throw new Error(`id 非法：${patch.id}（必须是小写 kebab：[a-z0-9-]，如 web-lifecycle）`)
  }
  const entries = registry.entries.map((e) => ({ ...e }))
  const index = entries.findIndex((e) => e.id === patch.id)
  let action: 'created' | 'updated'
  let entry: RegistryEntry
  if (index < 0) {
    action = 'created'
    entry = {
      id: patch.id,
      title: patch.title ?? patch.id,
      doc: patch.doc ?? '',
      status: patch.status ?? 'draft',
      owners: patch.owners ?? [],
      twins: patch.twins ?? [],
      impl: patch.impl ?? [],
      acceptance: patch.acceptance ?? null,
      openQuestions: patch.openQuestions ?? null,
    }
    if (patch.docVersion !== undefined) entry.docVersion = patch.docVersion
    if (patch.lastReviewedAt !== undefined) entry.lastReviewedAt = patch.lastReviewedAt
    if (patch.notes !== undefined) entry.notes = patch.notes
    entries.push(entry)
  } else {
    action = 'updated'
    const current = entries[index] as RegistryEntry
    if (patch.title !== undefined) current.title = patch.title
    if (patch.doc !== undefined) current.doc = normalizeRelPath(patch.doc)
    if (patch.docVersion !== undefined) current.docVersion = patch.docVersion
    if (patch.status !== undefined) current.status = patch.status
    if (patch.owners !== undefined) current.owners = patch.owners
    if (patch.twins !== undefined) current.twins = patch.twins
    if (patch.impl !== undefined) current.impl = patch.impl
    if (patch.acceptance !== undefined) current.acceptance = patch.acceptance
    if (patch.openQuestions !== undefined) current.openQuestions = patch.openQuestions
    if (patch.lastReviewedAt !== undefined) current.lastReviewedAt = patch.lastReviewedAt
    if (patch.notes !== undefined) current.notes = patch.notes
    entry = current
  }
  return { registry: { ...registry, updatedAt, entries }, action, entry }
}

function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

function numOrDash(v: number | null | undefined): string {
  return typeof v === 'number' ? String(v) : '—'
}

/** 生成人类索引 INDEX.md（registry 的投影，可重放；真源永远是 registry.json） */
export function renderIndexMarkdown(registry: Registry, options: { generatedAt: string }): string {
  const lines: string[] = []
  lines.push('# 语义文档索引（INDEX.md）', '')
  lines.push('> **本文件由 `dsh-semantic-docs` 的 `semantic_register` 生成，请勿手改。**')
  lines.push('> 真源是 `registry.json`；本文件是可重放的投影，随时可重新生成。')
  lines.push(
    `> 生成时间：${options.generatedAt} · 条目数：${registry.entries.length}` +
      (registry.workspace !== undefined ? ` · workspace：${registry.workspace}` : ''),
    '',
  )
  lines.push('| id | 标题 | 状态 | 验收（已证/待验/总） | 未决问题 | 复核日期 | 文档 |')
  lines.push('|---|---|---|---|---|---|---|')
  for (const e of registry.entries) {
    const a = e.acceptance ?? null
    const acc = a === null ? '—' : `${numOrDash(a.proven)}/${numOrDash(a.pending)}/${numOrDash(a.total)}`
    lines.push(
      `| ${cell(String(e.id))} | ${cell(String(e.title ?? ''))} | ${cell(String(e.status ?? ''))} | ${acc} | ` +
        `${numOrDash(e.openQuestions)} | ${cell(String(e.lastReviewedAt ?? '—'))} | \`${cell(String(e.doc ?? ''))}\` |`,
    )
  }
  const dist = STATUSES.map((s) => `${s} ${registry.entries.filter((e) => e.status === s).length}`).join(' · ')
  lines.push('', `**状态分布**：${dist}`, '')
  lines.push('> drift 检查：`semantic_check`（D1–D6）；条目增改：`semantic_register`（幂等 upsert）。', '')
  return lines.join('\n')
}

/** 删除一个注册表条目后的结果（含**悬空引用**清单）。 */
export interface RemoveResult {
  registry: Registry
  removed: boolean
  /** 被删掉的条目（未删时为 null）。 */
  entry: RegistryEntry | null
  /**
   * 仍**指向被删条目文档路径**的其他条目 —— 删除前必须让人看见，
   * 否则会留下悬空引用（与 D1「路径不存在」同族，但方向相反）。
   */
  referencedBy: Array<{ id: string; field: 'doc' | 'twins' | 'impl' }>
}

/**
 * 从注册表移除一个条目（纯函数：只算，不写盘）。
 *
 * 语义边界：
 * - 未命中 ⇒ `removed: false` 且 registry 原样返回（**调用方必须据此报错，不得静默当成功**）；
 * - **只删注册表条目，不删文档正文**——正文属插件目录，归退役流程（`plugin_purge`）管；
 * - 删除是**不可逆**的（无回收站）：调用方应先跑 `referencedBy` 检查。
 */
export function removeEntry(registry: Registry, id: string, updatedAt: string): RemoveResult {
  const idx = registry.entries.findIndex((e) => e.id === id)
  if (idx < 0) return { registry, removed: false, entry: null, referencedBy: [] }
  const entry = registry.entries[idx] as RegistryEntry
  const entries = registry.entries.filter((_, i) => i !== idx).map((e) => ({ ...e }))
  const docPath = normalizeRelPath(String(entry.doc ?? ''))
  const referencedBy: Array<{ id: string; field: 'doc' | 'twins' | 'impl' }> = []
  if (docPath !== '') {
    for (const e of entries) {
      if (normalizeRelPath(String(e.doc ?? '')) === docPath) {
        referencedBy.push({ id: String(e.id), field: 'doc' })
        continue
      }
      if (Array.isArray(e.twins) && e.twins.some((t) => normalizeRelPath(String(t)) === docPath)) {
        referencedBy.push({ id: String(e.id), field: 'twins' })
        continue
      }
      if (Array.isArray(e.impl) && e.impl.some((t) => normalizeRelPath(String(t)) === docPath)) {
        referencedBy.push({ id: String(e.id), field: 'impl' })
      }
    }
  }
  return { registry: { ...registry, updatedAt, entries }, removed: true, entry, referencedBy }
}
