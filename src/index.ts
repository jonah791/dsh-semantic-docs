/**
 * dsh-semantic-docs · Cordis 插件（工具面）
 *
 * 四个工具（契约：docs/semantics/README.md §8）：
 *   semantic_list      列出条目 + 现算状态（可按 status/owner 过滤）
 *   semantic_get       单条详情 + 文档大纲 + 验收统计
 *   semantic_check     D1–D6 drift 检查 + 建议动作（**只报不改**）
 *   semantic_register  upsert 注册表 + 重新生成 INDEX.md（幂等）
 *
 * 纪律：
 *   - 只报不改：semantic_check 绝不改文件；处置归主体（主人/爱丽丝）
 *   - 不吞异常：注册表缺失/坏 JSON/条目 schema 不合法 → 显式错误（带路径），绝不静默返回空清单
 *   - 出参为纯 JSON（toJson 往返）：dsh-tools 会对返回值做 output.schema 校验与 deepFreeze
 *   - 能力边界（诚实声明）：本插件只读写 workspace 内的文档与注册表，不是沙箱、不做授权
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  absOf,
  applyRegistration,
  createNodeFs,
  factsAlignedWith,
  loadRegistryState,
  INDEX_REL,
  REGISTRY_REL,
  SCAN_ROOTS,
} from './collect.ts'
import { detectDrift, DRIFT_HINTS, STATUSES } from './registry.ts'
import type { DriftIssue, EntryPatch, SemanticStatus } from './registry.ts'

export const name = 'semantic-docs'
export const inject = ['tools'] as const

export interface Config {
  /** 插件开关 */
  enabled: boolean
  /** 工作区根（docs/semantics/registry.json 所在）；缺省 process.cwd() */
  workspace?: string
}

export const Config = z.object({
  enabled: z.boolean().default(true),
  workspace: z.string().required(false),
})

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** 出参统一走一次 JSON 往返：保证是纯 JSON（无 undefined / 无类实例），并满足 output.schema 的 JsonValue 约束 */
function toJson<T>(value: T): any {
  return JSON.parse(JSON.stringify(value ?? null)) as any
}

/** 参数归一：接受字符串数组 / JSON 字符串 / 逗号分隔串（DSH 参数面写法不一，宽容入参、严格出参） */
function toStrArray(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string').map((v) => v.trim()).filter((v) => v.length > 0)
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.length === 0) return []
    if (trimmed.startsWith('[')) {
      try {
        return toStrArray(JSON.parse(trimmed))
      } catch {
        return [trimmed]
      }
    }
    return trimmed.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
  }
  return undefined
}

interface ListRow {
  id: string
  title: string
  status: string
  computed: string
  canPromote: boolean
  doc: string
  docExists: boolean
  acceptance: string
  openQuestions: number | null
  owners: string[]
  drift: string[]
}

interface IssueCounts {
  error: number
  warn: number
  byCode: Record<string, number>
}

function countIssues(issues: readonly DriftIssue[]): IssueCounts {
  const byCode: Record<string, number> = {}
  let error = 0
  let warn = 0
  for (const issue of issues) {
    byCode[issue.code] = (byCode[issue.code] ?? 0) + 1
    if (issue.severity === 'error') error += 1
    else warn += 1
  }
  return { error, warn, byCode }
}

