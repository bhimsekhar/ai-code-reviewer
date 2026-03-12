# AI Code Reviewer — Solution & Architecture

---

## 1. Problem

Development teams using AI coding assistants fall into a pattern of **blind approval** — developers press accept on AI-generated code without reading it. The root cause is zero friction: when there is no forcing function, the path of least resistance is to approve and move on.

This leads to:
- Bugs and logic errors reaching production undetected
- Security vulnerabilities passing unreviewed
- Developers losing comprehension of their own codebase

---

## 2. Solution

AI Code Reviewer wraps the AI code generation process with **mandatory, unpredictable comprehension checkpoints**. Code streams into the editor one line at a time at a controlled pace. At logical boundaries, streaming pauses and the developer must answer a question about the code they just watched being written — before they can proceed.

The checkpoint type is always unpredictable. Developers cannot develop a reflex or shortcut — they must genuinely read and understand the code.

---

## 3. End-to-End Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│  Developer asks Claude Code to write a file                             │
│                                                                         │
│  Claude Code generates code  ──────────────────────────────────────┐   │
│    └─ embeds checkpoints in comments (limericks, haikus, etc.)     │   │
│                                                                     ▼   │
│  PostToolUse hook fires                                             │   │
│    └─ reads Write/Edit event from stdin                             │   │
│    └─ POSTs payload to localhost:3131/api/inbound  ─────────────────┘   │
│                                                                         │
│  Coordinator (inside VS Code extension)                                 │
│    ├─ parse: extract embedded checkpoints, strip 🔑 answer keys         │
│    ├─ assess: detect risk patterns, complexity, boilerplate tier        │
│    ├─ build: split code into StreamBlocks, attach Gates                 │
│    └─ emit: streamReady event → Streamer                                │
│                                                                         │
│  Streamer                                                               │
│    ├─ opens target file in VS Code editor                               │
│    ├─ streams lines one by one at configured speed                      │
│    ├─ paints incoming lines green (reviewed diff)                       │
│    ├─ at gate: pauses, hands off to Gate UI                             │
│    │    ├─ correct answer → green clears, streaming continues           │
│    │    ├─ wrong answer  → block turns red, developer retries           │
│    │    └─ max retries   → block flagged, audit log entry, escalation   │
│    └─ audit logger records every gate result                            │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Component Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         VS Code Extension                                    │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  Coordinator (HTTP server — localhost:3131)                           │   │
│  │                                                                       │   │
│  │   ┌───────────────┐   ┌────────────────┐   ┌──────────────────────┐  │   │
│  │   │ checkpoint-   │   │   assessor     │   │ checkpoint-selector  │  │   │
│  │   │ parser        │   │                │   │                      │  │   │
│  │   │               │   │ risk patterns  │   │ weighted random pick │  │   │
│  │   │ extracts ❓🔑  │   │ complexity     │   │ no consecutive repeat│  │   │
│  │   │ strips answer │   │ boilerplate    │   │ tier-aware           │  │   │
│  │   │ keys          │   │ tier (1/2/3)   │   │                      │  │   │
│  │   └───────────────┘   └────────────────┘   └──────────────────────┘  │   │
│  │                                                                       │   │
│  │   ┌───────────────────────────────────────────────────────────────┐  │   │
│  │   │  answer-validator                                              │  │   │
│  │   │  fuzzy match for free-text · exact for multiple-choice        │  │   │
│  │   └───────────────────────────────────────────────────────────────┘  │   │
│  │                                                                       │   │
│  │   ┌────────────────────┐                                             │   │
│  │   │  audit-logger      │  → .ai-code-reviewer-audit.jsonl           │   │
│  │   └────────────────────┘                                             │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  Streamer                                                             │   │
│  │  speed levels: 1× 2× 5× 10×  ·  hold-to-fastforward  ·  auto-reset  │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  ┌────────────────────┐  ┌─────────────────┐  ┌───────────────────────┐    │
│  │  Gate UI           │  │  Highlighter    │  │  Status Bar           │    │
│  │  (webview panel)   │  │  green/red/mark │  │  speed · tier · pass  │    │
│  └────────────────────┘  └─────────────────┘  └───────────────────────┘    │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  Adapters                                                             │   │
│  │  ┌─────────────────────────┐   ┌────────────────────────────────┐   │   │
│  │  │ ClaudeCodeAdapter       │   │ (Phase 2: CopilotAdapter)      │   │   │
│  │  │ POST /api/inbound       │   │ FileWatcher + git diff         │   │   │
│  │  └─────────────────────────┘   └────────────────────────────────┘   │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
            ▲
            │  HTTP POST  (localhost:3131/api/inbound)
            │
┌───────────────────────┐
│  Claude Code Hook     │
│  post-tool-use.sh     │
│                       │
│  fires on Write/Edit  │
│  reads stdin JSON     │
│  extracts file+content│
│  POSTs to coordinator │
└───────────────────────┘
            ▲
            │
