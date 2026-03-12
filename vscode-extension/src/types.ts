export type Tier = 1 | 2 | 3 | 'skip'

export type CheckpointType =
  | 'limerick'
  | 'haiku'
  | 'fill_blank'
  | 'true_false'
  | 'metaphor'
  | 'security_audit'

export interface CodePayload {
  file: string          // absolute path
  content: string       // full file content (Write) or new_string (Edit)
  language: string      // java, typescript, python, etc.
  source: 'claude-code'
  toolName: 'Write' | 'Edit'
}

export interface EmbeddedCheckpoint {
  type: CheckpointType
  rawText: string        // full comment block
  question: string       // text after ❓
  answerKey: string      // text after 🔑 (stripped before display to dev)
  lineStart: number      // first line of checkpoint comment (1-based)
  lineEnd: number        // last line of checkpoint comment (1-based)
}

export interface SecurityQuestion {
  question: string
  options: string[]      // A, B, C, D
  correctIndex: number   // 0-based
  riskPattern: string
}

export interface Gate {
  id: string
  tier: Tier
  checkpointType: CheckpointType  // always set — drives gate-ui display
  embedded?: EmbeddedCheckpoint   // present when Claude embedded a checkpoint
  security?: SecurityQuestion     // present for Tier 3
  codeStartLine: number
  codeEndLine: number
  attempts: number
  passed?: boolean
  startedAt?: number
}

export interface StreamLine {
  content: string
  lineNum: number   // 1-based, position in final file
}

export interface StreamBlock {
  lines: StreamLine[]
  gate?: Gate
  isBoilerplate: boolean
}

export interface AuditEntry {
  timestamp: string
  file: string
  tier: number | string
  checkpointType: string
  passed: boolean
  attempts: number
  source: string
  durationMs: number
}

export interface ProjectConfig {
  adapter: 'claude-code'
  stream: {
    default_speed_ms: number
    hard_cap_ms: number
    reset_after_gate: boolean
  }
  gates: {
    mode: 'hybrid'
    logical: { every_n_methods: number; every_n_classes: number }
    lines: { fallback_every: number }
    tier1_pool: Record<string, number>
    no_repeat_consecutive: boolean
    max_retries: number
    escalate_to: string
  }
}

export const DEFAULT_CONFIG: ProjectConfig = {
  adapter: 'claude-code',
  stream: { default_speed_ms: 1000, hard_cap_ms: 100, reset_after_gate: true },
  gates: {
    mode: 'hybrid',
    logical: { every_n_methods: 3, every_n_classes: 1 },
    lines: { fallback_every: 80 },
    tier1_pool: { limerick: 30, haiku: 15, fill_blank: 25, true_false: 20, metaphor: 10 },
    no_repeat_consecutive: true,
    max_retries: 3,
    escalate_to: ''
  }
}
