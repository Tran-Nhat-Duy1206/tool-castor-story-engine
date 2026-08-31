# Changelog

[English](CHANGELOG.en.md) | Tiếng Việt

## v1.8.0

### Release Focus

 Pi Agent Harness ：Studio Chat、TUI、 Agent  worker  pi-agent 、 action/result、Skill 、。Pipeline ， Agent 。

### Agent Harness And Skills

-  production harness，、、、、、Play 、、、
-  15  `SKILL.md` ， / 、、Play、、、、、、、、 AI 
- Production worker  pi-agent harness  Skill； Skill ，
- Agent  run / tool / model ， kkaiapi 、

### Context, Retrieval, And Persistence

-  SQLite FTS5 / BM25 ，、 Skill ，
- ：， Planner / Composer / Writer 
- ；、、，
- 、 inactive stream ，、

### Production And Workbench

- ，、，
- Short、、、、Play  Skill、、
- Studio ，、；、
-  LM Studio ； /  ID、 Base URL  Token / 
- TUI  `/new`、`/short`、`/play`、`/cover`、`/write` ， `/confirm` / `/cancel`， `/model` ； Agent 
-  Node.js 22，CI / Release  Node 22 / 24

## v1.7.2

### Release Focus

Agent Skills  Skill ：castor  `SKILL.md` ，Chat Agent ， `+`  `@skill-id` 。 castor  Skill 、，。

### Agent Skills

-  pi-agent  `use_skill`： Skill ，
- Studio  `SKILL.md` ， `.agents/skills/`；
-  `skills/`、`.agents/skills/`， `~/.agents/skills/`、`~/.openclaw/skills/` 
-  Chat  Skill；
- Studio  Skill ， Skill； Agent 

### Compatibility

-  `.castor/skills` ， `whenToUse`、`promptPacks`、`toolHints`、`contextNeeds`  castor 
-  Studio“ → ”， Skill 
-  Skill ： `SKILL.md` ， Studio  `.agents/skills/`

## v1.7.1

### Release Focus

 Studio ：、；，、。，，、、，。

### Major Features

- ： 2-5 ，、、、、
- Studio Chat ，、； `selected-branch-plan.md`，、、
- CLI  `castor forecast create / show / select`， Core  schema、、、agent  runner 
-  / ；，

### Collaboration And Task Reliability

- `write_next`  Studio ；， Chat
-  execution id ，；
- 、、
- ；，
- ，； tool result 

### Data Safety And Compatibility

- ，
-  runner ，
-  Play 、 transcript 
-  Xiaomi MiMo API ， Studio ， task id 

## v1.7.0

### Release Focus

： / ，、、、、Studio  CLI。，Chat 、、，。

### Major Features

-  / ： EPUB、 PDF、TXT  Markdown，，， TXT、Markdown  EPUB
- Studio ： / ，、、、
- CLI  `castor translate init / run / export`；Studio Chat ， `zh`、`en` 
- 、、；Studio  CLI ， UI 
- Chat  `import_chapters` ： / ，； `ingest_material` （#324）

### Collaboration And Control

-  `writing.revisionGate`： strict、lenient、always ，；（#326）
- CLI  `writing.reviewMode`； `castor auto [book-id] <>` （#307）
- ；`write next / write rewrite / auto / revise / audit`  `--notify` （#308）
- Studio ，read / grep ，“”（#306）

### Reliability And Compatibility

- 、：、； `BOOK_BUSY`， `.write.lock`（#337）
- Studio  pi-agent、，
- OpenRouter、NewAPI、kkaiapi、PPIO、；OpenRouter  `openrouter/auto`（#300）
- MiniMax  reasoning ， think ，（#329）
-  POSIX ， Windows 

## v1.6.3

### Hotfix

-  `@actalk/castor@1.6.2` / `@actalk/castor-studio@1.6.2`  npm  registry manifest  `workspace:*` ；Windows / npm  `1.6.3`  `latest`
-  publishable manifest  `workspace:` ，
- MiniMax  OpenAI-compatible  `MiniMax-M3` ， `MiniMax-M3*`  `thinking: { "type": "disabled" }`， thinking 