export function apply(ctx: Context, config: Config): void {
  const logger = ctx.logger('dsh-semantic-docs')
  const fs = createNodeFs()
  const ws = (): string => config.workspace ?? process.cwd()
  const nowIso = (): string => new Date().toISOString()

  // ---------------------------------------------------------------------
  // semantic_list
  // ---------------------------------------------------------------------
  ctx.tools.register(defineTool({
    name: 'semantic_list',
    description:
      '列出语义文档注册表条目（可按 status/owner 过滤），并对每条**现算状态**（声明 ≠ 事实：按 impl 落点 + 文档解析出的验收 pending 重判）。' +
      '真源：<workspace>/docs/semantics/registry.json。注册表缺失/坏 JSON 会显式报错（不静默返回空清单）。',
    parameters: {
      status: { type: 'string', enum: [...STATUSES], description: '按**声明**状态过滤（draft/implemented/verified/deprecated）' },
      owner: { type: 'string', description: '按 owner（能力/仓库名）子串过滤' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          registryPath: { type: 'string' },
          count: { type: 'number' },
          entries: { type: 'json' },
          notes: { type: 'json' },
          schemaIssues: { type: 'json' },
          error: { type: 'string' },
        },
      },
      render: (_a: unknown, v: any) => {
        if (v.ok !== true) return [{ type: 'text', text: `语义文档注册表读取失败：${String(v.error ?? '')}` }]
        const rows: ListRow[] = v.entries ?? []
        if (rows.length === 0) {
          return [{ type: 'text', text: `注册表无匹配条目（${String(v.registryPath ?? '')}）。用 semantic_register 登记条目。` }]
        }
        const lines = rows.map((r) => {
          const promote = r.canPromote ? ' ⤴可晋升' : ''
          const drift = r.drift.length > 0 ? ` · ⚠${r.drift.join(',')}` : ''
          return `[${r.id}] ${r.title} · ${r.status}→${r.computed}${promote} · 验收 ${r.acceptance} · 未决 ${r.openQuestions ?? '—'} · ${r.doc}${drift}`
        })
        const notes = (v.notes ?? []) as string[]
        const tail = notes.length > 0 ? `\n\n注：\n- ${notes.join('\n- ')}` : ''
        return [{ type: 'text', text: `语义文档条目（${rows.length}）· ${String(v.registryPath ?? '')}\n${lines.join('\n')}${tail}` }]
      },
    },
    async execute(args) {
      const workspace = ws()
      try {
        const state = loadRegistryState(workspace, fs)
        const drift = detectDrift({
          entries: state.registry.entries,
          facts: factsAlignedWith(state),
          unregisteredDocs: state.unregisteredDocs,
          nowMs: Date.now(),
        })
        const codesById = new Map<string, string[]>()
        for (const issue of drift) {
          if (issue.id === undefined) continue
          const arr = codesById.get(issue.id) ?? []
          if (!arr.includes(issue.code)) arr.push(issue.code)
          codesById.set(issue.id, arr)
        }
        const owner = args.owner
        const rows: ListRow[] = state.records
          .filter((r) => args.status === undefined || r.entry.status === args.status)
          .filter((r) => owner === undefined || (r.entry.owners ?? []).some((o) => o.includes(owner)))
          .map((r) => {
            const a = r.facts?.doc?.acceptance ?? null
            return {
              id: r.entry.id,
              title: r.entry.title,
              status: r.entry.status,
              computed: r.status?.computed ?? r.entry.status,
              canPromote: r.status?.canPromote ?? false,
              doc: r.entry.doc,
              docExists: r.facts?.docExists ?? false,
              acceptance: a === null ? '—' : `${a.proven}/${a.pending}/${a.total}`,
              openQuestions: r.facts?.doc?.openQuestions ?? r.entry.openQuestions ?? null,
              owners: r.entry.owners ?? [],
              drift: codesById.get(r.entry.id) ?? [],
            }
          })

        const notes: string[] = []
        if (state.unregisteredDocs.length > 0) notes.push(`D5 待登记：磁盘存在未注册语义文档 ${state.unregisteredDocs.join('、')}`)
        if (state.skipped.length > 0) {
          notes.push(
            `跳过 ${state.skipped.length} 条 schema 不合法条目：${state.skipped.map((s) => `entries[${s.index}]${s.id === null ? '' : `(${s.id})`}`).join('、')}——见 schemaIssues`,
          )
        }
        notes.push(`D5 扫描根：${SCAN_ROOTS.join(' | ')}（排除 docs/semantics/** 系统自身目录）`)

        return {
          ok: true,
          registryPath: state.registryPath,
          count: rows.length,
          entries: toJson(rows),
          notes: toJson(notes),
          schemaIssues: toJson(state.schemaIssues),
          error: '',
        }
      } catch (err) {
        return {
          ok: false,
          registryPath: absOf(workspace, REGISTRY_REL),
          count: 0,
          entries: toJson([]),
          notes: toJson([]),
          schemaIssues: toJson([]),
          error: errText(err),
        }
      }
    },
  }))

  // ---------------------------------------------------------------------
  // semantic_get
  // ---------------------------------------------------------------------
  ctx.tools.register(defineTool({
    name: 'semantic_get',
    description:
      '取单条语义文档条目详情：声明状态 + 现算状态（含判据理由）、文档大纲（标题树）、可证伪验收统计（总数/已证/待验）、未决问题数、impl/twins 落点存在性。',
    parameters: {
      id: { type: 'string', required: true, description: '条目 id（小写 kebab，如 web-lifecycle）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          id: { type: 'string' },
          entry: { type: 'json' },
          status: { type: 'json' },
          outline: { type: 'json' },
          acceptance: { type: 'json' },
          openQuestions: { type: 'number' },
          openQuestionItems: { type: 'json' },
          docPath: { type: 'string' },
          docExists: { type: 'boolean' },
          problems: { type: 'json' },
          error: { type: 'string' },
        },
      },
      render: (_a: unknown, v: any) => {
        if (v.ok !== true) return [{ type: 'text', text: `取条目失败：${String(v.error ?? '')}` }]
        const e = v.entry ?? {}
        const st = v.status ?? {}
        const a = v.acceptance ?? {}
        const outline = (v.outline ?? []) as { level: number; title: string }[]
        const questions = (v.openQuestionItems ?? []) as { label: string; text: string }[]
        const problems = (v.problems ?? []) as { code: string; message: string }[]
        const head = [
          `[${String(v.id)}] ${String(e.title ?? '')}`,
          `  声明状态：${String(e.status ?? '?')} ｜ 现算状态：${String(st.computed ?? '?')}${st.canPromote ? '（⤴可晋升）' : ''}`,
          `  判据：${String(st.reason ?? '—')}`,
          `  文档：${String(v.docPath ?? '')}${v.docExists === true ? '' : '（缺失）'}`,
          `  验收：已证 ${String(a.proven ?? '—')} / 待验 ${String(a.pending ?? '—')} / 总 ${String(a.total ?? '—')}` +
            `（其中显式标「待线上验收」${String(a.pendingMarked ?? 0)} 条）`,
          `  未决问题：${String(v.openQuestions ?? 0)}`,
          `  owners：${((e.owners ?? []) as string[]).join(', ') || '—'} ｜ impl：${((e.impl ?? []) as string[]).length} 个落点`,
        ]
        if (questions.length > 0) head.push(`  未决问题清单：${questions.map((q) => `${q.label} ${q.text}`).join(' ｜ ')}`)
        if (outline.length > 0) {
          head.push(
            `  文档大纲：\n${outline.map((h) => `    ${'  '.repeat(Math.max(0, h.level - 1))}${h.title}`).join('\n')}`,
          )
        }
        if (problems.length > 0) head.push(`  已知问题：${problems.map((p) => `${p.code} ${p.message}`).join(' ｜ ')}`)
        return [{ type: 'text', text: head.join('\n') }]
      },
    },
    async execute(args) {
      const workspace = ws()
      const id = args.id.trim()
      const empty = {
        ok: false,
        id,
        entry: toJson(null),
        status: toJson(null),
        outline: toJson([]),
        acceptance: toJson(null),
        openQuestions: 0,
        openQuestionItems: toJson([]),
        docPath: '',
        docExists: false,
        problems: toJson([]),
        error: '',
      }
      try {
        const state = loadRegistryState(workspace, fs)
        const record = state.records.find((r) => r.entry.id === id)
        if (record === undefined) {
          const known = state.records.map((r) => r.entry.id).join(', ')
          return { ...empty, error: `条目不存在：${id}（已知条目：${known.length > 0 ? known : '无'}）` }
        }
        const doc = record.facts?.doc ?? null
        const issues = detectDrift({ entries: [record.entry], facts: [record.facts], nowMs: Date.now() }).map((i) => ({
          code: i.code,
          severity: i.severity,
          message: i.message,
          hint: i.hint,
        }))

        return {
          ok: true,
          id: record.entry.id,
          entry: toJson(record.entry),
          status: toJson(record.status),
          outline: toJson((doc?.headings ?? []).slice(0, 80).map((h) => ({ level: h.level, title: h.title, line: h.line }))),
          acceptance: toJson(doc?.acceptance ?? null),
          openQuestions: doc?.openQuestions ?? record.entry.openQuestions ?? 0,
          openQuestionItems: toJson(doc?.openQuestionItems ?? []),
          docPath: absOf(workspace, record.entry.doc ?? ''),
          docExists: record.facts?.docExists ?? false,
          problems: toJson(issues),
          error: '',
        }
      } catch (err) {
        return { ...empty, error: errText(err) }
      }
    },
  }))

  // ---------------------------------------------------------------------
  // semantic_check（只报不改）
  // ---------------------------------------------------------------------
  ctx.tools.register(defineTool({
    name: 'semantic_check',
    description:
      '语义文档 drift 检查（D1 路径不存在 / D2 状态与证据不符 / D3 实现比文档新 / D4 必备结构缺节 / D5 存在未注册的 docs/semantic*.md / D6 缺「实践修订记录」小节）' +
      ' + 建议动作。**只报不改**：修复处置归主体。缺省检查全部条目，可传 id 只查一条。',
    parameters: {
      id: { type: 'string', description: '只检查该条目 id（缺省 = 全部条目）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          registryPath: { type: 'string' },
          scope: { type: 'string' },
          checked: { type: 'number' },
          issues: { type: 'json' },
          schemaIssues: { type: 'json' },
          notes: { type: 'json' },
          actions: { type: 'json' },
          summary: { type: 'string' },
          error: { type: 'string' },
        },
      },
      render: (_a: unknown, v: any) => {
        if (v.ok !== true) return [{ type: 'text', text: `drift 检查失败：${String(v.error ?? '')}` }]
        const issues = (v.issues ?? []) as DriftIssue[]
        const actions = (v.actions ?? []) as string[]
        const notes = (v.notes ?? []) as string[]
        const head = `语义文档 drift 检查（${String(v.scope ?? '全部')} · 检查 ${String(v.checked ?? 0)} 条）· ${String(v.registryPath ?? '')}\n${String(v.summary ?? '')}`
        if (issues.length === 0) {
          const tail = notes.length > 0 ? `\n\n注：\n- ${notes.join('\n- ')}` : ''
          return [{ type: 'text', text: `${head}\n未发现 drift（D1–D6 全过）。${tail}` }]
        }
        const lines = issues.map(
          (i) => `${i.severity === 'error' ? '✖' : '⚠'} ${i.code}${i.id === undefined ? '' : ` [${i.id}]`} ${i.message}`,
        )
        const tail = ['', '建议动作（只报不改，处置归主体）：', ...actions.map((a) => `- ${a}`)]
        if (notes.length > 0) tail.push('', '注：', ...notes.map((n) => `- ${n}`))
        return [{ type: 'text', text: `${head}\n${lines.join('\n')}\n${tail.join('\n')}` }]
      },
    },
    async execute(args) {
      const workspace = ws()
      const onlyId = typeof args.id === 'string' && args.id.trim().length > 0 ? args.id.trim() : undefined
      try {
        const state = loadRegistryState(workspace, fs)
        const facts = factsAlignedWith(state)
        const allIssues = detectDrift({
          entries: state.registry.entries,
          facts,
          unregisteredDocs: state.unregisteredDocs,
          nowMs: Date.now(),
        })
        const issues = onlyId === undefined ? allIssues : allIssues.filter((i) => i.id === onlyId)
        const counts = countIssues(issues)

        const notes: string[] = []
        if (onlyId !== undefined && !state.records.some((r) => r.entry.id === onlyId)) {
          notes.push(`指定 id 不在可用条目中：${onlyId}（可能不存在，或该条 schema 不合法被跳过）`)
        }
        if (state.skipped.length > 0) {
          notes.push(
            `跳过 ${state.skipped.length} 条 schema 不合法条目（不静默丢弃）：` +
              state.skipped.map((s) => `entries[${s.index}]${s.id === null ? '' : `(${s.id})`}：${s.reason}`).join('；'),
          )
        }
        const deprecated = state.records.filter((r) => r.entry.status === 'deprecated').map((r) => r.entry.id)
        if (deprecated.length > 0) notes.push(`deprecated 条目不参与 D2/D3/D4/D6 告警（README §5）：${deprecated.join('、')}`)
        const suppressed = state.records.filter((r) => r.facts?.doc?.needReview === true).map((r) => r.entry.id)
        if (suppressed.length > 0) notes.push(`D3 被文档「待复核」标记抑制：${suppressed.join('、')}`)
        for (const r of state.records) {
          const reg = r.entry.acceptance ?? null
          const parsed = r.facts?.doc?.acceptance ?? null
          if (reg === null || parsed === null) continue
          if ((reg.pending ?? null) !== parsed.pending) {
            notes.push(
              `注册表验收快照与文档解析不一致 [${r.entry.id}]：注册表 pending=${String(reg.pending ?? '—')}，文档 pending=${parsed.pending}（用 semantic_register 回填）`,
            )
          }
        }
        if (state.unregisteredDocs.length > 0) notes.push(`D5 未注册文档：${state.unregisteredDocs.join('、')}`)
        notes.push(
          `D5 扫描根：${SCAN_ROOTS.map((r) => `${workspace.replace(/\\/g, '/')}/${r}`).join(' | ')}（排除 docs/semantics/**）`,
        )

        const actions: string[] = []
        for (const code of ['D1', 'D2', 'D3', 'D4', 'D5', 'D6'] as const) {
          const hits = counts.byCode[code] ?? 0
          if (hits > 0) actions.push(`${code}（${hits} 处）：${DRIFT_HINTS[code]}`)
        }

        const summary =
          `error ${counts.error} · warn ${counts.warn} · ` +
          ['D1', 'D2', 'D3', 'D4', 'D5', 'D6'].map((c) => `${c}×${counts.byCode[c] ?? 0}`).join(' · ')

        return {
          ok: true,
          registryPath: state.registryPath,
          scope: onlyId ?? '全部条目',
          checked: onlyId === undefined ? state.records.length : state.records.filter((r) => r.entry.id === onlyId).length,
          issues: toJson(issues),
          schemaIssues: toJson(state.schemaIssues),
          notes: toJson(notes),
          actions: toJson(actions),
          summary,
          error: '',
        }
      } catch (err) {
        return {
          ok: false,
          registryPath: absOf(workspace, REGISTRY_REL),
          scope: onlyId ?? '全部条目',
          checked: 0,
          issues: toJson([]),
          schemaIssues: toJson([]),
          notes: toJson([]),
          actions: toJson([]),
          summary: '',
          error: errText(err),
        }
      }
    },
  }))

  // ---------------------------------------------------------------------
  // semantic_register（写注册表 + 重生成 INDEX.md）
  // ---------------------------------------------------------------------
  ctx.tools.register(defineTool({
    name: 'semantic_register',
    description:
      '登记/更新一条语义文档条目（幂等 upsert，同 id 不会重复）并重新生成 docs/semantics/INDEX.md。' +
      '不写文档正文（I2：文档随代码，注册表只存引用）；若 doc 存在，acceptance/openQuestions 由文档解析自动回填（README §6）。' +
      '注册表存在但坏 JSON → 报错拒绝覆盖（不静默重建）。',
    parameters: {
      id: { type: 'string', required: true, description: '条目 id（小写 kebab，全局唯一，如 web-lifecycle）' },
      title: { type: 'string', description: '人类可读标题' },
      doc: { type: 'string', description: '主副本路径（相对 workspace 的 POSIX 路径，如 self-plugins/x/docs/semantic.md）' },
      status: { type: 'string', enum: [...STATUSES], description: '声明状态（会被 semantic_check 按证据重判）' },
      owners: { type: 'array', description: '涉及的能力/仓库名数组（也接受逗号分隔字符串）' },
      impl: { type: 'array', description: '实现落点路径数组（也接受逗号分隔字符串）' },
      twins: { type: 'array', description: '同语义副本路径数组（I1）' },
      docVersion: { type: 'string', description: '文档版本（如 v0.1）' },
      lastReviewedAt: { type: 'string', description: '最近复核日期（YYYY-MM-DD）' },
      notes: { type: 'string', description: '备注（人读）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          action: { type: 'string' },
          id: { type: 'string' },
          entryCount: { type: 'number' },
          registryPath: { type: 'string' },
          indexMdPath: { type: 'string' },
          acceptanceApplied: { type: 'boolean' },
          entry: { type: 'json' },
          error: { type: 'string' },
        },
      },
      render: (_a: unknown, v: any) => {
        if (v.ok !== true) return [{ type: 'text', text: `登记失败：${String(v.error ?? '')}` }]
        const e = v.entry ?? {}
        const acc =
          v.acceptanceApplied === true
            ? '（acceptance/openQuestions 已从文档解析回填）'
            : '（未找到文档，acceptance 保持手写占位）'
        return [
          {
            type: 'text',
            text:
              `已${v.action === 'created' ? '新建' : '更新'}条目 [${String(v.id)}] · ${String(e.title ?? '')} · 状态 ${String(e.status ?? '')} ${acc}\n` +
              `注册表：${String(v.registryPath ?? '')}（共 ${String(v.entryCount ?? 0)} 条）\n索引：${String(v.indexMdPath ?? '')}`,
          },
        ]
      },
    },
    async execute(args) {
      const workspace = ws()
      const id = args.id.trim()
      const empty = {
        ok: false,
        action: '',
        id,
        entryCount: 0,
        registryPath: absOf(workspace, REGISTRY_REL),
        indexMdPath: absOf(workspace, INDEX_REL),
        acceptanceApplied: false,
        entry: toJson(null),
        error: '',
      }
      if (id.length === 0) return { ...empty, error: 'id 必填' }
      if (args.status !== undefined && !(STATUSES as readonly string[]).includes(args.status)) {
        return { ...empty, error: `status 非法：${args.status}（可选 ${STATUSES.join('|')}）` }
      }

      const patch: EntryPatch = { id }
      if (args.title !== undefined) patch.title = args.title
      if (args.doc !== undefined) patch.doc = args.doc
      if (args.status !== undefined) patch.status = args.status as SemanticStatus
      if (args.docVersion !== undefined) patch.docVersion = args.docVersion
      if (args.lastReviewedAt !== undefined) patch.lastReviewedAt = args.lastReviewedAt
      if (args.notes !== undefined) patch.notes = args.notes
      const owners = toStrArray(args.owners)
      if (owners !== undefined) patch.owners = owners
      const impl = toStrArray(args.impl)
      if (impl !== undefined) patch.impl = impl
      const twins = toStrArray(args.twins)
      if (twins !== undefined) patch.twins = twins

      try {
        const outcome = applyRegistration(workspace, fs, patch, nowIso())
        return {
          ok: true,
          action: outcome.action,
          id: outcome.entry.id,
          entryCount: outcome.entryCount,
          registryPath: outcome.registryPath,
          indexMdPath: outcome.indexPath,
          acceptanceApplied: outcome.acceptanceApplied,
          entry: toJson(outcome.entry),
          error: '',
        }
      } catch (err) {
        return { ...empty, error: errText(err) }
      }
    },
  }))

  logger.info(`ready (workspace=${ws()}, registry=${REGISTRY_REL}, index=${INDEX_REL})`)
}
