/**
 * dsh-semantic-docs · IO 适配层
 *
 * 把「文件系统」抽象成 FsLike 注入进来，于是：
 *   - 上层工具（index.ts）只做参数与呈现；
 *   - 本层承载真实读写，且**可在测试里换成真实 fs + 临时 workspace** 直接跑（无需挂载插件）。
 *
 * 不吞异常纪律：注册表缺失/为空/坏 JSON/不可解析 → 抛错并带**绝对路径**；
 *   注册表存在但坏掉时 applyRegistration **拒绝覆盖**（不许静默重建，否则等于销毁证据）。
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { parseSemanticDoc } from './markdown.ts'
import {
  emptyRegistry,
  evaluateStatus,
  parseRegistry,
  partitionEntries,
  renderIndexMarkdown,
  upsertEntry,
  validateRegistry,
} from './registry.ts'
import type {
  EntryFacts,
  EntryPatch,
  Registry,
  RegistryEntry,
  SchemaIssue,
  StatusEvaluation,
} from './registry.ts'

export const REGISTRY_REL = 'docs/semantics/registry.json'
export const INDEX_REL = 'docs/semantics/INDEX.md'
/** 系统自身目录（规范/模板/注册表/索引）——D5 扫描必须排除，它不是「能力的语义文档」 */
export const SYSTEM_DIR_PREFIX = 'docs/semantics/'

/** D5 扫描根（相对 workspace；* = 一层通配） */
export const SCAN_ROOTS: readonly string[] = ['docs', 'docs/*', '*/docs', 'self-plugins/*/docs']

const SCAN_SKIP = new Set([
  'node_modules',
  '.git',
  '.dsh',
  '.pnpm',
  'dist',
  'build',
  'lib',
  'coverage',
  'tmp',
  '.tmp',
  'out',
  '.next',
  '__pycache__',
  '.venv',
  'venv',
])

export interface FsLike {
  exists(path: string): boolean
  isFile(path: string): boolean
  mtimeMs(path: string): number | null
  readText(path: string): string
  listNames(dir: string): string[]
}

export function createNodeFs(): FsLike {
  return {
    exists: (p) => existsSync(p),
    isFile: (p) => {
      try {
        return statSync(p).isFile()
      } catch {
        return false
      }
    },
    mtimeMs: (p) => {
      try {
        return statSync(p).mtimeMs
      } catch {
        return null
      }
    },
    readText: (p) => readFileSync(p, 'utf8'),
    listNames: (dir) => {
      try {
        return readdirSync(dir)
      } catch {
        return []
      }
    },
  }
}

export function toPosix(p: string): string {
  return p.split(sep).join('/')
}

