# AI Code Reviewer — Design & Build Plan

> **Status:** Pre-build planning — ready for implementation (Phase 1: Claude Code only)
> **GitHub org:** bhimsekhar
> **Last updated:** 2026-03-12
> **Origin:** Design discussion, documented for team review before build starts

---

## 1. Problem Statement

Development teams using AI coding assistants (Claude Code, Copilot, etc.) are falling into a pattern of **blind approval** — developers press "accept" or "approve" on AI-generated code without reading it. This leads to:

- Bugs and logic errors reaching production undetected
- Security vulnerabilities passing unreviewed
- Developers losing comprehension of their own codebase
- AI-generated code becoming a black box

The root cause is not laziness — it is **zero friction**. When there is no forcing function, the path of least resistance is to approve and move on.

---

## 2. Solution Overview

**AI Code Reviewer** is a developer toolchain that wraps the AI code generation process with mandatory, unpredictable comprehension checkpoints. It works across two monitors:

```
Monitor 1 (Planning Terminal)              Monitor 2 (VS Code / IntelliJ)
┌──────────────────────────────┐           ┌─────────────────────────────────┐
│  TASK DASHBOARD              │           │  AI streaming code in real-time  │
│                              │           │  at controlled speed...          │
│  ▶ Feature: Auth Module      │           │                                  │
│    ✓ Design schema           │           │  91  public User findById(       │
│    ✓ Write migration         │           │  92    Long id) {                │
│    ⏳ Write UserService      │           │  93    return repo.findById(id)  │
│       ├─ [WRITING] method 2  │           │  94      .orElseThrow(...);      │
│       └─ [GATE PENDING]      │           │  95    }                         │
│                              │           │                                  │
│  Next gate: unknown type     │           │  ████████████ method 3/3         │
│  (developer does not know)   │           │                                  │
│                              │           │  ┌───────────────────────────┐   │
│  Last gate: ✓ PASSED         │           │  │ ⛔ REVIEW GATE            │   │
│  Pass rate this week: 84%    │           │  │ 🎭 Read the haiku above.  │   │
└──────────────────────────────┘           │  │ What condition does it    │   │
                                           │  │ describe?  [__________]   │   │
                                           │  └───────────────────────────┘   │
                                           └─────────────────────────────────┘
```

**Core principle:** The checkpoint type is always unpredictable. Developers cannot develop a reflex or shortcut for passing gates — they must genuinely read and understand the code.

---

## 3. How It Works — End to End

```
Claude generates code
  │
  ▼
PostToolUse hook intercepts Write / Edit tool calls
  │
  ▼
Coordinator receives code, assesses risk/complexity
  │  → determines tier (1, 2, 3, or skip)
  │  → selects checkpoint type (random, no consecutive repeat)
  │  → generates checkpoint content (limerick, question, etc.)
  │  → queues code + checkpoint for streaming
  │
  ▼
VS Code Extension streams code to active editor
  │  → 1 line per second (configurable)
  │  → renders embedded checkpoint comments as they appear
  │  → at gate trigger: pauses, shows checkpoint UI
  │
Developer reads code, answers checkpoint
  │  → correct: continue streaming
  │  → wrong: highlight block, must re-read and retry
  │  → 3 wrong answers: flag for tech lead escalation
  │
  ▼
Audit log: developer, file, gate type, pass/fail, timestamp
```

---

## 4. Checkpoint Types

### 4.1 Tier 1 — Standard Code

Applied to normal, non-critical code blocks. **One type chosen randomly** from the pool. The same type is never used twice consecutively.

| Type | What Claude Embeds in Code | What Developer Is Asked |
|---|---|---|
| **Limerick** | 5-line poem that summarises the method's behaviour | "What does this method return when X?" |
| **Haiku** | 3-line haiku describing the core logic or condition | "What condition does this haiku describe?" |
| **Fill the Blank** | `// This method fails when ___ and returns ___` | Complete the sentence accurately |
| **True / False** | 3 statements about the code block, one of which is false | "Which of these three statements is false?" |
| **Metaphor** | `// This is like a bouncer who checks IDs but lets VIPs skip` | "Who are the VIPs in this metaphor?" — must map back to code |

**Examples:**

