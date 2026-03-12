import * as http from 'http'
import express from 'express'
import { EventEmitter } from 'events'
import {
  CodePayload,
  Gate,
  ProjectConfig,
  SecurityQuestion,
  StreamBlock,
  StreamLine,
  Tier
} from '../types'
import { ClaudeCodeAdapter } from '../adapters/claude-code.adapter'
import { assess } from './assessor'
import { parse } from './checkpoint-parser'
import { select, shouldGate } from './checkpoint-selector'

// ─── Security question templates (Phase 1, keyed by risk pattern) ───────────

const SECURITY_QUESTIONS: Record<string, SecurityQuestion> = {
  sql: {
    question: 'Is user input safely handled before reaching this SQL operation?',
    options: [
      'Yes — parameterised query / prepared statement',
      'No — string concatenation used',
      'Partially — some inputs checked',
      'Cannot determine from code'
    ],
    correctIndex: 0,
    riskPattern: 'sql'
  },
  authentication: {
    question: 'What happens if authentication fails in this block?',
    options: [
      'Exception is thrown',
      'Returns null/empty',
      'Logs and continues',
      'Cannot determine'
    ],
    correctIndex: -1,
    riskPattern: 'authentication'
  },
  cryptography: {
    question: 'Is a strong algorithm used here (BCrypt, AES-256, SHA-256 or stronger)?',
    options: [
      'Yes — strong algorithm confirmed',
      'No — weak algorithm (MD5, SHA1, DES)',
      'Not determinable from code',
      'No cryptography in this block'
    ],
    correctIndex: -1,
    riskPattern: 'cryptography'
  },
  hardcoded_secret: {
    question: 'A hardcoded credential or secret was detected. What should be done?',
    options: [
      'Move to environment variable',
      'Move to secrets manager (Vault, AWS Secrets)',
      'It is a test value — acceptable',
      'It is not a real secret'
    ],
    correctIndex: -1,
    riskPattern: 'hardcoded_secret'
  },
  authorization: {
    question: 'Is the authorisation check correctly placed — before the protected operation executes?',
    options: [
      'Yes — check occurs before sensitive operation',
      'No — check occurs after sensitive operation',
      'Partial — some paths are unchecked',
      'Cannot determine from code'
    ],
    correctIndex: 0,
    riskPattern: 'authorization'
  },
  file_io: {
    question: 'Is the file path validated or sanitised before use in this operation?',
    options: [
      'Yes — path is validated/sanitised',
      'No — raw user input reaches file operation',
      'Partial — some inputs checked',
      'Cannot determine from code'
    ],
    correctIndex: -1,
    riskPattern: 'file_io'
  },
  network: {
    question: 'Are connections to external hosts validated or restricted in this block?',
    options: [
      'Yes — host/URL is validated',
      'No — arbitrary URL from user input',
      'Partial — some validation present',
      'Cannot determine from code'
    ],
    correctIndex: -1,
    riskPattern: 'network'
  },
  env_vars: {
    question: 'Is there a safe fallback if the environment variable is absent?',
    options: [
      'Yes — default value or exception with clear message',
      'No — null/undefined propagates silently',
      'Partial',
      'Cannot determine from code'
    ],
    correctIndex: -1,
    riskPattern: 'env_vars'
  }
}

// ─── Method boundary detection ──────────────────────────────────────────────

