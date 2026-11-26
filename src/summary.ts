import * as core from '@actions/core'
import {EXIT_CODE_CLEAN, EXIT_CODE_LEAKS_FOUND} from './constants.js'
import type {BetterleaksReport, ReportFormat} from './report.js'

export interface SummaryOptions {
  report?: BetterleaksReport
  scanMode: string
  reportPath: string
  reportFormat: ReportFormat
  exitCode: number
  leakExitCode?: number
  validate?: boolean
  analyze?: boolean
  scanIncomplete?: boolean
}

const MAX_RULE_ROWS = 25

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(2)} GB`
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(2)} MB`
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(2)} KB`
  return `${bytes} bytes`
}

export async function writeSummary(options: SummaryOptions): Promise<void> {
  const {
    report,
    scanMode,
    reportPath,
    reportFormat,
    exitCode,
    leakExitCode = EXIT_CODE_LEAKS_FOUND,
    validate = false,
    analyze = false
  } = options

  const scanIncomplete =
    options.scanIncomplete ?? report?.scan.state === 'incomplete'
  const leakCount = report ? report.findings.length : undefined
  const isExitError =
    exitCode !== EXIT_CODE_CLEAN && exitCode !== leakExitCode
  const missingReportError = !report && exitCode !== EXIT_CODE_CLEAN
  const isError = isExitError || missingReportError
  const hasPositiveCount = leakCount !== undefined && leakCount > 0
  const isLeakExit =
    leakExitCode !== EXIT_CODE_CLEAN && exitCode === leakExitCode
  const leaksDetected = !isError && (hasPositiveCount || isLeakExit)

  let statusEmoji: string
  let statusText: string
  let leaksFoundCell: string

  if (scanIncomplete) {
    statusEmoji = '\u274c'
    statusText = hasPositiveCount
      ? `Scan incomplete (${leakCount} partial leak(s) found)`
      : `Scan incomplete (exit code ${exitCode})`
    leaksFoundCell = leakCount !== undefined ? String(leakCount) : 'N/A'
  } else if (isError) {
    statusEmoji = '\u274c'
    statusText = `Scan failed (exit code ${exitCode})`
    leaksFoundCell = 'N/A'
  } else if (leaksDetected) {
    statusEmoji = '\u274c'
    statusText = hasPositiveCount
      ? `${leakCount} leak(s) found`
      : 'Leaks detected'
    leaksFoundCell = hasPositiveCount ? String(leakCount) : 'unknown'
  } else {
    statusEmoji = '\u2705'
    statusText = 'No leaks detected'
    leaksFoundCell = String(leakCount ?? 0)
  }

  core.summary.addHeading(`${statusEmoji} Betterleaks Scan Results`).addTable([
    [
      {data: 'Status', header: true},
      {data: 'Scan Mode', header: true},
      {data: 'Leaks Found', header: true},
      {data: 'Exit Code', header: true}
    ],
    [statusText, scanMode, leaksFoundCell, String(exitCode)]
  ])

  if (report && report.findings.length > 0) {
    const byRule = new Map<string, {description: string; count: number}>()
    for (const finding of report.findings) {
      const existing = byRule.get(finding.rule_id)
      if (existing) {
        existing.count++
      } else {
        byRule.set(finding.rule_id, {
          description: finding.description || finding.rule_id,
          count: 1
        })
      }
    }

    const sortedRules = Array.from(byRule.entries()).sort((a, b) => {
      if (b[1].count !== a[1].count) return b[1].count - a[1].count
      return a[0].localeCompare(b[0])
    })

    const rows: (string | {data: string; header: boolean})[][] = [
      [
        {data: 'Rule ID', header: true},
        {data: 'Description', header: true},
        {data: 'Count', header: true}
      ]
    ]

    for (const [ruleId, info] of sortedRules.slice(0, MAX_RULE_ROWS)) {
      rows.push([ruleId, info.description, String(info.count)])
    }

    if (sortedRules.length > MAX_RULE_ROWS) {
      const remaining = sortedRules.length - MAX_RULE_ROWS
      rows.push([`+${remaining} more rule(s)`, '', ''])
    }

    core.summary.addHeading('Findings by Rule', 3).addTable(rows)
  }

  if (report) {
    const sc = report.scan.status_counts
    const sev = report.scan.severity_counts
    const hasValidationData =
      validate ||
      analyze ||
      sc.valid > 0 ||
      sc.invalid > 0 ||
      sc.revoked > 0 ||
      sc.needs_validation > 0 ||
      sc.unknown > 0 ||
      sc.error > 0
    const hasSeverityData =
      analyze || sev.high > 0 || sev.medium > 0 || sev.unknown > 0

    if (hasValidationData || hasSeverityData) {
      core.summary.addHeading('Validation & Analysis', 3)
      if (hasValidationData) {
        core.summary.addTable([
          [
            {data: 'Valid', header: true},
            {data: 'Invalid', header: true},
            {data: 'Revoked', header: true},
            {data: 'Needs Validation', header: true},
            {data: 'Unknown', header: true},
            {data: 'Error', header: true},
            {data: 'Unchecked', header: true}
          ],
          [
            String(sc.valid),
            String(sc.invalid),
            String(sc.revoked),
            String(sc.needs_validation),
            String(sc.unknown),
            String(sc.error),
            String(sc.none)
          ]
        ])
      }
      if (hasSeverityData) {
        core.summary.addTable([
          [
            {data: 'High Severity', header: true},
            {data: 'Medium Severity', header: true},
            {data: 'Unknown Severity', header: true},
            {data: 'Unset', header: true}
          ],
          [
            String(sev.high),
            String(sev.medium),
            String(sev.unknown),
            String(sev.none)
          ]
        ])
      }
    }
  }

  const footerParts: string[] = []
  if (report || (!isError && !scanIncomplete)) {
    footerParts.push(`Report written to \`${reportPath}\` (${reportFormat})`)
  }
  if (report?.scan) {
    const meta: string[] = []
    if (report.scan.betterleaks_version) {
      meta.push(`Betterleaks ${report.scan.betterleaks_version}`)
    }
    if (typeof report.scan.bytes_scanned === 'number') {
      meta.push(`Scanned ${formatBytes(report.scan.bytes_scanned)}`)
    }
    if (meta.length > 0) {
      footerParts.push(meta.join(' \u2022 '))
    }
  }
  footerParts.push(
    'Powered by [Betterleaks](https://github.com/betterleaks/betterleaks)'
  )

  await core.summary.addRaw(`\n\n${footerParts.join('\n\n')}`).write()
}