```java
// Limerick example
public String hashPassword(String raw) {
    return BCrypt.hashpw(raw, BCrypt.gensalt(12));
}
// 🎭 A wizard stored passwords in plain,
//    His users all screamed in pain.
//    He learned BCrypt's might,
//    Set rounds just right,
//    Now his secrets are locked in a chain.
// ❓ What did the wizard use to protect passwords?
```

```java
// Haiku example
public boolean isExpired(Instant tokenTime) {
    return Instant.now().isAfter(tokenTime.plusSeconds(3600));
}
// 🌸 Time flows past one hour —
//    The token fades like morning dew,
//    Access denied now.
// ❓ What does this haiku say determines expiry?
```

```java
// Fill the blank example
public User findOrThrow(Long id) {
    return repo.findById(id)
        .orElseThrow(() -> new UserNotFoundException(id));
}
// 📝 This method returns ___ when found,
//    and throws ___ when not found.
```

---

### 4.2 Tier 2 — Complex Code

Applied when cyclomatic complexity exceeds threshold, or when a method exceeds a configured line count. **Two types chosen randomly** from the pool — both must be answered correctly to proceed.

| Type | What Claude Embeds | What Developer Is Asked |
|---|---|---|
| **Code Smell Hunt** | Nothing — code speaks for itself | "Name one concern in this block" (free text, fuzzy matched against known issues) |
| **What Would Happen If** | `// What if userId is null here?` | "What exception or behaviour would occur?" |
| **Sequence Recall** | Nothing embedded | "In what order do these operations run? (A, B, C...)" |
| **Name the Pattern** | Nothing embedded | "What design pattern is used in this block?" |
| **Dependency Map** | Nothing embedded | "What does this method depend on to function correctly?" |

---

### 4.3 Tier 3 — Critical / Security Code

Applied immediately when risk patterns are detected, regardless of position in the file. **Both checkpoints are fixed — no randomness.**

Always: **Code Smell + Security Audit**, both required.

```
  ⚡ RISK DETECTED: SQL query + user input

  ─── GATE 1 of 2 — Code Smell ────────────────────────────────
  Describe one potential problem in the last method:
  [_________________________________]

  ─── GATE 2 of 2 — Security Audit ────────────────────────────
  Is user input sanitised before it reaches the query?
  A) Yes, parameterised query used
  B) No, string concatenation used
  C) Partially sanitised
  D) Cannot determine from the code
```

**Risk patterns that trigger Tier 3 immediately:**
- SQL queries with any user-supplied parameter
- Authentication / authorisation logic
- Cryptographic operations
- File I/O with user-controlled paths
- Network calls
- Environment variable access
- Hardcoded secret patterns (regex matched)
- Deserialization

---

### 4.4 Boilerplate — Fast-Forward, No Gate

Code that carries no logic risk is streamed at 5x speed with no checkpoint. Developer time is respected.

Boilerplate patterns:
- Getters and setters
- `equals()` / `hashCode()` / `toString()`
- DTO / POJO classes with no logic
- Import blocks
- Annotation-only classes

---

## 5. Gate Trigger Strategy

Line count alone is insufficient. 100 lines of getters is trivial. 8 lines of auth logic is critical.

### 5.1 Trigger Modes

```yaml
gates:
  mode: hybrid     # lines | logical | risk | hybrid

  logical:
    every_n_methods: 3       # gate after every 3 methods
    every_n_classes: 1       # always gate at class boundary
    every_n_files: 1         # gate when a complete file is written

  lines:
    fallback_every: 80       # fallback if no logical boundary hit within N lines

  risk_aware:
    immediate: true          # trigger regardless of current position
    triggers:
      - sql_query
      - authentication
      - authorization
      - cryptography
      - file_io
      - network_call
      - env_variable_access
      - hardcoded_secret_pattern

  boilerplate_skip:
    patterns:
      - getters_setters
      - toString
      - equals_hashcode
      - dto_classes
```

### 5.2 Hybrid Mode (Recommended Default)

```
Gate fires when ANY of these conditions is first met:
  → 3 methods have been written since last gate, OR
  → 80 lines have passed since last gate (fallback), OR
  → a class boundary is crossed, OR
  → a risk pattern is detected (immediate, no wait)

Boilerplate blocks are excluded from all counts.
```

### 5.3 What a Typical File Looks Like

