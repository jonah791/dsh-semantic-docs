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

export const DRIFT_CODES = ['D1', 'D2', 'D3', 'D4', 'D5', 'D6'] as const
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
  /** impl + twins 中最新的 mtime（D3 用） */
  implLatestMtimeMs: number | null
  doc: DocParse | null
}

export interface DriftIssue {
  code: DriftCode
  severity: DriftSeverity
  id?: string
  message: string
  hint: string
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
    if (
      docUsable &&
      facts.docMtimeMs !== null &&
      facts.implLatestMtimeMs !== null &&
      facts.implLatestMtimeMs > facts.docMtimeMs
    ) {
      const suppressed = facts.doc !== null && facts.doc.needReview
      if (!suppressed) {
        const lagHours = Math.max(0, (nowMs - facts.docMtimeMs) / 3_600_000)
        push(
          'D3',
          'warn',
          `实现比文档新：impl 最新 mtime ${fmtTime(facts.implLatestMtimeMs)} > doc mtime ${fmtTime(facts.docMtimeMs)}（文档已 ${lagHours.toFixed(1)} 小时未动，且未标「待复核」）`,
          DRIFT_HINTS.D3,
        )
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