## v1.6.2

### Release Focus

Chat ： v1.6.0  / Skill ，、、、 Studio 。 Chat ：，，，。

### Improvements

- Studio Chat  / Markdown / ； LLM ，
- ， Chat  agent turn，
- ：， /  evidence trace 
-  Studio ：“ → ” longform、Play、 prompt pack；，
- Runtime Skill  prompt pack、；
-  Studio Chat ：`sub_agent(reviser)` “ /  / ” brief 
- ： blocking / critical / AI-tell 、， “kept original chapter”
- ：“”，“ N  / ”

### Verification Notes

- ：`kkaiapi / deepseek-v4-flash`  Markdown ， LLM 
- ：`kkaiapi / gpt-5.5`  PNG ，

## v1.6.0

### Release Focus

 Skill ： castor “ + Play”、、。Studio Chat  /  skills，，。

### Major Features

- ：、 / 、、、
-  runtime Skill ： /  skill ， Chat / 、
-  `research_web`：、、、、， sources / queryLog / unknowns / confidence  Markdown 
- Studio Skill UI 、 skill，
- 、、 Chat action surface ，， Studio 

### Reliability And Fixes

-  `patch_chapter_text` ；，，
-  /  `chapters/index.json` ；， UI 
-  bookId ， session-bound bookId 
-  `.castor/research/` ， story truth、

## v1.5.0

### Release Focus

castor Play ： castor “” Story Creation AI Agent。、、、、、、 Studio Chat / CLI / TUI ，、。

### Major Features

-  **castor Play**  / ：、、、、 agent、 /  / 、HUD 
- Studio ：、、、、、、、
- Play ： HUD 、、、、；，
-  / 、、， IP、
- Studio Chat、TUI  CLI  action surface：、、、、Play、

### Context And Reliability

-  protected / compressible ：、、，
- Composer  outline ，
-  + ，
- provider / Studio  Chat ， 400
- ：Planner / Architect  YAML  Markdown / ， MiniMax 
- 、，

### Studio UX

- Studio 、Play 、、、
- Play 、、、，，
- 、、 API ：castor 、
- README  Skill  Story Creation AI Agent ， v1.5.0 Studio Play 

### Bug Fixes

-  TUI / Studio / Chat 
- ，
-  Play HUD 、、、
-  writer / reviewer / reviser 
-  UI 、README 、Kimi  1.5.0  GitHub README 

## v1.4.1

### Release Focus

Windows / provider ： MiniMax ，， 3。

### Improvements

-  `writing.reviewRetries` ， 1； `castor config set writing.reviewRetries 3`
- Studio ，CLI  Studio 
- README /  v1.4.1  MiniMax 

### Bug Fixes

-  MiniMax  provider  Anthropic ， Windows 
-  MiniMax endpoint ，

## v1.4.0

### Release Focus

 Studio Chat ：、、，。

### Improvements

- ：Studio Chat  CLI 、、、
- ： / ， Studio 
- Studio  session，、、
- Chat ，、、 castor 
- ，

### Bug Fixes

-  / 、
-  Studio 
-  `LengthNormalizerAgent`  `maxTokens`  / 

## v1.3.12

### Release Focus

Studio ：， /  / ，“ API”。

### Improvements

- Studio ，、
- “ API”，

## v1.3.11

### Release Focus

Studio ： kkaiapi ，/ OpenAI-compatible 、API Key 、，、。

### Improvements

-  kkaiapi ，Studio / CLI 
- Studio ，
- ，Studio  scan 
-  / ，“”

### Bug Fixes

- ， llama.cpp /  OpenAI-compatible 
-  API Key  ASCII  ByteString 
-  Studio  / 
-  Studio 
-  `hooks.json`  hook id 

## v1.3.10

### Release Focus

 platform ： `sub_agent.platform` / schema ，。

### Bug Fixes

-  `Validation failed for tool "sub_agent": - platform: must be equal to constant`，
-  Studio、CLI、TUI、agent create-book ，`` (Cà Chua) / `fanqie` / `` (Cà Chua Tiểu Thuyết) 
-  `other`， id 
-  README  13 