```
Writing UserService.java...

  [method 1/3]  findById()           → streams at 1 line/sec
  [method 2/3]  updateProfile()      → streams at 1 line/sec
  [method 3/3]  deleteUser()         → streams at 1 line/sec
  ⛔ GATE (logical: 3 methods)       → Tier 1, random type

  [method 4]    validateToken()      → streams...
  ⚡ RISK: authentication detected   → IMMEDIATE Tier 3 gate

  [POJO]        UserDto.java         → ⏩ fast-forward (boilerplate)

  [method 5]    processPayment()     → streams...
  [method 6]    refundPayment()      → streams...
  [method 7]    voidTransaction()    → streams...
  ⛔ GATE (logical: 3 methods)       → Tier 2 (complexity > threshold)

  [class end]   UserService.java     → final gate + "file complete" summary
```

---

## 5.4 Fast-Forward Controls

Streaming at 1 line/second is intentional friction — but developers must have a way to increase speed for code they are genuinely comfortable with, up to a hard cap. Below the cap, reading is still physically possible. Above it, it is not — so the cap is the integrity boundary.

### Speed Levels

| Level | Speed | ms per line | Readable? |
|---|---|---|---|
| 1 (default) | 1× | 1000ms | Yes, comfortable |
| 2 | 2× | 500ms | Yes |
| 3 | 5× | 200ms | Yes, if focused |
| 4 (max) | 10× | 100ms | Barely — hard cap |

**Hard cap at 10× (100ms/line).** This cannot be overridden by config or keyboard shortcut. Below 100ms a developer cannot read code — allowing it would make the entire tool pointless.

### Controls (VS Code)

| Action | Shortcut | Behaviour |
|---|---|---|
| Speed up one level | `Ctrl+]` | Increase to next level, show indicator |
| Slow down one level | `Ctrl+[` | Decrease to previous level |
| Hold to fast-forward | Hold `Ctrl+Shift+F` | Streams at max (10×) while held, returns to current level on release |
| Reset to default | `Ctrl+Shift+R` | Back to 1× (1000ms) |

**Hold to fast-forward** is the key mechanic — it requires sustained conscious effort. The developer cannot set it and walk away; they must physically hold the key. The moment they release, speed drops back. This is deliberate.

### Speed Reset Rules

Speed is **not** persistent across gates. After every gate (pass or fail), speed resets to 1× for the next block. This prevents a developer from speeding through everything after the first gate.

```
method 1  →  developer speeds up to 3×
gate 1    →  PAUSE — developer answers
              ↓ speed resets to 1×
method 2  →  starts at 1× again
              developer must consciously re-apply fast-forward
```

### Speed Is Visible

The VS Code status bar shows current speed at all times:

```
[ ▶ AI Reviewer  |  Speed: 2×  |  Next gate: ~3 methods  |  Last: ✓ PASSED ]
```

### Config

```yaml
stream:
  default_speed_ms: 1000     # level 1
  speed_levels:              # define your own levels if needed
    - 1000
    - 500
    - 200
    - 100                    # hard cap — never go below this
  hard_cap_ms: 100           # enforced in extension, cannot be overridden
  reset_after_gate: true     # always reset to default after each gate
  hold_to_fastforward: true  # enable hold-key mechanic
```

---

## 6. Checkpoint Selection Rules

```
for each gate trigger:

  assess the code block just written:
    risk patterns detected?          → Tier 3 (fixed: smell + audit)
    cyclomatic complexity > 5?       → Tier 2 (pick 2 from pool)
    boilerplate only?                → skip entirely
    otherwise?                       → Tier 1 (pick 1 from weighted pool)

  enforce:
    never same type as previous gate
    track type history per session
```

---

## 7. System Architecture

### 7.1 Code Source Adapter Pattern

Only one thing differs between AI tools: **how generated code arrives**. Everything downstream — the coordinator, gate engine, checkpoint logic, streaming, and audit — is identical regardless of which AI tool produced the code.

Each AI tool gets a thin **Code Source Adapter**. The interface is defined once. **Phase 1 implements Claude Code only.** Adding Copilot in Phase 2 means writing one adapter file — nothing in the core changes.

