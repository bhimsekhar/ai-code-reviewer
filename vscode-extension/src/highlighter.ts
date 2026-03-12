import * as vscode from 'vscode'

export class Highlighter {
  // Green: lines currently being typed (new / changed code)
  private readonly streamingDecoration: vscode.TextEditorDecorationType

  // Bright green left border on the active "typing cursor" line
  private readonly currentLineDecoration: vscode.TextEditorDecorationType

  // Red: failed gate — must re-read
  private readonly failDecoration: vscode.TextEditorDecorationType

  // Tracks all green ranges currently shown, so we can flip them to red on fail
  private streamingRanges: vscode.Range[] = []

  constructor() {
    // Green — matches VS Code's own diff "inserted line" color so it feels native
    this.streamingDecoration = vscode.window.createTextEditorDecorationType({
      backgroundColor: new vscode.ThemeColor('diffEditor.insertedLineBackground'),
      isWholeLine: true,
      borderWidth: '0 0 0 3px',
      borderStyle: 'solid',
      borderColor: new vscode.ThemeColor('diffEditor.insertedTextBorder'),
      overviewRulerColor: new vscode.ThemeColor('diffEditor.insertedTextBorder'),
      overviewRulerLane: vscode.OverviewRulerLane.Left
    })

    // Active typing line: brighter green border on the right edge
    this.currentLineDecoration = vscode.window.createTextEditorDecorationType({
      backgroundColor: new vscode.ThemeColor('diffEditor.insertedLineBackground'),
      isWholeLine: true,
      after: {
        contentText: '  ◀ writing',
        color: new vscode.ThemeColor('diffEditor.insertedTextBorder'),
        fontStyle: 'italic'
      }
    })

    // Red — failed gate
    this.failDecoration = vscode.window.createTextEditorDecorationType({
      backgroundColor: new vscode.ThemeColor('diffEditor.removedLineBackground'),
      isWholeLine: true,
      borderWidth: '0 0 0 3px',
      borderStyle: 'solid',
      borderColor: '#ff4444',
      overviewRulerColor: '#ff4444',
      overviewRulerLane: vscode.OverviewRulerLane.Left
    })
  }

  /**
   * Add a newly typed line to the green streaming highlight.
   * Call this after each line is inserted. lineNum is 1-based.
   * Accumulates ranges so the entire block typed so far stays green.
   */
  addStreamingLine(editor: vscode.TextEditor, lineNum: number): void {
    const line = Math.max(0, lineNum - 1)
    this.streamingRanges.push(new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER))
    editor.setDecorations(this.streamingDecoration, this.streamingRanges)
  }

  /**
   * Mark the active "cursor" line with the typing indicator annotation.
   * Replaces the previous cursor line. lineNum is 1-based.
   */
  highlightCurrentLine(editor: vscode.TextEditor, lineNum: number): void {
    const line = Math.max(0, lineNum - 1)
    const range = new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER)
    editor.setDecorations(this.currentLineDecoration, [range])
  }

  /**
   * Gate passed — clear all green from the current block.
   * The code fades to normal: it is reviewed and accepted.
   */
  clearStreamingBlock(editor: vscode.TextEditor): void {
    this.streamingRanges = []
    editor.setDecorations(this.streamingDecoration, [])
    editor.setDecorations(this.currentLineDecoration, [])
  }

  /**
   * Gate failed — flip all currently green lines to red.
   * Also clears the cursor indicator.
   */
  failStreamingBlock(editor: vscode.TextEditor): void {
    editor.setDecorations(this.failDecoration, this.streamingRanges)
    editor.setDecorations(this.streamingDecoration, [])
    editor.setDecorations(this.currentLineDecoration, [])
    // Keep streamingRanges so clearAll() can wipe the red too on retry
  }

  /**
   * Explicit red block for a line range (used when retrying after fail).
   * startLine and endLine are 1-based.
   */
  markBlock(editor: vscode.TextEditor, startLine: number, endLine: number): void {
    const start = Math.max(0, startLine - 1)
    const end = Math.max(0, endLine - 1)
    const range = new vscode.Range(start, 0, end, Number.MAX_SAFE_INTEGER)
    editor.setDecorations(this.failDecoration, [range])
  }

  /**
   * After a failed gate retry: remove red, put green back so the developer
   * can see the block highlighted while they re-read and answer again.
   */
  restoreGreenAfterFail(editor: vscode.TextEditor): void {
    editor.setDecorations(this.failDecoration, [])
    editor.setDecorations(this.streamingDecoration, this.streamingRanges)
  }

  /**
   * Clear everything — green, red, cursor. Call at end of stream or on retry.
   */
  clearAll(editor: vscode.TextEditor): void {
    this.streamingRanges = []
    editor.setDecorations(this.streamingDecoration, [])
    editor.setDecorations(this.currentLineDecoration, [])
    editor.setDecorations(this.failDecoration, [])
  }

  dispose(): void {
    this.streamingDecoration.dispose()
    this.currentLineDecoration.dispose()
    this.failDecoration.dispose()
  }
}
