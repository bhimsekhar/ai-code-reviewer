import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'
import * as yaml from 'js-yaml'
import { CoordinatorService } from './coordinator/server'
import { ClaudeCodeAdapter } from './adapters/claude-code.adapter'
import { Streamer } from './streamer'
import { GateViewProvider } from './gate-view-provider'
import { Highlighter } from './highlighter'
import { StatusBar } from './status-bar'
import { AuditLogger } from './coordinator/audit-logger'
import { DEFAULT_CONFIG, ProjectConfig } from './types'
import { installClaudeHookIfNeeded } from './hook-installer'

/**
 * Load .ai-code-reviewer.yml from the workspace root.
 * Falls back to DEFAULT_CONFIG if not found or invalid.
 */
function loadConfig(): ProjectConfig {
  const workspaceFolders = vscode.workspace.workspaceFolders
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return DEFAULT_CONFIG
  }

  const configPath = path.join(
    workspaceFolders[0].uri.fsPath,
    '.ai-code-reviewer.yml'
  )

  if (!fs.existsSync(configPath)) {
    return DEFAULT_CONFIG
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf8')
    const loaded = yaml.load(raw) as Partial<ProjectConfig>

    // Deep merge with defaults
    return {
      adapter: loaded.adapter ?? DEFAULT_CONFIG.adapter,
      stream: {
        ...DEFAULT_CONFIG.stream,
        ...(loaded.stream ?? {})
      },
      gates: {
        ...DEFAULT_CONFIG.gates,
        ...(loaded.gates ?? {}),
        logical: {
          ...DEFAULT_CONFIG.gates.logical,
          ...(loaded.gates?.logical ?? {})
        },
        lines: {
          ...DEFAULT_CONFIG.gates.lines,
          ...(loaded.gates?.lines ?? {})
        },
        tier1_pool: loaded.gates?.tier1_pool ?? DEFAULT_CONFIG.gates.tier1_pool
      }
    }
  } catch (err) {
    console.error('[AI Code Reviewer] Failed to load .ai-code-reviewer.yml:', err)
    vscode.window.showWarningMessage(
      'AI Code Reviewer: Could not parse .ai-code-reviewer.yml — using defaults.'
    )
    return DEFAULT_CONFIG
  }
}

export function activate(context: vscode.ExtensionContext): void {
  // Output channel — visible in VS Code's Output panel (dropdown: "AI Code Reviewer")
  const out = vscode.window.createOutputChannel('AI Code Reviewer')
  out.appendLine('[AI Code Reviewer] Activating...')

  // Load project config
  const config = loadConfig()

  const resolvedPort =
    vscode.workspace.getConfiguration('ai-code-reviewer').get<number>('coordinatorPort') ?? 3131

  const workspacePath =
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? ''

  out.appendLine(`[AI Code Reviewer] Workspace: ${workspacePath || '(none)'}`)
  out.appendLine(`[AI Code Reviewer] Coordinator port: ${resolvedPort}`)

  // Initialise components
  const statusBar = new StatusBar()
  const gateViewProvider = new GateViewProvider()
  const highlighter = new Highlighter()
  const auditLogger = new AuditLogger(workspacePath)
  const streamer = new Streamer(gateViewProvider, highlighter, auditLogger, statusBar, config, out)
  const coordinator = new CoordinatorService(config, resolvedPort, out)
  const adapter = new ClaudeCodeAdapter()

  // Wire adapter → coordinator
  adapter.initialize((payload) => {
    out.appendLine(`[Adapter] Received payload: ${payload.toolName} → ${payload.file}`)
    coordinator.receive(payload).catch(err => {
      const msg = `Error in coordinator.receive: ${err}`
      out.appendLine(`[Coordinator] ERROR: ${msg}`)
      vscode.window.showErrorMessage(`AI Code Reviewer: ${msg}`)
    })
  })
  coordinator.registerAdapter(adapter)

  // Wire coordinator → streamer
  coordinator.on('streamReady', (event: { payload: import('./types').CodePayload; blocks: import('./types').StreamBlock[] }) => {
    out.appendLine(`[Coordinator] streamReady — ${event.blocks.length} block(s), file: ${event.payload.file}`)
    streamer.stream(event.payload, event.blocks, config).catch(err => {
      const msg = `Streaming error: ${err}`
      out.appendLine(`[Streamer] ERROR: ${msg}`)
      vscode.window.showErrorMessage(`AI Code Reviewer: ${msg}`)
    })
  })

  // Auto-install Claude Code hook on first activation
  installClaudeHookIfNeeded(context, out).catch(err => {
    out.appendLine(`[HookInstaller] Unexpected error: ${err}`)
  })

  // Start the embedded coordinator server
  coordinator.start()
  statusBar.setReady()
  out.appendLine(`[AI Code Reviewer] Coordinator started on port ${resolvedPort}`)
  out.show(true)  // open Output panel on activation so developer sees logs immediately

  // Register the gate panel webview provider
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      GateViewProvider.viewType,
      gateViewProvider,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  )

  // Register commands
  context.subscriptions.push(
    out,
    vscode.commands.registerCommand('ai-code-reviewer.speedUp', () => {
      streamer.speedUp()
    }),
    vscode.commands.registerCommand('ai-code-reviewer.speedDown', () => {
      streamer.speedDown()
    }),
    vscode.commands.registerCommand('ai-code-reviewer.resetSpeed', () => {
      streamer.resetSpeed()
    }),
    vscode.commands.registerCommand('ai-code-reviewer.startReview', () => {
      vscode.window.showInformationMessage(
        'AI Code Reviewer is active. Next AI-generated file will be streamed automatically.'
      )
    }),
    statusBar,
    highlighter,
    {
      dispose: () => {
        coordinator.stop()
        adapter.dispose()
      }
    }
  )

  out.appendLine('[AI Code Reviewer] Activated successfully.')
}

export function deactivate(): void {
  // Cleanup is handled via context.subscriptions dispose chain
}