## v1.3.9

### Release Focus

Studio ： session ，。

### Bug Fixes

-  Studio  `/new`、`/create`  orphan session， session 
-  Chat 
- ：`#/book/:id`  Chat ，`#/book/:id/settings` 
-  Dashboard “” Chat 

## v1.3.8

### Release Focus

： 1.3.7  Ollama /  OpenAI-compatible ， Studio  CLI  API key 。

### Bug Fixes

-  Studio 、 API key， Ollama / 
-  Studio  `/agent`  key  client 
-  CLI / Studio  Ollama 
-  `write next --context` 

## v1.3.7

### Release Focus

： Writer、Planner、Architect ，、、、。

### Improvements

- ****：Writer prompt 、、、，
- **Planner / Architect **：、、hook  foundation 
- **Hook **：hook ledger  advance / resolve 、、，“、”
- ****：，；

### Bug Fixes

-  Architect  5  foundation SECTION 
-  hook ledger payoff ，
-  prompt ，“1-3 ”

## v1.3.6

### Release Focus

v13 ：、，。

### Improvements

- ****：Architect  `outline/story_frame.md`、`outline/volume_map.md`  `roles/` ， legacy shim 
- ****：agent architect  `revise=true`， Phase 5 ；，
- ****：Agent  truth files ；
- ****： `maxTokens` fallback  `maxTokensCap` ， Architect 
- **README **： Skills Download History ，、、 README

### Bug Fixes

-  Phase 5  shim 
-  reviseFoundation  `current_state` / `pending_hooks` / runtime logs 
-  role 

## v1.3.5

### Improvements

- **Session / Sidebar **：Studio  per-session runtime，`pendingBookArgs`  session ，session SSE  `App.tsx` ；sidebar 、、
- ****： LLM ； session title， session  lazy migration
- **Draft Session **：，，
- **Session **：`listBookSessions`  summary， session 

### Bug Fixes

- ****：`/services/:service/models`  key  `resolvedBaseUrl`，custom 
- ****：`ConfirmDialog`  portal， sidebar  containing block 
- ****： `server.test.ts`  `updateSessionTitle` mock 

## v1.3.4

### Bug Fixes

- ****： `@mariozechner/pi-ai` / `pi-agent-core`  `0.67.1`， npm 
- ****：`GET /models` ，`knownModels`  probe；`/models`  `knownModels`
- ****：`/models`  `401/403` ； `/test`  key， `/test` 
- ****： 50 

### Improvements

- **agent **：`edit` ， `write` /， `books/` 
- **`sub_agent` **： `writer.chapterWordCount`、`reviser.mode`、`exporter.format`、`exporter.approvedOnly`
- ****：book-mode  `sub_agent(reviser)`， `revise_chapter`  `sub_agent` 

## v1.3.3

### Bug Fixes

- ****：agent  `title`，`initBook` / `book.json` ，
- ** EPUB **：CLI、Studio 、 agent exporter  EPUB ， EPUB、 HTML、
- ****：book-mode agent 、、、/ deterministic ， `edit`

### Improvements

- **TUI  agent/session**：TUI  agent session ， fast-path， Studio 
- ****：agent prompt  deterministic ，“，”

## v1.3.2

### Bug Fixes

- ** `architect` foundation **： `maxTokens: 16384`， LM Studio  foundation 
- ** OpenAI-compatible **：`provider=openai +  baseUrl`  `custom fetch` ，Google/Gemma 
- ** Anthropic-compatible  transport**：`service=custom`  `provider=anthropic` ， SDK
- **Windows Studio **：`castor studio`  Windows  loader  ESM URL 
- **Bootstrap  env **： auto-init  Studio ， `.castor/.env`，`book create`  key
- ****：`config-loader`、`service-resolver`、Studio 、`doctor`  `service-presets`  provider/api/chatBaseUrl/modelsBaseUrl，

### 

- ****：`castor` / `castor studio`  Studio， `init`
- **Studio  transport**：、`chat/responses` ，
- **`doctor` **：/， model、、
- ** fresh session**：“”，
- ****：Studio model picker 
- ****： sidebar ，
- ****： API Key  `/test` ， `/models`