```
┌─────────────────────────────────────────────────────────────────┐
│                    AI Code Reviewer Core                         │
│                                                                  │
│   Coordinator (embedded in extension)                            │
│     assessor → checkpoint-selector → checkpoint-generator        │
│     answer-validator → audit-logger                              │
│                                                                  │
│   VS Code Extension                                              │
│     streamer → gate-ui → highlighter → status-bar               │
└───────────────────────┬─────────────────────────────────────────┘
                        │  CodePayload { file, content, language, source }
                        ▼
                 ┌────────────┐        ┌──────────┐
                 │   Claude   │        │ Copilot  │  ← Phase 2
                 │   Adapter  │        │ Adapter  │  (not built yet)
                 │            │        │          │
                 │ PostToolUse│        │FileWatch │
                 │ hook fires │        │+git diff │
                 └────────────┘        └──────────┘
                 (Phase 1 — now)       (Phase 2 — later)
```

### 7.2 Adapter Interface

Every adapter delivers the same payload shape to the coordinator. The core never knows or cares which AI produced the code.

```typescript
interface CodeSourceAdapter {
  readonly name: string            // 'claude-code'  (Phase 1) | 'copilot' (Phase 2)
  readonly displayName: string     // shown in status bar and audit log

  // called once on extension activation
  initialize(config: AdapterConfig, onCode: (payload: CodePayload) => void): void

  dispose(): void
}

interface CodePayload {
  file: string                     // absolute path
  content: string                  // full new content
  diff?: string                    // optional: what changed (for file-watch adapters)
  language: string                 // java | typescript | python | ...
  source: string                   // which adapter produced this
}
```

### 7.3 Adapter Implementations

**Claude Code Adapter** (today)
- Mechanism: `PostToolUse` hook in `~/.claude/settings.json`
- Hook fires after every `Write` or `Edit` tool call
- POSTs `CodePayload` to the embedded coordinator on `localhost:3131`
- Installed via Claude Code plugin (`/plugin install`)

**Copilot Adapter** (Phase 2 — not built in Phase 1)
- Mechanism: VS Code `FileSystemWatcher` on the open workspace
- On file save: computes `git diff HEAD -- <file>` to isolate AI-added lines
- If diff exceeds threshold (e.g. > 5 new lines): treats as AI-generated, routes to coordinator
- No separate plugin needed — purely VS Code API inside the extension
- Activated by setting `ai-code-reviewer.adapter: copilot` in VS Code settings
- See open question #12 for threshold decision

**What changes per adapter: nothing in the core.** Only the adapter file itself.

### 7.4 Folder Structure

```
ai-code-reviewer/
│
├── vscode-extension/                        # Single installable VSIX — contains everything
│   ├── src/
│   │   ├── extension.ts                     # activation: loads adapter + starts coordinator
│   │   ├── coordinator/                     # embedded coordinator (no Docker, no npm)
│   │   │   ├── coordinator.ts               # spawns as child Node.js process
│   │   │   ├── server.ts                    # HTTP + WebSocket server (localhost:3131)
│   │   │   ├── assessor.ts                  # risk pattern detection + complexity
│   │   │   ├── checkpoint-selector.ts       # tier assignment + type selection
│   │   │   ├── checkpoint-generator.ts      # generates limerick/haiku/question etc.
│   │   │   ├── answer-validator.ts          # exact / multiple-choice / fuzzy match
│   │   │   └── audit-logger.ts              # append-only JSON audit log
│   │   ├── adapters/
│   │   │   ├── adapter.interface.ts         # CodeSourceAdapter + CodePayload types
│   │   │   ├── claude-code.adapter.ts       # PostToolUse webhook receiver  ← Phase 1
│   │   │   └── copilot.adapter.ts           # FileSystemWatcher + git diff  ← Phase 2
│   │   ├── streamer.ts                      # line-by-line editor insertion + speed control
│   │   ├── gate-ui.ts                       # checkpoint UI per type (inputBox/quickPick/webview)
│   │   ├── highlighter.ts                   # red block highlight on wrong answer
│   │   └── status-bar.ts                    # speed indicator + gate status
│   └── package.json
│
├── claude-plugin/                           # Claude Code plugin (thin — just hook + prompt)
│   ├── plugin.json
│   ├── hooks/
│   │   └── post-tool-use.sh                 # POSTs to coordinator on Write/Edit
│   └── prompts/
│       └── system-prompt.md                 # embedding rules for Claude
│
├── dashboard/                               # Monitor 1 — Python textual TUI
│   ├── app.py
│   ├── task_panel.py
│   ├── gate_panel.py
│   └── audit_panel.py
│
└── install/
    ├── install.sh                           # Mac/Linux one-liner
    └── install.ps1                          # Windows one-liner
```

