import * as fs from 'fs'

export type ReportFormat = 'sarif' | 'json' | 'jsonl'

export type ValidationStatus =
  | 'valid'
  | 'needs_validation'
  | 'invalid'
  | 'revoked'
  | 'unknown'
  | 'error'

export type FindingSeverity = 'unknown' | 'medium' | 'high'

export interface BetterleaksMatch {
  full: string
  value: string
  entropy?: number
  fingerprint?: string
  captures?: Record<string, string>
  context?: string
}

export interface BetterleaksLocation {
  path?: string
  start_line?: number
  end_line?: number
  start_column?: number
  end_column?: number
}

export interface BetterleaksAccount {
  id?: string
  name?: string
  domains?: string[]
}

export interface BetterleaksIdentity {
  id?: string
  username?: string
  name?: string
  email?: string
  account?: BetterleaksAccount
}

export interface BetterleaksAnalysis {
  status?: ValidationStatus
  severity?: FindingSeverity
  identity?: BetterleaksIdentity
  capabilities?: string[]
  metadata?: Record<string, unknown>
  debug?: Record<string, unknown>
  status_reason?: string
  status_metadata?: Record<string, unknown>
}

export interface BetterleaksComponentFinding {
  rule_id: string
  rule_hash?: string
  optional?: boolean
  match: BetterleaksMatch
  location: BetterleaksLocation
  encodings?: string[]
  decode_depth?: number
}

export interface BetterleaksComponentSet {
  components: (BetterleaksComponentFinding | null)[] | null
  analysis?: {
    status?: ValidationStatus
    severity?: FindingSeverity
  }
}

export interface BetterleaksFinding {
  rule_id: string
  rule_hash?: string
  description: string
  confidence: string
  match: BetterleaksMatch
  attributes?: Record<string, string>
  location: BetterleaksLocation
  analysis?: BetterleaksAnalysis
  component_sets?: BetterleaksComponentSet[]
  tags?: string[]
  component_sets_truncated?: boolean
  encodings?: string[]
  decode_depth?: number
}

export interface BetterleaksConfidenceCounts {
  high: number
  medium: number
  low: number
  none: number
  other: number
}

export interface BetterleaksSeverityCounts {
  high: number
  medium: number
  unknown: number
  none: number
}

export interface BetterleaksStatusCounts {
  valid: number
  invalid: number
  revoked: number
  needs_validation: number
  unknown: number
  error: number
  none: number
}

export interface BetterleaksScanMetadata {
  state: 'complete' | 'incomplete'
  source: {
    type: string
    targets?: string[]
  }
  started: string
  finished: string
  betterleaks_version: string
  config_hash: string
  bytes_scanned: number
  num_findings: number
  confidence_counts: BetterleaksConfidenceCounts
  severity_counts: BetterleaksSeverityCounts
  status_counts: BetterleaksStatusCounts
}

export interface BetterleaksReport {
  schema_version: string
  findings: BetterleaksFinding[]
  scan: BetterleaksScanMetadata
}

function emptyCounts(findings: BetterleaksFinding[]): {
  confidence: BetterleaksConfidenceCounts
  severity: BetterleaksSeverityCounts
  status: BetterleaksStatusCounts
} {
  const confidence: BetterleaksConfidenceCounts = {
    high: 0,
    medium: 0,
    low: 0,
    none: 0,
    other: 0
  }
  const severity: BetterleaksSeverityCounts = {
    high: 0,
    medium: 0,
    unknown: 0,
    none: 0
  }
  const status: BetterleaksStatusCounts = {
    valid: 0,
    invalid: 0,
    revoked: 0,
    needs_validation: 0,
    unknown: 0,
    error: 0,
    none: 0
  }

  for (const finding of findings) {
    if (finding.confidence === 'high') confidence.high++
    else if (finding.confidence === 'medium') confidence.medium++
    else if (finding.confidence === 'low') confidence.low++
    else if (!finding.confidence) confidence.none++
    else confidence.other++

    const sev = finding.analysis?.severity
    if (sev === 'high') severity.high++
    else if (sev === 'medium') severity.medium++
    else if (sev === 'unknown') severity.unknown++
    else severity.none++

    const st = finding.analysis?.status
    if (st === 'valid') status.valid++
    else if (st === 'invalid') status.invalid++
    else if (st === 'revoked') status.revoked++
    else if (st === 'needs_validation') status.needs_validation++
    else if (st === 'unknown') status.unknown++
    else if (st === 'error') status.error++
    else status.none++
  }

  return {confidence, severity, status}
}

export function parseJsonReport(reportPath: string): BetterleaksReport {
  if (!fs.existsSync(reportPath)) {
    throw new Error(`Betterleaks JSON report not found at ${reportPath}`)
  }

  const content = fs.readFileSync(reportPath, 'utf-8')
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    throw new Error(
      `Failed to parse Betterleaks JSON report at ${reportPath}: invalid JSON`
    )
  }

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !Array.isArray((parsed as Partial<BetterleaksReport>).findings) ||
    !(parsed as Partial<BetterleaksReport>).scan ||
    typeof (parsed as Partial<BetterleaksReport>).scan !== 'object'
  ) {
    throw new Error(
      `Invalid Betterleaks v2 JSON report at ${reportPath}: expected schema_version, findings, and scan`
    )
  }

  return parsed as BetterleaksReport
}

export function parseJsonlReport(reportPath: string): BetterleaksReport {
  if (!fs.existsSync(reportPath)) {
    throw new Error(`Betterleaks JSONL report not found at ${reportPath}`)
  }

  const content = fs.readFileSync(reportPath, 'utf-8')
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0)

  const findings: BetterleaksFinding[] = []
  let scan: BetterleaksScanMetadata | undefined
  let schemaVersion = '1'

  for (let i = 0; i < lines.length; i++) {
    let record: unknown
    try {
      record = JSON.parse(lines[i])
    } catch {
      throw new Error(
        `Failed to parse Betterleaks JSONL report at ${reportPath} (line ${i + 1}): invalid JSON`
      )
    }

    if (!record || typeof record !== 'object') {
      throw new Error(
        `Invalid Betterleaks JSONL record at ${reportPath} (line ${i + 1})`
      )
    }

    const obj = record as {
      schema_version?: string
      finding?: BetterleaksFinding
      scan?: BetterleaksScanMetadata
    }

    if (obj.schema_version) {
      schemaVersion = obj.schema_version
    }

    if (obj.finding && typeof obj.finding === 'object') {
      findings.push(obj.finding)
    } else if (obj.scan && typeof obj.scan === 'object') {
      scan = obj.scan
    } else {
      throw new Error(
        `Unrecognized Betterleaks JSONL record at ${reportPath} (line ${i + 1}): expected finding or scan`
      )
    }
  }

  if (!scan) {
    const counts = emptyCounts(findings)
    const now = new Date().toISOString()
    scan = {
      state: 'incomplete',
      source: {type: 'unknown'},
      started: now,
      finished: now,
      betterleaks_version: '',
      config_hash: '',
      bytes_scanned: 0,
      num_findings: findings.length,
      confidence_counts: counts.confidence,
      severity_counts: counts.severity,
      status_counts: counts.status
    }
  }

  return {
    schema_version: schemaVersion,
    findings,
    scan
  }
}

export function parseReport(
  reportPath: string,
  format: 'json' | 'jsonl'
): BetterleaksReport {
  return format === 'jsonl'
    ? parseJsonlReport(reportPath)
    : parseJsonReport(reportPath)
}
