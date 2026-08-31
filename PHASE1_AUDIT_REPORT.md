# Phase 1 - Han Audit Report (Clean HEAD)

Total Han lines: 11622, files: 455

## Summary by category
- TEST_FIXTURE: 5912 lines
- OTHER_LANGUAGE_DOC: 2332 lines
- MACHINE_PROMPT_EN: 1867 lines
- DOC_VI: 597 lines
- USER_UI_VI: 523 lines
- LEGACY_COMPAT: 204 lines
- TECHNICAL_IDENTIFIER: 187 lines

## Rejected stash evidence (what NOT to do)
- Bad bulk introduced `ViText123` placeholders, ASCII fake Vietnamese (`Chuong`, `Nhiem vu`, `Khong lam`, `Kiem tra`), damaged regex `[VI-VI]`, semantic substitutions only to eliminate Han, test regressions, Japanese Kanji -> Romaji transliteration.
- Stash `backup-bad-bulk-han-cleanup` contains 501 files changed, 13276 insertions, includes `ViText` placeholders and `help.aliyun.com/vi` etc.
- Correct approach: natural Vietnamese with diacritics, English canonical for machine prompts, keep technical identifiers, use escaped \uXXXX only for legacy compat.

## Detailed sample per file (first 3 lines per file, truncated)
| File | Line | Category | Current text (truncated) | Target | Behavior-sensitive | Proposed |
|------|------|----------|--------------------------|--------|--------------------|----------------|
| .gitignore | 37 | OTHER_LANGUAGE_DOC | # 用户运行时数据（会话记录、书籍内容、项目密钥、提示词模板不属于项目代码） | Giữ nguyên (Japanese) hoặc hỏi Human | Không | Xem chi tiết |
| CHANGELOG.en.md | 3 | DOC_VI | [中文](CHANGELOG.md) \| English | Tiếng Việt | Không | Xem chi tiết |
| CHANGELOG.en.md | 278 | DOC_VI | - Unified platform alias normalization across the Studio, CLI, TUI, and agent create-book chains; inputs like `番茄` / `fa | Tiếng Việt | Không | Xem chi tiết |
| CHANGELOG.en.md | 471 | DOC_VI | - **Whole-book entity rename**: `把林烬改成张三` / `/rename 林烬 => 张三`, a full scan of chapters + truth files replaced in one pa | Tiếng Việt | Không | Xem chi tiết |
| CHANGELOG.md | 3 | DOC_VI | [English](CHANGELOG.en.md) \| 中文 | Tiếng Việt | Không | Xem chi tiết |
| CHANGELOG.md | 9 | DOC_VI | 统一 Pi Agent Harness 与专业创作内核：Studio Chat、TUI、外部 Agent 和各类作品生产 worker 现在共享同一套 pi-agent 工具循环、结构化 action/result、Skill 绑定、检索与 | Tiếng Việt | Không | Xem chi tiết |
| CHANGELOG.md | 13 | DOC_VI | - 新增统一 production harness，长篇、短篇、剧本、分镜、互动影游、Play 和翻译共用运行快照、观测、取消、恢复与原子提交语义 | Tiếng Việt | Không | Xem chi tiết |
| README.en.md | 13 | DOC_VI | <a href="README.md">中文</a> \| English \| <a href="README.ja.md">日本語</a> | Tiếng Việt | Không | Xem chi tiết |
| README.ja.md | 4 | OTHER_LANGUAGE_DOC | <strong>長編・短編小説、脚本、インタラクティブ影遊、IP コンテンツ、多言語翻訳のための AI 創作システム（CLI: <code>castor</code>）</strong> | Giữ nguyên (Japanese) hoặc hỏi Human | Không | Xem chi tiết |
| README.ja.md | 13 | OTHER_LANGUAGE_DOC | <a href="README.md">中文</a> \| <a href="README.en.md">English</a> \| 日本語 | Giữ nguyên (Japanese) hoặc hỏi Human | Không | Xem chi tiết |
| README.ja.md | 18 | OTHER_LANGUAGE_DOC | > **派生プロジェクトのお知らせ** | Giữ nguyên (Japanese) hoặc hỏi Human | Không | Xem chi tiết |
| README.md | 13 | DOC_VI | <a href="README.en.md">English</a> \| <a href="README.md">中文</a> \| <a href="README.ja.md">日本語</a> | Tiếng Việt | Không | Xem chi tiết |
| assets/arch-memory.svg | 28 | USER_UI_VI | <text class="t2" x="44" y="56">长期记忆与状态</text> | Tiếng Việt (có dấu) | Không | Xem chi tiết |
| assets/arch-memory.svg | 32 | USER_UI_VI | <text class="nm2k" x="64" y="125">写手正文</text> | Tiếng Việt (có dấu) | Không | Xem chi tiết |
| assets/arch-memory.svg | 34 | USER_UI_VI | <text class="nm2" x="252" y="125">提取九类事实</text> | Tiếng Việt (có dấu) | Không | Xem chi tiết |
| assets/arch-pipeline.svg | 24 | USER_UI_VI | <text class="t" x="44" y="56">章节生产管线</text> | Tiếng Việt (có dấu) | Không | Xem chi tiết |
| assets/arch-pipeline.svg | 28 | USER_UI_VI | <text class="d" x="558" y="54">建筑师 · 建书 / 导入 / 番外时生成设定</text> | Tiếng Việt (có dấu) | Không | Xem chi tiết |
| assets/arch-pipeline.svg | 30 | USER_UI_VI | <text class="d" x="870" y="54">雷达 · 趋势（可跳过）</text> | Tiếng Việt (có dấu) | Không | Xem chi tiết |
| assets/arch-system.svg | 25 | USER_UI_VI | <text class="t3" x="44" y="56">整体系统</text> | Tiếng Việt (có dấu) | Không | Xem chi tiết |
| assets/arch-system.svg | 28 | USER_UI_VI | <text class="d3" x="682" y="54">底层共享：模型配置 · 多模型路由 · 封面 / 图片服务</text> | Tiếng Việt (có dấu) | Không | Xem chi tiết |
| assets/arch-system.svg | 30 | USER_UI_VI | <rect class="pill" x="150" y="92" width="170" height="46" filter="url(#s3)"/><text class="pl" x="200" y="120">Studio 对话< | Tiếng Việt (có dấu) | Không | Xem chi tiết |
| audit_phase1.py | 27 | OTHER_LANGUAGE_DOC | if any(x in line_content for x in ["hook_id","起始章节","伏笔","当前位置","当前位置","是","否","无","字段","值"]): | Giữ nguyên (Japanese) hoặc hỏi Human | Không | Xem chi tiết |
| docs/ARCHITECTURE_AUDIT.md | 111 | DOC_VI | ├── outline/{story_frame.md,volume_map.md,rhythm_principles.md\|节奏原则.md} | Tiếng Việt | Không | Xem chi tiết |
| docs/ARCHITECTURE_AUDIT.md | 112 | DOC_VI | ├── roles/{主要角色,次要角色,major,minor}/<name>.md        # role cards | Tiếng Việt | Không | Xem chi tiết |
| docs/ARCHITECTURE_AUDIT.md | 145 | DOC_VI | 3. Staging dir `books/.tmp-book-create-*`: `saveBookConfigAt` → `book.json`; `writeFoundationFiles` (:842) writes `outli | Tiếng Việt | Không | Xem chi tiết |
| docs/IMPLEMENTATION_PLAN.md | 476 | DOC_VI | - Files: CREATE `migration/translate.ts` — adapter over the EXISTING translation subsystem (`translation/index.ts#create | Tiếng Việt | Không | Xem chi tiết |
| docs/superpowers/plans/2026-08-24-human-governed-post-chapter-state-review.md | 21 | DOC_VI | - Fixtures: `createCanonBook({seedSnapshotsThrough: 12})` from the same helper module (facts: 主角/当前位置 closed@10 + open 东 | Tiếng Việt | Không | Xem chi tiết |
| docs/superpowers/plans/2026-08-24-human-governed-post-chapter-state-review.md | 96 | DOC_VI | // (zh books: ["当前位置","Current Location"], en books: ["Current Location","当前位置"], …) | Tiếng Việt | Không | Xem chi tiết |
| docs/superpowers/plans/2026-08-27-phase-5-foundation-planning-intelligence.md | 478 | DOC_VI | //     heading text (e.g. "数值/资源规则" CONTAINS "/" because the real book_rules | Tiếng Việt | Không | Xem chi tiết |
| docs/superpowers/plans/2026-08-29-castor-machine-prompt-language-migration.md | 104 | DOC_VI | 你是一个章节规划器... | Tiếng Việt | Không | Xem chi tiết |
| docs/superpowers/plans/2026-08-29-castor-ui-localization.md | 38 | DOC_VI | rg -n --hidden --glob '!node_modules' --glob '!dist' --glob '!.git' '中文\|zh-CN\|/bzh/b' packages README*.md docs scripts | Tiếng Việt | Không | Xem chi tiết |
| packages/cli/src/__tests__/analytics.test.ts | 32 | TEST_FIXTURE | { number: 2, status: "audit-failed", wordCount: 3000, auditIssues: ["[critical] 连续性：角色位置矛盾"] }, | Tiếng Việt có dấu / English | Không | Xem chi tiết |
| packages/cli/src/__tests__/analytics.test.ts | 65 | TEST_FIXTURE | "[critical] 连续性：角色位置矛盾", | Tiếng Việt có dấu / English | Không | Xem chi tiết |
| packages/cli/src/__tests__/analytics.test.ts | 66 | TEST_FIXTURE | "[warning] 数值错误：灵石数量不一致", | Tiếng Việt có dấu / English | Không | Xem chi tiết |
| packages/cli/src/__tests__/auto-command.test.ts | 47 | TEST_FIXTURE | title: `第${chapterNumber}章`, | Tiếng Việt có dấu / English | Không | Xem chi tiết |
| packages/cli/src/__tests__/book-backup.test.ts | 28 | TEST_FIXTURE | await writeFile(join(bookDir, "chapters", "0001_起风.md"), "第一章原文。", "utf-8"); | Tiếng Việt có dấu / English | Không | Xem chi tiết |
| packages/cli/src/__tests__/book-backup.test.ts | 29 | TEST_FIXTURE | await writeFile(join(bookDir, "story", "current_state.md"), "原始状态", "utf-8"); | Tiếng Việt có dấu / English | Không | Xem chi tiết |
| packages/cli/src/__tests__/book-backup.test.ts | 43 | TEST_FIXTURE | await expect(readFile(join(backupDir, "chapters", "0001_起风.md"), "utf-8")).resolves.toBe("第一章原文。"); | Tiếng Việt có dấu / English | Không | Xem chi tiết |
| packages/cli/src/__tests__/chapter-command.test.ts | 83 | TEST_FIXTURE | // "风从码头吹进巷子。" → 9 chars after stripping heading + whitespace. | Tiếng Việt có dấu / English | Không | Xem chi tiết |
| packages/cli/src/__tests__/chapter-command.test.ts | 84 | TEST_FIXTURE | { file: "0001_起风.md", content: "# 第1章 起风/n/n风从码头吹进巷子。" }, | Tiếng Việt có dấu / English | Không | Xem chi tiết |
| packages/cli/src/__tests__/chapter-command.test.ts | 86 | TEST_FIXTURE | index: [chapterEntry(1, "起风", 3000)], | Tiếng Việt có dấu / English | Không | Xem chi tiết |
| packages/cli/src/__tests__/cli-integration.test.ts | 165 | TEST_FIXTURE | expect(output).not.toContain("我的小说"); | Tiếng Việt có dấu / English | Không | Xem chi tiết |
| packages/cli/src/__tests__/cli-integration.test.ts | 221 | TEST_FIXTURE | const output = run(["interact", "--json", "--message", "切换到全自动"]); | Tiếng Việt có dấu / English | Không | Xem chi tiết |
| packages/cli/src/__tests__/cli-integration.test.ts | 394 | TEST_FIXTURE | expect(output).not.toContain("7字"); | Tiếng Việt có dấu / English | Không | Xem chi tiết |
| packages/cli/src/__tests__/genre-command.test.ts | 4 | TEST_FIXTURE | const CHINESE_CHARS = /[一-鿿]/; | Tiếng Việt có dấu / English | Không | Xem chi tiết |
| packages/cli/src/__tests__/localization.test.ts | 31 | TEST_FIXTURE | const CHINESE_CHARS = /[一-鿿]/; | Tiếng Việt có dấu / English | Không | Xem chi tiết |
| packages/cli/src/__tests__/notify-option.test.ts | 33 | TEST_FIXTURE | formatLengthCount: (count: number) => `${count}字`, | Tiếng Việt có dấu / English | Không | Xem chi tiết |
| packages/cli/src/__tests__/notify-option.test.ts | 56 | TEST_FIXTURE | title: `第${chapterNumber}章`, | Tiếng Việt có dấu / English | Không | Xem chi tiết |
| packages/cli/src/__tests__/notify-option.test.ts | 71 | TEST_FIXTURE | title: "示例书", | Tiếng Việt có dấu / English | Không | Xem chi tiết |
| packages/cli/src/__tests__/progress-text.test.ts | 62 | TEST_FIXTURE | totalCountLabel: "24000字", | Tiếng Việt có dấu / English | Không | Xem chi tiết |
| packages/cli/src/__tests__/progress-text.test.ts | 68 | TEST_FIXTURE | "  Tổng độ dài: 24000字", | Tiếng Việt có dấu / English | Không | Xem chi tiết |
| packages/cli/src/__tests__/revision-command.test.ts | 70 | TEST_FIXTURE | await reviseCommand.parseAsync(["node", "revise", "demo-book", "3", "--mode", "rewrite", "--brief", "把注意力拉回师债主线。"], { fr | Tiếng Việt có dấu / English | Không | Xem chi tiết |
| packages/cli/src/__tests__/revision-command.test.ts | 73 | TEST_FIXTURE | externalContext: "把注意力拉回师债主线。", | Tiếng Việt có dấu / English | Không | Xem chi tiết |
| packages/cli/src/__tests__/revision-command.test.ts | 82 | TEST_FIXTURE | await writeCommand.parseAsync(["node", "write", "sync", "demo-book", "3", "--brief", "以师债线为准同步状态。"], { from: "node" }); | Tiếng Việt có dấu / English | Không | Xem chi tiết |
| packages/cli/src/__tests__/tui-agent-session.test.ts | 25 | TEST_FIXTURE | title: "雨夜", | Tiếng Việt có dấu / English | Không | Xem chi tiết |
| packages/cli/src/__tests__/tui-agent-session.test.ts | 83 | TEST_FIXTURE | responseText: "这是 agent 直接返回的回复。", | Tiếng Việt có dấu / English | Không | Xem chi tiết |
| packages/cli/src/__tests__/tui-agent-session.test.ts | 85 | TEST_FIXTURE | { role: "user", content: "帮我整理这一章" }, | Tiếng Việt có dấu / English | Không | Xem chi tiết |
| packages/cli/src/__tests__/tui-dashboard.test.tsx | 192 | TEST_FIXTURE | concept: "港风商战悬疑，主角从灰产洗白。", | Tiếng Việt có dấu / English | Không | Xem chi tiết |
| packages/cli/src/__tests__/tui-dashboard.test.tsx | 193 | TEST_FIXTURE | title: "夜港账本", | Tiếng Việt có dấu / English | Không | Xem chi tiết |
| packages/cli/src/__tests__/tui-dashboard.test.tsx | 194 | TEST_FIXTURE | nextQuestion: "你更想写长篇连载，还是十来章能收住？", | Tiếng Việt có dấu / English | Không | Xem chi tiết |
| packages/cli/src/__tests__/tui-local-commands.test.ts | 8 | TEST_FIXTURE | expect(classifyLocalTuiCommand("帮助")).toBe("help"); | Tiếng Việt có dấu / English | Không | Xem chi tiết |
| packages/cli/src/__tests__/tui-local-commands.test.ts | 14 | TEST_FIXTURE | expect(classifyLocalTuiCommand("状态")).toBe("status"); | Tiếng Việt có dấu / English | Không | Xem chi tiết |
| packages/cli/src/__tests__/tui-local-commands.test.ts | 23 | TEST_FIXTURE | expect(classifyLocalTuiCommand("退出")).toBe("quit"); | Tiếng Việt có dấu / English | Không | Xem chi tiết |
| packages/cli/src/__tests__/write-command.test.ts | 55 | TEST_FIXTURE | readdir: vi.fn(async () => ["0005_第五章.md"]), | Tiếng Việt có dấu / English | Không | Xem chi tiết |
| packages/cli/src/__tests__/write-command.test.ts | 154 | TEST_FIXTURE | { number: 4, title: "第四章", wordCount: 1000, status: "approved" }, | Tiếng Việt có dấu / English | Không | Xem chi tiết |
| packages/cli/src/__tests__/write-command.test.ts | 155 | TEST_FIXTURE | { number: 5, title: "第五章", wordCount: 1000, status: "ready-for-review" }, | Tiếng Việt có dấu / English | Không | Xem chi tiết |
| packages/cli/src/__tests__/write-phase5.test.ts | 39 | TEST_FIXTURE | readdir: vi.fn(async () => ["0005_第五章.md"]), | Tiếng Việt có dấu / English | Không | Xem chi tiết |
| packages/cli/src/__tests__/write-phase5.test.ts | 81 | TEST_FIXTURE | chapterNumber: 5, title: "第五章", wordCount: 2000, | Tiếng Việt có dấu / English | Không | Xem chi tiết |
| packages/cli/src/__tests__/write-review-mode.test.ts | 51 | TEST_FIXTURE | title: "第四章", | Tiếng Việt có dấu / English | Không | Xem chi tiết |
| packages/cli/src/commands/agent.ts | 22 | MACHINE_PROMPT_EN | ? `${instruction}/n/n补充信息：${context}` | English | Có | Xem chi tiết |
| packages/cli/src/commands/config.ts | 307 | USER_UI_VI | // B17: list-models 命令 —— 列出指定 service 的可用模型（含元数据） | Tiếng Việt (có dấu) | Không | Xem chi tiết |
| packages/cli/src/commands/doctor.ts | 347 | USER_UI_VI | if (!connected && //b(?:401\|403\|429)/b\|unauthorized\|forbidden\|quota\|balance\|insufficient\|exceeded\|额度\|余额\|配额/i. | Tiếng Việt (có dấu) | Không | Xem chi tiết |
| packages/cli/src/tui/__tests__/markdown.test.ts | 11 | USER_UI_VI | const result = renderMarkdown("这是 **加粗** 文本"); | Tiếng Việt (có dấu) | Không | Xem chi tiết |
| packages/cli/src/tui/__tests__/markdown.test.ts | 12 | USER_UI_VI | // Should contain ANSI bold on/off around 加粗 | Tiếng Việt (có dấu) | Không | Xem chi tiết |
| packages/cli/src/tui/__tests__/markdown.test.ts | 13 | USER_UI_VI | expect(result).toContain("/x1b[1m加粗/x1b[22m"); | Tiếng Việt (có dấu) | Không | Xem chi tiết |
| packages/cli/src/tui/agent-input.ts | 219 | MACHINE_PROMPT_EN | : "我想创建一本新书，请先和我确认方向。")); | English | Có | Xem chi tiết |
| packages/cli/src/tui/agent-input.ts | 226 | MACHINE_PROMPT_EN | : "我想做 Castor Short，请先和我确认方向。")); | English | Có | Xem chi tiết |
| packages/cli/src/tui/agent-input.ts | 233 | MACHINE_PROMPT_EN | : "我想生成或重做封面，请先和我确认目标。")); | English | Có | Xem chi tiết |
| packages/cli/src/tui/local-commands.ts | 11 | USER_UI_VI | if (/^//help$/i.test(value) \|\| /^(help\|giup\|giúp\|tro giup\|trợ giúp\|帮助)$/i.test(value)) { | Tiếng Việt (có dấu) | Không | Xem chi tiết |
| packages/cli/src/tui/local-commands.ts | 15 | USER_UI_VI | if (/^//status$/i.test(value) \|\| /^(status\|trang thai\|trạng thái\|状态)$/i.test(value)) { | Tiếng Việt (có dấu) | Không | Xem chi tiết |
| packages/cli/src/tui/local-commands.ts | 19 | USER_UI_VI | if (/^//clear$/i.test(value) \|\| /^(xoa man hinh\|xóa màn hình\|清屏)$/i.test(value)) { | Tiếng Việt (có dấu) | Không | Xem chi tiết |
| packages/core/genres/horror.md | 2 | LEGACY_COMPAT | name: 恐怖 | Escaped \uXXXX (giữ compat) | Có | Xem chi tiết |
| packages/core/genres/horror.md | 4 | LEGACY_COMPAT | chapterTypes: ["氛围章", "事件章", "揭示章", "过渡章", "回收章"] | Escaped \uXXXX (giữ compat) | Có | Xem chi tiết |
| packages/core/genres/horror.md | 5 | LEGACY_COMPAT | fatigueWords: ["毛骨悚然", "不寒而栗", "浑身发冷", "头皮发麻", "鸡皮疙瘩", "心跳加速", "仿佛", "不禁", "宛如", "竟然"] | Escaped \uXXXX (giữ compat) | Có | Xem chi tiết |
| packages/core/genres/other.md | 2 | LEGACY_COMPAT | name: 通用 | Escaped \uXXXX (giữ compat) | Có | Xem chi tiết |
| packages/core/genres/other.md | 4 | LEGACY_COMPAT | chapterTypes: ["推进章", "布局章", "过渡章", "回收章"] | Escaped \uXXXX (giữ compat) | Có | Xem chi tiết |
| packages/core/genres/other.md | 5 | LEGACY_COMPAT | fatigueWords: ["震惊", "不可思议", "难以置信", "深吸一口气", "仿佛", "不禁", "宛如", "竟然"] | Escaped \uXXXX (giữ compat) | Có | Xem chi tiết |
| packages/core/genres/urban.md | 2 | LEGACY_COMPAT | name: 都市 | Escaped \uXXXX (giữ compat) | Có | Xem chi tiết |
| packages/core/genres/urban.md | 4 | LEGACY_COMPAT | chapterTypes: ["商战章", "社交章", "布局章", "过渡章", "回收章"] | Escaped \uXXXX (giữ compat) | Có | Xem chi tiết |
| packages/core/genres/urban.md | 5 | LEGACY_COMPAT | fatigueWords: ["冷笑", "不可思议", "震惊", "难以置信", "深吸一口气", "眼中闪过一丝", "仿佛", "不禁", "宛如", "竟然", "核心动机", "信息边界"] | Escaped \uXXXX (giữ compat) | Có | Xem chi tiết |
| packages/core/genres/xianxia.md | 2 | LEGACY_COMPAT | name: 仙侠 | Escaped \uXXXX (giữ compat) | Có | Xem chi tiết |
| packages/core/genres/xianxia.md | 4 | LEGACY_COMPAT | chapterTypes: ["战斗章", "悟道章", "布局章", "过渡章", "回收章"] | Escaped \uXXXX (giữ compat) | Có | Xem chi tiết |
| packages/core/genres/xianxia.md | 5 | LEGACY_COMPAT | fatigueWords: ["冷笑", "蝼蚁", "倒吸凉气", "瞳孔骤缩", "天道", "大道", "因果", "气运", "仿佛", "不禁", "宛如", "竟然"] | Escaped \uXXXX (giữ compat) | Có | Xem chi tiết |
| packages/core/genres/xuanhuan.md | 2 | LEGACY_COMPAT | name: 玄幻 | Escaped \uXXXX (giữ compat) | Có | Xem chi tiết |
| packages/core/genres/xuanhuan.md | 4 | LEGACY_COMPAT | chapterTypes: ["战斗章", "布局章", "过渡章", "回收章"] | Escaped \uXXXX (giữ compat) | Có | Xem chi tiết |
| packages/core/genres/xuanhuan.md | 5 | LEGACY_COMPAT | fatigueWords: ["冷笑", "蝼蚁", "倒吸凉气", "瞳孔骤缩", "不可置信", "轰然炸裂", "满场死寂", "难以置信", "仿佛", "不禁", "宛如", "竟然"] | Escaped \uXXXX (giữ compat) | Có | Xem chi tiết |
| packages/core/skills/castor-interactive-film/SKILL.md | 3 | OTHER_LANGUAGE_DOC | description: 互动影游的剧情树、变量旗标、可拍节点、多结局与资产连续性方法。Used for creation and authoring of interactive-film projects. | Giữ nguyên (Japanese) hoặc hỏi Human | Không | Xem chi tiết |
| packages/core/skills/castor-long-market-research/SKILL.md | 3 | OTHER_LANGUAGE_DOC | description: 长篇网文市场、榜单、平台趋势与对标研究。Use for evidence-based long-form fiction market research, not for ordinary drafting. | Giữ nguyên (Japanese) hoặc hỏi Human | Không | Xem chi tiết |
| packages/core/skills/castor-long-story-analysis/SKILL.md | 3 | OTHER_LANGUAGE_DOC | description: 长篇小说拆稿、文风分析与可迁移机制提炼。Use when analyzing a full novel or long sample without copying its expression. | Giữ nguyên (Japanese) hoặc hỏi Human | Không | Xem chi tiết |
| packages/core/skills/castor-long-writing/SKILL.md | 3 | OTHER_LANGUAGE_DOC | description: 长篇小说的场景构造、人物因果、信息释放与连载节奏。Used by Castor long-form workers as their shared craft method. | Giữ nguyên (Japanese) hoặc hỏi Human | Không | Xem chi tiết |
| packages/core/skills/castor-play-world/SKILL.md | 3 | OTHER_LANGUAGE_DOC | description: 品类中立的开放世界与分支互动推进方法。Used by Castor Play workers for coherent action, state, time, and scene progression. | Giữ nguyên (Japanese) hoặc hỏi Human | Không | Xem chi tiết |
| packages/core/skills/castor-script-writing/SKILL.md | 3 | OTHER_LANGUAGE_DOC | description: 小说、创意与大纲到可演剧本的改编方法。Used for confirmed script and short-drama production. | Giữ nguyên (Japanese) hoặc hỏi Human | Không | Xem chi tiết |
| packages/core/skills/castor-short-market-research/SKILL.md | 3 | OTHER_LANGUAGE_DOC | description: 商业短篇市场、平台样本、标题与移动端阅读趋势研究。Use for evidence-based short-fiction market research. | Giữ nguyên (Japanese) hoặc hỏi Human | Không | Xem chi tiết |

## Full file list with counts
- CHANGELOG.md: 525 lines - DOC_VI
- packages/studio/src/api/server.test.ts: 340 lines - OTHER_LANGUAGE_DOC
- packages/core/src/__tests__/pipeline-runner.test.ts: 265 lines - TEST_FIXTURE
- packages/core/src/agents/architect.ts: 258 lines - MACHINE_PROMPT_EN
- README.ja.md: 256 lines - OTHER_LANGUAGE_DOC
- packages/core/src/__tests__/agent-tools.test.ts: 195 lines - TEST_FIXTURE
- packages/core/src/pipeline/runner.ts: 188 lines - OTHER_LANGUAGE_DOC
- packages/core/src/__tests__/script-storyboard-runner.test.ts: 178 lines - TEST_FIXTURE
- packages/core/src/__tests__/play-runner.test.ts: 167 lines - TEST_FIXTURE
- packages/core/src/__tests__/architect-phase5.test.ts: 166 lines - TEST_FIXTURE
- packages/core/src/__tests__/architect-phase5-consolidated.test.ts: 152 lines - TEST_FIXTURE
- packages/core/src/__tests__/revise-foundation.test.ts: 148 lines - TEST_FIXTURE
- packages/core/src/agent/agent-system-prompt.ts: 143 lines - OTHER_LANGUAGE_DOC
- packages/core/src/__tests__/session-transcript-restore.test.ts: 140 lines - TEST_FIXTURE
- packages/core/src/agents/continuity.ts: 138 lines - MACHINE_PROMPT_EN
- packages/studio/src/store/chat/slices/message/action.test.ts: 133 lines - OTHER_LANGUAGE_DOC
- packages/core/src/agents/writer-prompts.ts: 127 lines - MACHINE_PROMPT_EN
- packages/core/src/__tests__/architect.test.ts: 117 lines - TEST_FIXTURE
- packages/core/src/__tests__/post-write-validator.test.ts: 112 lines - TEST_FIXTURE
- packages/core/src/__tests__/play-agents.test.ts: 111 lines - TEST_FIXTURE
- packages/core/src/agents/post-write-validator.ts: 111 lines - MACHINE_PROMPT_EN
- packages/core/src/__tests__/script-storyboard.test.ts: 110 lines - TEST_FIXTURE
- packages/core/src/prompts/short-fiction.ts: 108 lines - MACHINE_PROMPT_EN
- packages/core/src/agents/script-storyboard.ts: 108 lines - MACHINE_PROMPT_EN
- packages/studio/src/components/chat/__tests__/ToolExecutionSteps.test.ts: 105 lines - USER_UI_VI
- packages/core/src/agents/reviser.ts: 102 lines - MACHINE_PROMPT_EN
- packages/core/src/__tests__/draft-directive-parser.test.ts: 98 lines - TEST_FIXTURE
- packages/core/src/interaction/runtime.ts: 98 lines - OTHER_LANGUAGE_DOC
- packages/core/src/__tests__/phase7-hotfix.test.ts: 97 lines - TEST_FIXTURE
- packages/core/src/agents/planner-prompts.ts: 97 lines - MACHINE_PROMPT_EN
- packages/core/src/__tests__/agent-play-tools.test.ts: 96 lines - TEST_FIXTURE
- packages/core/src/__tests__/phase5-cleanup.test.ts: 96 lines - TEST_FIXTURE
- packages/core/src/agents/settler-prompts.ts: 96 lines - MACHINE_PROMPT_EN
- packages/studio/src/api/server.ts: 95 lines - OTHER_LANGUAGE_DOC
- packages/core/src/__tests__/chapter-memo-parser.test.ts: 95 lines - TEST_FIXTURE
- packages/core/src/__tests__/state-review-confirm.test.ts: 91 lines - TEST_FIXTURE
- packages/core/src/__tests__/reviser.test.ts: 90 lines - TEST_FIXTURE
- packages/core/src/agents/chapter-analyzer.ts: 88 lines - MACHINE_PROMPT_EN
- packages/core/src/__tests__/agent-system-prompt.test.ts: 87 lines - TEST_FIXTURE
- packages/studio/src/components/chat/__tests__/PlayHud.test.ts: 84 lines - USER_UI_VI
- packages/core/src/llm/provider.ts: 74 lines - OTHER_LANGUAGE_DOC
- packages/core/src/__tests__/writer.test.ts: 72 lines - TEST_FIXTURE
- packages/core/src/__tests__/agent-session.test.ts: 67 lines - TEST_FIXTURE
- packages/core/src/__tests__/provider.test.ts: 67 lines - TEST_FIXTURE
- packages/core/src/__tests__/writer-parser.test.ts: 64 lines - TEST_FIXTURE
- packages/core/src/__tests__/hook-ledger-validator.test.ts: 64 lines - TECHNICAL_IDENTIFIER
- packages/core/src/__tests__/edit-controller.test.ts: 64 lines - TEST_FIXTURE
- packages/studio/src/lib/truth-display.test.ts: 63 lines - USER_UI_VI
- packages/core/src/play/play-agents.ts: 62 lines - OTHER_LANGUAGE_DOC
- packages/core/src/__tests__/composer.test.ts: 61 lines - TEST_FIXTURE
- packages/core/src/__tests__/planner.test.ts: 59 lines - TEST_FIXTURE
- packages/core/src/agent/agent-tools.ts: 59 lines - OTHER_LANGUAGE_DOC
- packages/core/src/agents/fanfic-canon-importer.ts: 57 lines - MACHINE_PROMPT_EN
- packages/core/src/utils/writing-methodology.ts: 56 lines - MACHINE_PROMPT_EN
- packages/core/src/agents/writer.ts: 55 lines - MACHINE_PROMPT_EN
- packages/core/src/__tests__/foundation-manifest.test.ts: 53 lines - TEST_FIXTURE
- packages/core/src/__tests__/architect-phase7.test.ts: 53 lines - TEST_FIXTURE
- packages/core/src/agents/planner.ts: 53 lines - MACHINE_PROMPT_EN
- packages/core/src/__tests__/foundation-reviewer.test.ts: 51 lines - TEST_FIXTURE
- packages/core/src/__tests__/pipeline-runner.gated.test.ts: 50 lines - TEST_FIXTURE
- packages/core/src/__tests__/short-fiction-public.test.ts: 48 lines - TEST_FIXTURE
- packages/core/src/__tests__/play-reducer.test.ts: 48 lines - TEST_FIXTURE
- packages/core/src/agents/composer.ts: 48 lines - MACHINE_PROMPT_EN
- packages/cli/src/__tests__/tui-agent-session.test.ts: 47 lines - TEST_FIXTURE
- packages/core/src/__tests__/play-models.test.ts: 47 lines - TEST_FIXTURE
- packages/core/src/__tests__/planner-prompts.test.ts: 47 lines - TEST_FIXTURE
- packages/studio/src/pages/page-state.test.ts: 46 lines - USER_UI_VI
- packages/core/genres/xuanhuan.md: 46 lines - LEGACY_COMPAT
- packages/core/src/__tests__/continuity.test.ts: 45 lines - TEST_FIXTURE
- packages/core/src/__tests__/book-session-store.test.ts: 44 lines - TEST_FIXTURE
- packages/core/src/__tests__/planner-context.test.ts: 43 lines - TEST_FIXTURE
- packages/core/src/__tests__/state-review-items.test.ts: 42 lines - TEST_FIXTURE
- packages/core/src/__tests__/short-fiction-resume.test.ts: 42 lines - TEST_FIXTURE
- packages/core/src/__tests__/canon-commit.test.ts: 42 lines - TEST_FIXTURE
- packages/core/src/__tests__/book-references.test.ts: 42 lines - TEST_FIXTURE
- packages/core/src/__tests__/state-review-future-progression.test.ts: 41 lines - TEST_FIXTURE
- packages/core/src/agents/observer-prompts.ts: 40 lines - MACHINE_PROMPT_EN
- CHANGELOG.en.md: 39 lines - DOC_VI
- packages/core/src/agents/fanfic-prompt-sections.ts: 39 lines - MACHINE_PROMPT_EN
- packages/core/src/__tests__/state-reducer.test.ts: 38 lines - TEST_FIXTURE
- packages/core/src/__tests__/persisted-governed-plan.test.ts: 38 lines - TEST_FIXTURE
- packages/core/src/models/book-rules.ts: 38 lines - TECHNICAL_IDENTIFIER
- packages/core/genres/urban.md: 36 lines - LEGACY_COMPAT
- packages/core/src/__tests__/forecast-context.test.ts: 35 lines - TEST_FIXTURE
- packages/core/src/__tests__/context-transform.test.ts: 35 lines - TEST_FIXTURE
- packages/core/src/agents/foundation-reviewer.ts: 35 lines - MACHINE_PROMPT_EN
- packages/core/src/__tests__/interaction-models.test.ts: 34 lines - TEST_FIXTURE
- packages/core/genres/horror.md: 34 lines - LEGACY_COMPAT
- packages/core/src/__tests__/state-review-historical.test.ts: 33 lines - TEST_FIXTURE
- packages/studio/src/__tests__/canon-edits-route.test.ts: 32 lines - TEST_FIXTURE
- packages/core/src/__tests__/agent-derivative-tools.test.ts: 32 lines - TEST_FIXTURE
- packages/core/src/__tests__/governance-conflicts.test.ts: 32 lines - TEST_FIXTURE
- packages/core/src/__tests__/chapter-delete.test.ts: 32 lines - TEST_FIXTURE
- packages/core/genres/xianxia.md: 32 lines - LEGACY_COMPAT
- packages/core/src/__tests__/play-image.test.ts: 31 lines - TEST_FIXTURE
- packages/core/src/forecast/render.ts: 29 lines - MACHINE_PROMPT_EN
- packages/core/src/__tests__/state-review-regenerate.test.ts: 29 lines - TEST_FIXTURE
- packages/core/src/__tests__/spot-fix-patches.test.ts: 29 lines - TEST_FIXTURE
- packages/core/src/__tests__/polisher.test.ts: 29 lines - TEST_FIXTURE
- packages/core/src/__tests__/memory-retrieval.test.ts: 29 lines - TEST_FIXTURE
- packages/core/src/__tests__/foundation-bootstrap.test.ts: 29 lines - TEST_FIXTURE
- packages/core/src/agents/planner-context.ts: 29 lines - MACHINE_PROMPT_EN
- packages/core/src/pipeline/script-storyboard-runner.ts: 29 lines - OTHER_LANGUAGE_DOC
- packages/core/src/agents/polisher.ts: 28 lines - MACHINE_PROMPT_EN
- packages/core/src/interaction/project-tools.ts: 28 lines - OTHER_LANGUAGE_DOC
- packages/core/src/play/play-runner.ts: 27 lines - OTHER_LANGUAGE_DOC
- packages/core/src/agents/sensitive-words.ts: 27 lines - MACHINE_PROMPT_EN
- packages/studio/src/__tests__/canon-route.test.ts: 26 lines - TEST_FIXTURE
- packages/core/src/__tests__/v13-hotfix-round4.test.ts: 26 lines - TEST_FIXTURE
- packages/core/src/__tests__/state-review-invalidate.test.ts: 26 lines - TEST_FIXTURE
- packages/core/src/__tests__/helpers/canon-fixture.ts: 26 lines - TEST_FIXTURE
- packages/core/src/__tests__/chapter-truth-validation.test.ts: 26 lines - TEST_FIXTURE
- docs/ARCHITECTURE_AUDIT.md: 25 lines - DOC_VI
- packages/studio/src/lib/truth-display.ts: 25 lines - USER_UI_VI
- packages/studio/src/api/phase5-hotfix.test.ts: 25 lines - OTHER_LANGUAGE_DOC
- packages/core/src/__tests__/play-store.test.ts: 25 lines - TEST_FIXTURE
- packages/core/src/__tests__/interaction-runtime.test.ts: 25 lines - TEST_FIXTURE
- packages/core/src/__tests__/helpers/forecast-fixture.ts: 25 lines - TEST_FIXTURE
- packages/studio/e2e/fixtures/seed-screenshot.ts: 24 lines - TEST_FIXTURE
- packages/core/src/forecast/prompts.ts: 24 lines - MACHINE_PROMPT_EN
- packages/core/src/__tests__/provider-minimax-thinking.test.ts: 24 lines - TEST_FIXTURE
- packages/core/src/utils/narrative-control.ts: 24 lines - OTHER_LANGUAGE_DOC
- packages/core/src/state/state-projections.ts: 24 lines - LEGACY_COMPAT
- packages/core/src/interaction/session-transcript-restore.ts: 24 lines - OTHER_LANGUAGE_DOC
- packages/studio/src/components/chat/__tests__/NarrativeForecastPreview.test.ts: 23 lines - USER_UI_VI
- packages/core/src/__tests__/state-review-decisions.test.ts: 23 lines - TEST_FIXTURE
- packages/core/src/__tests__/runtime-state-store.test.ts: 23 lines - TEST_FIXTURE
- packages/core/src/__tests__/providers-schema.test.ts: 23 lines - TEST_FIXTURE
- packages/core/src/__tests__/agent-import-chapters-tool.test.ts: 23 lines - TEST_FIXTURE
- packages/core/src/utils/hook-lifecycle.ts: 23 lines - TECHNICAL_IDENTIFIER
- packages/studio/e2e/fixtures/seed-analysis.ts: 23 lines - TEST_FIXTURE
- packages/core/src/__tests__/effective-llm-config.test.ts: 23 lines - TEST_FIXTURE
- assets/arch-memory.svg: 22 lines - USER_UI_VI
- packages/core/src/__tests__/local-search.test.ts: 22 lines - TEST_FIXTURE
- packages/core/src/agent/llm-stub.ts: 22 lines - OTHER_LANGUAGE_DOC
- packages/studio/e2e/fixtures/seed-film-wizard.ts: 21 lines - TEST_FIXTURE
- packages/core/src/__tests__/ai-tells.test.ts: 21 lines - TEST_FIXTURE
- packages/core/src/__tests__/phase5-hotfix.test.ts: 21 lines - TEST_FIXTURE
- packages/core/src/utils/chapter-memo-parser.ts: 21 lines - OTHER_LANGUAGE_DOC
- packages/core/src/__tests__/chapter-splitter.test.ts: 21 lines - TEST_FIXTURE
- assets/arch-system.svg: 20 lines - USER_UI_VI
- packages/studio/src/__tests__/state-review-route.test.ts: 20 lines - TEST_FIXTURE
- packages/studio/src/pages/state-review-ui-state.test.ts: 20 lines - USER_UI_VI
- packages/core/src/__tests__/writer-prompts.test.ts: 20 lines - TEST_FIXTURE
- packages/core/src/__tests__/sensitive-words.test.ts: 20 lines - TEST_FIXTURE
- packages/core/src/__tests__/long-span-fatigue.test.ts: 20 lines - TEST_FIXTURE
- packages/core/src/__tests__/chapter-state-recovery.test.ts: 20 lines - TEST_FIXTURE
- packages/core/src/llm/service-presets.ts: 20 lines - OTHER_LANGUAGE_DOC
- packages/core/src/utils/outline-paths.ts: 19 lines - OTHER_LANGUAGE_DOC
- packages/cli/src/__tests__/notify-option.test.ts: 18 lines - TEST_FIXTURE
- packages/core/src/__tests__/translation-ingest.test.ts: 18 lines - TEST_FIXTURE
- packages/core/src/__tests__/state-validator-agent.test.ts: 18 lines - TEST_FIXTURE
- packages/core/src/__tests__/state-projections.test.ts: 18 lines - TEST_FIXTURE
- packages/core/src/utils/story-markdown.ts: 18 lines - OTHER_LANGUAGE_DOC
- packages/core/src/utils/hook-ledger-validator.ts: 18 lines - TECHNICAL_IDENTIFIER
- packages/core/src/__tests__/forecast-runner.test.ts: 18 lines - TEST_FIXTURE
- packages/core/src/llm/providers/types.ts: 18 lines - OTHER_LANGUAGE_DOC
- packages/core/src/llm/providers/endpoints/bailian.ts: 18 lines - OTHER_LANGUAGE_DOC
- packages/studio/src/pages/story-state/story-state-model.test.ts: 17 lines - USER_UI_VI
- packages/core/src/__tests__/writer.deferred-save.test.ts: 17 lines - TEST_FIXTURE
- packages/core/src/__tests__/worker-agent.test.ts: 17 lines - TEST_FIXTURE
- packages/core/src/__tests__/settler-prompts.test.ts: 17 lines - TEST_FIXTURE
- packages/core/src/pipeline/short-fiction-runner.ts: 17 lines - OTHER_LANGUAGE_DOC
- packages/core/src/agents/radar.ts: 17 lines - MACHINE_PROMPT_EN
- packages/studio/e2e/fixtures/seed-graph.ts: 16 lines - TEST_FIXTURE
- packages/core/src/__tests__/providers-lookup.test.ts: 16 lines - TEST_FIXTURE
- packages/core/src/__tests__/outline-paths.test.ts: 16 lines - TEST_FIXTURE
- packages/core/src/play/play-image.ts: 16 lines - OTHER_LANGUAGE_DOC
- packages/core/src/interactive-film/validation.ts: 16 lines - OTHER_LANGUAGE_DOC
- assets/arch-pipeline.svg: 15 lines - USER_UI_VI
- packages/studio/src/store/chat/__tests__/message-parts.test.ts: 15 lines - TEST_FIXTURE
- packages/studio/src/store/chat/slices/message/runtime.test.ts: 15 lines - OTHER_LANGUAGE_DOC
- packages/studio/e2e/player.spec.ts: 15 lines - OTHER_LANGUAGE_DOC
- packages/core/src/utils/long-span-fatigue.ts: 15 lines - OTHER_LANGUAGE_DOC
- packages/core/src/__tests__/if-film-authoring-llm-tools.test.ts: 15 lines - TEST_FIXTURE
- packages/core/src/llm/providers/endpoints/volcengineCodingPlan.ts: 15 lines - OTHER_LANGUAGE_DOC
- packages/core/src/llm/providers/endpoints/ppio.ts: 15 lines - OTHER_LANGUAGE_DOC
- packages/cli/src/__tests__/chapter-command.test.ts: 14 lines - TEST_FIXTURE
- packages/cli/src/tui/__tests__/markdown.test.ts: 14 lines - USER_UI_VI
- packages/core/src/utils/hook-health.ts: 14 lines - LEGACY_COMPAT
- packages/core/src/agents/ai-tells.ts: 14 lines - MACHINE_PROMPT_EN
- packages/core/src/__tests__/if-review-plus.test.ts: 14 lines - TEST_FIXTURE
- packages/core/src/__tests__/if-emotion.test.ts: 14 lines - TEST_FIXTURE
- packages/core/src/__tests__/think-tag-stripper.test.ts: 13 lines - TEST_FIXTURE
- packages/core/src/__tests__/spinoff-foundation-context.test.ts: 13 lines - TEST_FIXTURE
- packages/core/src/__tests__/settler-delta-parser.test.ts: 13 lines - TEST_FIXTURE
- packages/core/src/__tests__/session-transcript.test.ts: 13 lines - TEST_FIXTURE
- packages/core/src/__tests__/agent-tools-en-language.test.ts: 13 lines - TEST_FIXTURE
- packages/core/src/__tests__/prose-revision.test.ts: 13 lines - TEST_FIXTURE
- packages/core/src/__tests__/play-db.test.ts: 13 lines - TEST_FIXTURE
- packages/core/src/__tests__/interaction-tools.test.ts: 13 lines - TEST_FIXTURE
- packages/core/src/__tests__/if-paths.test.ts: 13 lines - TEST_FIXTURE
- packages/core/src/__tests__/if-film-authoring-tools.test.ts: 13 lines - TEST_FIXTURE
- packages/core/src/__tests__/fanfic-canon-importer.test.ts: 13 lines - TEST_FIXTURE
- packages/core/src/__tests__/chapter-word-sync.test.ts: 13 lines - TEST_FIXTURE
- packages/core/src/agents/fanfic-dimensions.ts: 13 lines - MACHINE_PROMPT_EN
- packages/core/genres/other.md: 13 lines - LEGACY_COMPAT
- packages/core/src/agents/writer-parser.ts: 13 lines - MACHINE_PROMPT_EN
- packages/cli/src/__tests__/book-backup.test.ts: 12 lines - TEST_FIXTURE
- packages/studio/src/components/sidebar/ProgressSection.tsx: 12 lines - USER_UI_VI
- packages/cli/src/tui/local-commands.ts: 12 lines - USER_UI_VI
- packages/core/src/__tests__/state-manager.test.ts: 12 lines - TEST_FIXTURE
- packages/core/src/utils/pov-filter.ts: 12 lines - OTHER_LANGUAGE_DOC
- packages/core/src/utils/effective-llm-config.ts: 12 lines - OTHER_LANGUAGE_DOC
- packages/core/src/__tests__/list-models.test.ts: 12 lines - TEST_FIXTURE
- packages/core/src/llm/think-tag-stripper.ts: 12 lines - OTHER_LANGUAGE_DOC
- packages/core/src/forecast/context-builder.ts: 11 lines - MACHINE_PROMPT_EN
- packages/studio/e2e/fixtures/seed-authoring-confirm.ts: 11 lines - TEST_FIXTURE
- packages/core/src/__tests__/material-retrieval.test.ts: 11 lines - TEST_FIXTURE
- packages/studio/src/components/chat/__tests__/play-choices.test.ts: 10 lines - USER_UI_VI
- packages/studio/e2e/fixtures/seed-export.ts: 10 lines - TEST_FIXTURE
- packages/core/src/__tests__/verify-service.test.ts: 10 lines - TEST_FIXTURE
- packages/core/src/__tests__/state-bootstrap-forward-head.test.ts: 10 lines - TEST_FIXTURE
- packages/core/src/utils/hook-promotion.ts: 10 lines - TECHNICAL_IDENTIFIER
- packages/core/src/utils/context-filter.ts: 10 lines - OTHER_LANGUAGE_DOC
- packages/core/src/__tests__/long-form-completion.test.ts: 10 lines - TEST_FIXTURE
- packages/core/src/__tests__/chapter-workspace.test.ts: 10 lines - TEST_FIXTURE
- packages/core/src/__tests__/canon-service.test.ts: 10 lines - TEST_FIXTURE
- packages/core/src/llm/providers/endpoints/spark.ts: 10 lines - OTHER_LANGUAGE_DOC
- packages/core/src/foundation/pipeline.ts: 10 lines - OTHER_LANGUAGE_DOC
- packages/core/src/llm/providers/endpoints/astronCodingPlan.ts: 10 lines - OTHER_LANGUAGE_DOC
- packages/cli/src/__tests__/tui-local-commands.test.ts: 9 lines - TEST_FIXTURE
- packages/cli/src/__tests__/analytics.test.ts: 9 lines - TEST_FIXTURE
- packages/studio/src/components/sidebar/CharacterSection.tsx: 9 lines - USER_UI_VI
- packages/core/src/__tests__/style-analyzer.test.ts: 9 lines - TEST_FIXTURE
- packages/core/src/__tests__/state-review-schema.test.ts: 9 lines - TEST_FIXTURE
- packages/studio/src/api/task-store.test.ts: 9 lines - OTHER_LANGUAGE_DOC
- packages/core/src/utils/memory-retrieval.ts: 9 lines - OTHER_LANGUAGE_DOC
- packages/studio/e2e/fixtures/seed-authoring.ts: 9 lines - TEST_FIXTURE
- packages/core/src/__tests__/models.test.ts: 9 lines - TEST_FIXTURE
- packages/core/src/agent/context-transform.ts: 9 lines - OTHER_LANGUAGE_DOC
- packages/core/src/__tests__/if-film-context.test.ts: 9 lines - TEST_FIXTURE
- packages/core/src/llm/providers/lookup.ts: 9 lines - OTHER_LANGUAGE_DOC
- packages/core/src/llm/providers/endpoints/siliconcloud.ts: 9 lines - OTHER_LANGUAGE_DOC
- packages/core/src/llm/providers/endpoints/openrouter.ts: 9 lines - OTHER_LANGUAGE_DOC
- packages/core/src/llm/providers/endpoints/deepseek.ts: 9 lines - OTHER_LANGUAGE_DOC
- packages/core/src/llm/providers/endpoints/custom.ts: 9 lines - OTHER_LANGUAGE_DOC
- packages/core/src/agents/short-fiction.ts: 9 lines - MACHINE_PROMPT_EN
- scripts/audit-semantic-patterns.mjs: 8 lines - OTHER_LANGUAGE_DOC
- packages/studio/src/__tests__/story-graph-export-endpoints.test.ts: 8 lines - TEST_FIXTURE
- packages/core/src/__tests__/translation-runner.test.ts: 8 lines - TEST_FIXTURE
- packages/core/src/__tests__/agent-tools-params.test.ts: 8 lines - TEST_FIXTURE
- packages/core/src/__tests__/play-file-db.test.ts: 8 lines - TEST_FIXTURE
- packages/core/src/__tests__/notify-format.test.ts: 8 lines - TEST_FIXTURE
- packages/core/src/agent/agent-session.ts: 8 lines - OTHER_LANGUAGE_DOC
- packages/core/src/__tests__/if-film-en-language.test.ts: 8 lines - TEST_FIXTURE
- packages/core/src/__tests__/forecast-schema.test.ts: 8 lines - TEST_FIXTURE
- packages/core/src/__tests__/chapter-review-cycle.test.ts: 8 lines - TEST_FIXTURE
- packages/core/src/agents/researcher.ts: 8 lines - MACHINE_PROMPT_EN
- packages/core/src/agents/style-analyzer.ts: 8 lines - MACHINE_PROMPT_EN
- packages/cli/src/__tests__/cli-integration.test.ts: 7 lines - TEST_FIXTURE
- packages/core/src/__tests__/skill-agent-tool.test.ts: 7 lines - TEST_FIXTURE
- packages/core/src/__tests__/short-fiction-en.test.ts: 7 lines - TEST_FIXTURE
- packages/core/src/__tests__/researcher.test.ts: 7 lines - TEST_FIXTURE
- packages/core/src/__tests__/probe.test.ts: 7 lines - TEST_FIXTURE
- packages/core/src/utils/chapter-splitter.ts: 7 lines - OTHER_LANGUAGE_DOC
- packages/core/src/__tests__/if-export-ink.test.ts: 7 lines - TEST_FIXTURE
- packages/core/src/__tests__/forecast-tools.test.ts: 7 lines - TEST_FIXTURE
- packages/core/src/pipeline/chapter-state-recovery.ts: 7 lines - OTHER_LANGUAGE_DOC
- packages/core/src/pipeline/chapter-review-cycle.ts: 7 lines - OTHER_LANGUAGE_DOC
- packages/core/src/interaction/action-envelope.ts: 7 lines - OTHER_LANGUAGE_DOC
- packages/core/src/agents/radar-source.ts: 7 lines - MACHINE_PROMPT_EN
- skills/SKILL.md: 6 lines - USER_UI_VI
- packages/cli/src/__tests__/tui-dashboard.test.tsx: 6 lines - TEST_FIXTURE
- packages/studio/src/hooks/use-hash-route.test.ts: 6 lines - USER_UI_VI
- packages/studio/e2e/authoring-confirm.spec.ts: 6 lines - OTHER_LANGUAGE_DOC
- packages/core/src/utils/governed-context.ts: 6 lines - OTHER_LANGUAGE_DOC
- packages/core/src/__tests__/material-ingestion.test.ts: 6 lines - TEST_FIXTURE
- packages/core/src/__tests__/legacy-v2-upgrade-e2e.test.ts: 6 lines - TEST_FIXTURE
- packages/core/src/__tests__/if-export-html.test.ts: 6 lines - TEST_FIXTURE
- packages/core/src/__tests__/hook-promotion.test.ts: 6 lines - TECHNICAL_IDENTIFIER
- packages/core/src/__tests__/governed-working-set.test.ts: 6 lines - TEST_FIXTURE
- packages/core/src/__tests__/forecast-agent.test.ts: 6 lines - TEST_FIXTURE
- packages/core/src/__tests__/consolidator.test.ts: 6 lines - TEST_FIXTURE
- packages/core/src/__tests__/book-foundation-complete.test.ts: 6 lines - TEST_FIXTURE
- packages/core/src/state/manager.ts: 6 lines - TECHNICAL_IDENTIFIER
- packages/core/src/llm/providers/endpoints/zhipu.ts: 6 lines - OTHER_LANGUAGE_DOC
- packages/core/src/llm/providers/endpoints/xiaomimimo.ts: 6 lines - OTHER_LANGUAGE_DOC
- packages/core/src/llm/providers/endpoints/ollama.ts: 6 lines - OTHER_LANGUAGE_DOC
- packages/core/src/llm/providers/endpoints/newapi.ts: 6 lines - OTHER_LANGUAGE_DOC
- packages/core/src/llm/providers/endpoints/minimax.ts: 6 lines - OTHER_LANGUAGE_DOC
- packages/core/src/llm/providers/endpoints/kkaiapi.ts: 6 lines - OTHER_LANGUAGE_DOC
- packages/core/src/interactive-film/film-context.ts: 6 lines - OTHER_LANGUAGE_DOC
- packages/studio/src/__tests__/story-flow-layout.test.ts: 5 lines - TEST_FIXTURE
- packages/studio/src/__tests__/film-wizard-progress.test.ts: 5 lines - TEST_FIXTURE
- packages/cli/src/tui/agent-input.ts: 5 lines - MACHINE_PROMPT_EN
- packages/studio/e2e/authoring.spec.ts: 5 lines - OTHER_LANGUAGE_DOC
- packages/studio/e2e/fixtures/seed-flow.ts: 5 lines - TEST_FIXTURE
- packages/core/src/__tests__/state-review-store.test.ts: 5 lines - TEST_FIXTURE
- packages/core/src/__tests__/state-reducer.manual-edit.test.ts: 5 lines - TEST_FIXTURE
- packages/core/src/__tests__/short-fiction-craft.test.ts: 5 lines - TEST_FIXTURE
- packages/core/src/__tests__/secrets-migration.test.ts: 5 lines - TEST_FIXTURE
- packages/core/src/utils/hook-stale-detection.ts: 5 lines - TECHNICAL_IDENTIFIER
- packages/core/src/__tests__/phase5-acceptance.test.ts: 5 lines - TEST_FIXTURE
- packages/core/src/__tests__/length-metrics.test.ts: 5 lines - TEST_FIXTURE
- packages/core/src/agent/film-authoring-tools.ts: 5 lines - OTHER_LANGUAGE_DOC
- packages/core/src/__tests__/if-schema-phase2.test.ts: 5 lines - TEST_FIXTURE
- packages/core/src/__tests__/book-eval.test.ts: 5 lines - TEST_FIXTURE
- packages/core/src/pipeline/persisted-governed-plan.ts: 5 lines - OTHER_LANGUAGE_DOC
- packages/core/src/llm/providers/verify.ts: 5 lines - OTHER_LANGUAGE_DOC
- packages/core/src/interaction/draft-directive-parser.ts: 5 lines - OTHER_LANGUAGE_DOC
- packages/core/src/llm/providers/endpoints/zeroone.ts: 5 lines - OTHER_LANGUAGE_DOC
- packages/core/src/llm/providers/endpoints/wenxin.ts: 5 lines - OTHER_LANGUAGE_DOC
- packages/core/src/llm/providers/endpoints/volcengine.ts: 5 lines - OTHER_LANGUAGE_DOC
- packages/core/src/llm/providers/endpoints/tencentcloud.ts: 5 lines - OTHER_LANGUAGE_DOC
- packages/core/src/llm/providers/endpoints/stepfun.ts: 5 lines - OTHER_LANGUAGE_DOC
- packages/core/src/llm/providers/endpoints/sensenova.ts: 5 lines - OTHER_LANGUAGE_DOC
- packages/core/src/llm/providers/endpoints/qiniu.ts: 5 lines - OTHER_LANGUAGE_DOC
- packages/core/src/llm/providers/endpoints/moonshot.ts: 5 lines - OTHER_LANGUAGE_DOC
- packages/core/src/llm/providers/endpoints/modelscope.ts: 5 lines - OTHER_LANGUAGE_DOC
- packages/core/src/llm/providers/endpoints/bailianCodingPlan.ts: 5 lines - OTHER_LANGUAGE_DOC
- packages/core/src/llm/providers/endpoints/baichuan.ts: 5 lines - OTHER_LANGUAGE_DOC
- packages/core/src/llm/providers/endpoints/internlm.ts: 5 lines - OTHER_LANGUAGE_DOC
- packages/core/src/llm/providers/endpoints/anthropic.ts: 5 lines - OTHER_LANGUAGE_DOC
- packages/core/src/llm/providers/endpoints/infiniai.ts: 5 lines - OTHER_LANGUAGE_DOC
- packages/core/src/llm/providers/endpoints/ai360.ts: 5 lines - OTHER_LANGUAGE_DOC
- packages/core/src/llm/providers/endpoints/hunyuan.ts: 5 lines - OTHER_LANGUAGE_DOC
- packages/core/src/llm/providers/endpoints/google.ts: 5 lines - OTHER_LANGUAGE_DOC
- packages/core/src/interactive-film/emotion.ts: 5 lines - OTHER_LANGUAGE_DOC
- packages/core/src/interactive-film/generate.ts: 5 lines - OTHER_LANGUAGE_DOC
- packages/studio/src/__tests__/service-groups-i18n.test.ts: 4 lines - TEST_FIXTURE
- packages/studio/src/__tests__/authoring-confirm-flow.test.ts: 4 lines - TEST_FIXTURE
- packages/cli/src/__tests__/revision-command.test.ts: 4 lines - TEST_FIXTURE
- packages/studio/src/components/sidebar/PendingHooksView.tsx: 4 lines - USER_UI_VI
- packages/studio/e2e/fixtures/seed-validation.ts: 4 lines - TEST_FIXTURE
- packages/studio/e2e/fixtures/seed-flow-editor.ts: 4 lines - TEST_FIXTURE
- packages/studio/e2e/fixtures/seed-film-image.ts: 4 lines - TEST_FIXTURE
- packages/core/src/__tests__/translation-llm-model.test.ts: 4 lines - TEST_FIXTURE
- packages/core/src/__tests__/service-resolver.test.ts: 4 lines - TEST_FIXTURE
- packages/core/src/__tests__/planning-materials.test.ts: 4 lines - TEST_FIXTURE
- packages/core/src/agents/consolidator.ts: 4 lines - MACHINE_PROMPT_EN
- packages/core/src/utils/chapter-cadence.ts: 4 lines - OTHER_LANGUAGE_DOC
- packages/core/src/__tests__/instruction-adherence-boundary.test.ts: 4 lines - TEST_FIXTURE
- packages/core/src/__tests__/if-schema.test.ts: 4 lines - TEST_FIXTURE
- packages/core/src/__tests__/if-node-image.test.ts: 4 lines - TEST_FIXTURE
- packages/core/src/__tests__/if-memory-link.test.ts: 4 lines - TEST_FIXTURE
- packages/core/src/__tests__/if-authoring-builders.test.ts: 4 lines - TEST_FIXTURE
- packages/core/src/__tests__/foundation-pipeline.test.ts: 4 lines - TEST_FIXTURE
- packages/core/src/__tests__/forecast-store.test.ts: 4 lines - TEST_FIXTURE
- packages/core/src/__tests__/config-loader.test.ts: 4 lines - TEST_FIXTURE
- packages/core/src/__tests__/chapter-import-source.test.ts: 4 lines - TEST_FIXTURE
- packages/core/src/models/project.ts: 4 lines - LEGACY_COMPAT
- packages/core/src/models/book.ts: 4 lines - TECHNICAL_IDENTIFIER
- packages/core/src/llm/providers/endpoints/xai.ts: 4 lines - OTHER_LANGUAGE_DOC
- packages/core/src/llm/providers/endpoints/openai.ts: 4 lines - OTHER_LANGUAGE_DOC
- packages/core/src/llm/providers/endpoints/mistral.ts: 4 lines - OTHER_LANGUAGE_DOC
- packages/core/src/llm/providers/endpoints/longcat.ts: 4 lines - OTHER_LANGUAGE_DOC
- packages/core/src/interactive-film/export-html.ts: 4 lines - OTHER_LANGUAGE_DOC
- packages/cli/src/__tests__/write-command.test.ts: 3 lines - TEST_FIXTURE
- packages/studio/src/pages/service-detail-state.test.ts: 3 lines - USER_UI_VI
- packages/studio/src/components/sidebar/SummarySection.tsx: 3 lines - USER_UI_VI
- packages/studio/src/api/book-create.test.ts: 3 lines - OTHER_LANGUAGE_DOC
- packages/core/src/__tests__/short-run-length-validation.test.ts: 3 lines - TEST_FIXTURE
- packages/core/src/__tests__/providers-group.test.ts: 3 lines - TEST_FIXTURE
- packages/core/src/__tests__/language.test.ts: 3 lines - TEST_FIXTURE
- packages/core/src/__tests__/if-delta.test.ts: 3 lines - TEST_FIXTURE
- packages/core/src/__tests__/if-authoring-store.test.ts: 3 lines - TEST_FIXTURE
- packages/core/src/__tests__/hook-stale-detection.test.ts: 3 lines - TECHNICAL_IDENTIFIER
- packages/core/src/__tests__/hook-health.test.ts: 3 lines - TECHNICAL_IDENTIFIER
- packages/core/src/__tests__/hook-governance.test.ts: 3 lines - TECHNICAL_IDENTIFIER
- packages/core/src/__tests__/book-id.test.ts: 3 lines - TEST_FIXTURE
- packages/core/src/pipeline/detection-runner.ts: 3 lines - OTHER_LANGUAGE_DOC
- packages/core/src/pipeline/chapter-truth-validation.ts: 3 lines - OTHER_LANGUAGE_DOC
- packages/core/src/llm/providers/index.ts: 3 lines - OTHER_LANGUAGE_DOC
- packages/core/src/interaction/book-session-store.ts: 3 lines - OTHER_LANGUAGE_DOC
- packages/core/src/llm/providers/endpoints/giteeai.ts: 3 lines - OTHER_LANGUAGE_DOC
- packages/core/src/llm/providers/endpoints/kimiCodingPlan.ts: 3 lines - OTHER_LANGUAGE_DOC
- packages/core/src/llm/providers/endpoints/glmCodingPlan.ts: 3 lines - OTHER_LANGUAGE_DOC
- packages/core/src/llm/providers/endpoints/githubCopilot.ts: 3 lines - OTHER_LANGUAGE_DOC
- packages/core/src/agents/settler-parser.ts: 3 lines - MACHINE_PROMPT_EN
- docs/superpowers/plans/2026-08-24-human-governed-post-chapter-state-review.md: 2 lines - DOC_VI
- packages/cli/src/__tests__/write-phase5.test.ts: 2 lines - TEST_FIXTURE
- packages/cli/src/__tests__/progress-text.test.ts: 2 lines - TEST_FIXTURE
- packages/studio/src/store/chat/message-policy.test.ts: 2 lines - OTHER_LANGUAGE_DOC
- packages/studio/src/components/chatbar-state.test.ts: 2 lines - USER_UI_VI
- packages/core/src/__tests__/state-validator.test.ts: 2 lines - TEST_FIXTURE
- packages/core/src/__tests__/secrets.test.ts: 2 lines - TEST_FIXTURE
- packages/core/src/utils/planning-materials.ts: 2 lines - OTHER_LANGUAGE_DOC
- packages/core/src/__tests__/planner-prompts-ratio.test.ts: 2 lines - TEST_FIXTURE
- packages/core/src/utils/length-metrics.ts: 2 lines - OTHER_LANGUAGE_DOC
- packages/core/src/utils/governed-working-set.ts: 2 lines - OTHER_LANGUAGE_DOC
- packages/studio/e2e/film-list.spec.ts: 2 lines - OTHER_LANGUAGE_DOC
- packages/core/src/utils/book-eval.ts: 2 lines - OTHER_LANGUAGE_DOC
- packages/core/src/__tests__/logger.test.ts: 2 lines - TEST_FIXTURE
- packages/core/src/__tests__/llm-stub.test.ts: 2 lines - TEST_FIXTURE
- packages/core/src/agent/chapter-import-source.ts: 2 lines - OTHER_LANGUAGE_DOC
- packages/core/src/__tests__/if-review.test.ts: 2 lines - TEST_FIXTURE
- packages/core/src/__tests__/if-film-confirm-tools.test.ts: 2 lines - TEST_FIXTURE
- packages/core/src/__tests__/governance-readiness.test.ts: 2 lines - TEST_FIXTURE
- packages/core/src/__tests__/external-skill-loader.test.ts: 2 lines - TEST_FIXTURE
- packages/core/src/__tests__/canon-edits.test.ts: 2 lines - TEST_FIXTURE
- packages/core/src/llm/providers/probe.ts: 2 lines - OTHER_LANGUAGE_DOC
- packages/core/src/governance/authorizations.ts: 2 lines - OTHER_LANGUAGE_DOC
- packages/core/src/llm/providers/endpoints/opencodeCodingPlan.ts: 2 lines - OTHER_LANGUAGE_DOC
- packages/core/src/llm/providers/endpoints/minimaxCodingPlan.ts: 2 lines - OTHER_LANGUAGE_DOC
- .gitignore: 1 lines - OTHER_LANGUAGE_DOC
- audit_phase1.py: 1 lines - OTHER_LANGUAGE_DOC
- docs/IMPLEMENTATION_PLAN.md: 1 lines - DOC_VI
- docs/superpowers/plans/2026-08-29-castor-ui-localization.md: 1 lines - DOC_VI
- docs/superpowers/plans/2026-08-29-castor-machine-prompt-language-migration.md: 1 lines - DOC_VI
- docs/superpowers/plans/2026-08-27-phase-5-foundation-planning-intelligence.md: 1 lines - DOC_VI
- README.md: 1 lines - DOC_VI
- README.en.md: 1 lines - DOC_VI
- packages/studio/src/__tests__/story-graph-analysis-endpoint.test.ts: 1 lines - TEST_FIXTURE
- packages/studio/src/__tests__/story-editor-deltas.test.ts: 1 lines - TEST_FIXTURE
- packages/cli/src/__tests__/write-review-mode.test.ts: 1 lines - TEST_FIXTURE
- packages/studio/src/__tests__/film-image-endpoint.test.ts: 1 lines - TEST_FIXTURE
- packages/cli/src/__tests__/localization.test.ts: 1 lines - TEST_FIXTURE
- packages/cli/src/__tests__/genre-command.test.ts: 1 lines - TEST_FIXTURE
- packages/cli/src/__tests__/auto-command.test.ts: 1 lines - TEST_FIXTURE
- packages/cli/src/commands/doctor.ts: 1 lines - USER_UI_VI
- packages/cli/src/commands/config.ts: 1 lines - USER_UI_VI
- packages/cli/src/commands/agent.ts: 1 lines - MACHINE_PROMPT_EN
- packages/studio/e2e/film-image.spec.ts: 1 lines - OTHER_LANGUAGE_DOC
- packages/studio/e2e/export.spec.ts: 1 lines - OTHER_LANGUAGE_DOC
- packages/core/src/__tests__/webhook.test.ts: 1 lines - TECHNICAL_IDENTIFIER
- packages/core/src/__tests__/state-review-gate.test.ts: 1 lines - TEST_FIXTURE
- packages/core/src/__tests__/service-presets-regression.test.ts: 1 lines - TEST_FIXTURE
- packages/core/src/utils/language.ts: 1 lines - TECHNICAL_IDENTIFIER
- packages/core/src/__tests__/memory-sync.test.ts: 1 lines - TEST_FIXTURE
- packages/core/src/utils/analytics.ts: 1 lines - OTHER_LANGUAGE_DOC
- packages/core/src/agent/forecast-tools.ts: 1 lines - OTHER_LANGUAGE_DOC
- packages/core/src/__tests__/if-node-image-tool.test.ts: 1 lines - TEST_FIXTURE
- packages/core/skills/castor-translation/SKILL.md: 1 lines - OTHER_LANGUAGE_DOC
- packages/core/src/__tests__/if-authoring-envelope.test.ts: 1 lines - TEST_FIXTURE
- packages/core/skills/castor-storyboard/SKILL.md: 1 lines - OTHER_LANGUAGE_DOC
- packages/core/src/__tests__/governance-versions.test.ts: 1 lines - TEST_FIXTURE
- packages/core/skills/castor-story-review/SKILL.md: 1 lines - OTHER_LANGUAGE_DOC
- packages/core/src/__tests__/governance-dependencies.test.ts: 1 lines - TEST_FIXTURE
- packages/core/skills/castor-story-import/SKILL.md: 1 lines - OTHER_LANGUAGE_DOC
- packages/core/skills/castor-story-deslop/SKILL.md: 1 lines - OTHER_LANGUAGE_DOC
- packages/core/skills/castor-story-cover/SKILL.md: 1 lines - OTHER_LANGUAGE_DOC
- packages/core/src/__tests__/fanfic-dimensions.test.ts: 1 lines - TEST_FIXTURE
- packages/core/skills/castor-short-writing/SKILL.md: 1 lines - OTHER_LANGUAGE_DOC
- packages/core/skills/castor-short-story-analysis/SKILL.md: 1 lines - OTHER_LANGUAGE_DOC
- packages/core/src/__tests__/context-filter.test.ts: 1 lines - TEST_FIXTURE
- packages/core/skills/castor-short-market-research/SKILL.md: 1 lines - OTHER_LANGUAGE_DOC
- packages/core/skills/castor-script-writing/SKILL.md: 1 lines - OTHER_LANGUAGE_DOC
- packages/core/skills/castor-play-world/SKILL.md: 1 lines - OTHER_LANGUAGE_DOC
- packages/core/src/__tests__/chapter-analyzer.test.ts: 1 lines - TEST_FIXTURE
- packages/core/skills/castor-long-writing/SKILL.md: 1 lines - OTHER_LANGUAGE_DOC
- packages/core/skills/castor-long-story-analysis/SKILL.md: 1 lines - OTHER_LANGUAGE_DOC
- packages/core/skills/castor-long-market-research/SKILL.md: 1 lines - OTHER_LANGUAGE_DOC
- packages/core/skills/castor-interactive-film/SKILL.md: 1 lines - OTHER_LANGUAGE_DOC
- packages/core/src/state/chapter-delete.ts: 1 lines - TECHNICAL_IDENTIFIER
- packages/core/src/state/memory-db.ts: 1 lines - TECHNICAL_IDENTIFIER
- packages/core/src/play/play-reducer.ts: 1 lines - OTHER_LANGUAGE_DOC
- packages/core/src/models/play.ts: 1 lines - TECHNICAL_IDENTIFIER
- packages/core/src/interaction/project-control.ts: 1 lines - OTHER_LANGUAGE_DOC
- packages/core/src/interaction/edit-controller.ts: 1 lines - OTHER_LANGUAGE_DOC
- packages/core/src/foundation/manifest.ts: 1 lines - OTHER_LANGUAGE_DOC
- packages/core/src/foundation/bootstrap.ts: 1 lines - OTHER_LANGUAGE_DOC
- packages/core/src/llm/providers/endpoints/lmstudio.ts: 1 lines - OTHER_LANGUAGE_DOC
- packages/core/src/llm/long-form-completion.ts: 1 lines - OTHER_LANGUAGE_DOC
- packages/core/src/agents/state-validator.ts: 1 lines - MACHINE_PROMPT_EN

## Quality gates (clean HEAD)

- `rg -n --hidden --glob '!node_modules' --glob '!dist' 'ViText[0-9]*|VietText[0-9]*|DummyVietnamese|PLACEHOLDER' packages README.md docs` => **0** (no fake placeholders in clean HEAD - correct)
- `rg -n --hidden --glob '!node_modules' --glob '!dist' 'Chuong|Nhiem vu|Khong|Kiem tra|Vi tri|Huyen Ao' packages/studio packages/cli` => **0** on clean HEAD (no ASCII fake Vietnamese in product code - correct, because clean HEAD still has Chinese Han, not fake Vietnamese)
- Rejected stash had many ViText and Chuong etc. -> evidence of bad bulk.

## Correct Vietnamese examples (GOOD vs BAD)

| BAD (ASCII fake) | GOOD (có dấu) | File ví dụ |
|------------------|---------------|------------|
| Chuong | Chương | `assets/arch-pipeline.svg:24` `章节生产管线` -> `Dây chuyền sản xuất chương` |
| Nhiem vu | Nhiệm vụ | `writer.ts: verifyPreWriteCheck` `当前任务` -> `Nhiệm vụ hiện tại` |
| Khong lam | Không làm | `writer.ts` `不要做` -> `Không làm` |
| Kiem tra | Kiểm tra | `continuity.ts` `OOC检查` -> `Kiểm tra OOC` |
| Vi tri hien tai | Vị trí hiện tại | `state-projections.ts` `当前位置` -> `Vị trí hiện tại` |
| Huyen Ao | Huyền Ảo | `genres/xuanhuan.md` `玄幻` -> `Huyền Ảo` |
| Chien Dau | Chiến Đấu | `genres/xuanhuan.md` `战斗章` -> `Chương Chiến Đấu` |

Machine prompts must be English canonical, e.g.:

- `polisher.ts: buildChineseSystemPrompt()` Chinese `你是一位专业中文网文文字层润色编辑...` -> English `You are a professional English web-fiction prose polisher...` (already has en version, copy it)
- `continuity.ts: Dimension 1 zh "OOC检查"` -> keep `vi: "Kiểm tra OOC"` for UI, but system prompt `OOC模式下...` -> English `In OOC mode, personality drift can be intentional;...`

## Legacy compatibility (escaped \uXXXX) - only where required

- `packages/core/src/models/book.ts` `raw.includes("番茄")` -> `raw.includes("\u756a\u8304")` (keeps reading old books with platform "番茄")
- `packages/core/src/utils/story-markdown.ts` headers `章节` -> `"\u7ae0\u8282"` escaped, booleans `是/否` -> `"\u662f"/"\u5426"` - needed to parse old markdown files
- `packages/core/genres/*.md` - if genre templates are legacy Chinese, should be translated to Vietnamese with diacritics, not escaped. Only keep escaped if genre must support old books. Proposed: translate genre files to Vietnamese (as above).
- Do NOT use escaped to pretend translation: `"\u7ae0\u8282"` is not Vietnamese, it's Chinese escaped.

## Japanese docs

- `README.ja.md` (256 Han lines, Kanji + Kana) is correctly Japanese. It is **not** Chinese Han to be removed. The rejected bulk romanized it to Romaji (`Nihongo no setsumei...`), which destroys correct Japanese.
- **Question for Human:** `README.ja.md` is a Japanese translation of the Vietnamese/English README. Should we keep it as is (correct Japanese with Kanji), or remove it if no longer maintained? Current clean HEAD keeps it. Proposed: **keep** and exclude from Han eradication metric, or explicitly mark as `OTHER_LANGUAGE_DOC` excluded. Do not romanize.

## Phase 1 conclusion

- Clean HEAD has **11622 Han lines** across 455 files, classified above.
- No production code has been modified yet in this Phase 1 (working tree is clean, only `PHASE1_AUDIT_REPORT.md` is untracked).
- Next step requires Human approval to proceed to Phase 2 slices.

## Phase 2 plan (small slices, TDD)

Recommended order (as per spec):

A. Studio user-facing Vietnamese (ví dụ `packages/studio/src/api/server.ts:327-332` `## 后台任务状态` -> `## Trạng thái tác vụ nền` with diacritics, `本会话有一个正在后台运行...` -> `Phiên này có một tác vụ đang chạy nền...`)
   - TDD: update `server.test.ts` expectation, verify `tr("Tiến độ","Progress")` already correct
   - After: `pnpm --filter @actalk/castor-studio typecheck && pnpm --filter @actalk/castor-studio build`

B. CLI / TUI / Doctor Vietnamese (`packages/cli/src/commands/*`, `tui/i18n.ts`)
   - Example: `tui/local-commands.ts` `帮助` -> already has `giúp`, but need to ensure `Tiếng Việt` with diacritics, not `Tieng Viet`
   - After: `pnpm --filter @actalk/castor typecheck` etc.

C. README / active docs Vietnamese (`README.md` already Vietnamese, `CHANGELOG.md` Chinese parts -> Vietnamese)
D. Test fixtures (`packages/core/src/__tests__/*` Chinese prose `这是一段测试文本` -> `Đây là đoạn văn bản kiểm thử` with diacritics)
E. Machine prompts family-by-family to English canonical (`polisher.ts`, `continuity.ts`, `writer-prompts.ts` etc. - copy en branch, do not bulk)
F. Legacy compatibility cleanup (only where `rg` shows active product still depends on Chinese headers)

Each slice will be committed separately, with targeted tests, typecheck, build.

Quality gates before final acceptance:
- `rg 'ViText|VietText|DummyVietnamese|PLACEHOLDER' packages` => 0
- Manual inspection for `Chuong` etc. => 0 in user-facing files (identifiers like `chuong` variable are ok)
- `pnpm typecheck` PASS, `pnpm build` PASS, relevant tests PASS

No push/tag/release will be done.

---
*Audit generated from clean HEAD (7278b4b) via `audit_phase1.py` + manual inspection of stash `backup-bad-bulk-han-cleanup`.*