┌───────────────────────┐
│  Claude Code          │
│  (AI assistant)       │
│                       │
│  generates code with  │
│  embedded checkpoints │
│  in comments          │
└───────────────────────┘
```

---

## 5. Checkpoint Tier System

```
Code arrives
     │
     ▼
 Risk pattern detected?  ──Yes──▶  TIER 3 — Security Audit
 (SQL, auth, crypto,                 Fixed: Code Smell + Security Question
  file I/O, network,                 No randomness. Always fires immediately.
  hardcoded secrets)
     │ No
     ▼
 Boilerplate only?  ──Yes──▶  SKIP — Fast-Forward at 5× (200ms/line)
 (getters/setters,               No gate. Developer time respected.
  toString, equals,
  empty DTOs)
     │ No
     ▼
 Complexity > 5  ──Yes──▶  TIER 2 — Complex Code
 or methods > 8?              Pick 2 random types from pool
                              Both must be answered correctly
     │ No
     ▼
                        TIER 1 — Standard Code
                          Pick 1 random type from weighted pool
                          Never same type as previous gate
```

---

## 6. Gate Trigger Strategy (Hybrid Mode)

A gate fires when **any** of the following conditions is first met since the last gate:

```
  ├─ 3 non-boilerplate methods have been written      (logical)
  ├─ 80 lines have passed without a logical boundary  (fallback)
  ├─ a class boundary is crossed                      (logical)
  └─ a risk pattern is detected                       (immediate — no wait)

  Boilerplate blocks are excluded from all counts.
```

---

## 7. Checkpoint Types

| Tier | Type | Claude Embeds | Developer Is Asked |
|---|---|---|---|
| 1 | Limerick 🎭 | 5-line poem about the method | What does it return when X? |
| 1 | Haiku 🌸 | 3-line haiku about the core condition | What condition does this describe? |
| 1 | Fill the Blank 📝 | `This method returns ___ when ___` | Complete the sentence accurately |
| 1 | True / False ✅❌ | 3 statements, 1 subtly false | Which statement is false? |
| 1 | Metaphor 💡 | Real-world analogy | Map an element back to code |
| 2 | Code Smell | Nothing embedded | Name one concern in this block |
| 2 | What-If | Nothing embedded | What happens if X is null? |
| 2 | Sequence Recall | Nothing embedded | In what order do these run? |
| 2 | Name the Pattern | Nothing embedded | What design pattern is used? |
| 3 | Security Audit | Nothing embedded | Multiple-choice security question |

---

## 8. Data Flow — Two Monitors

```
Monitor 1 (Terminal / Claude Code)        Monitor 2 (VS Code)
┌────────────────────────────────┐        ┌──────────────────────────────────┐
│  $ claude                      │        │  UserService.java                 │
│                                │        │                                   │
│  > write UserService.java      │        │  1  public class UserService {    │
│                                │        │  2    private final UserRepo repo; │
│  Claude is writing...          │        │  3                                │
│  PostToolUse hook fires ──────────────▶ │  4  public User findById(        │
│  POST → localhost:3131         │        │  5    Long id) {                  │
│                                │        │  6    return repo.findById(id)    │
│                                │        │  7      .orElseThrow(...);        │
│                                │        │  8  }   ◀ writing                │
│                                │        │                                   │
│                                │        │  ┌──────────────────────────┐    │
│                                │        │  │ ⛔ REVIEW GATE — Tier 1  │    │
│                                │        │  │ 🌸 Time flows past one   │    │
│                                │        │  │    hour — the token      │    │
│                                │        │  │    fades, access denied. │    │
│                                │        │  │                          │    │
│                                │        │  │ ❓ What determines       │    │
│                                │        │  │    token expiry?         │    │
│                                │        │  │ [___________________]    │    │
│                                │        │  └──────────────────────────┘    │
└────────────────────────────────┘        └──────────────────────────────────┘
```

---

## 9. File Structure

```
ai-code-reviewer/
├── .ai-code-reviewer.yml          ← project-level config (copy to any repo)
├── PLAN.md                        ← original design document
│
├── claude-plugin/
│   ├── hooks/
│   │   └── post-tool-use.sh      ← Claude Code PostToolUse hook
│   ├── prompts/
│   │   └── system-prompt.md      ← instructs Claude to embed checkpoints
│   ├── plugin.json
│   └── settings.json.template
│
├── install/
│   ├── install.sh                ← Mac/Linux one-click installer
│   ├── install.ps1               ← Windows one-click installer
│   └── wire-hook.ps1             ← Windows hook-only wiring script
│
├── vscode-extension/
│   ├── src/
│   │   ├── extension.ts          ← activation, wiring all components
│   │   ├── hook-installer.ts     ← auto-installs Claude hook on first run
│   │   ├── streamer.ts           ← line-by-line streaming + speed control
│   │   ├── gate-ui.ts            ← gate question/answer interaction
│   │   ├── gate-view-provider.ts ← VS Code webview panel
│   │   ├── highlighter.ts        ← green/red/mark line decorations
│   │   ├── status-bar.ts         ← bottom status bar item
│   │   ├── types.ts              ← shared types and DEFAULT_CONFIG
│   │   ├── adapters/
│   │   │   ├── adapter.interface.ts
│   │   │   └── claude-code.adapter.ts
│   │   └── coordinator/
│   │       ├── server.ts         ← HTTP server + block builder
│   │       ├── assessor.ts       ← risk/complexity/boilerplate detection
│   │       ├── checkpoint-parser.ts
│   │       ├── checkpoint-selector.ts
│   │       ├── answer-validator.ts
│   │       └── audit-logger.ts
│   ├── resources/
│   │   ├── post-tool-use.sh      ← hook bundled inside VSIX (auto-installed)
│   │   └── icon.png
│   └── ai-code-reviewer-1.0.0.vsix  ← pre-built extension package
│
└── docs/
    ├── architecture.md           ← this file
    ├── user-manual.md
    └── configuration.md
```
