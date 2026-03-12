import * as vscode from 'vscode'
import * as fs from 'fs'
import { CodePayload, ProjectConfig, StreamBlock } from './types'
import { GateViewProvider } from './gate-view-provider'
import { Highlighter } from './highlighter'
import { AuditLogger } from './coordinator/audit-logger'
import { StatusBar } from './status-bar'

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export class Streamer {
  private readonly SPEED_LEVELS = [1000, 500, 200, 100]
  private readonly HARD_CAP_MS = 100
  private currentLevelIndex = 0
  private isStreaming = false
  private stopRequested = false
  private fastForwardActive = false

  constructor(
    private readonly gateUi: GateViewProvider,
    private readonly highlighter: Highlighter,
    private readonly auditLogger: AuditLogger,
    private readonly statusBar: StatusBar,
    private readonly config: ProjectConfig,
    private readonly out?: import('vscode').OutputChannel
  ) {}

  private log(msg: string): void {
    this.out?.appendLine(`[Streamer] ${msg}`)
    console.log(`[AI Code Reviewer][Streamer] ${msg}`)
  }

  // ─── Speed controls ────────────────────────────────────────────────────────

  speedUp(): void {
    if (this.currentLevelIndex < this.SPEED_LEVELS.length - 1) {
      this.currentLevelIndex++
    }
    const ms = this.SPEED_LEVELS[this.currentLevelIndex]
    this.statusBar.setSpeed(ms)
    vscode.window.showInformationMessage(
      `AI Reviewer speed: ${this.speedLabel(ms)}`
    )
  }

  speedDown(): void {
    if (this.currentLevelIndex > 0) {
      this.currentLevelIndex--
    }
    const ms = this.SPEED_LEVELS[this.currentLevelIndex]
    this.statusBar.setSpeed(ms)
    vscode.window.showInformationMessage(
      `AI Reviewer speed: ${this.speedLabel(ms)}`
    )
  }

  resetSpeed(): void {
    this.currentLevelIndex = 0
    this.statusBar.setSpeed(this.SPEED_LEVELS[0])
    vscode.window.showInformationMessage('AI Reviewer speed reset to 1×')
  }

  toggleFastForward(): void {
    this.fastForwardActive = !this.fastForwardActive
    const label = this.fastForwardActive ? '10× Fast Forward ON' : 'Fast Forward OFF'
    vscode.window.showInformationMessage(`AI Reviewer: ${label}`)
    this.statusBar.setSpeed(this.effectiveSpeedMs)
  }

  stop(): void {
    this.stopRequested = true
  }

  private get effectiveSpeedMs(): number {
    if (this.fastForwardActive) {
      return this.HARD_CAP_MS
    }
    const ms = this.SPEED_LEVELS[this.currentLevelIndex]
    return Math.max(ms, this.HARD_CAP_MS)
  }

  private speedLabel(ms: number): string {
    if (ms >= 1000) { return '1×' }
    if (ms >= 500) { return '2×' }
    if (ms >= 200) { return '5×' }
    return '10×'
  }

  // ─── Main stream method ────────────────────────────────────────────────────

  async stream(
    payload: CodePayload,
    blocks: StreamBlock[],
    _config: ProjectConfig
  ): Promise<'passed' | 'failed' | 'aborted'> {
    if (this.isStreaming) {
      vscode.window.showWarningMessage(
        'AI Code Reviewer: Already streaming a file. Please wait for it to finish.'
      )
      return 'aborted'
    }

    this.isStreaming = true
    this.stopRequested = false

    const shortName = payload.file.split(/[\\/]/).pop() ?? payload.file
    this.log(`stream() called for: ${shortName} (${blocks.length} blocks)`)

    // Open or create the target document
    let document: vscode.TextDocument
    let editor: vscode.TextEditor

    try {
      // Normalise path for VS Code on Windows
      const normalised = payload.file.replace(/\//g, '\\')
      if (!fs.existsSync(normalised)) {
        fs.writeFileSync(normalised, '', 'utf8')
        this.log(`Created empty file: ${normalised}`)
      }

      const uri = vscode.Uri.file(normalised)
      this.log(`Opening document: ${uri.fsPath}`)
      document = await vscode.workspace.openTextDocument(uri)
      editor = await vscode.window.showTextDocument(document, {
        preview: false,
        preserveFocus: false,
        viewColumn: vscode.ViewColumn.One
      })
      this.log(`Document opened in editor`)
    } catch (err) {
      const msg = `Could not open file ${payload.file}: ${err}`
      this.log(`ERROR: ${msg}`)
      vscode.window.showErrorMessage(`AI Code Reviewer: ${msg}`)
      this.isStreaming = false
      return 'aborted'
    }

    // Save original content as backup
    const originalContent = document.getText()
    this.log(`Backup saved (${originalContent.length} chars). Clearing file...`)

    // Notify developer streaming is starting
    vscode.window.showInformationMessage(
      `AI Code Reviewer: Streaming ${shortName} — watch the file being reviewed line by line.`
    )

    // Clear the editor
    try {
      const cleared = await editor.edit(editBuilder => {
        const fullRange = new vscode.Range(
          document.positionAt(0),
          document.positionAt(document.getText().length)
        )
        editBuilder.delete(fullRange)
      })
      this.log(`File cleared: edit success=${cleared}`)
    } catch (err) {
      const msg = `Could not clear file: ${err}`
      this.log(`ERROR: ${msg}`)
      vscode.window.showErrorMessage(`AI Code Reviewer: ${msg}`)
      this.isStreaming = false
      return 'aborted'
    }

    this.statusBar.setStreaming(shortName, this.speedLabel(this.effectiveSpeedMs))

    let overallResult: 'passed' | 'failed' | 'aborted' = 'passed'

    try {
      for (const block of blocks) {
        if (this.stopRequested) {
          overallResult = 'aborted'
          break
        }

        // Each block starts with a fresh green slate — lines accumulate until gate fires
        // (clearStreamingBlock is called on gate pass; clearAll on gate fail + retry)
        if (!block.isBoilerplate) {
          this.highlighter.clearAll(editor)
        }

        // Stream all lines in this block
        for (const streamLine of block.lines) {
          if (this.stopRequested) {
            overallResult = 'aborted'
            break
          }

          const lineText = streamLine.content

          // Use the current document line count as the insertion point
          const currentDoc = editor.document
          const lastLine = currentDoc.lineCount - 1
          const lastLineLength = currentDoc.lineAt(lastLine).text.length
          const pos = new vscode.Position(lastLine, lastLineLength)

          await editor.edit(editBuilder => {
            // If this is the very first line (document is empty), insert without leading newline
            if (currentDoc.getText().length === 0) {
              editBuilder.insert(pos, lineText)
            } else {
              editBuilder.insert(pos, '\n' + lineText)
            }
          })

          // The inserted line index in the document (0-based)
          const insertedLineIndex = editor.document.lineCount - 1

          // Scroll to keep the new line visible
          const revealRange = new vscode.Range(insertedLineIndex, 0, insertedLineIndex, 0)
          editor.revealRange(revealRange, vscode.TextEditorRevealType.InCenterIfOutsideViewport)

          // Boilerplate fast-forwards without green — only reviewed code gets coloured
          if (!block.isBoilerplate) {
            // Paint the new line green — accumulates across the whole block so
            // the developer sees the full "diff" of new code since the last gate
            this.highlighter.addStreamingLine(editor, insertedLineIndex + 1)  // 1-based

            // "◀ writing" cursor annotation on the active line only
            this.highlighter.highlightCurrentLine(editor, insertedLineIndex + 1)
          }

          // Re-read speed on every line so Ctrl+Alt+] / Ctrl+Alt+[ take effect immediately
          const lineSpeedMs = block.isBoilerplate
            ? Math.max(200, this.HARD_CAP_MS)
            : this.effectiveSpeedMs
          await sleep(lineSpeedMs)
        }

        if (overallResult === 'aborted') {
          break
        }

        // Gate handling
        if (block.gate) {
          const gate = block.gate
          gate.startedAt = Date.now()
          this.log(`Gate fired: tier=${gate.tier}, type=${gate.checkpointType}, lines ${gate.codeStartLine}-${gate.codeEndLine}`)

          this.statusBar.setGateActive(gate.tier)
          // Green stays visible while the developer reads and answers the gate.
          // It clears on pass (clearStreamingBlock) or turns red on fail (failStreamingBlock).

          let gatePassed = false
          const maxRetries = this.config.gates.max_retries

          while (gate.attempts < maxRetries && !gatePassed) {
            const result = await this.gateUi.show(gate)
            gate.attempts++

            if (result) {
              gatePassed = true
              gate.passed = true
              this.statusBar.setGatePassed()

              // Green → clear: block is reviewed and accepted
              this.highlighter.clearStreamingBlock(editor)

              // Reset speed and fast-forward after gate if configured
              if (this.config.stream.reset_after_gate) {
                this.currentLevelIndex = 0
                this.fastForwardActive = false
              }
            } else {
              gate.passed = false
              this.statusBar.setGateFailed(gate.attempts, maxRetries)

              // Green → red: wrong answer, developer must re-read the block
              this.highlighter.failStreamingBlock(editor)

              if (gate.attempts < maxRetries) {
                vscode.window.showWarningMessage(
                  `Incorrect — re-read the red block (${maxRetries - gate.attempts} attempt(s) remaining).`
                )
                // Hold the red highlight so developer re-reads the flagged block
                await sleep(2000)
                // Restore green so developer sees the block clearly on retry
                this.highlighter.restoreGreenAfterFail(editor)
              }
            }
          }

          // Log to audit
          const durationMs = gate.startedAt ? Date.now() - gate.startedAt : 0
          this.auditLogger.log({
            timestamp: new Date().toISOString(),
            file: payload.file,
            tier: gate.tier,
            checkpointType: gate.embedded?.type ?? gate.security?.riskPattern ?? 'security_audit',
            passed: gatePassed,
            attempts: gate.attempts,
            source: payload.source,
            durationMs
          })

          if (!gatePassed) {
            // Max retries exhausted
            this.highlighter.markBlock(editor, gate.codeStartLine, gate.codeEndLine)

            if (this.config.gates.escalate_to) {
              vscode.window.showErrorMessage(
                `AI Code Reviewer: Gate failed after ${maxRetries} attempts. ` +
                `Tech lead (${this.config.gates.escalate_to}) has been notified. ` +
                `Code block is flagged in the audit log.`
              )
            } else {
              vscode.window.showErrorMessage(
                `AI Code Reviewer: Gate failed after ${maxRetries} attempts. ` +
                `Please review the highlighted code block with your team before proceeding.`
              )
            }

            overallResult = 'failed'
            break
          }
        }
      }
    } catch (err) {
      // On any error: restore original content
      try {
        await editor.edit(editBuilder => {
          const fullRange = new vscode.Range(
            editor.document.positionAt(0),
            editor.document.positionAt(editor.document.getText().length)
          )
          editBuilder.replace(fullRange, originalContent)
        })
      } catch (restoreErr) {
        console.error('[AI Code Reviewer] Failed to restore file content:', restoreErr)
      }
      vscode.window.showErrorMessage(`AI Code Reviewer: Streaming error: ${err}`)
      overallResult = 'aborted'
    } finally {
      this.isStreaming = false
      this.statusBar.setReady()
      this.highlighter.clearAll(editor)
    }

    return overallResult
  }
}