### 7.5 Embedded Coordinator — No Docker Required

The coordinator is **not a separate service**. It lives inside the VS Code extension and is spawned as a child Node.js process on extension activation. VS Code ships with Node.js — no external runtime needed.

```
VS Code starts
  → extension activates
  → extension.ts spawns coordinator/server.ts as child_process
  → coordinator binds to localhost:3131
  → adapter initializes (based on settings)
  → status bar shows: [ ▶ AI Reviewer | Claude Code | Ready ]

VS Code closes
  → extension deactivates
  → child process killed automatically
```

No Docker. No npm global install. No background service. **Install VSIX → done.**

### 7.6 Data Flow (with adapter abstraction)

```
AI Tool generates code
  │
  ▼
Code Source Adapter  (claude-code in Phase 1)
  │  delivers: CodePayload { file, content, language, source }
  │  via: HTTP POST to localhost:3131/api/queue
  ▼
coordinator/assessor.ts
  │  detects risk patterns, estimates complexity → assigns tier
  ▼
coordinator/checkpoint-selector.ts
  │  selects type (random, no-repeat rule) → prepares checkpoint
  ▼
coordinator/checkpoint-generator.ts
  │  generates limerick / haiku / question / audit prompts
  ▼
coordinator/queue.ts
  │  chunks into lines, marks gate trigger points
  ▼
WebSocket → vscode-extension/streamer.ts
  │  inserts lines into active editor at configured speed
  │  at gate marker: pauses, hands off to gate-ui.ts
  ▼
vscode-extension/gate-ui.ts
  │  renders correct UI for checkpoint type
  │  collects developer answer → sends to coordinator
  ▼
coordinator/answer-validator.ts
  │  validates → pass: resume | fail ×3: hard stop + escalate
  ▼
coordinator/audit-logger.ts
  │  { developer, file, method, tier, type, pass/fail, source, timestamp }
  ▼
dashboard/gate_panel.py  (Monitor 1)
  │  WebSocket event → live update
```

---

## 8. Distribution & Packaging

### 8.1 Overview

The entire tool ships as **two things only**:

| # | Deliverable | What it contains | Who needs it |
|---|---|---|---|
| 1 | **VSIX file** (private) | Extension + embedded coordinator + all adapters | Every developer |
| 2 | **Claude Code plugin** (private GitHub) | PostToolUse hook + system prompt | Every developer using Claude Code |

No Docker. No npm global. No external services. Developer machines need nothing pre-installed beyond VS Code and Claude Code.

When Copilot support is added in Phase 2: **same VSIX**, developer changes one setting. No new install, no new plugin.

---

### 8.2 VSIX — Private Distribution (No Marketplace)

The `.vsix` file is hosted as an asset on a **private GitHub Release**. Developers download and install it once. Updates are pushed as new releases; developers re-run the install script.

**Why private, not Marketplace:**
- No public listing — internal tool stays internal
- No Marketplace review process or wait time
- Team controls release cadence completely
- Install is equally simple

**Install — one command per developer:**

```bash
# Mac / Linux
curl -fsSL https://raw.githubusercontent.com/bhimsekhar/ai-code-reviewer/main/install/install.sh | bash

# Windows (PowerShell)
irm https://raw.githubusercontent.com/bhimsekhar/ai-code-reviewer/main/install/install.ps1 | iex
```

**What the install scripts do:**

```bash
# install.sh (Mac/Linux)
#!/bin/bash
set -e
echo "Installing AI Code Reviewer..."

# 1. Download latest VSIX from private GitHub release
LATEST=$(curl -s -H "Authorization: token $GITHUB_TOKEN" \
  https://api.github.com/repos/bhimsekhar/ai-code-reviewer/releases/latest \
  | grep browser_download_url | grep '.vsix' | cut -d'"' -f4)

curl -L -H "Authorization: token $GITHUB_TOKEN" "$LATEST" -o /tmp/ai-code-reviewer.vsix

# 2. Install VSIX into VS Code (no Docker, no npm — self-contained)
code --install-extension /tmp/ai-code-reviewer.vsix
rm /tmp/ai-code-reviewer.vsix

# 3. Install Claude Code plugin
claude /plugin install https://github.com/bhimsekhar/ai-code-reviewer

echo "Done. Reload VS Code to activate."
```

