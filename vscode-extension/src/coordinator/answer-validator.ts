import { Gate } from '../types'

/**
 * Normalise a string for comparison: lowercase, strip punctuation.
 */
function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Split into words, filter empty strings.
 */
function words(s: string): string[] {
  return normalise(s).split(' ').filter(w => w.length > 0)
}

/**
 * Word overlap ratio: fraction of key words that appear in answer words.
 */
function wordOverlap(answer: string, key: string): number {
  const keyWords = words(key)
  if (keyWords.length === 0) { return 1.0 }
  const answerWords = new Set(words(answer))
  const matched = keyWords.filter(w => answerWords.has(w)).length
  return matched / keyWords.length
}

/**
 * Parse answer letter/number to 0-based index.
 * Accepts: 'A', 'B', 'C', 'D', '0', '1', '2', '3'
 */
function parseOptionIndex(answer: string): number {
  const trimmed = answer.trim().toUpperCase()
  if (trimmed === 'A') { return 0 }
  if (trimmed === 'B') { return 1 }
  if (trimmed === 'C') { return 2 }
  if (trimmed === 'D') { return 3 }
  const num = parseInt(answer.trim(), 10)
  if (!isNaN(num)) { return num }
  return -1
}

/**
 * Validate a developer's answer against a gate's checkpoint.
 * Returns true if the answer passes.
 */
export function validate(gate: Gate, answer: string): boolean {
  if (!answer || answer.trim().length === 0) {
    return false
  }

  const type = gate.embedded?.type ?? gate.security ? 'security_audit' : undefined

  // Security audit (multiple choice)
  if (gate.security || type === 'security_audit') {
    const sec = gate.security!
    // correctIndex === -1 means awareness gate — any answer is accepted
    if (sec.correctIndex === -1) {
      return true
    }
    const answerIdx = parseOptionIndex(answer)
    if (answerIdx !== -1) {
      return answerIdx === sec.correctIndex
    }
    // Try matching the option text itself
    const normAnswer = normalise(answer)
    const option = sec.options[sec.correctIndex]
    if (option && normAnswer.includes(normalise(option).slice(0, 20))) {
      return true
    }
    return false
  }

  if (!gate.embedded) {
    return false
  }

  const embedded = gate.embedded
  const answerKey = embedded.answerKey

  switch (embedded.type) {
    case 'security_audit':
      // Handled above via gate.security
      return true

    case 'limerick':
    case 'haiku':
    case 'metaphor':
      // Fuzzy string match: > 50% word overlap threshold
      return wordOverlap(answer, answerKey) > 0.5

    case 'fill_blank':
      // Fuzzy match: 40% word overlap threshold
      return wordOverlap(answer, answerKey) > 0.4

    case 'true_false':
      // Developer must identify the false statement
      // Check if answer contains text matching the false statement (❌ one)
      if (!answerKey) { return true }
      return wordOverlap(answer, answerKey) > 0.4

    default:
      return false
  }
}
