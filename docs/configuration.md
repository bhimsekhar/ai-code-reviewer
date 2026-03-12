# AI Code Reviewer — Configuration Reference

---

## Overview

Configuration lives in two places:

| Location | Scope | When it applies |
|---|---|---|
| `.ai-code-reviewer.yml` in project root | Per-project | Read on extension activation and each review session |
| VS Code Settings (`Ctrl+,` → search "AI Code Reviewer") | Global / workspace | Coordinator port, default speed |

Project-level `.ai-code-reviewer.yml` takes precedence over VS Code settings for streaming and gate behaviour. Any option omitted from the file falls back to the built-in defaults shown below.

---

## Full `.ai-code-reviewer.yml` Reference

Copy this file to the root of any project you want to review with gates.

```yaml
# .ai-code-reviewer.yml

# ─── Adapter ────────────────────────────────────────────────────────────────
# Which AI tool adapter to use.
# Phase 1: 'claude-code' only. Phase 2 will add 'copilot'.
adapter: claude-code

# ─── Streaming ──────────────────────────────────────────────────────────────
stream:
  # Milliseconds per line at the default speed level.
  # Keyboard shortcuts adjust from this base: Ctrl+] speeds up, Ctrl+[ slows down.
  # Valid range: 100–5000. Values below 100 are clamped to the hard cap.
  default_speed_ms: 1000          # default: 1000

  # Absolute minimum ms/line. Cannot be overridden by keyboard shortcuts or config.
  # Do not change this unless you have a very good reason.
  hard_cap_ms: 100                # default: 100

  # Reset speed to default after every gate (pass or fail).
  # true  = developer must consciously re-apply speed each block (recommended)
  # false = speed persists across gates (easier, less rigorous)
  reset_after_gate: true          # default: true

# ─── Gates ───────────────────────────────────────────────────────────────────
gates:
  # Gate trigger mode.
  # 'hybrid' is the only supported mode. Gates fire when ANY condition is met first.
  mode: hybrid                    # default: hybrid

  logical:
    # Fire a gate after this many non-boilerplate methods since the last gate.
    # Lower = more frequent gates = more thorough but more interruption.
    # Recommended range: 1–5
    every_n_methods: 3            # default: 3

    # Fire a gate at every class boundary.
    # 1 = always gate at class boundaries. 0 = skip class-boundary gates.
    every_n_classes: 1            # default: 1

  lines:
    # If no logical boundary is reached within this many lines, fire a gate anyway.
    # Prevents very long methods from going unreviewed.
    # Recommended range: 40–150
    fallback_every: 80            # default: 80

  # Weighted probability pool for Tier 1 checkpoint types.
  # Values are relative weights — they do not need to sum to 100.
  # Set a type's weight to 0 to disable it entirely.
  tier1_pool:
    limerick:   30    # 5-line poem summarising method behaviour
    haiku:      15    # 3-line haiku describing condition or logic
    fill_blank: 25    # "This method returns ___ when ___"
    true_false: 20    # 3 statements, identify the false one
    metaphor:   10    # Real-world analogy, map an element back to code

  # Prevent the same checkpoint type from appearing twice in a row.
  # true = re-roll if selected type matches the previous gate
  no_repeat_consecutive: true     # default: true

  # Maximum wrong answers before streaming halts and the block is flagged.
  max_retries: 3                  # default: 3

  # Email or Slack webhook to notify when a developer exhausts max_retries.
  # Leave empty to disable escalation. Notifications appear in VS Code only.
  escalate_to: ""                 # default: "" (disabled)
```

---

## Configuration Profiles

### High-rigour team (frequent gates, no fast-forward reset disabled)

```yaml
stream:
  default_speed_ms: 1000
  reset_after_gate: true
gates:
  logical:
    every_n_methods: 2
    every_n_classes: 1
  lines:
    fallback_every: 50
  tier1_pool:
    limerick:   20
    haiku:      20
    fill_blank: 20
    true_false: 20
    metaphor:   20
  max_retries: 2
  escalate_to: "tech-lead@yourcompany.com"
```

### Solo developer (relaxed pace, less interruption)

```yaml
stream:
  default_speed_ms: 500
  reset_after_gate: false
gates:
  logical:
    every_n_methods: 5
    every_n_classes: 1
  lines:
    fallback_every: 120
  max_retries: 3
  escalate_to: ""
```

### Security-focused team (boost security audit weight, disable lighter types)

```yaml
stream:
  default_speed_ms: 1000
  reset_after_gate: true
gates:
  logical:
    every_n_methods: 3
  lines:
    fallback_every: 80
  tier1_pool:
    limerick:   0     # disabled
    haiku:      0     # disabled
    fill_blank: 40
    true_false: 40
    metaphor:   20
  max_retries: 3
  escalate_to: "security@yourcompany.com"
```

### Fast review (maximum speed, gates still enforced)