```powershell
# install.ps1 (Windows)
$headers = @{ Authorization = "token $env:GITHUB_TOKEN" }
$release = Invoke-RestMethod "https://api.github.com/repos/bhimsekhar/ai-code-reviewer/releases/latest" -Headers $headers
$vsix = ($release.assets | Where-Object { $_.name -like "*.vsix" }).browser_download_url
Invoke-WebRequest $vsix -Headers $headers -OutFile "$env:TEMP\ai-code-reviewer.vsix"
code --install-extension "$env:TEMP\ai-code-reviewer.vsix"
Remove-Item "$env:TEMP\ai-code-reviewer.vsix"
claude /plugin install https://github.com/bhimsekhar/ai-code-reviewer
Write-Host "Done. Reload VS Code to activate."
```

**That is the complete onboarding.** Two commands (set GITHUB_TOKEN, run script).

---

### 8.3 Switching AI Tools — One Setting Change

When Copilot or Cursor support is needed, the developer changes **one VS Code setting**. No reinstall, no new plugin, no new script.

```jsonc
// VS Code settings.json (user or workspace)
{
  "ai-code-reviewer.adapter": "claude-code"   // Phase 1 — the only option now
  // "ai-code-reviewer.adapter": "copilot"    // Phase 2 — uncomment when ready
}
```

The VSIX ships with the adapter interface already in place. Adding Copilot in Phase 2 is a single new adapter file — the setting above activates it with no other changes.

---

### 8.4 Claude Code Plugin — Private GitHub

The plugin is a folder in the same private repo, installed via Claude Code's plugin system:

```bash
claude /plugin install https://github.com/bhimsekhar/ai-code-reviewer
```

Plugin contents:
```
claude-plugin/
├── plugin.json              # Claude Code plugin manifest
├── hooks/
│   └── post-tool-use.sh     # fires after every Write/Edit → POSTs to coordinator
└── prompts/
    └── system-prompt.md     # embedding rules injected into every Claude session
```

Updates: `claude /plugin update ai-code-reviewer`

When moving to Copilot in Phase 2: this plugin is simply not installed on those machines. The Copilot adapter in the VSIX uses VS Code's file watcher — no hook or plugin needed.

---

### 8.5 Team Config (Checked Into Each Project Repo)

```yaml
# .ai-code-reviewer.yml
adapter: claude-code           # Phase 1 only value. Phase 2 will add: copilot

stream:
  default_speed_ms: 1000
  hard_cap_ms: 100
  reset_after_gate: true

gates:
  mode: hybrid
  logical:
    every_n_methods: 3
    every_n_classes: 1
  lines:
    fallback_every: 80
  tier1_pool:
    limerick: 30
    haiku: 15
    fill_blank: 25
    true_false: 20
    metaphor: 10
  tier2_pool:
    - code_smell
    - what_if
    - sequence_recall
    - name_the_pattern
    pick: 2
  tier3:
    always: [code_smell, security_audit]
  no_repeat_consecutive: true
  max_retries: 3
  escalate_to: tech-lead@bhimsekhar.com
```

---

### 8.6 Future: IntelliJ Plugin

Same adapter interface, different IDE client. The embedded coordinator concept carries over — IntelliJ plugin bundles and spawns it identically. Published to JetBrains Marketplace (public or private). No changes to coordinator or gate logic.

---

## 9. Planning Dashboard — Monitor 1

Python `textual` TUI. No browser required.

