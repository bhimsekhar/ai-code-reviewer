import * as vscode from 'vscode'
import { Gate } from './types'
import { validate } from './coordinator/answer-validator'

export class GateUI {
  /**
   * Show the appropriate gate UI for the given gate.
   * Returns true if the developer passed, false if they failed or cancelled.
   */
  async show(gate: Gate): Promise<boolean> {
    // Use the type the coordinator selected. For tier 1/2 without an embedded
    // checkpoint (Claude didn't write one yet), fall back to a generic free-text
    // question so the developer still has to articulate what the code does.
    const type = gate.checkpointType

    switch (type) {
      case 'limerick':
        return this.showFreeTextGate(gate, 'Limerick Gate 🎭')

      case 'haiku':
        return this.showFreeTextGate(gate, 'Haiku Gate 🌸')

      case 'metaphor':
        return this.showFreeTextGate(gate, 'Metaphor Gate 💡')

      case 'fill_blank':
        return this.showFillBlankGate(gate)

      case 'true_false':
        return this.showTrueFalseGate(gate)

      case 'security_audit':
        return this.showSecurityAuditGate(gate)

      default:
        return this.showFreeTextGate(gate, 'Review Gate')
    }
  }

  // ─── Free-text gates (limerick, haiku, metaphor) ────────────────────────

  private async showFreeTextGate(gate: Gate, title: string): Promise<boolean> {
    const embedded = gate.embedded
    const question = embedded?.question ?? 'In one sentence, describe what the code block you just read does.'

    const answer = await vscode.window.showInputBox({
      title: `⛔ ${title}  (lines ${gate.codeStartLine}–${gate.codeEndLine})`,
      prompt: question,
      placeHolder: 'Your answer...',
      ignoreFocusOut: true
    })

    if (answer === undefined || answer.trim().length === 0) {
      return false
    }

    // If no embedded answer key, any non-empty answer passes (awareness gate)
    if (!embedded?.answerKey) {
      return true
    }

    return validate(gate, answer)
  }

  // ─── Fill the blank gate ─────────────────────────────────────────────────

  private async showFillBlankGate(gate: Gate): Promise<boolean> {
    const embedded = gate.embedded
    const promptText = embedded?.rawText
      ? embedded.rawText
          .split('\n')
          .map(l => l.replace(/^\s*\/\/\s*/, ''))
          .join(' ')
          .replace(/📝\s*/, '')
          .trim()
      : 'Complete the statement about the code above.'

    const answer = await vscode.window.showInputBox({
      title: 'Fill the Blank Gate 📝',
      prompt: `⛔ GATE — ${promptText}`,
      placeHolder: 'Fill in the blanks...',
      ignoreFocusOut: true
    })

    if (answer === undefined) {
      return false
    }

    return validate(gate, answer)
  }

  // ─── True / False gate ───────────────────────────────────────────────────

  private async showTrueFalseGate(gate: Gate): Promise<boolean> {
    const embedded = gate.embedded

    if (!embedded) {
      return false
    }

    // Parse statements from the embedded text — ✅ and ❌ lines
    const statementLines = embedded.rawText
      .split('\n')
      .map(l => l.replace(/^\s*\/\/\s*/, '').trim())
      .filter(l => l.startsWith('✅') || l.startsWith('❌'))
      .map(l => l.replace(/^[✅❌]\s*/, '').trim())

    if (statementLines.length === 0) {
      // Fallback to free-text
      return this.showFreeTextGate(gate, 'True/False Gate ✅❌')
    }

    const items: vscode.QuickPickItem[] = statementLines.map(s => ({
      label: s,
      description: ''
    }))

    const selected = await vscode.window.showQuickPick(items, {
      title: 'True/False Gate ✅❌ — Which of these statements is FALSE?',
      placeHolder: 'Select the false statement...',
      ignoreFocusOut: true
    })

    if (selected === undefined) {
      return false
    }

    return validate(gate, selected.label)
  }

  // ─── Security audit gate ─────────────────────────────────────────────────

  private async showSecurityAuditGate(gate: Gate): Promise<boolean> {
    if (!gate.security) {
      // No security question — show an awareness prompt
      const answer = await vscode.window.showInputBox({
        title: 'Security Gate ⚡',
        prompt: '⛔ SECURITY GATE — Describe one potential security concern in the code above.',
        placeHolder: 'Your observation...',
        ignoreFocusOut: true
      })
      return answer !== undefined && answer.trim().length > 0
    }

    const sec = gate.security
    const prefixes = ['A', 'B', 'C', 'D']

    const items: vscode.QuickPickItem[] = sec.options.map((opt, idx) => ({
      label: `${prefixes[idx]}) ${opt}`,
      description: ''
    }))

    const riskLabel = sec.riskPattern.replace(/_/g, ' ').toUpperCase()
    const selected = await vscode.window.showQuickPick(items, {
      title: `⚡ SECURITY GATE — Risk: ${riskLabel}`,
      placeHolder: sec.question,
      ignoreFocusOut: true
    })

    if (selected === undefined) {
      return false
    }

    // Extract letter from selection
    const letter = selected.label.charAt(0)
    return validate(gate, letter)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
