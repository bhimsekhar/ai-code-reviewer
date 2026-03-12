import * as vscode from 'vscode'

export class StatusBar {
  private readonly item: vscode.StatusBarItem
  private currentSpeedMs = 1000

  constructor() {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100
    )
    this.item.show()
  }

  private speedLabel(ms: number): string {
    if (ms >= 1000) { return '1×' }
    if (ms >= 500) { return '2×' }
    if (ms >= 200) { return '5×' }
    return '10×'
  }

  setReady(): void {
    this.item.text = '▶ AI Reviewer | Claude Code | Ready'
    this.item.tooltip = 'AI Code Reviewer is running on port 3131'
    this.item.backgroundColor = undefined
    this.item.color = undefined
  }

  setStreaming(file: string, speedLabel: string): void {
    const shortName = file.split(/[\\/]/).pop() ?? file
    this.item.text = `▶ AI Reviewer | Streaming ${shortName} | ${speedLabel}`
    this.item.tooltip = `Streaming ${file} at ${speedLabel}`
    this.item.backgroundColor = undefined
    this.item.color = new vscode.ThemeColor('statusBarItem.prominentForeground')
  }

  setGateActive(tier: number | string): void {
    this.item.text = `⛔ AI Reviewer | GATE ACTIVE (Tier ${tier}) | Answer to continue`
    this.item.tooltip = `Review gate is active — Tier ${tier}`
    this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground')
    this.item.color = undefined
  }

  setGatePassed(): void {
    this.item.text = '✓ AI Reviewer | Gate Passed | Ready'
    this.item.tooltip = 'Gate passed — streaming will resume'
    this.item.backgroundColor = undefined
    this.item.color = new vscode.ThemeColor('testing.iconPassed')
  }

  setGateFailed(attempts: number, max: number): void {
    this.item.text = `✗ AI Reviewer | Failed (${attempts}/${max}) | Re-read and retry`
    this.item.tooltip = `Gate failed ${attempts} of ${max} allowed attempts`
    this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground')
    this.item.color = undefined
  }

  setSpeed(speedMs: number): void {
    this.currentSpeedMs = speedMs
    const label = this.speedLabel(speedMs)
    // Update the text if it currently shows a streaming message
    if (this.item.text.includes('Streaming')) {
      const parts = this.item.text.split(' | ')
      if (parts.length >= 3) {
        parts[2] = label
        this.item.text = parts.join(' | ')
      }
    }
  }

  dispose(): void {
    this.item.dispose()
  }
}
