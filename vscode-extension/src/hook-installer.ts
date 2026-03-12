import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

const INSTALLED_KEY = 'claudeHookInstalled_v1'

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

  // Windows: the hook is a bash script. Offer a manual path instead.
  if (process.platform === 'win32') {
    out.appendLine('[HookInstaller] Windows detected — skipping auto-install of bash hook.')
    const choice = await vscode.window.showInformationMessage(
      'AI Code Reviewer: To wire up Claude Code on Windows, run the one-line installer in PowerShell.',
      'Copy Command'
    )
    if (choice === 'Copy Command') {
      await vscode.env.clipboard.writeText(
        'irm https://raw.githubusercontent.com/bhimsekhar/ai-code-reviewer/main/install/install.ps1 | iex'
      )
      vscode.window.showInformationMessage('Command copied to clipboard.')
    }
    await context.globalState.update(INSTALLED_KEY, true)
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
    fs.chmodSync(hookDest, 0o755)
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