```
┌─ TASK TREE ──────────────────────────┐ ┌─ CURRENT GATE ──────────────────┐
│ ▶ Auth Module                        │ │                                  │
│   ✓ Design schema          [done]    │ │  ⛔ GATE ACTIVE                  │
│   ✓ Write V6 migration     [done]    │ │  File: UserService.java          │
│   ⏳ Write UserService     [active]  │ │  Method: validateToken()         │
│      ├─ method 1/3  ✓               │ │  Tier: 3 (auth detected)         │
│      ├─ method 2/3  ✓               │ │  Type: Smell + Security Audit    │
│      └─ method 3/3  ⏳ writing...   │ │  Gate 1: pending                 │
│   ○ Write UserController  [pending]  │ │  Gate 2: pending                 │
│   ○ Write tests           [pending]  │ │                                  │
└──────────────────────────────────────┘ └──────────────────────────────────┘
┌─ AUDIT LOG ─────────────────────────────────────────────────────────────────┐
│ 14:32  findById()        Tier 1  Limerick      ✓ PASSED   dev: alice        │
│ 14:35  updateProfile()   Tier 1  Fill blank    ✓ PASSED   dev: alice        │
│ 14:41  processPayment()  Tier 2  Smell+What-if ✗ FAILED   dev: alice (×2)  │
│ 14:44  processPayment()  Tier 2  Smell+What-if ✓ PASSED   dev: alice        │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 10. Escalation & Team Analytics

Track across developers and time, not just per session.

### 10.1 Escalation Path

```
Wrong answer × 1 → retry, block highlighted in red
Wrong answer × 2 → retry, warning shown
Wrong answer × 3 → hard stop, tech lead notified, block flagged in audit log
                   Developer cannot proceed until tech lead clears it
```

### 10.2 Team Metrics (Weekly Report)

| Developer | Gates Passed | Gates Failed | Fail Rate | Tier 3 Fails | Flag Count |
|---|---|---|---|---|---|
| alice | 47 | 3 | 6% | 0 | 0 |
| bob | 31 | 11 | 26% | 2 | 1 |
| carol | 52 | 1 | 2% | 0 | 0 |

Patterns to watch:
- Consistently failing a specific **checkpoint type** → training gap
- Consistently failing on a specific **file or module** → comprehension gap
- High fail rate on **Tier 3** → security awareness gap
- Suspiciously perfect scores with very fast response times → gaming the system

---

## 11. Claude System Prompt Injection

The Claude Code plugin injects this into every session:

```
You are generating code that will be reviewed via AI Code Reviewer gates.

EMBEDDING RULES:
- At every logical boundary (end of method/class), embed a checkpoint comment
  in the appropriate format based on code complexity and risk.

- Tier 1 (standard): choose randomly from limerick, haiku, fill-blank,
  true/false, metaphor. Vary your choice — never use the same type twice
  in a row within a file.

- Tier 2 (complex, cyclomatic complexity > 5): embed a what-if question
  or sequence hint to prime the developer for the gate.

- Tier 3 (risk patterns detected): embed NOTHING — the gate fires
  automatically. Do not warn the developer it is coming.

- Boilerplate (getters, DTOs, equals/hashCode): embed nothing, no gate.

LIMERICK FORMAT:
// 🎭 [line 1]
//    [line 2]
//    [line 3]
//    [line 4]
//    [line 5]
// ❓ [question whose answer requires understanding the method]

HAIKU FORMAT:
// 🌸 [5 syllables]
//    [7 syllables]
//    [5 syllables]
// ❓ [question]

FILL THE BLANK FORMAT:
// 📝 This method [does X] when [condition A],
//    and [does Y] when [condition B].

TRUE/FALSE FORMAT:
// ✅ Statement 1: [true statement about method]
// ✅ Statement 2: [true statement about method]
// ❌ Statement 3: [false statement — subtly wrong]
// ❓ Which statement above is false?

METAPHOR FORMAT:
// 💡 This is like [real-world metaphor that accurately maps to code behaviour].
// ❓ In this metaphor, what represents [specific code element]?

