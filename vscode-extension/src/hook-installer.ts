import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

const INSTALLED_KEY = 'claudeHookInstalled_v2'

const CLAUDE_MD_MARKER = '<!-- ai-code-reviewer-checkpoint-instructions -->'

const CLAUDE_MD_INSTRUCTIONS = `
${CLAUDE_MD_MARKER}
## AI Code Monitor — Checkpoint Embedding (do not remove this section)

When writing any code file, embed a review checkpoint comment at the end of every
non-boilerplate method or function. Follow these rules exactly:

1. **Never embed for boilerplate** — skip getters, setters, toString, equals, hashCode,
   constructors, __init__, empty DTOs.
2. **Never embed for security-sensitive code** — SQL, auth, crypto, file I/O, network,
   env vars, hardcoded secrets. The gate engine handles these automatically.
3. **Always include the 🔑 answer key line** — it is stripped before the developer sees it.
4. **Rotate types** — never use the same type twice in a row within a file.
5. **Be accurate** — every checkpoint must correctly describe the code above it.

### Checkpoint formats (use exactly one per method boundary):

**Limerick 🎭** — for methods with a single clear action:
\`\`\`
// 🎭 [line 1 — 8-9 syllables, rhymes with 2 and 5]
//    [line 2 — 8-9 syllables]
//    [line 3 — 5-6 syllables, rhymes with 4]
//    [line 4 — 5-6 syllables]
//    [line 5 — 8-9 syllables, punchline]
// ❓ [question requiring understanding of what the method does or returns]
// 🔑 [correct answer — stripped before display]
\`\`\`

**Haiku 🌸** — for conditional logic or predicates:
\`\`\`
// 🌸 [5 syllables]
//    [7 syllables]
//    [5 syllables]
// ❓ [question about the condition or outcome]
// 🔑 [correct answer]
\`\`\`

**Fill the Blank 📝** — for methods with two clear cases:
\`\`\`
// 📝 This method returns ___ when [condition A],
//    and [throws/returns] ___ when [condition B].
// ❓ What does this method return/throw when [condition B]?
// 🔑 [exact return value or exception]
\`\`\`

**True / False ✅❌** — for methods with multiple behaviours:
\`\`\`
// ✅ Statement 1: [accurate statement]
// ✅ Statement 2: [accurate statement]
// ❌ Statement 3: [subtly false — plausible but wrong]
// ❓ Which of these three statements is false?
// 🔑 [full text of the false statement verbatim]
\`\`\`

**Metaphor 💡** — for orchestration or pipeline methods:
\`\`\`
// 💡 This is like [real-world analogy that accurately maps to the code].
// ❓ In this metaphor, what represents [specific code element]?
// 🔑 [the real-world equivalent]
\`\`\`
<!-- end ai-code-reviewer-checkpoint-instructions -->
`

/**
 * On first activation, copies the bundled PostToolUse hook into ~/.claude/hooks/
 * and registers it in ~/.claude/settings.json.
 *
 * Idempotent: does nothing if the hook is already registered (checked via globalState).
 * Safe: any failure is caught and surfaced as a warning — Claude Code still works normally.
 */
export async function installClaudeHookIfNeeded(
  context: vscode.ExtensionContext,
  out: vscode.OutputChannel
): Promise<void> {
  if (context.globalState.get(INSTALLED_KEY)) {
    out.appendLine('[HookInstaller] Hook already installed — skipping.')
    return
  }

  const claudeDir   = path.join(os.homedir(), '.claude')
  const hooksDir    = path.join(claudeDir, 'hooks')
  const hookDest    = path.join(hooksDir, 'ai-code-reviewer-post-tool-use.sh')
  const settingsPath = path.join(claudeDir, 'settings.json')
  const hookSrc     = path.join(context.extensionPath, 'resources', 'post-tool-use.sh')

  if (!fs.existsSync(claudeDir)) {
    out.appendLine('[HookInstaller] ~/.claude not found — Claude Code may not be installed. Skipping.')
    return
  }

  if (!fs.existsSync(hookSrc)) {
    out.appendLine('[HookInstaller] Bundled hook script not found — skipping.')
    return
  }

  try {
    fs.mkdirSync(hooksDir, { recursive: true })
    fs.copyFileSync(hookSrc, hookDest)
    if (process.platform !== 'win32') {
      fs.chmodSync(hookDest, 0o755)
    }
    out.appendLine(`[HookInstaller] Hook copied to ${hookDest}`)

    // Read or initialise settings.json
    let settings: Record<string, unknown> = {}
    if (fs.existsSync(settingsPath)) {
      try {
        settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
      } catch {
        out.appendLine('[HookInstaller] settings.json parse error — starting fresh.')
        settings = {}
      }
    }

    // Ensure hooks.PostToolUse array exists
    if (!settings.hooks || typeof settings.hooks !== 'object') {
      settings.hooks = {}
    }
    const hooks = settings.hooks as Record<string, unknown[]>
    if (!Array.isArray(hooks.PostToolUse)) {
      hooks.PostToolUse = []
    }

    // Avoid duplicate registration
    const alreadyRegistered = hooks.PostToolUse.some((entry: unknown) => {
      if (typeof entry !== 'object' || entry === null) return false
      const e = entry as Record<string, unknown>
      return Array.isArray(e.hooks) &&
        (e.hooks as unknown[]).some((h: unknown) => {
          if (typeof h !== 'object' || h === null) return false
          const cmd = (h as Record<string, unknown>).command
          return typeof cmd === 'string' && cmd.includes('ai-code-reviewer')
        })
    })

    if (!alreadyRegistered) {
      hooks.PostToolUse.push({
        matcher: 'Write|Edit',
        hooks: [{ type: 'command', command: hookDest }]
      })
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2))
      out.appendLine('[HookInstaller] settings.json updated.')
    } else {
      out.appendLine('[HookInstaller] Hook already in settings.json — no change.')
    }

    // Write checkpoint embedding instructions to ~/.claude/CLAUDE.md
    // Claude Code reads this at session start — this is how the system prompt is injected.
    const claudeMdPath = path.join(claudeDir, 'CLAUDE.md')
    try {
      const existing = fs.existsSync(claudeMdPath)
        ? fs.readFileSync(claudeMdPath, 'utf8')
        : ''
      if (!existing.includes(CLAUDE_MD_MARKER)) {
        fs.writeFileSync(claudeMdPath, existing + CLAUDE_MD_INSTRUCTIONS)
        out.appendLine('[HookInstaller] Checkpoint instructions written to ~/.claude/CLAUDE.md')
      } else {
        out.appendLine('[HookInstaller] CLAUDE.md already has checkpoint instructions — skipping.')
      }
    } catch (mdErr) {
      out.appendLine(`[HookInstaller] Could not write CLAUDE.md: ${mdErr}`)
    }

    await context.globalState.update(INSTALLED_KEY, true)
    out.appendLine('[HookInstaller] Claude Code hook installed successfully.')

    const choice = await vscode.window.showInformationMessage(
      'AI Code Reviewer: Claude Code hook installed. Reload VS Code to activate.',
      'Reload Now'
    )
    if (choice === 'Reload Now') {
      await vscode.commands.executeCommand('workbench.action.reloadWindow')
    }
  } catch (err) {
    out.appendLine(`[HookInstaller] Failed: ${err}`)
    vscode.window.showWarningMessage(
      'AI Code Reviewer: Could not auto-install the Claude Code hook. ' +
      'Run manually: claude /plugin install https://github.com/bhimsekhar/ai-code-reviewer'
    )
  }
}
