/**
 * Markdown 解析层测试：真实文档样本 + 残缺样本
 * 契约：docs/semantics/README.md §4（必备结构 10 项）/ §6（验收与未决问题计数回填）
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseSemanticDoc } from '../lib/markdown.js'
import { realCorpus, REAL_WORKSPACE, PANEL_DOC, DOC_COMPLETE, DOC_INCOMPLETE, docWithAcceptanceRows } from './helpers.mjs'

test('真语料全库对照：每份生产文档都能解析，且计数口径自洽', () => {
  const docs = realCorpus()
  // ⚠ 零样本会让下面的「全部通过」恒真 —— 必须先钉住语料本体存在。
  assert.ok(docs.length >= 30, `真语料只有 ${docs.length} 份，太少（< 30）⇒ 对照退化成单文件测`)

  /** @type {string[]} */
  const broken = []
  for (const file of docs) {
    const label = file.slice(REAL_WORKSPACE.length + 1).replace(/\\/g, '/')
    let doc
    try {
      doc = parseSemanticDoc(readFileSync(file, 'utf8'))
    } catch (err) {
      broken.push(`${label}: 解析抛错 ${err instanceof Error ? err.message : String(err)}`)
      continue
    }
    const a = doc.acceptance
    // 恒真关系（对任何文档都成立，不依赖具体数字）：
    if (a.proven + a.pending !== a.total) broken.push(`${label}: proven+pending≠total（${a.proven}+${a.pending}≠${a.total}）`)
    if (a.pendingMarked + a.unprovenUnmarked !== a.pending) broken.push(`${label}: 未证分类不完备（${a.pendingMarked}+${a.unprovenUnmarked}≠${a.pending}）`)
    if (doc.missingSections.length + doc.presentSections.length !== 10) broken.push(`${label}: 必备结构没判全（${doc.missingSections.length + doc.presentSections.length}/10）`)
    for (const row of a.rows) if (row.id.length === 0) broken.push(`${label}: 有验收行缺编号`)
    for (const q of doc.openQuestionItems) if (q.text.length === 0) broken.push(`${label}: 有未决问题缺正文`)
  }
  assert.deepEqual(broken, [], '真语料里出现口径不自洽的文档')
})

test('真样本：面板 docs/semantic.md（只断言结构性不变量，不锁内容）', () => {
  // 说明：面板文档正在被并行实例持续编辑（实测：§11.5「实践修订记录」在本次作业期间被补入），
  // 因此这里只断言**契约级不变量**，不锁具体计数——内容级断言放在固定夹具（DOC_COMPLETE / DOC_INCOMPLETE）里。
  const text = readFileSync(PANEL_DOC, 'utf8')
  const doc = parseSemanticDoc(text)

  assert.ok(doc.headings.length > 10, '真实文档应解析出标题树')
  assert.equal(doc.acceptance.pending, doc.acceptance.total - doc.acceptance.proven, 'pending 口径自洽')
  assert.equal(doc.hasRevisionLog, !doc.missingSections.includes('revision-log'), 'D6 载体判定与缺节列表一致')
  assert.equal(doc.missingSections.length + doc.presentSections.length, 10, '10 项必备结构必须全部被判定（不丢项）')
  assert.ok(doc.acceptance.total >= 0 && doc.openQuestions >= 0)
  for (const row of doc.acceptance.rows) assert.ok(row.id.length > 0, '验收行必须有编号')
  for (const q of doc.openQuestionItems) assert.ok(q.text.length > 0, '未决问题条目必须有正文')
})

test('残缺样本：缺 3 个小节必须能被报出（不是「解析成功就万事大吉」）', () => {
  const doc = parseSemanticDoc(DOC_INCOMPLETE)
  assert.deepEqual(doc.missingSections, ['concept', 'acceptance', 'revision-log'])
  assert.deepEqual(doc.missingSectionNames, ['概念模型 + 不变量', '可证伪验收', '实践修订记录'])
  assert.equal(doc.hasRevisionLog, false)
  assert.equal(doc.acceptance.total, 0)
})

