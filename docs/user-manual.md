# AI Code Reviewer — User Manual

---

## 1. What This Tool Does

When you ask Claude Code to write or edit a file, AI Code Reviewer intercepts the generated code and streams it into your VS Code editor one line at a time at a controlled pace. At logical boundaries — after every few methods, at class boundaries, or immediately when security-sensitive code is detected — streaming pauses and a **Review Gate** appears. You must answer a question about the code you just watched being written before streaming continues.

The goal is to prevent blind approval of AI-generated code. You cannot develop a shortcut because the question type is always different and unpredictable.

---

## 2. Prerequisites

- **VS Code** (1.85 or newer)
- **Claude Code** CLI installed and authenticated
- **jq** installed (used by the hook to parse JSON — `brew install jq` on Mac, `sudo apt install jq` on Linux)

---

## 3. Installation

### Mac / Linux
```bash
curl -sSL https://raw.githubusercontent.com/bhimsekhar/ai-code-reviewer/master/install/install.sh | bash
```

### Windows (PowerShell)
```powershell
irm https://raw.githubusercontent.com/bhimsekhar/ai-code-reviewer/master/install/install.ps1 | iex
```

After the installer finishes, **reload VS Code** (`Ctrl+Shift+P` → `Developer: Reload Window`).

On first reload, the extension automatically registers the Claude Code hook in `~/.claude/settings.json`. You will see a notification confirming this.

---

## 4. Your First Review Session

1. Open VS Code and a terminal side by side (or use two monitors)
2. In the terminal, start a Claude Code session in any project:
   ```bash
   claude
   ```
3. Ask Claude to write a file:
   ```
   > write a UserService class with findById, updateProfile, and deleteUser methods
   ```
4. **Switch to VS Code.** The file opens automatically and code begins streaming in, one line at a time, highlighted green.
5. Read the code as it appears.
6. When a gate fires, streaming pauses and the **AI Code Reviewer** panel shows a question.
7. Type your answer and press **Submit**.
8. Correct → green highlight clears, streaming continues.
   Wrong → block turns red, re-read and try again.

---

## 5. The Review Gate Panel

The gate panel appears in the VS Code panel area (bottom or side). It shows:

```
┌──────────────────────────────────────────────────────┐
│  ⛔ REVIEW GATE                          Tier 1 · 🌸  │
├──────────────────────────────────────────────────────┤
│                                                      │
│  🌸 Time flows past one hour —                       │
│     The token fades like morning dew,                │
│     Access denied now.                               │
│                                                      │
│  ❓ What duration determines token expiry?            │
│                                                      │
│  [ type your answer here                           ] │
│                                                      │
│                              [ Submit ]              │
└──────────────────────────────────────────────────────┘
```

For multiple-choice gates (Tier 3 security), you select A / B / C / D instead of free text.

### Answer validation

- **Free-text answers** (Tier 1, Tier 2): fuzzy matched — you do not need to be word-for-word exact. "3600 seconds" and "one hour" and "1 hour" all match "3600 seconds (one hour)".
- **Multiple choice** (Tier 3 security): exact selection required.

### Retry behaviour

| Attempt | What happens |
|---|---|
| Wrong (attempt 1 or 2) | Block turns red for 2 seconds, then green again. Warning shows remaining attempts. |
| Wrong (attempt 3 — final) | Block stays red and is permanently marked. Audit log entry flagged. If `escalate_to` is set, tech lead is notified. Streaming stops for this file. |

---

## 6. Gate Types

### Tier 1 — Standard Code (one gate, random type)

| Type | What you see | What you are asked |
|---|---|---|
| **Limerick 🎭** | 5-line poem in a comment block | What the method does, returns, or checks |
| **Haiku 🌸** | 3-line haiku about the core condition | What condition or outcome the haiku describes |
| **Fill the Blank 📝** | `This method returns ___ when ___` | Complete the blanks accurately |
| **True / False ✅❌** | 3 statements about the code, 1 is false | Which statement is false |
| **Metaphor 💡** | Real-world analogy in a comment | Map a specific element of the metaphor back to the code |

### Tier 2 — Complex Code (two gates, both required)

Fires when cyclomatic complexity > 5 or more than 8 methods in the file. Two questions chosen from:

- **Code Smell** — name one concern in the block (free text)
- **What Would Happen If** — what exception or behaviour occurs if X is null/missing?
- **Sequence Recall** — in what order do these operations run?
- **Name the Pattern** — what design pattern is used?
- **Dependency Map** — what does this method depend on to work correctly?

### Tier 3 — Security Code (immediate, fixed gate)

Fires immediately when any of the following patterns are detected:

| Pattern | Example |
|---|---|
| SQL query | `executeQuery`, `SELECT ... FROM`, `prepareStatement` |
| Authentication | `authenticate`, `verifyPassword`, `validateCredential` |
| Authorisation | `hasRole`, `@PreAuthorize`, `checkPermission` |
| Cryptography | `BCrypt`, `encrypt`, `MessageDigest`, `Cipher` |
| File I/O | `FileInputStream`, `readFile`, `Files.`, `Paths.get` |
| Network calls | `HttpClient`, `fetch(`, `axios.`, `RestTemplate` |
| Environment variables | `process.env.`, `System.getenv`, `os.environ` |
| Hardcoded secrets | `password = "..."`, `api_key = "..."` (8+ chars) |

The gate shows a security-specific multiple-choice question. Example:

```
⚡ SECURITY GATE — SQL detected

Is user input safely handled before reaching this SQL operation?

  A) Yes — parameterised query / prepared statement
  B) No — string concatenation used
  C) Partially — some inputs checked
  D) Cannot determine from code
```

### Boilerplate — No Gate (fast-forward)

The following code is streamed at 5× speed (200ms/line) with no gate:

- Getters and setters (`getX`, `setX`, `isX`, `hasX`)
- `toString`, `equals`, `hashCode`
- `constructor`, `__init__`, `__str__`, `__repr__`
- Empty DTOs / POJOs with no logic body

---

## 7. Speed Controls

Code streams at **1000ms per line** (1×) by default — a comfortable reading pace. You can adjust speed while streaming is in progress.

### Keyboard shortcuts

| Action | Shortcut | Result |
|---|---|---|
| Speed up one level | `Ctrl+]` | 1× → 2× → 5× → 10× |
| Slow down one level | `Ctrl+[` | 10× → 5× → 2× → 1× |
| Reset to default | `Ctrl+Shift+R` | Returns to 1× immediately |

### Speed levels

| Level | Speed label | ms per line | Readable? |
|---|---|---|---|
| 1 (default) | 1× | 1000ms | Yes — comfortable |
| 2 | 2× | 500ms | Yes |
| 3 | 5× | 200ms | Yes, if focused |
| 4 (maximum) | 10× | 100ms | Barely — hard cap |

**Hard cap: 100ms per line.** This cannot be overridden by any keyboard shortcut or config setting. Below 100ms it is physically impossible to read code, which would defeat the purpose of the tool.

### Speed reset after gates

By default (`reset_after_gate: true`), speed resets to 1× after every gate — pass or fail. This prevents a developer from speeding through everything after the first gate. The developer must consciously re-apply fast-forward for each new block.

To disable this, set `reset_after_gate: false` in `.ai-code-reviewer.yml`.

---

## 8. Status Bar

The status bar item at the bottom of VS Code shows the current state at all times:

| State | Status bar shows |
|---|---|
| Idle | `▶ AI Reviewer  Ready` |
| Streaming | `▶ AI Reviewer  Streaming UserService.java  1×` |
| Gate active (Tier 1) | `⛔ AI Reviewer  Gate — Tier 1` |
| Gate active (Tier 3) | `⚡ AI Reviewer  Security Gate — Tier 3` |
| Gate passed | `✓ AI Reviewer  Gate Passed` |
| Gate failed | `✗ AI Reviewer  Gate Failed (2/3)` |

---

## 9. Audit Log

Every gate — pass or fail — is recorded in `.ai-code-reviewer-audit.jsonl` in your workspace root. Each line is a JSON entry:

```json
{
  "timestamp": "2026-03-12T14:23:01.456Z",
  "file": "/path/to/UserService.java",
  "tier": 1,
  "checkpointType": "haiku",
  "passed": true,
  "attempts": 1,
  "source": "claude-code",
  "durationMs": 8432
}
```

| Field | Meaning |
|---|---|
| `tier` | 1, 2, 3, or "skip" |
| `checkpointType` | limerick, haiku, fill_blank, true_false, metaphor, security_audit |
| `passed` | true / false |
| `attempts` | how many tries before pass or max retries |
| `durationMs` | how long the developer took to answer (ms) |

Add `.ai-code-reviewer-audit.jsonl` to `.gitignore` if you do not want audit history committed, or commit it to track comprehension metrics over time.

---

## 10. Escalation

If `escalate_to` is set in `.ai-code-reviewer.yml` and a developer fails a gate 3 times:

- The code block is permanently highlighted in the editor
- An error message appears: *"Gate failed after 3 attempts. Tech lead (email) has been notified."*
- The audit log entry is flagged with `passed: false`

Currently the notification is shown in VS Code. Integration with email or Slack can be added via the `escalate_to` webhook URL.

---

## 11. Common Scenarios

### "I know this code — can I skip the gate?"

No. That is intentional. The gate is not a judgment on your ability — it is a forcing function that ensures you read the code. Speed up with `Ctrl+]` if the streaming pace feels too slow.

### "The gate fired in the middle of a long method"

The fallback line trigger (`fallback_every: 80`) ensures no block goes more than 80 lines without a gate. Increase this value in `.ai-code-reviewer.yml` if you prefer less frequent interruptions.

### "I got a security gate on code I wrote myself"

The risk pattern detector is regex-based and fires on patterns like `executeQuery` or `process.env.` regardless of context. This is intentional — security-sensitive code always warrants a deliberate review, even if you wrote it.

### "Streaming started but no gate appeared"

The code was classified as boilerplate (all getters/setters/constructors) or the file was too short to trigger a gate. Check the VS Code Output panel (`View → Output → AI Code Reviewer`) for detailed logs.

### "Port 3131 is already in use"

Another VS Code window is running the extension. The coordinator binds to `localhost:3131`. Change the port in VS Code settings (`ai-code-reviewer.coordinatorPort`) and update the hook's `COORDINATOR_URL` in `~/.claude/hooks/ai-code-reviewer-post-tool-use.sh` to match.

---

## 12. Output Panel

The extension writes detailed logs to the VS Code Output panel. Open it with `View → Output` and select `AI Code Reviewer` from the dropdown. Useful for diagnosing missed gates, failed hook connections, or coordinator errors.