const JAVA_METHOD_RE = /(public|private|protected|static|final)\s+[\w<>\[\]]+\s+\w+\s*\([^{]*\)\s*(?:throws\s+[\w,\s]+)?\s*\{/gm
const TS_METHOD_RE = /(?:^|\s)(?:async\s+)?(?:function\s+\w+|\w+\s*[=:]\s*(?:async\s+)?(?:function|\([^)]*\)\s*=>))\s*[({]/gm
const PY_METHOD_RE = /^(?:async\s+)?def\s+\w+\s*\(/gm

function countMethodsInRange(lines: string[], language: string): number {
  const chunk = lines.join('\n')
  const re =
    language === 'python' ? PY_METHOD_RE :
    language === 'java' || language === 'kotlin' ? JAVA_METHOD_RE :
    TS_METHOD_RE
  const m = chunk.match(new RegExp(re.source, re.flags))
  return m ? m.length : 0
}

// ─── CoordinatorService ──────────────────────────────────────────────────────

export class CoordinatorService extends EventEmitter {
  private readonly app: express.Application
  private server: http.Server | null = null
  private adapter: ClaudeCodeAdapter | null = null
  private lastCheckpointType: import('../types').CheckpointType | null = null

  constructor(
    private readonly config: ProjectConfig,
    private readonly port: number,
    private readonly out?: import('vscode').OutputChannel
  ) {
    super()
    this.app = express()
    this.app.use(express.json({ limit: '10mb' }))
  }

  private log(msg: string): void {
    this.out?.appendLine(`[Coordinator] ${msg}`)
    console.log(`[AI Code Reviewer][Coordinator] ${msg}`)
  }

  /**
   * Register an adapter and mount its route(s) on the Express app.
   */
  registerAdapter(adapter: ClaudeCodeAdapter): void {
    this.adapter = adapter
    this.app.use(adapter.getRouter())
  }

  start(): void {
    this.server = http.createServer(this.app)
    // Bind to localhost only — never expose externally
    this.server.listen(this.port, '127.0.0.1', () => {
      this.log(`Listening on 127.0.0.1:${this.port}`)
    })
    this.server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        this.log(`ERROR: Port ${this.port} already in use. Is another VS Code window running?`)
      } else {
        this.log(`ERROR: ${err.message}`)
      }
    })
  }

  stop(): void {
    if (this.server) {
      this.server.close()
      this.server = null
    }
  }

  /**
   * Process an incoming code payload:
   * 1. Parse embedded checkpoints and strip answer keys
   * 2. Assess the code (tier, risk patterns)
   * 3. Split into StreamBlocks with gates
   * 4. Emit 'streamReady'
   */
  async receive(payload: CodePayload): Promise<void> {
    try {
      this.log(`Processing: ${payload.toolName} → ${payload.file} (${payload.language})`)

      // Step 1: Parse embedded checkpoints, strip 🔑 lines
      const { checkpoints, cleanedContent } = parse(payload.content)
      this.log(`Parsed ${checkpoints.length} checkpoint(s)`)

      // Step 2: Assess the cleaned content
      const assessment = assess(cleanedContent, payload.language)
      this.log(`Assessment: tier=${assessment.tier}, risk=[${assessment.riskPatterns.join(',')}], boilerplate=${assessment.isBoilerplate}`)

      // Step 3: Split into lines and build stream blocks
      const rawLines = cleanedContent.split('\n')
      const blocks = this.buildBlocks(rawLines, payload.language, assessment, checkpoints)
      this.log(`Built ${blocks.length} block(s) with ${blocks.filter(b => b.gate).length} gate(s)`)

      // Step 4: Emit with cleaned payload
      const cleanedPayload: CodePayload = { ...payload, content: cleanedContent }
      this.emit('streamReady', { payload: cleanedPayload, blocks })
    } catch (err) {
      this.log(`ERROR in receive: ${err}`)
      throw err
    }
  }

  private buildBlocks(
    rawLines: string[],
    language: string,
    assessment: ReturnType<typeof assess>,
    checkpoints: import('../types').EmbeddedCheckpoint[]
  ): StreamBlock[] {
    const blocks: StreamBlock[] = []
    let currentBlockLines: StreamLine[] = []
    let linesSinceLastGate = 0
    let methodsSinceLastGate = 0
    let lineNum = 1

    // Assign checkpoints in order — pop the next one for each gate that fires.
    // Line-number matching is fragile after 🔑 lines are stripped (line numbers shift).
    const checkpointQueue = [...checkpoints]

    const flushBlock = (gate?: Gate, isBoilerplate = false): void => {
      if (currentBlockLines.length > 0 || gate) {
        blocks.push({
          lines: [...currentBlockLines],
          gate,
          isBoilerplate
        })
        currentBlockLines = []
      }
      linesSinceLastGate = 0
      methodsSinceLastGate = 0
    }

    for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i]
      const currentLineNum = lineNum++

      currentBlockLines.push({ content: line, lineNum: currentLineNum })
      linesSinceLastGate++

      // Count methods in current batch
      const methodsInLine = countMethodsInRange([line], language)
      methodsSinceLastGate += methodsInLine

      const riskDetected = assessment.riskPatterns.length > 0
      const triggerGate =
        shouldGate(linesSinceLastGate, methodsSinceLastGate, this.config) ||
        (riskDetected && methodsSinceLastGate >= 1 && linesSinceLastGate >= 10)

      if (triggerGate) {
        const tier: Tier =
          riskDetected ? 3 :
          assessment.tier === 'skip' ? 'skip' :
          assessment.tier

        if (tier === 'skip') {
          flushBlock(undefined, true)
          continue
        }

        // Pop the next embedded checkpoint (order-based, not line-number based)
        const nextCheckpoint = checkpointQueue.shift()

        // Use the embedded checkpoint's type if available, otherwise select randomly
        const cpType = nextCheckpoint
          ? nextCheckpoint.type
          : select(assessment, this.config, this.lastCheckpointType)
        this.lastCheckpointType = cpType

        const blockStart = currentBlockLines.length > 0
          ? currentBlockLines[0].lineNum
          : currentLineNum
        const gate: Gate = {
          id: uuidv4(),
          tier,
          checkpointType: cpType,
          embedded: nextCheckpoint,
          codeStartLine: blockStart,
          codeEndLine: currentLineNum,
          attempts: 0
        }

        // Tier 3: attach security question based on first matched risk pattern
        if (tier === 3 && assessment.riskPatterns.length > 0) {
          const riskKey = assessment.riskPatterns[0]
          gate.security = SECURITY_QUESTIONS[riskKey] ?? SECURITY_QUESTIONS['sql']
        }

        flushBlock(gate, assessment.isBoilerplate)
      }
    }

    // Flush any remaining lines as the last block
    if (currentBlockLines.length > 0) {
      blocks.push({
        lines: currentBlockLines,
        gate: undefined,
        isBoilerplate: assessment.isBoilerplate
      })
    }

    return blocks
  }
}

// Re-export uuid so server.ts is self-contained with dynamic import
function uuidv4(): string {
  // Simple UUID v4 implementation (no external dep required at runtime)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}