## v1.3.1

### Bug Fixes

- **MiniMax baseUrl **： `api.minimax.chat`  `api.minimaxi.com`（ OpenAI ）
- ** baseUrl **：agent ， baseUrl（ moonshot URL  minimax ）
- **resolveServiceModel  preset**： pi-ai  model （ API ）， preset  baseUrl  api  model
- **agent **： agent ，（ POST /books/create  `book:created`）
- **`pnpm dev` **： `--parallel`， core tsc --watch  studio 

### 

- **MiniMax knownModels**：MiniMax  `GET /models`， 7 （M2.7/M2.5/M2.1  highspeed  + M2）
- ****： chat completion ， `/models` + fallback ，
- **custom  URL  /v1**：`https://example.com`、`https://example.com/`、`https://example.com/v1` 
- **agent **： emoji、/、

### 

- ：service-presets（MiniMax baseUrl + knownModels）、service-resolver（preset  pi-ai）、normalizeBaseUrl

## v1.3.0

### Release Focus

Studio 2.0 。`castor`  Studio， Web ；TUI  `castor tui`。

### 

- **Studio 2.0 **：`castor`  Studio，、、
- ** OpenAI-compatible **：Studio  `baseUrl`、（`chat` / `responses`），
- ****：Studio  `.env`  Studio ， `castor_LLM_*` 
- ** custom transport**： `custom`  fetch ， SDK ，

### 

- ****： `/models`，，“”
- ****：，
- ****： key， key 
- ****：Studio  `Acknowledged.` ，

### Bug Fixes

-  `llm.services + defaultModel + secrets` 
-  `custom:*` 、 `/api/v1/agent` 
-  `castor`  Studio  `llm.model` 
-  / SSE  JSON 

## v1.2.0

### Release Focus

——TUI、Studio、`castor interact`、OpenClaw Skill 。

### 

- ****（`packages/core/src/interaction/`）：（15+ intent）、、、、
- **Ink TUI **：`castor`  Ink + React ，，slash  Tab ，（writing/auditing/revising/planning ），i18n 
- **Studio **： AI ，（、、、），SSE ，
- ****： Studio 、、，
- ****：`` / `/rename  => `， + 
- ****：`/replace 5  => `，
- **`castor interact --json`**： JSON ， request / response / session / events， OpenClaw  Agent 
- **Thinking **（PR #174）：kimi-k2.5  thinking  temperature=1， per-call ， warn 

### 

- Studio ChatBar ：`executeCommand()` ， handleSubmit/handleQuickCommand 80 
- Studio ChatBar SSE effect  `loadingRef`  stale closure
- Studio  z-index ： paper-sheet  transform（ stacking context）， card  z-50
- Studio agent ： `result.responseText`  `session.messages.at(-1)`
- TUI ：（///）+ （//）
- TUI ：✓  / ✗  / ✎  / ◇  / ◈ 
- TUI i18n ：`stageLabels`  TuiCopy， hardcoded 
- Studio （PR #176）： shadcn 、`dotenv`、`shadcn`、`tw-animate-css`、`class-variance-authority`，-2800 

### Bug Fixes

- Studio ChatBar ：session  response 
- Studio BookMenu  card ：fadeIn  transform  stacking context
- Studio GenreManager  `window.confirm`  `ConfirmDialog`
- Studio BookDetail Nav `toTruth`  hack 
- Studio ChapterReader/Dashboard approve/reject 
- ChatBar curly quote  esbuild 

---

## v1.1.1

### Release Focus

-  `v6 + bugfix` ， `v8` 

### Bug Fixes

- **#151** — Architect section  `book-rules` / `Book Rules` / ， `book_rules` 
- **#152** — State validator  fail-closed：， JSON ， `passed` 
- **#154** — ， `33` / `Chapter 33` 
- **#155** — `repair-state`  `state-degraded` ， `delta chapter N goes backwards`

### Improvements

- `ai-tells` / `sensitive-words` ， issue
- import / continuation / series  prompt ，foundation reviewer 
- reviser  `hookDebtBlock`， hook 

---

## v1.1.0

