import { CheckpointType, ProjectConfig, Tier } from '../types'
import { Assessment } from './assessor'

/**
 * Select a checkpoint type based on assessment, config and last used type.
 * Returns 'security_audit' for Tier 3.
 * For Tier 1/2: weighted random from pool, with no-repeat enforcement.
 */
export function select(
  assessment: Assessment,
  config: ProjectConfig,
  lastType: CheckpointType | null
): CheckpointType {
  if (assessment.tier === 3) {
    return 'security_audit'
  }

  const pool = config.gates.tier1_pool
  const types = Object.keys(pool) as CheckpointType[]
  const weights = types.map(t => pool[t] ?? 0)
  const totalWeight = weights.reduce((a, b) => a + b, 0)

  function pickWeighted(excluded: CheckpointType | null): CheckpointType {
    let adjustedTypes = types
    let adjustedWeights = weights

    if (excluded !== null && config.gates.no_repeat_consecutive) {
      const idx = types.indexOf(excluded)
      if (idx !== -1) {
        adjustedTypes = types.filter((_, i) => i !== idx)
        adjustedWeights = weights.filter((_, i) => i !== idx)
      }
    }

    const adjustedTotal = adjustedWeights.reduce((a, b) => a + b, 0)
    if (adjustedTotal === 0 || adjustedTypes.length === 0) {
      // Fallback: pick uniformly
      return types[Math.floor(Math.random() * types.length)]
    }

    let rand = Math.random() * adjustedTotal
    for (let i = 0; i < adjustedTypes.length; i++) {
      rand -= adjustedWeights[i]
      if (rand <= 0) {
        return adjustedTypes[i]
      }
    }
    return adjustedTypes[adjustedTypes.length - 1]
  }

  const selected = pickWeighted(lastType)

  // Enforce no-repeat: if selected === lastType, re-roll once
  if (
    config.gates.no_repeat_consecutive &&
    selected === lastType &&
    totalWeight > 0 &&
    types.length > 1
  ) {
    return pickWeighted(lastType)
  }

  return selected
}

/**
 * Determine whether a gate should fire based on current position stats.
 */
export function shouldGate(
  linesSinceLastGate: number,
  methodsSinceLastGate: number,
  config: ProjectConfig
): boolean {
  const { every_n_methods } = config.gates.logical
  const { fallback_every } = config.gates.lines

  if (methodsSinceLastGate >= every_n_methods) {
    return true
  }
  if (linesSinceLastGate >= fallback_every) {
    return true
  }
  return false
}
