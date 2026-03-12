import express from 'express'
import { CodePayload } from '../types'
import { CodeSourceAdapter } from './adapter.interface'

export class ClaudeCodeAdapter implements CodeSourceAdapter {
  readonly name = 'claude-code'
  readonly displayName = 'Claude Code'

  private onCodeCallback: ((payload: CodePayload) => void) | null = null

  initialize(onCode: (payload: CodePayload) => void): void {
    this.onCodeCallback = onCode
  }

  /**
   * Returns an Express router that handles POST /api/inbound.
   * The CoordinatorService mounts this router on its Express app.
   */
  getRouter(): express.Router {
    const router = express.Router()

    router.post('/api/inbound', (req: express.Request, res: express.Response) => {
      const body = req.body as Record<string, unknown>

      if (!body || typeof body !== 'object') {
        res.status(400).json({ error: 'Request body must be JSON' })
        return
      }

      // Support both 'content' (Write tool) and 'new_string' (Edit tool)
      const content =
        (body.content as string | undefined) ??
        (body.new_string as string | undefined)

      const file = body.file as string | undefined
      const language = (body.language as string | undefined) ?? 'unknown'
      const source = body.source as string | undefined
      const toolName = body.toolName as string | undefined

      if (!file) {
        res.status(400).json({ error: 'Missing required field: file' })
        return
      }

      if (content === undefined || content === null) {
        res.status(400).json({ error: 'Missing required field: content or new_string' })
        return
      }

      const payload: CodePayload = {
        file,
        content: String(content),
        language,
        source: (source as 'claude-code') ?? 'claude-code',
        toolName: (toolName === 'Edit' ? 'Edit' : 'Write') as 'Write' | 'Edit'
      }

      if (this.onCodeCallback) {
        this.onCodeCallback(payload)
      }

      res.status(202).json({ status: 'accepted' })
    })

    return router
  }

  dispose(): void {
    this.onCodeCallback = null
  }
}
