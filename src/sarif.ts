import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import {
  SARIF_SCHEMA,
  SARIF_VERSION,
  TOOL_INFORMATION_URI
} from './constants.js'
import {parseSemver, stripVPrefix} from './installer.js'
import type {
  BetterleaksFinding,
  BetterleaksLocation,
  BetterleaksReport
} from './report.js'

export type SarifLevel = 'error' | 'warning' | 'note'

export interface SarifMessage {
  text: string
}

export interface SarifRegion {
  startLine: number
  endLine?: number
  startColumn?: number
  endColumn?: number
}

export interface SarifLocation {
  physicalLocation: {
    artifactLocation: {
      uri: string
    }
    region?: SarifRegion
  }
}

export interface SarifRule {
  id: string
  shortDescription: SarifMessage
  properties?: Record<string, unknown>
}

export interface SarifResult {
  ruleId: string
  ruleIndex: number
  level: SarifLevel
  message: SarifMessage
  locations: SarifLocation[]
  partialFingerprints: Record<string, string>
  properties?: Record<string, unknown>
}

export interface SarifInvocation {
  executionSuccessful: boolean
  startTimeUtc?: string
  endTimeUtc?: string
}

export interface SarifRun {
  tool: {
    driver: {
      name: string
      version?: string
      semanticVersion?: string
      informationUri: string
      rules: SarifRule[]
    }
  }
  invocations?: SarifInvocation[]
  results: SarifResult[]
  properties?: Record<string, unknown>
}

export interface SarifLog {
  $schema: string
  version: string
  runs: SarifRun[]
}

export interface ConvertToSarifOptions {
  workspaceRoot?: string
  fallbackVersion?: string
}

function toPosixSlashes(filePath: string): string {
  return filePath.replace(/\\/g, '/')
}

function isWindowsDrivePath(filePath: string): boolean {
  return /^[A-Za-z]:\//.test(filePath)
}

function isAbsoluteAnyPlatform(posixPath: string): boolean {
  return posixPath.startsWith('/') || isWindowsDrivePath(posixPath)
}

