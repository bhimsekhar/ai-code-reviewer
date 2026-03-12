import { CodePayload } from '../types'

export interface CodeSourceAdapter {
  readonly name: string
  readonly displayName: string
  initialize(onCode: (payload: CodePayload) => void): void
  dispose(): void
}
