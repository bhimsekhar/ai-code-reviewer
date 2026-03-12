import * as vscode from 'vscode'
import { Gate } from './types'
import { validate } from './coordinator/answer-validator'

/**
 * Renders the review gate as a proper panel tab — sits next to
 * Output / Problems / Debug Console at the bottom of VS Code.
 *
 * Registered via contributes.views[panel] in package.json.
 * Call show(gate) to present a gate; it returns a Promise<boolean>.
 */
export class GateViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'ai-code-reviewer.gateView'

  private _view?: vscode.WebviewView
  private _resolveAnswer?: (passed: boolean) => void

  // ─── WebviewViewProvider ────────────────────────────────────────────────────

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView
    webviewView.webview.options = { enableScripts: true }
    webviewView.webview.html = this._idleHtml()

    webviewView.webview.onDidReceiveMessage(msg => {
      if (msg.type === 'submit' && this._resolveAnswer) {
        const resolve = this._resolveAnswer
        this._resolveAnswer = undefined

        const gate: Gate = msg.gate as Gate
        const raw: string = msg.answer ?? ''
        const passed = this._evaluate(gate, raw)

        resolve(passed)

        // Leave the view showing the result briefly before idle
        webviewView.webview.html = passed
          ? this._resultHtml('✅ Correct — streaming continues.', '#4ec9b0')
          : this._resultHtml('❌ Incorrect — re-read the highlighted block.', '#f44747')
      }

      if (msg.type === 'skip' && this._resolveAnswer) {
        // Developer dismissed / closed — count as fail
        const resolve = this._resolveAnswer
        this._resolveAnswer = undefined
        resolve(false)
        webviewView.webview.html = this._resultHtml('❌ Gate skipped — counted as fail.', '#f44747')
      }
    })

    webviewView.onDidDispose(() => {
      this._view = undefined
    })
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  async show(gate: Gate): Promise<boolean> {
    // Bring the panel tab into focus
    await vscode.commands.executeCommand(`${GateViewProvider.viewType}.focus`)

    return new Promise(resolve => {
      this._resolveAnswer = resolve
      if (this._view) {
        this._view.webview.html = this._gateHtml(gate)
      } else {
        // View not yet created — fall back after a short wait
        setTimeout(() => {
          if (this._view) {
            this._view.webview.html = this._gateHtml(gate)
          } else {
            // Still not available — resolve as fail so streaming isn't blocked forever
            resolve(false)
          }
        }, 1000)
      }
    })
  }

  // ─── Answer evaluation (mirrors gate-ui logic) ──────────────────────────────

  private _evaluate(gate: Gate, raw: string): boolean {
    const type = gate.checkpointType

    if (type === 'true_false') {
      // raw is the full label text of the selected option
      return validate(gate, raw)
    }

    if (type === 'security_audit') {
      // raw is the letter 'A'/'B'/'C'/'D'
      return validate(gate, raw)
    }

    // free-text: awareness gate if no answer key
    if (!gate.embedded?.answerKey) {
      return raw.trim().length > 0
    }

    return validate(gate, raw)
  }

  // ─── HTML builders ───────────────────────────────────────────────────────────

  private _idleHtml(): string {
    return this._shell(`
      <div class="idle">
        <div class="idle-icon">🛡️</div>
        <div class="idle-text">Waiting for the next review gate…</div>
        <div class="idle-sub">Gates appear here when the AI streams code that needs your attention.</div>
      </div>
    `)
  }

  private _resultHtml(message: string, color: string): string {
    return this._shell(`
      <div class="result" style="color:${color}">
        <div class="result-text">${this._esc(message)}</div>
      </div>
    `)
  }

  private _gateHtml(gate: Gate): string {
    const tierLabel = gate.tier === 3 ? '⚡ SECURITY' : gate.tier === 2 ? '🔶 TIER 2' : '🔷 TIER 1'
    const typeLabel = gate.checkpointType.replace(/_/g, ' ').toUpperCase()
    const lineRange = `Lines ${gate.codeStartLine}–${gate.codeEndLine}`

    let body = ''

    switch (gate.checkpointType) {
      case 'security_audit':
        body = this._securityBody(gate)
        break
      case 'true_false':
        body = this._trueFalseBody(gate)
        break
      case 'fill_blank':
        body = this._fillBlankBody(gate)
        break
      default:
        body = this._freeTextBody(gate)
    }

    return this._shell(`
      <div class="gate">
        <div class="gate-header">
          <span class="gate-tier">${tierLabel}</span>
          <span class="gate-type">${typeLabel}</span>
          <span class="gate-lines">${lineRange}</span>
        </div>
        ${body}
      </div>
    `, gate)
  }

  // ─── Gate-type bodies ────────────────────────────────────────────────────────

  private _freeTextBody(gate: Gate): string {
    const typeEmoji: Record<string, string> = {
      limerick: '🎭',
      haiku: '🌸',
      metaphor: '💡'
    }
    const emoji = typeEmoji[gate.checkpointType] ?? '💬'
    const question = gate.embedded?.question
      ?? 'In one sentence, describe what the code block you just read does.'

    return `
      <div class="question">${emoji} ${this._esc(question)}</div>
      <textarea id="ans" class="textarea" rows="4" placeholder="Your answer…" autofocus></textarea>
      <div class="actions">
        <button class="btn-primary" onclick="submitText()">Submit</button>
      </div>
      <script>
        const ans = document.getElementById('ans')
        ans.addEventListener('keydown', e => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submitText()
        })
        function submitText() {
          const v = ans.value.trim()
          if (!v) { ans.style.borderColor = '#f44747'; return }
          vscode.postMessage({ type: 'submit', gate: GATE, answer: v })
        }
      </script>
    `
  }

  private _fillBlankBody(gate: Gate): string {
    const embedded = gate.embedded
    const prompt = embedded?.rawText
      ? embedded.rawText
          .split('\n')
          .map(l => l.replace(/^\s*\/\/\s*/, ''))
          .join(' ')
          .replace(/📝\s*/, '')
          .trim()
      : 'Complete the statement about the code above.'

    return `
      <div class="question">📝 ${this._esc(prompt)}</div>
      <input id="ans" class="input" type="text" placeholder="Fill in the blank…" autofocus />
      <div class="actions">
        <button class="btn-primary" onclick="submitText()">Submit</button>
      </div>
      <script>
        const ans = document.getElementById('ans')
        ans.addEventListener('keydown', e => { if (e.key === 'Enter') submitText() })
        function submitText() {
          vscode.postMessage({ type: 'submit', gate: GATE, answer: ans.value })
        }
      </script>
    `
  }

  private _trueFalseBody(gate: Gate): string {
    const embedded = gate.embedded
    if (!embedded) {
      return this._freeTextBody(gate)
    }

    const statementLines = embedded.rawText
      .split('\n')
      .map(l => l.replace(/^\s*\/\/\s*/, '').trim())
      .filter(l => l.startsWith('✅') || l.startsWith('❌'))
      .map(l => l.replace(/^[✅❌]\s*/, '').trim())

    if (statementLines.length === 0) {
      return this._freeTextBody(gate)
    }

    const opts = statementLines
      .map((s, i) => `
        <label class="option" id="opt${i}">
          <input type="radio" name="tf" value="${this._esc(s)}" onchange="selectOpt(this)" />
          <span>${this._esc(s)}</span>
        </label>
      `)
      .join('')

    return `
      <div class="question">✅❌ Which of these statements is <strong>FALSE</strong>?</div>
      <div class="options">${opts}</div>
      <div class="actions">
        <button class="btn-primary" onclick="submitChoice()">Submit</button>
      </div>
      <script>
        let selected = null
        function selectOpt(el) { selected = el.value }
        function submitChoice() {
          if (!selected) return
          vscode.postMessage({ type: 'submit', gate: GATE, answer: selected })
        }
      </script>
    `
  }

  private _securityBody(gate: Gate): string {
    if (!gate.security) {
      return `
        <div class="question">⚡ Describe one potential security concern in the code above.</div>
        <textarea id="ans" class="textarea" rows="4" placeholder="Your observation…" autofocus></textarea>
        <div class="actions">
          <button class="btn-primary" onclick="submitText()">Submit</button>
        </div>
        <script>
          function submitText() {
            vscode.postMessage({ type: 'submit', gate: GATE, answer: document.getElementById('ans').value })
          }
        </script>
      `
    }

    const sec = gate.security
    const riskLabel = sec.riskPattern.replace(/_/g, ' ').toUpperCase()
    const prefixes = ['A', 'B', 'C', 'D']
    const opts = sec.options
      .map((opt, i) => `
        <label class="option" id="opt${i}">
          <input type="radio" name="sec" value="${prefixes[i]}" onchange="selectOpt(this)" />
          <span><strong>${prefixes[i]})</strong> ${this._esc(opt)}</span>
        </label>
      `)
      .join('')

    return `
      <div class="risk-badge">⚡ RISK: ${this._esc(riskLabel)}</div>
      <div class="question">${this._esc(sec.question)}</div>
      <div class="options">${opts}</div>
      <div class="actions">
        <button class="btn-primary" onclick="submitChoice()">Submit</button>
      </div>
      <script>
        let selected = null
        function selectOpt(el) { selected = el.value }
        function submitChoice() {
          if (!selected) return
          vscode.postMessage({ type: 'submit', gate: GATE, answer: selected })
        }
      </script>
    `
  }

  // ─── HTML shell with VS Code theming ────────────────────────────────────────

  private _shell(body: string, gate?: Gate): string {
    const gateJson = gate ? JSON.stringify(gate).replace(/</g, '\\u003c') : 'null'
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
  :root {
    --gap: 12px;
    --radius: 4px;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-panel-background, var(--vscode-editor-background));
    padding: 16px;
    height: 100vh;
    overflow-y: auto;
  }

  /* ── Idle ── */
  .idle {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 80vh;
    opacity: 0.45;
    text-align: center;
    gap: 8px;
  }
  .idle-icon { font-size: 36px; }
  .idle-text { font-size: 14px; font-weight: 600; }
  .idle-sub  { font-size: 11px; max-width: 280px; line-height: 1.5; }

  /* ── Result ── */
  .result {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 80vh;
    font-size: 16px;
    font-weight: 600;
    text-align: center;
  }

  /* ── Gate ── */
  .gate { display: flex; flex-direction: column; gap: var(--gap); }

  .gate-header {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    padding-bottom: 10px;
    border-bottom: 1px solid var(--vscode-panel-border, #333);
  }
  .gate-tier  { font-weight: 700; font-size: 13px; }
  .gate-type  {
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
    border-radius: 3px;
    padding: 1px 6px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .gate-lines {
    margin-left: auto;
    font-size: 11px;
    opacity: 0.6;
  }

  .risk-badge {
    background: #5a1a1a;
    color: #f4857a;
    border-left: 3px solid #f44747;
    padding: 6px 10px;
    border-radius: var(--radius);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.05em;
  }

  .question {
    font-size: 13px;
    line-height: 1.6;
    color: var(--vscode-foreground);
  }

  .textarea {
    width: 100%;
    min-height: 80px;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, #555);
    border-radius: var(--radius);
    padding: 8px;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    resize: vertical;
    outline: none;
  }
  .textarea:focus { border-color: var(--vscode-focusBorder); }

  .input {
    width: 100%;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, #555);
    border-radius: var(--radius);
    padding: 7px 8px;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    outline: none;
  }
  .input:focus { border-color: var(--vscode-focusBorder); }

  .options { display: flex; flex-direction: column; gap: 6px; }
  .option {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, #444);
    border-radius: var(--radius);
    padding: 8px 10px;
    cursor: pointer;
    transition: border-color 0.1s;
  }
  .option:hover { border-color: var(--vscode-focusBorder); }
  .option input[type="radio"] { margin-top: 2px; flex-shrink: 0; accent-color: var(--vscode-focusBorder); }
  .option span { font-size: 13px; line-height: 1.4; }

  .actions { display: flex; justify-content: flex-end; gap: 8px; padding-top: 4px; }

  .btn-primary {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none;
    border-radius: var(--radius);
    padding: 6px 18px;
    font-size: 13px;
    cursor: pointer;
    font-family: var(--vscode-font-family);
  }
  .btn-primary:hover { background: var(--vscode-button-hoverBackground); }
  .btn-primary:active { opacity: 0.8; }

  .hint { font-size: 11px; opacity: 0.5; }
</style>
</head>
<body>
<script>
  const vscode = acquireVsCodeApi()
  const GATE = ${gateJson}
</script>
${body}
</body>
</html>`
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private _esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }
}
