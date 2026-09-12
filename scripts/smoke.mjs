/**
 * 冒烟验证（本地直测，不需要挂载插件）：
 *   1. 真实加载 lib/index.js + fake ctx → 注册 4 个工具（证明插件可加载、defineTool schema 合法）
 *   2. 逐个调用 execute：对真实 workspace 跑 list/get/check（只读），对临时 workspace 跑 register（写入）
 *   3. 用 output.schema 校验返回值键（additionalProperties:false 的常见坑）
 *   4. 调 render(args, value) 打印人类可读摘要（render 签名是 (args, value)）
 *
 * 用法：node scripts/smoke.mjs [workspace]   缺省 workspace = E:/alice
 */
import { mkdirSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pluginDir = dirname(here)
const realWorkspace = process.argv[2] ?? 'E:/alice'
const tmpWorkspace = join(pluginDir, 'tests', '.work', 'smoke-ws')

const tools = []
const logs = []
const ctx = {
  logger: () => ({
    info: (m) => logs.push(`INFO ${m}`),
    warn: (m) => logs.push(`WARN ${m}`),
    error: (m) => logs.push(`ERROR ${m}`),
  }),
  tools: { register: (t) => tools.push(t) },
}

const mod = await import('../lib/index.js')
mod.apply(ctx, { enabled: true, workspace: realWorkspace })

console.log(`插件加载成功：name=${mod.name} inject=${JSON.stringify(mod.inject)} 注册工具=${tools.length}`)
for (const l of logs) console.log('  ' + l)
const names = tools.map((t) => t.name).sort()
const expected = ['semantic_check', 'semantic_get', 'semantic_list', 'semantic_register']
console.log(`工具：${names.join(', ')}`)
if (JSON.stringify(names) !== JSON.stringify(expected)) {
  console.error(`✖ 工具集合不符，期望 ${expected.join(', ')}`)
  process.exit(1)
}

/** 用 output.schema 校验返回值键（additionalProperties:false → 每个返回键都必须声明） */
function checkSchema(tool, value) {
  const schema = tool.output?.schema
  if (schema === undefined) return []
  const declared = Object.keys(schema.properties ?? {})
  const problems = []
  for (const key of Object.keys(value)) {
    if (!declared.includes(key)) problems.push(`返回了未声明字段 ${key}`)
  }
  for (const [key, spec] of Object.entries(schema.properties ?? {})) {
    if (spec?.required === true && !(key in value)) problems.push(`缺少 required 字段 ${key}`)
  }
  return problems
}

const byName = new Map(tools.map((t) => [t.name, t]))
let failures = 0

async function run(name, args) {
  const tool = byName.get(name)
  const value = await tool.execute(args, {})
  const problems = checkSchema(tool, value)
  console.log(`\n===== ${name} ${JSON.stringify(args)} =====`)
  console.log(`[schema] ${problems.length === 0 ? 'PASS（键与 output.schema 一致）' : 'FAIL → ' + problems.join('; ')}`)
  if (problems.length > 0) failures += 1
  const rendered = tool.output.render(args, value)
  console.log('[render]')
  console.log(String(rendered?.[0]?.text ?? '').split('\n').map((l) => '  ' + l).join('\n'))
  return value
}

await run('semantic_list', {})
await run('semantic_get', { id: 'web-lifecycle' })
await run('semantic_get', { id: 'panel-host' })
await run('semantic_check', {})
await run('semantic_check', { id: 'panel-host' })

// semantic_register：只写临时 workspace（绝不碰 E:/alice 的 docs/semantics）
rmSync(tmpWorkspace, { recursive: true, force: true })
mkdirSync(join(tmpWorkspace, 'self-plugins', 'sample', 'docs'), { recursive: true })
mkdirSync(join(tmpWorkspace, 'self-plugins', 'sample', 'src'), { recursive: true })
const sampleDoc = readFileSync(join(pluginDir, 'tests', 'helpers.mjs'), 'utf8') // 仅为占位，真实内容如下
void sampleDoc
const doc = `# 语义文档：冒烟样本

> 版本 v0.1 · 2026-01-01 · 状态：草案
> 实现落点：\`sample/src/index.ts\`

## 1 · 定位与反定位
x

## 2 · 术语表
x

## 3 · 概念模型
x

## 4 · 契约
x

## 5 · 边界与信任
x

## 6 · 可证伪验收

| # | 命题 | 证据 |
|---|------|------|
| A1 | x | **待线上验收** |

## 7 · 与实现的关系
x

## 8 · 实践修订记录
x

## 9 · 未决问题
- **U1** x
`
const { writeFileSync } = await import('node:fs')
writeFileSync(join(tmpWorkspace, 'self-plugins', 'sample', 'docs', 'semantic.md'), doc, 'utf8')
writeFileSync(join(tmpWorkspace, 'self-plugins', 'sample', 'src', 'index.ts'), '// sample\n', 'utf8')

const registerTool = byName.get('semantic_register')
const registerCtx = {
  ...ctx,
  tools: { register: () => {} },
}
// 换 workspace：临时构造一个新实例（apply 会把 config 闭包进去，这里用第二个 fake ctx）
const tools2 = []
const ctx2 = { ...ctx, tools: { register: (t) => tools2.push(t) } }
mod.apply(ctx2, { enabled: true, workspace: tmpWorkspace })
const regTool = tools2.find((t) => t.name === 'semantic_register')
const regValue = await regTool.execute(
  {
    id: 'smoke-sample',
    title: '冒烟样本',
    doc: 'self-plugins/sample/docs/semantic.md',
    status: 'implemented',
    owners: ['sample'],
    impl: ['self-plugins/sample/src/index.ts'],
  },
  {},
)
const regProblems = checkSchema(regTool, regValue)
console.log(`\n===== semantic_register（临时 workspace）=====`)
console.log(`[schema] ${regProblems.length === 0 ? 'PASS' : 'FAIL → ' + regProblems.join('; ')}`)
if (regProblems.length > 0) failures += 1
console.log('[render]')
console.log(String(regTool.output.render({}, regValue)?.[0]?.text ?? '').split('\n').map((l) => '  ' + l).join('\n'))
console.log(`[files] registry=${existsSync(join(tmpWorkspace, 'docs/semantics/registry.json'))} index=${existsSync(join(tmpWorkspace, 'docs/semantics/INDEX.md'))}`)
void registerTool
void registerCtx
rmSync(tmpWorkspace, { recursive: true, force: true })

console.log(`\n冒烟结果：${failures === 0 ? 'PASS' : `FAIL（${failures} 项 schema 不一致）`}`)
process.exit(failures === 0 ? 0 : 1)