function encodeUriPath(posixPath: string): string {
  return posixPath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

export function normalizeArtifactUri(
  rawPath: string | undefined,
  workspaceRoot: string,
  fallbackUri = 'stdin'
): string {
  const trimmed = rawPath?.trim()
  if (!trimmed) {
    return fallbackUri
  }

  const normalizedInput = toPosixSlashes(trimmed)
  const normalizedWorkspace = toPosixSlashes(workspaceRoot).replace(/\/+$/, '')

  if (isAbsoluteAnyPlatform(normalizedInput)) {
    const inputForCompare = isWindowsDrivePath(normalizedInput)
      ? normalizedInput[0].toLowerCase() + normalizedInput.slice(1)
      : normalizedInput
    const workspaceForCompare = isWindowsDrivePath(normalizedWorkspace)
      ? normalizedWorkspace[0].toLowerCase() + normalizedWorkspace.slice(1)
      : normalizedWorkspace

    if (
      normalizedWorkspace &&
      (inputForCompare === workspaceForCompare ||
        inputForCompare.startsWith(`${workspaceForCompare}/`))
    ) {
      const relative = normalizedInput.slice(normalizedWorkspace.length + 1)
      const cleaned = path.posix.normalize(relative).replace(/^(\.\/)+/, '')
      return encodeUriPath(cleaned || fallbackUri)
    }

    const cleanedAbs = path.posix.normalize(normalizedInput)
    if (isWindowsDrivePath(cleanedAbs)) {
      return `file:///${encodeUriPath(cleanedAbs)}`
    }
    return `file://${encodeUriPath(cleanedAbs)}`
  }

  const cleanedRel = path.posix
    .normalize(normalizedInput)
    .replace(/^(\.\/)+/, '')
  if (!cleanedRel || cleanedRel === '.') {
    return fallbackUri
  }

  return encodeUriPath(cleanedRel)
}

export function mapFindingLevel(finding: BetterleaksFinding): SarifLevel {
  const status = finding.analysis?.status
  const severity = finding.analysis?.severity

  if (status === 'invalid' || status === 'revoked') {
    return 'note'
  }
  if (status === 'valid' || severity === 'high') {
    return 'error'
  }
  if (severity === 'medium') {
    return 'warning'
  }

  const confidence = finding.confidence.toLowerCase()
  if (confidence === 'low' || confidence === 'medium') {
    return 'warning'
  }

  return 'error'
}

export function buildRegion(
  location: BetterleaksLocation
): SarifRegion | undefined {
  if (!location.start_line || location.start_line < 1) {
    return undefined
  }

  const region: SarifRegion = {
    startLine: location.start_line
  }

  if (location.end_line && location.end_line >= location.start_line) {
    region.endLine = location.end_line
  }

  if (location.start_column && location.start_column >= 1) {
    region.startColumn = location.start_column
  }

  if (location.end_column && location.end_column >= 1) {
    // SARIF 2.1.0 §3.30.8 defines endColumn as 1-based exclusive, whereas Betterleaks reports 1-based inclusive columns.
    const exclusiveEndColumn = location.end_column + 1
    const isMultiLine = (region.endLine ?? region.startLine) > region.startLine
    if (
      isMultiLine ||
      !region.startColumn ||
      exclusiveEndColumn > region.startColumn
    ) {
      region.endColumn = exclusiveEndColumn
    }
  }

  return region
}

export function buildResultMessage(finding: BetterleaksFinding): string {
  const base =
    finding.description?.trim() || `Secret detected by rule ${finding.rule_id}`
  const details: string[] = []

  if (finding.analysis?.status) {
    const severitySuffix =
      finding.analysis.severity && finding.analysis.severity !== 'unknown'
        ? `, severity: ${finding.analysis.severity}`
        : ''
    details.push(`validation: ${finding.analysis.status}${severitySuffix}`)
  } else if (
    finding.analysis?.severity &&
    finding.analysis.severity !== 'unknown'
  ) {
    details.push(`severity: ${finding.analysis.severity}`)
  }

  const commitSha = finding.attributes?.['git.sha']
  if (commitSha) {
    details.push(`commit ${commitSha.slice(0, 7)}`)
  }

  if (finding.encodings && finding.encodings.length > 0) {
    details.push(`decoded: ${finding.encodings.join(', ')}`)
  }

  return details.length > 0 ? `${base} (${details.join('; ')})` : base
}

function buildPartialFingerprints(
  finding: BetterleaksFinding,
  artifactUri: string
): Record<string, string> {
  const startLine = finding.location?.start_line ?? 0
  const commitSha = finding.attributes?.['git.sha'] ?? ''
  const secretFp = finding.match?.fingerprint ?? ''

  const locationHash = crypto
    .createHash('sha256')
    .update(
      `${finding.rule_id}\0${artifactUri}\0${startLine}\0${commitSha}\0${secretFp}`
    )
    .digest('hex')

  const fingerprints: Record<string, string> = {
    betterleaksLocationFingerprint: locationHash
  }

  if (secretFp) {
    fingerprints.betterleaksSecretFingerprint = secretFp
  }

  return fingerprints
}

function buildResultProperties(
  finding: BetterleaksFinding
): Record<string, unknown> | undefined {
  const props: Record<string, unknown> = {}

  if (finding.confidence) props.confidence = finding.confidence
  if (finding.match?.entropy !== undefined) props.entropy = finding.match.entropy
  if (finding.rule_hash) props.ruleHash = finding.rule_hash
  if (finding.tags && finding.tags.length > 0) props.tags = finding.tags
  if (finding.encodings && finding.encodings.length > 0) {
    props.encodings = finding.encodings
  }
  if (finding.decode_depth !== undefined) props.decodeDepth = finding.decode_depth

  if (finding.analysis) {
    if (finding.analysis.status) props.validationStatus = finding.analysis.status
    if (finding.analysis.severity) props.severity = finding.analysis.severity
    if (finding.analysis.status_reason) {
      props.statusReason = finding.analysis.status_reason
    }
    if (
      finding.analysis.capabilities &&
      finding.analysis.capabilities.length > 0
    ) {
      props.capabilities = finding.analysis.capabilities
    }
    if (finding.analysis.identity) props.identity = finding.analysis.identity
  }

  if (finding.attributes) {
    if (finding.attributes['git.sha']) props.commit = finding.attributes['git.sha']
    if (finding.attributes['git.author_name']) {
      props.author = finding.attributes['git.author_name']
    }
    if (finding.attributes['git.date']) props.date = finding.attributes['git.date']
    if (finding.attributes['resource']) {
      props.resource = finding.attributes['resource']
    }
    if (finding.attributes['url']) props.url = finding.attributes['url']
  }

  return Object.keys(props).length > 0 ? props : undefined
}

export function convertToSarif(
  report: BetterleaksReport,
  options: ConvertToSarifOptions = {}
): SarifLog {
  const workspaceRoot =
    options.workspaceRoot ?? process.env.GITHUB_WORKSPACE ?? process.cwd()

  const rules: SarifRule[] = []
  const ruleIndexById = new Map<string, number>()
  const results: SarifResult[] = []

  for (const finding of report.findings) {
    let ruleIndex = ruleIndexById.get(finding.rule_id)
    if (ruleIndex === undefined) {
      ruleIndex = rules.length
      ruleIndexById.set(finding.rule_id, ruleIndex)

      const ruleTags = Array.from(
        new Set(['security', 'secrets', ...(finding.tags ?? [])])
      )
      const ruleProps: Record<string, unknown> = {tags: ruleTags}
      if (finding.rule_hash) {
        ruleProps.ruleHash = finding.rule_hash
      }

      rules.push({
        id: finding.rule_id,
        shortDescription: {
          text: finding.description?.trim() || finding.rule_id
        },
        properties: ruleProps
      })
    }

    const fallbackUri =
      finding.attributes?.['resource'] || report.scan?.source?.type || 'stdin'
    const artifactUri = normalizeArtifactUri(
      finding.location?.path,
      workspaceRoot,
      fallbackUri
    )
    const region = buildRegion(finding.location ?? {})
    const physicalLocation: SarifLocation['physicalLocation'] = {
      artifactLocation: {uri: artifactUri}
    }
    if (region) {
      physicalLocation.region = region
    }

    const result: SarifResult = {
      ruleId: finding.rule_id,
      ruleIndex,
      level: mapFindingLevel(finding),
      message: {text: buildResultMessage(finding)},
      locations: [{physicalLocation}],
      partialFingerprints: buildPartialFingerprints(finding, artifactUri)
    }

    const resultProperties = buildResultProperties(finding)
    if (resultProperties) {
      result.properties = resultProperties
    }

    results.push(result)
  }

  const rawVersion =
    report.scan?.betterleaks_version || options.fallbackVersion || ''
  const cleanVersion = rawVersion ? stripVPrefix(rawVersion) : undefined

  const driver: SarifRun['tool']['driver'] = {
    name: 'Betterleaks',
    informationUri: TOOL_INFORMATION_URI,
    rules
  }
  if (cleanVersion) {
    driver.version = cleanVersion
    if (parseSemver(cleanVersion)) {
      driver.semanticVersion = cleanVersion
    }
  }

  const run: SarifRun = {
    tool: {driver},
    results
  }

  if (report.scan) {
    const invocation: SarifInvocation = {
      executionSuccessful: report.scan.state === 'complete'
    }
    if (report.scan.started) invocation.startTimeUtc = report.scan.started
    if (report.scan.finished) invocation.endTimeUtc = report.scan.finished
    run.invocations = [invocation]

    run.properties = {
      scanState: report.scan.state,
      sourceType: report.scan.source?.type,
      configHash: report.scan.config_hash,
      bytesScanned: report.scan.bytes_scanned
    }
  }

  return {
    $schema: SARIF_SCHEMA,
    version: SARIF_VERSION,
    runs: [run]
  }
}

export function writeSarifReport(sarif: SarifLog, outputPath: string): void {
  const dir = path.dirname(outputPath)
  if (dir && dir !== '.') {
    fs.mkdirSync(dir, {recursive: true})
  }
  fs.writeFileSync(outputPath, `${JSON.stringify(sarif, null, 2)}\n`, 'utf-8')
}