The checkpoint must be accurate. A wrong limerick or a false metaphor
will cause developers to learn incorrect mental models.
```

---

## 12. Build Phases

### Phase 1 — Claude Code (current build)
- [ ] `adapter.interface.ts` — CodeSourceAdapter + CodePayload contract
- [ ] `claude-code.adapter.ts` — HTTP receiver for PostToolUse hook
- [ ] Embedded coordinator — child process, localhost:3131, no Docker
- [ ] Claude Code plugin — `post-tool-use.sh` hook + `system-prompt.md`
- [ ] VS Code extension — streamer + speed controls (levels 1–4, hold-to-fastforward)
- [ ] Gate UI — multiple choice, fill-the-blank, free-text input
- [ ] Checkpoint types — Limerick, Fill the Blank, Security Audit (Tier 3)
- [ ] Gate triggers — method boundary + risk patterns + fallback line count
- [ ] Boilerplate detection + fast-forward (5× speed, no gate)
- [ ] Highlighter — red block on wrong answer
- [ ] Status bar — speed indicator + gate status + adapter name
- [ ] Audit log — append-only JSON file per project
- [ ] GitHub Actions — build VSIX + publish to private GitHub Release
- [ ] `install.sh` + `install.ps1` — one-liner onboarding (downloads from `bhimsekhar/ai-code-reviewer`)
- [ ] `.ai-code-reviewer.yml` — project config schema

### Phase 2 — Full Checkpoint Library (Claude Code)
- [ ] All Tier 1 types: haiku, true/false, metaphor
- [ ] All Tier 2 types: code smell, what-if, sequence recall, name the pattern
- [ ] Fuzzy answer matching for free-text responses
- [ ] No-repeat-consecutive enforcement
- [ ] Weighted random selection per config

### Phase 3 — Copilot Adapter
- [ ] `copilot.adapter.ts` — FileSystemWatcher + `git diff HEAD` on file save
- [ ] Threshold config for AI-detection (new lines on save)
- [ ] Coordinator-generated checkpoints (no embedded comments)
- [ ] Pre-commit hook to block commit until gates cleared
- [ ] Setting: `ai-code-reviewer.adapter: copilot`

### Phase 4 — Planning Dashboard
- [ ] Python textual TUI for Monitor 1
- [ ] Live task tree with subtasks + status
- [ ] Gate status panel (active gate type, file, method)
- [ ] Audit log panel (scrolling, per developer)

### Phase 5 — Analytics & Enterprise
- [ ] Weekly team report generation
- [ ] Tech lead escalation (email / Slack webhook)
- [ ] IntelliJ plugin (connects to same embedded coordinator concept)
- [ ] JetBrains Marketplace publishing

---

## 13. Open Questions / Decisions Pending

| # | Question | Options | Decision |
|---|---|---|---|
| 1 | Fuzzy match threshold for free-text answers | 60% / 70% / 80% similarity | TBD |
| 2 | Default stream speed | 500ms / 1000ms / configurable | TBD |
| 3 | Max retries before escalation | 2 / 3 / configurable | TBD |
| 4 | Coordinator deployment | Embedded in VSIX (no Docker) | **DECIDED: embedded** |
| 5 | Dashboard: TUI or web app? | Python textual / React | TBD |
| 6 | First IDE to support | VS Code first, IntelliJ later | **DECIDED: VS Code first** |
| 7 | Checkpoint answer: typed or UI controls? | Always typed / mixed by type | TBD |
| 8 | GitHub repo visibility | Private org repo | **DECIDED: private** |
| 9 | VSIX distribution | Private GitHub Releases (no Marketplace) | **DECIDED: private releases** |
| 10 | AI tool adapter — Phase 1 | Claude Code only | **DECIDED** |
| 11 | AI tool adapter — Phase 2 | GitHub Copilot (file watcher + git diff) | **DECIDED: next iteration** |
| 12 | Copilot adapter trigger threshold | > 5 new lines on save = AI-generated? | Defer to Phase 2 |
| 13 | GITHUB_TOKEN for install script | Dev sets env var manually / org secret / other | TBD |

---

## 14. Key Design Principles

1. **Unpredictability is the mechanism** — developers cannot develop a reflex for any specific checkpoint type
2. **Comprehension, not compliance** — every checkpoint proves understanding, not just attention
3. **Proportionate friction** — boilerplate flows fast; critical code flows slow with hard gates
4. **Team visibility** — failures are visible to tech leads, not just the individual
5. **Zero bypass** — no keyboard shortcut, no override flag, no "skip" option
6. **IDE-native feel** — gates appear inside VS Code/IntelliJ, not in a separate window
7. **Claude-generated checkpoints** — the AI that wrote the code also writes the review challenge; it knows what matters

---

*Document generated from design discussion — 2026-03-11*
*Ready for team review. Build starts after sign-off.*