test('完整样本：10 节齐全、验收与未决问题计数正确', () => {
  const doc = parseSemanticDoc(DOC_COMPLETE)
  assert.deepEqual(doc.missingSections, [])
  assert.equal(doc.acceptance.total, 3)
  assert.equal(doc.acceptance.proven, 2)
  assert.equal(doc.acceptance.pending, 1)
  assert.equal(doc.acceptance.pendingMarked, 1)
  assert.equal(doc.openQuestions, 2)
  assert.equal(doc.hasRevisionLog, true)
})

test('解析是纯函数：同输入两次结果一致（无 IO / 无时间依赖）', () => {
  const a = parseSemanticDoc(DOC_COMPLETE)
  const b = parseSemanticDoc(DOC_COMPLETE)
  assert.deepEqual(a, b)
})

// ---- 元信息解析（2026-09-13 实测修正：模板推荐的加粗状态读不出来）----

const HEADER_BLOCKQUOTE = [
  '# 语义文档：样本能力',
  '',
  '> 版本 v0.3 · 2026-09-13 · 作者：爱丽丝 · 状态：**已实现（M1：租约）**',
  '> 开发方式：语义文档优先',
  '> 实现落点：`src/x.ts`（主）',
  '',
  '## 1 · 元信息',
  '',
  '| 字段 | 值 |',
  '|------|-----|',
  '| 载体 | 插件 |',
].join('\n')

test('元信息：加粗状态可解析（模板推荐写法，此前一律 null）', () => {
  const doc = parseSemanticDoc(HEADER_BLOCKQUOTE)
  assert.equal(doc.meta.version, 'v0.3')
  assert.equal(doc.meta.date, '2026-09-13')
  assert.equal(doc.meta.status, '已实现（M1：租约）', '加粗标记被剥掉，值在行尾截断')
  assert.equal(doc.meta.implHints.length, 1)
  assert.ok(doc.meta.implHints[0].includes('src/x.ts'))
})

test('元信息：状态值在 · 分隔符处截断，不吃掉后续内容', () => {
  const doc = parseSemanticDoc([
    '# 语义文档：样本',
    '',
    '> 版本 v1 · 2026-01-01 · 状态：已验收 · 作者：爱丽丝',
    '> 实现落点：`src/y.ts`',
    '',
    '## 1 · 元信息',
  ].join('\n'))
  assert.equal(doc.meta.status, '已验收')
  assert.equal(doc.meta.version, 'v1')
})

test('元信息：写在 §1 表格里的版本/状态不被头部解析（规范位置是 H1 后的引用块）', () => {
  const doc = parseSemanticDoc([
    '# 语义文档：样本',
    '',
    '## 1 · 元信息',
    '',
    '| 字段 | 值 |',
    '|------|-----|',
    '| 版本 | v0.9 |',
    '| 状态 | verified |',
  ].join('\n'))
  assert.equal(doc.meta.version, null)
  assert.equal(doc.meta.status, null)
})

// ---- 表格分块（2026-09-22 修正：续块首行曾被当表头吃掉）----

test('表格中间的空行不得吃掉数据行（续块无表头——2026-09-22 实测缺陷）', () => {
  // 反例来源：dsh-agent-memory/docs/semantic.md 的 §7 在 A44 与 A45 之间有一个空行，
  // 原实现无条件 `block.slice(1)` 丢首行 ⇒ A45 被当表头静默吞掉（total 78 行报 77）。
  const doc = parseSemanticDoc([
    '# 语义文档：样本',
    '',
    '## 7 · 可证伪验收清单',
    '',
    '| # | 命题 | 证据 | 状态 |',
    '|---|------|------|------|',
    '| A1 | 第一条 | 单测 | ✔ 已实测 |',
    '| A2 | 第二条 | 单测 | ✔ 已实测 |',
    '',
    '| A3 | 空行之后的第三条 | 单测 | ✔ 已实测 |',
    '| A4 | 第四条 | 单测 | 待验收 |',
  ].join('\n'))
  assert.equal(doc.acceptance.total, 4, '空行切断后的续块首行仍是数据行，不能被当表头吃掉')
  assert.deepEqual(doc.acceptance.rows.map((r) => r.id), ['A1', 'A2', 'A3', 'A4'])
  assert.equal(doc.acceptance.proven, 3)
  assert.equal(doc.acceptance.pending, 1)
})

