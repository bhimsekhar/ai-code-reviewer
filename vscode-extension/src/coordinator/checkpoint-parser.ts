import { CheckpointType, EmbeddedCheckpoint } from '../types'

export interface ParseResult {
  checkpoints: EmbeddedCheckpoint[]
  cleanedContent: string
}

// Emoji → checkpoint type mapping
const EMOJI_TYPE_MAP: Record<string, CheckpointType> = {
  '🎭': 'limerick',
  '🌸': 'haiku',
  '📝': 'fill_blank',
  '✅': 'true_false',
  '❌': 'true_false',
  '💡': 'metaphor'
}

/**
 * Detect checkpoint type from the leading characters of a comment line.
 */
function detectType(line: string): CheckpointType | null {
  const stripped = line.replace(/^\s*\/\/\s*/, '').trimStart()
  for (const [emoji, type] of Object.entries(EMOJI_TYPE_MAP)) {
    if (stripped.startsWith(emoji)) {
      return type
    }
  }
  return null
}

/**
 * Parse Claude's embedded checkpoint comments from code content.
 * Returns checkpoints and content with 🔑 answer key lines removed.
 */
export function parse(content: string): ParseResult {
  const lines = content.split('\n')
  const checkpoints: EmbeddedCheckpoint[] = []
  const outputLines: string[] = []

  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    // Check if this line starts a checkpoint block
    const type = detectType(line)

    if (type !== null) {
      // Collect the full checkpoint block
      const blockStart = i + 1  // 1-based
      const blockLines: string[] = []

      // Collect lines while they are comment lines with checkpoint content
      let j = i
      while (j < lines.length) {
        const currentLine = lines[j]
        // A checkpoint block continues as long as lines are comments or blank
        const isComment = /^\s*\/\//.test(currentLine)
        if (!isComment && j > i) {
          break
        }
        blockLines.push(currentLine)
        j++
      }

      const blockEnd = i + blockLines.length  // 1-based (inclusive)
      const rawText = blockLines.join('\n')

      // Extract question (❓ line)
      let question = ''
      let answerKey = ''
      let falseStatement = ''

      for (const bl of blockLines) {
        const stripped = bl.replace(/^\s*\/\/\s*/, '')
        if (stripped.startsWith('❓')) {
          question = stripped.replace(/^❓\s*/, '').trim()
        }
        if (stripped.startsWith('🔑')) {
          answerKey = stripped.replace(/^🔑\s*/, '').trim()
        }
        if (stripped.startsWith('❌') && type === 'true_false') {
          falseStatement = stripped.replace(/^❌\s*/, '').trim()
        }
      }

      // For true_false, the answer key is the text of the ❌ statement
      if (type === 'true_false' && !answerKey && falseStatement) {
        answerKey = falseStatement
      }

      const checkpoint: EmbeddedCheckpoint = {
        type,
        rawText,
        question,
        answerKey,
        lineStart: blockStart,
        lineEnd: blockEnd
      }

      checkpoints.push(checkpoint)

      // Add block lines to output, but STRIP the 🔑 answer key lines
      for (const bl of blockLines) {
        const stripped = bl.replace(/^\s*\/\/\s*/, '')
        if (stripped.startsWith('🔑')) {
          // Skip this line — developer should not see the answer
          continue
        }
        outputLines.push(bl)
      }

      i = j  // advance past the block
    } else {
      outputLines.push(line)
      i++
    }
  }

  return {
    checkpoints,
    cleanedContent: outputLines.join('\n')
  }
}
