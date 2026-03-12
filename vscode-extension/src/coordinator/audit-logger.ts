import * as fs from 'fs'
import * as path from 'path'
import { AuditEntry } from '../types'

export class AuditLogger {
  private readonly auditFilePath: string

  constructor(workspacePath: string) {
    this.auditFilePath = path.join(workspacePath, '.ai-code-reviewer-audit.jsonl')
  }

  /**
   * Append a single audit entry as a JSON line to the audit file.
   */
  log(entry: AuditEntry): void {
    try {
      const line = JSON.stringify(entry) + '\n'
      fs.appendFileSync(this.auditFilePath, line, { encoding: 'utf8' })
    } catch (err) {
      // Non-fatal — audit logging failure should not interrupt streaming
      console.error('[AI Code Reviewer] Failed to write audit log:', err)
    }
  }

  /**
   * Read the last n entries from the audit log file.
   * Returns an empty array if the file does not exist.
   */
  getRecent(n: number): AuditEntry[] {
    try {
      if (!fs.existsSync(this.auditFilePath)) {
        return []
      }
      const content = fs.readFileSync(this.auditFilePath, 'utf8')
      const lines = content
        .split('\n')
        .filter(l => l.trim().length > 0)
      const recent = lines.slice(-n)
      return recent.map(l => {
        try {
          return JSON.parse(l) as AuditEntry
        } catch {
          return null
        }
      }).filter((e): e is AuditEntry => e !== null)
    } catch (err) {
      console.error('[AI Code Reviewer] Failed to read audit log:', err)
      return []
    }
  }
}