。 Meta-Harness  autoresearch ， 75  92 ， 39  82+ 。

### 

- **Foundation Reviewer**： Agent，5 （ DNA 、、、、）， 80  Architect 
- ****：（canon/au/ooc/cp），
- **Hook Seed Excerpt**：，Composer  chapter_summaries  Writer ， lifecycle pressure 
- **Review Reject **：`castor review reject`  state ，
- **State Validation Recovery**：state  settler，， `castor write repair-state` 
- **Audit Drift **： `audit_drift.md`， `current_state.md`
- ****：，
- **Hook **： ≥10 ，
- ****： 3 ，
- **/**：mood ， warning  blockingCount
- ****：`fanfic init`  `import chapters`  style_guide.md + style_profile.json
- **Governed **：/ parent_canon.md  fanfic_canon.md  Governed  Writer
- ** HTTP Headers**：`castor_LLM_HEADERS`  HTTP 

### Bug Fixes

- ：
- hook ：mustAdvance （）
- Outline ：， Chapter 1  Chapter 10
- approve 、style  graceful degrade、Studio  LLM 、

---

## v1.0.2

### Bug Fixes

- **#127** —  Studio Web ：，， `Book not found`
- ，

---

## v1.0.0

castor Studio + 。 CLI  CLI + Web 。

### castor Studio

- `castor studio`  Web （Vite + React + Hono， 4567）
- ：、、（TXT/MD/EPUB）、
- ：/、、（polish/spot-fix/rewrite/anti-detect）
- ：SSE 
- ：AI /
- ：、、、token 
- AI ： AI 
- ：、
- ：/（、、）
- ：、
- ：
- ：LLM 、、

### Bug Fixes

- unknown hook  resolve/defer ，
- Studio 
- Studio 
- validator false positive： fail，

### Chore

-  studio （.playwright-cli/、.superpowers/、）
- untrack docs/  autoresearch/， .gitignore
- SKILL.md  v2.2.0， Studio workflow section
-  README  Studio 

---

## v0.6.3

### Bug Fixes

- **#113/#109** — StateValidator JSON ，LLM  markdown 
- **#114** — status ， poisoned runtime state 
- **#110** — book creation （ → rename），
- **#92/#93** — agent ：write_draft 、revise_chapter 、write_truth_file 、import_chapters  ≥2 
- **#90** — （ normalize + auto revise ）
- **#94** — ：writer prompt  + post-write validator  + 

### Improvements

- **#111** — SKILL.md  13 （eval, consolidate, write rewrite, book update/delete, plan/compose, studio, fanfic show/refresh, genre create/copy）
- **#95** — doctor （ pre-v0.6 ）
- **#103** —  rewrite （rewrite 2 → next  3）
-  `castor eval`  — 
- SKILL.md  2.1.0

## v0.6.2

### Bug Fixes

- **** (#99/#101/#104) — duplicate active hook family ，； hook 
- ** LLM** (#100) — /self-hosted OpenAI-compatible （Ollama ） API key
- **0 ** (#105) — truth rebuild 
- **** (#108/#98) — poisoned manifest  bootstrap 
- **** (#88) — state validator ，
- **Provider 400** (#91) — streaming provider fallback 

### Improvements

- **** (#90) —  warning
- **Agent ** (#92/#93) — agent ，system prompt 
- Windows ：tar  --force-local
- README ，OpenClaw  skill 

## v0.6.1

-  emphasized hook id 
-  poisoned runtime state 

## v0.6

 +  + 。

：**20+  400 **、**、 0%**、** 50%+  normalizer **。

### 

-  10-agent： Planner、Composer、Observer、Reflector、Normalizer
-  `story/state/*.json`（Zod ），Settler  JSON delta  markdown，
- Node 22+  SQLite （`story/memory.db`），
- `createRequire`  ESM  node:sqlite 

### 

- Planner  `hookAgenda`（mustAdvance / eligibleResolve / staleDebt），
- Settler working set  `selected ∪ recent ∪ agenda ∪ dormant debt`，
- hookOps  `mention` ——"" `lastAdvancedChapter`，
- `analyzeHookHealth`：active  /  / stale  /  →  warning
- `evaluateHookAdmission`： hook ，

### 

- `LengthSpec`（target / softMin-softMax / hardMin-hardMax）+ `countingMode`（zh_chars / en_words）
-  + ，
- ： <25% ，`stripCommonWrappers`  50% 

### 

- （ 6  ngram /  3 ）
- （）
- English variance brief（//）
- （）

### Bug 

-  `castor_LLM_MAX_TOKENS` （#87）
- `stripReservedKeys`  `llm.extra`  max_tokens / temperature
- ：append  + bootstrap  + JSON 
- `consolidate` 
-  CLI 
- Runtime state 

---

## v0.5.0

 + 。

### 

- 10 （LitRPG、Progression Fantasy、Isekai、Romantasy、Sci-Fi、Cozy Fantasy、Tower Climber、Dungeon Core、System Apocalypse、Cultivation）
- `--lang en` ：Architect 、Writer 、Settler  truth files、Auditor 、Reviser 
- ：AI-tell （delve/tapestry/testament ）、、
- ：`Chapter X:` vs `X`
- EPUB  lang 

### 

- ：`acquireBookLock`  stat+write  `open("wx")` ，
- ：/ tick
- ：revision  `finalContent` ，spot-fix 
- Agent override ： API key  agent 
- Daemon pid ： pid 
- Studio ： JS  node  tsx 
- Import resume ：`--resume-from` 

### CLI 

- `castor book delete <id>`：（`--force` ）
- `castor status --chapters`： failed  critical issues
-  JSON （#51）
- `write_truth_file` agent （#53）
- （#52）

---

## v0.4.6

 +  +  + CLI 。

### 

-  Logger ：ANSI （INFO=cyan, WARN=yellow, ERROR=red），JSON Lines 
- `castor up`  `castor.log`，
- `write next`、`draft`、`up`  `-q, --quiet` 
- LLM ： 30 （、）
-  17  `process.stderr.write`  logger

### 

- Stream ：streaming  sync ， SSE 
- ： ≥500 （#21）
- ：400/401/403/429/Connection error  baseUrl、model 
- `castor doctor`  hints（ baseUrl、 stream:false、 API Key）

### Bug 

- `rewrite` ：`particle_ledger.md` ，（#37）
- `rewrite`  1 ：`initBook`  snapshot-0，chapter 1 （#34）
- ：`parseCreativeOutput`  3  fallback（markdown heading →  → ），Qwen/Ollama （#13）

### CLI 

- `book create --brief <file>`：，Architect （#43）
- `write rewrite`  1  snapshot-0（）

---

## v0.4 (v0.4.0 – v0.4.5)

 +  +  +  Provider  +  + 。

### 

（） castor，、（、、）， `write next` 。

```bash
castor import chapters  --from /        # 
castor import chapters  --from .txt          # （"X"）
castor import chapters  --from .txt --split "Chapter\\s+\\d+"  # 
castor write next                                # 
```

 `X` ， `--split <regex>` 。 `--resume-from <n>` 。

### （Spinoff）

、、 if 。，。

```bash
castor import canon  --from    # 
castor write next                      # 
```

 `story/parent_canon.md`，、（）、、。， 4 ：

|  |  |
|------|----------|
|  |  |
|  |  |
|  | （、、） |
|  |  |

 `parent_canon.md` ，。

### 

， + ， prompt。

```bash
castor style analyze .txt                     # ：、TTR、
castor style import .txt  --name   # 
```

：
- `style_profile.json` — （、、、）
- `style_guide.md` — LLM （、、、）

，。

### 

11 ， LLM ，：

|  |  |
|------|------|
|  | 「…………」 |
|  | 「——」 |
|  | //， 3000  ≤ 1  |
|  |  ≤ 1  |
|  |  |
|  |  |
|  | / |
|  | 「」 |
|  | ≥ 6 「」 |
|  | ≥ 2  300  |
|  | book_rules.md  |

 error ， `spot-fix` ， LLM 。

### -

 `rewrite`  6  AI ，：

-  `rewrite`  `spot-fix`（，）
-  AI ， AI ，
-  0（， 0-6  critical ）
- `polish` （、、）

###  Provider 

 agent  API ——， API  Key。，：

```bash
castor config set-model writer gpt-4o-mini                                    # 
castor config set-model auditor gemini-2.5-flash \
  --base-url https://generativelanguage.googleapis.com/v1beta/openai \
  --provider openai \
  --api-key-env GEMINI_API_KEY                                                #  Gemini API
castor config set-model reviser claude-sonnet-4-20250514 \
  --base-url https://api.anthropic.com \
  --provider anthropic \
  --api-key-env ANTHROPIC_API_KEY                                             #  Anthropic API
castor config show-models                                                      # 
```

 agent  `--base-url`、`--provider`、`--api-key-env`、`--no-stream`。 agent 。

### 

```bash
castor analytics           # 、、
castor analytics  --json   # 
```

###  v0.4 

-  26  33（+4  + dim 27  + dim 32  + dim 33 ）
- ：//（）
- ：AI （ 15 ）、、、
-  `spot-fix` （）
- `book_rules.md`  `additionalAuditDimensions` 
-  5  dim 24-26（//）
- `castor export`  `--format md`、`--output <path>`、`--approved-only`
- 「」 4  6 （）
- ：`init`/`book create`/`import chapters` 、`config set`  + key 、`update` 、`doctor`  API、、`genre show`  ID

---

## v0.3

 +  + AIGC  + Webhook。

### 

Writer 、//，。，。

|  |  |
|----------|------|
| `chapter_summaries.md` | ：、、、 |
| `subplot_board.md` | ：A/B/C  |
| `emotional_arcs.md` | ：、、 |
| `character_matrix.md` | ：、 |

### AIGC 

|  |  |
|------|------|
| AI  | （ LLM）：、、、， |
| AIGC  API |  API （GPTZero / Originality / ），`castor detect`  |
|  |  StyleProfile（、TTR、）， Writer prompt |
|  | ReviserAgent `anti-detect` ，→→ |
|  | `detection_history.json` /，`castor detect --stats`  |

```bash
castor style analyze reference.txt         # 
castor style import reference.txt   # 
castor detect  --all               #  AIGC 
castor detect --stats                      # 
```

### Webhook + 

 POST JSON  URL（HMAC-SHA256 ），（`chapter-complete`、`audit-failed`、`pipeline-error` ）。：（ temperature）、。

### 

 5 ，：、、、、。

|  |  |
|------|----------|
|  | 、、、// |
|  | /、、 |
|  | 、/、、 |
|  | 、、、 |
|  |  |

，：

```bash
castor book create --title "" --genre xuanhuan
```

、、：

```bash
castor genre list                      # 
castor genre show xuanhuan             # 
castor genre copy xuanhuan             # ，
castor genre create wuxia --name    # 
```

，、、、——。

（ ✗→✓ ），：

- ****：✗ "1224" → ✓ "，"
- ****：✗ "" → ✓ ""
- ****：✗ "" → ✓ ""

### 

 `book_rules.md`， agent ，。 prompt：

```yaml
protagonist:
  name: 
  personalityLock: ["", "", ""]
  behavioralConstraints: ["", ""]
numericalSystemOverrides:
  hardCap: 840000000
  resourceTypes: ["", "", ""]
prohibitions:
  - 
  - 
  - 
fatigueWordsOverride: ["", ""]   # 
```

、、、——，。

### 33 

 33 ，：

OOC、、、、、、、、、、、、、、、、、、、、、、、、、、、、、、、、

dim 20-23（AI ）+ dim 27（）， LLM 。dim 28-31（） `parent_canon.md` 。dim 32（）、dim 33（）。

###  AI 

5  + ， AI ：

- AI ：/////， 3000  ≤ 1 
- ，
- （""""）
- 
- 

 + AI （dim 20-23）。 AI 。

###  v0.3 

-  OpenAI + Anthropic  +  OpenAI 
-  polish / rewrite / rework / anti-detect / spot-fix 
- 
-  `--json` ，OpenClaw /  Agent 
- book-id ： book-id
- `castor update` 、`castor init` 
- API ，`castor doctor`  API 
