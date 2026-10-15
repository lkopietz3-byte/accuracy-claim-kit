// Typed view of test/fixtures/vectors.json, which is produced by
// test/fixtures/generate_vectors.py (standard library only).
import raw from './fixtures/vectors.json' with { type: 'json' }

export interface WilsonVector {
  successes: number
  n: number
  confidence: number
  low: number
  high: number
  point: number
}
export interface AgreementVector {
  name: string
  labels: string[]
  matrix: number[][]
  categories?: number
  published?: { kappa?: number; po?: number; pe?: number }
  expected: {
    n: number
    agreements: number
    percent: number | null
    kappa: number | null
    ac1: number | null
    categories?: number
  }
}
export interface GridVector {
  metric: 'accuracy' | 'error-rate'
  n: number
  correct?: number
  errors?: number
  confidence: number
  claim: number
  expected: 'supported' | 'overstated' | 'contradicted'
  low: number
  high: number
  tag: string
}
export interface CensusVector {
  value: number
  display?: string
  k: number
  n: number
  expected: 'supported' | 'overstated' | 'contradicted'
  expectedStrict: 'supported' | 'overstated' | 'contradicted'
}
export interface DisplayVector {
  metric: 'accuracy' | 'error-rate'
  display: string
  value: number
  k: number
  n: number
  census: 'supported' | 'contradicted'
  interval: 'supported' | 'overstated' | 'contradicted'
  nearLimit: boolean
}
export interface NoisyVector {
  metric: 'accuracy' | 'error-rate'
  display?: string
  value: number
  k: number
  n: number
  census: 'supported' | 'contradicted'
  interval: 'supported' | 'overstated' | 'contradicted'
  nearLimit: boolean
}
export interface Vectors {
  normalQuantile: [number, number][]
  zForConfidence: [number, number][]
  wilson: WilsonVector[]
  wilsonAnalytic: { n: number; confidence: number; zeroUpper: number; allLower: number }[]
  agreement: AgreementVector[]
  verdictGrid: GridVector[]
  censusGrid: CensusVector[]
  displayGrid: DisplayVector[]
  noisyGrid: NoisyVector[]
}

export const vectors = raw as unknown as Vectors

/** Expands a confusion matrix (rows: rater A, columns: rater B) into label pairs. */
export function expandMatrix(labels: string[], matrix: number[][]): [string, string][] {
  const pairs: [string, string][] = []
  matrix.forEach((row, i) => {
    row.forEach((count, j) => {
      for (let k = 0; k < count; k++) pairs.push([labels[i] as string, labels[j] as string])
    })
  })
  return pairs
}