test('有表头的正常表格仍不吃数据行（修正不得反噬正常形态）', () => {
  const doc = parseSemanticDoc([
    '# 语义文档：样本',
    '',
    '## 7 · 可证伪验收清单',
    '',
    '| # | 命题 | 证据 | 状态 |',
    '|---|------|------|------|',
    '| A1 | 甲 | 单测 | ✔ 已实测 |',
    '| A2 | 乙 | 单测 | 待线上验收 |',
  ].join('\n'))
  assert.equal(doc.acceptance.total, 2)
  assert.deepEqual(doc.acceptance.rows.map((r) => r.id), ['A1', 'A2'])
})

// ---------- D7 近义词误读（2026-10-09 · t-a49e40a8）----------

test('D7 尸体样本：格首「已证 / 已验证」⇒ nearMiss 计数到（真语料实测的两种写法）', () => {
  const doc = parseSemanticDoc(
    docWithAcceptanceRows([
      '| A1 | p1 | e1 | **已证**（2026-01-01 实测读数） |',
      '| A2 | p2 | e2 | 已验证 |',
      '| A3 | p3 | e3 | ✔ 已实测 |',
      '| A4 | p4 | e4 | ⚠ 待线上验收 |',
      '| A5 | p5 | e5 | 不可达（当前路径）：execute 先写目录，而 I1 保证该目录此前不存在 ⇒ 已由 try/catch 实现 |',
    ]),
  )
  assert.equal(doc.acceptance.nearMiss, 2, '两条词表外写法应被点名')
  assert.equal(doc.acceptance.rows[0].nearMiss, true, '「**已证**（…）」应命中（去粗体后格首仍是「已证」）')
  assert.equal(doc.acceptance.rows[1].nearMiss, true, '「已验证」应命中')
  // 不污染既有口径：nearMiss 是**第四桶**，不是把行挪进 proven/pending
  assert.equal(doc.acceptance.proven, 1, 'proven 仍只认 ✔ 那一行')
  assert.equal(doc.acceptance.pendingMarked, 1, '「待线上验收」仍单独计数')
  assert.equal(doc.acceptance.total, 5)
})

test('D7 对照：✔ 已实测 / ⚠ 待线上验收 / **长散文格** ⇒ 一条不报（锚定格首的分辨力）', () => {
  const doc = parseSemanticDoc(
    docWithAcceptanceRows([
      '| A1 | p1 | e1 | ✔ 已实测（单测） |',
      '| A2 | p2 | e2 | ⚠ 待线上验收 |',
      '| A3 | p3 | e3 | 不可达（当前路径）：execute 先写目录，而 I1 保证该目录此前不存在 ⇒ 已由 try/catch 实现 |',
    ]),
  )
  // ⚠ 第 3 行是**真实语料里抓到的假阳性形状**：最后一格是整段说明，行文里出现「已由…实现」。
  // 判据锚定**格首**才把它排除（松口径时全库有 4 条这种误报，锚定后为 0）。
  assert.equal(doc.acceptance.nearMiss, 0, '长散文格不得误报——否则告警变噪音')
})