```yaml
stream:
  default_speed_ms: 200     # starts at 5× by default
  reset_after_gate: false
gates:
  logical:
    every_n_methods: 4
  lines:
    fallback_every: 100
  max_retries: 3
```

---

## VS Code Settings

Access via `Ctrl+,` → search `AI Code Reviewer`.

| Setting | Default | Description |
|---|---|---|
| `ai-code-reviewer.adapter` | `claude-code` | Which adapter to use. `claude-code` only in Phase 1. |
| `ai-code-reviewer.coordinatorPort` | `3131` | Port for the embedded HTTP coordinator. Change if 3131 is in use. |
| `ai-code-reviewer.defaultSpeedMs` | `1000` | Overridden by `.ai-code-reviewer.yml` if present. |

### Changing the coordinator port

If port 3131 is in use by another application:

1. Change in VS Code settings: `ai-code-reviewer.coordinatorPort` → e.g. `3232`
2. Update the hook: edit `~/.claude/hooks/ai-code-reviewer-post-tool-use.sh`, change `COORDINATOR_URL` to match:
   ```bash
   COORDINATOR_URL="http://localhost:3232/api/inbound"
   ```
3. Reload VS Code.

---

## Tier 1 Checkpoint Pool — Weight Reference

The `tier1_pool` values control how often each type appears. Example: with the default weights, across 100 gates you would expect approximately:

| Type | Default weight | Expected frequency |
|---|---|---|
| limerick | 30 | ~30% |
| fill_blank | 25 | ~25% |
| true_false | 20 | ~20% |
| haiku | 15 | ~15% |
| metaphor | 10 | ~10% |

To run with **only fill-blank and true/false** questions (useful for teams that find poetry distracting):

```yaml
tier1_pool:
  limerick:   0
  haiku:      0
  fill_blank: 50
  true_false: 50
  metaphor:   0
```

---

## Risk Pattern Detection

Tier 3 gates fire automatically when any of these patterns are found in the generated code. These cannot be disabled via config — they are the integrity boundary of the tool.

| Pattern key | Triggers on |
|---|---|
| `sql` | `executeQuery`, `createStatement`, `prepareStatement`, `SELECT ... FROM`, `INSERT INTO`, `UPDATE ... SET`, `DELETE FROM` |
| `authentication` | `authenticate`, `.login(`, `verifyPassword`, `checkPassword`, `validateCredential` |
| `authorization` | `hasRole`, `hasAuthority`, `isAuthorized`, `@PreAuthorize`, `@Secured`, `checkPermission` |
| `cryptography` | `encrypt`, `decrypt`, `BCrypt`, `MessageDigest`, `Cipher.`, `SecretKey`, `KeyPair`, `.hash(` |
| `file_io` | `new File(`, `FileInputStream`, `FileOutputStream`, `Files.`, `Paths.get`, `readFile`, `writeFile`, `createWriteStream` |
| `network` | `HttpClient`, `RestTemplate`, `WebClient`, `new URL(`, `fetch(`, `axios.`, `URLConnection` |
| `env_vars` | `System.getenv`, `process.env.`, `getenv(`, `os.environ` |
| `hardcoded_secret` | Any variable named `password`, `secret`, `api_key`, `apikey`, or `token` assigned a string value of 8+ characters |

---

## Boilerplate Detection

The following method types are automatically fast-forwarded with no gate:

| Pattern | Examples |
|---|---|
| Getters | `getUser()`, `getId()`, `getName()` |
| Setters | `setUser()`, `setId()`, `setName()` |
| Boolean accessors | `isActive()`, `hasPermission()` |
| Standard overrides | `toString()`, `equals()`, `hashCode()` |
| Constructors | `constructor()`, `__init__()` |
| Python magic methods | `__str__()`, `__repr__()` |

A method is treated as boilerplate only if its body is 3 lines or fewer. A setter with a validation block inside it is **not** boilerplate and will be gated normally.

---

## Audit Log Fields

The audit log at `.ai-code-reviewer-audit.jsonl` records every gate:

```json
{
  "timestamp": "2026-03-12T14:23:01.456Z",
  "file": "/workspace/src/UserService.java",
  "tier": 1,
  "checkpointType": "haiku",
  "passed": true,
  "attempts": 1,
  "source": "claude-code",
  "durationMs": 8432
}
```

| Field | Values | Meaning |
|---|---|---|
| `tier` | `1`, `2`, `3`, `"skip"` | Gate tier |
| `checkpointType` | `limerick`, `haiku`, `fill_blank`, `true_false`, `metaphor`, `security_audit` | Which type fired |
| `passed` | `true` / `false` | Whether the developer answered correctly within max_retries |
| `attempts` | 1–max_retries | Number of attempts used |
| `durationMs` | number | Time from gate shown to final answer (ms) |

To exclude from git:
```
# .gitignore
.ai-code-reviewer-audit.jsonl
```