export function absOf(workspace: string, rel: string): string {
  return join(workspace, ...rel.split('/'))
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function writeAtomic(abs: string, text: string): void {
  mkdirSync(dirname(abs), { recursive: true })
  const tmp = `${abs}.tmp-${process.pid}`
  writeFileSync(tmp, text, 'utf8')
  renameSync(tmp, abs)
}

/**
 * 扫描磁盘上的语义文档（`docs/semantic*.md`）。
 * 约定即发现：README §3「路径即约定，工具无需配置即可发现」。
 * 排除：`docs/semantics/**`（系统自身：规范/模板/注册表/索引）。
 */
export function discoverSemanticDocs(workspace: string, fs: FsLike): string[] {
  const dirs = new Set<string>()
  dirs.add(join(workspace, 'docs'))
  for (const name of fs.listNames(workspace)) {
    if (name.startsWith('.') || SCAN_SKIP.has(name)) continue
    dirs.add(join(workspace, name, 'docs'))
  }
  for (const name of fs.listNames(join(workspace, 'docs'))) {
    if (name.startsWith('.') || SCAN_SKIP.has(name)) continue
    dirs.add(join(workspace, 'docs', name))
  }
  for (const name of fs.listNames(join(workspace, 'self-plugins'))) {
    if (name.startsWith('.') || SCAN_SKIP.has(name)) continue
    dirs.add(join(workspace, 'self-plugins', name, 'docs'))
  }

  const found = new Set<string>()
  for (const dir of dirs) {
    for (const name of fs.listNames(dir)) {
      if (!/^semantic.*\.md$/i.test(name)) continue
      const abs = join(dir, name)
      if (!fs.isFile(abs)) continue
      const rel = toPosix(relative(workspace, abs))
      if (rel.startsWith(SYSTEM_DIR_PREFIX)) continue
      found.add(rel)
    }
  }
  return [...found].sort()
}

/** 收集单条目的「事实」（存在性/mtime/文档解析） */
export function collectEntryFacts(entry: RegistryEntry, workspace: string, fs: FsLike): EntryFacts {
  const docRel = typeof entry.doc === 'string' ? entry.doc : ''
  const docAbs = absOf(workspace, docRel)
  const docExists = docRel.length > 0 && fs.exists(docAbs)
  let doc = null as EntryFacts['doc']
  let docReadError: string | null = null
  if (docExists) {
    try {
      doc = parseSemanticDoc(fs.readText(docAbs))
    } catch (err) {
      docReadError = `${errText(err)}（${docAbs}）`
    }
  }

  const implMissing: string[] = []
  const twinsMissing: string[] = []
  let implLatest = 0
  for (const rel of entry.impl ?? []) {
    const abs = absOf(workspace, rel)
    if (!fs.isFile(abs)) {
      implMissing.push(rel)
      continue
    }
    const m = fs.mtimeMs(abs)
    if (m !== null && m > implLatest) implLatest = m
  }
  for (const rel of entry.twins ?? []) {
    const abs = absOf(workspace, rel)
    if (!fs.isFile(abs)) {
      twinsMissing.push(rel)
      continue
    }
    const m = fs.mtimeMs(abs)
    if (m !== null && m > implLatest) implLatest = m
  }

  return {
    docExists,
    docMtimeMs: docExists ? fs.mtimeMs(docAbs) : null,
    docReadError,
    implMissing,
    twinsMissing,
    implLatestMtimeMs: implLatest > 0 ? implLatest : null,
    doc,
  }
}

export interface RegistryRecord {
  entry: RegistryEntry
  facts: EntryFacts | null
  status: StatusEvaluation | null
}

export interface RegistryState {
  workspace: string
  registryPath: string
  indexPath: string
  registry: Registry
  schemaIssues: SchemaIssue[]
  /** 可用条目（含事实与状态重判）；schema 不合法的条目在 skipped 里，绝不静默丢弃 */
  records: RegistryRecord[]
  skipped: { index: number; id: string | null; reason: string }[]
  unregisteredDocs: string[]
  scannedRoots: string[]
}

/**
 * 读取并装载注册表状态。
 * 失败一律抛错并带路径（调用方必须转成显式错误返回，不许退化成空清单）。
 */
export function loadRegistryState(workspace: string, fs: FsLike): RegistryState {
  const registryPath = absOf(workspace, REGISTRY_REL)
  const indexPath = absOf(workspace, INDEX_REL)
  if (!fs.exists(registryPath)) {
    throw new Error(`注册表不存在：${registryPath}（先用 semantic_register 登记第一条）`)
  }
  let text: string
  try {
    text = fs.readText(registryPath)
  } catch (err) {
    throw new Error(`注册表读取失败：${registryPath} —— ${errText(err)}`)
  }
  const parsed = parseRegistry(text, registryPath)
  const schemaIssues = validateRegistry(parsed.raw, registryPath)
  const { usable, usableIndices, skipped } = partitionEntries(parsed.registry, schemaIssues)

  const records: RegistryRecord[] = usable.map((entry) => {
    const facts = collectEntryFacts(entry, workspace, fs)
    const hasImpl = (entry.impl ?? []).length > 0
    const status = evaluateStatus(
      entry,
      facts.doc === null ? null : { total: facts.doc.acceptance.total, pending: facts.doc.acceptance.pending },
      hasImpl,
    )
    return { entry, facts, status }
  })

  const factsAligned: (EntryFacts | null)[] = parsed.registry.entries.map(() => null)
  usableIndices.forEach((registryIndex, i) => {
    factsAligned[registryIndex] = records[i]?.facts ?? null
  })

  const registered = new Set<string>()
  for (const e of parsed.registry.entries) {
    if (e !== null && typeof e === 'object' && typeof e.doc === 'string' && e.doc.trim().length > 0) {
      registered.add(e.doc.replace(/\\/g, '/').replace(/^\.\//, ''))
    }
  }
  const found = discoverSemanticDocs(workspace, fs)

  return {
    workspace,
    registryPath,
    indexPath,
    registry: parsed.registry,
    schemaIssues,
    records,
    skipped,
    unregisteredDocs: found.filter((p) => !registered.has(p)),
    scannedRoots: SCAN_ROOTS.map((r) => `${workspace.replace(/\\/g, '/')}/${r}`),
  }
}

/** 与 entries 同序的 facts（供 detectDrift 使用） */
export function factsAlignedWith(state: RegistryState): (EntryFacts | null)[] {
  const aligned: (EntryFacts | null)[] = state.registry.entries.map(() => null)
  state.records.forEach((record) => {
    const idx = state.registry.entries.indexOf(record.entry)
    if (idx >= 0) aligned[idx] = record.facts
  })
  return aligned
}

export interface RegisterOutcome {
  action: 'created' | 'updated'
  entry: RegistryEntry
  entryCount: number
  registryPath: string
  indexPath: string
  /** 是否用文档解析结果回填了 acceptance/openQuestions（README §6） */
  acceptanceApplied: boolean
}

/**
 * upsert 注册表 + 重新生成 INDEX.md。
 * 注册表存在但不可解析 → 抛错（拒绝覆盖：坏注册表是证据，不许静默重建）。
 */
export function applyRegistration(
  workspace: string,
  fs: FsLike,
  patch: EntryPatch,
  generatedAt: string,
): RegisterOutcome {
  const registryPath = absOf(workspace, REGISTRY_REL)
  const indexPath = absOf(workspace, INDEX_REL)

  let registry: Registry
  if (fs.exists(registryPath)) {
    let text: string
    try {
      text = fs.readText(registryPath)
    } catch (err) {
      throw new Error(`注册表读取失败（拒绝覆盖）：${registryPath} —— ${errText(err)}`)
    }
    registry = parseRegistry(text, registryPath).registry
  } else {
    registry = emptyRegistry(workspace, generatedAt)
  }

  let acceptance = patch.acceptance ?? null
  let openQuestions = patch.openQuestions ?? null
  let acceptanceApplied = false
  const docRel = typeof patch.doc === 'string' ? patch.doc : undefined
  if (docRel !== undefined && docRel.trim().length > 0) {
    const docAbs = absOf(workspace, docRel)
    if (fs.exists(docAbs)) {
      let doc
      try {
        doc = parseSemanticDoc(fs.readText(docAbs))
      } catch (err) {
        throw new Error(`文档读取/解析失败：${docAbs} —— ${errText(err)}`)
      }
      const note = patch.acceptance?.note
      acceptance = {
        total: doc.acceptance.total,
        proven: doc.acceptance.proven,
        pending: doc.acceptance.pending,
        ...(note !== undefined ? { note } : {}),
      }
      openQuestions = doc.openQuestions
      acceptanceApplied = true
    }
  }

  const { registry: next, action, entry } = upsertEntry(
    registry,
    { ...patch, acceptance, openQuestions },
    generatedAt,
  )
  writeAtomic(registryPath, `${JSON.stringify(next, null, 2)}\n`)
  writeAtomic(indexPath, renderIndexMarkdown(next, { generatedAt }))
  return {
    action,
    entry,
    entryCount: next.entries.length,
    registryPath,
    indexPath,
    acceptanceApplied,
  }
}