test('D7 真语料对照：全库 nearMiss 只允许已知那一份（缺口钉在这里，不是说它没问题）', () => {
  // nearMiss = 「人读等于已证、但不在严格词表里」的写法。
  //
  // ⚠ 这条断言**不是**「全库为 0」——实测只有 1 份文档不在 0 上，而它是**真缺口**：
  // `dsh-llm-probe/docs/semantic.md` 用的是四列表 `| # | 命题 | 证据 | 状态 |`，
  // 而解析器取「最后一个非空格」当证据 ⇒ 抓到的是**状态格**里的 `已验证`（不在 PASS_RE 里），
  // 于是 8 条真·已验的条目被读成「未验」。人读已证、机器读未验，这正是 D7 要抓的形状。
  //
  // 修法是解析器支持四列表（状态格 + 证据格分开取），但那要动全库 67 份文档的共用解析层，
  // 不塞进本次提交。所以这里把缺口**钉成精确清单**：
  //   · 新文档出现 nearMiss ⇒ 红（判据对好样本发火，或真有人用了词表外写法）
  //   · 缺口被修好 ⇒ 也红（提醒把这份清单清空，别让豁免变成永久免检）
  const KNOWN_GAP = ['self-plugins/dsh-llm-probe/docs/semantic.md: 8 条']
  const docs = realCorpus()
  assert.ok(docs.length >= 30, `真语料只有 ${docs.length} 份 ⇒ 这条对照无意义`)
  const hits = docs
    .map((file) => ({ file, doc: parseSemanticDoc(readFileSync(file, 'utf8')) }))
    .filter((x) => x.doc.acceptance.nearMiss !== 0)
    .map((x) => `${x.file.slice(REAL_WORKSPACE.length + 1).replace(/\\/g, '/')}: ${x.doc.acceptance.nearMiss} 条`)
  assert.deepEqual(hits, KNOWN_GAP, 'nearMiss 清单变了：要么是新缺口（查文档写法），要么是缺口已修（清空 KNOWN_GAP）')
})

// ---------- 节 span 定位：子标题不得抢走正式节（2026-10-09 · t-cdb92e72 附带）----------

test('尸体：排在前面、标题含「验收」的子标题**不得**抢走正式验收节的 span', () => {
  // 真事（本仓 2026-10-09 实测）：我在本插件的 `docs/semantic.md` 里加了 `### 4.4 验收快照…`，
  // 而 `findSpan` 按**文档序**取首个命中 `/可证伪|验收/` 的标题 ⇒ 抢走 `## 7 · 可证伪验收清单` 的 span
  // ⇒ A1–A17 被读成那张 3 行来源表（`0/3/3`），**且这个错读数被静默写进注册表**。
  // 判据：命中取**层级最浅者**（同级取文档序最先）。
  const doc = parseSemanticDoc([
    '# 语义文档：样本',
    '',
    '## 4 · 契约',
    '',
    '### 4.4 验收快照：三来源与对账口径',
    '',
    '| 来源 | 触发条件 | 结果 |',
    '|------|---------|------|',
    '| doc | a | b |',
    '| explicit | a | b |',
    '| untouched | a | b |',
    '',
    '## 7 · 可证伪验收清单',
    '',
    '| # | 命题 | 证据 | 状态 |',
    '|---|------|------|------|',
    '| A1 | 一 | 单测 | ✔ 已实测 |',
    '| A2 | 二 | 单测 | 待线上验收 |',
  ].join('\n'))
  assert.equal(doc.acceptance.total, 2, '必须取 `## 7` 那张表，不是子节的 3 行来源表')
  assert.deepEqual(doc.acceptance.rows.map((r) => r.id), ['A1', 'A2'])
  assert.equal(doc.acceptance.proven, 1)
})

test('反向对照：只有子标题命中时仍能解析（层级择优不得退化成「只认 ##」）', () => {
  const doc = parseSemanticDoc([
    '# 语义文档：样本',
    '',
    '### 验收清单',
    '',
    '| # | 命题 | 证据 | 状态 |',
    '|---|------|------|------|',
    '| A1 | 一 | 单测 | ✔ 已实测 |',
  ].join('\n'))
  assert.equal(doc.acceptance.total, 1)
  assert.equal(doc.acceptance.proven, 1)
})
