import {describe, it, expect, beforeEach, vi, type Mock} from 'vitest'
import {writeSummary} from '../src/summary.js'
import type {BetterleaksFinding, BetterleaksReport} from '../src/report.js'
import * as core from '@actions/core'

vi.mock('@actions/core')

function makeReport(
  findings: BetterleaksFinding[],
  overrides: Partial<BetterleaksReport['scan']> = {}
): BetterleaksReport {
  return {
    schema_version: '1',
    findings,
    scan: {
      state: 'complete',
      source: {type: 'filesystem', targets: ['.']},
      started: '2026-11-26T15:00:00Z',
      finished: '2026-11-26T15:00:01Z',
      betterleaks_version: '2.0.0-rc.15',
      config_hash: '0'.repeat(64),
      bytes_scanned: 1500,
      num_findings: findings.length,
      confidence_counts: {high: findings.length, medium: 0, low: 0, none: 0, other: 0},
      severity_counts: {high: 0, medium: 0, unknown: 0, none: findings.length},
      status_counts: {
        valid: 0,
        invalid: 0,
        revoked: 0,
        needs_validation: 0,
        unknown: 0,
        error: 0,
        none: findings.length
      },
      ...overrides
    }
  }
}

function makeFinding(ruleId: string, description: string): BetterleaksFinding {
  return {
    rule_id: ruleId,
    description,
    confidence: 'high',
    match: {full: 'REDACTED', value: 'REDACTED'},
    location: {path: 'a.txt', start_line: 1, end_line: 1}
  }
}

describe('summary', () => {
  let mockWrite: Mock
  let mockSummary: Record<string, Mock>

  beforeEach(() => {
    mockWrite = vi.fn().mockResolvedValue(undefined)
    mockSummary = {
      addHeading: vi.fn().mockReturnThis(),
      addTable: vi.fn().mockReturnThis(),
      addRaw: vi.fn().mockReturnThis(),
      write: mockWrite
    }
    Object.defineProperty(core, 'summary', {
      value: mockSummary,
      writable: true
    })
  })

  it('writes summary for clean scan with version and bytes scanned', async () => {
    await writeSummary({
      report: makeReport([]),
      scanMode: 'filesystem',
      reportPath: 'betterleaks-report.sarif',
      reportFormat: 'sarif',
      exitCode: 0
    })

    expect(mockSummary.addHeading).toHaveBeenCalledWith(
      '\u2705 Betterleaks Scan Results'
    )
    expect(mockSummary.addTable).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.arrayContaining(['No leaks detected', 'filesystem', '0', '0'])
      ])
    )
    expect(mockSummary.addRaw).toHaveBeenCalledWith(
      expect.stringContaining('Betterleaks 2.0.0-rc.15')
    )
    expect(mockSummary.addRaw).toHaveBeenCalledWith(
      expect.stringContaining('1.50 KB')
    )
    expect(mockWrite).toHaveBeenCalled()
  })

  it('writes rule breakdown table sorted by count descending for leaky scans', async () => {
    const report = makeReport([
      makeFinding('generic-api-key', 'Generic API Key'),
      makeFinding('github-pat', 'GitHub PAT'),
      makeFinding('github-pat', 'GitHub PAT')
    ])

    await writeSummary({
      report,
      scanMode: 'git',
      reportPath: 'report.json',
      reportFormat: 'json',
      exitCode: 1
    })

    expect(mockSummary.addHeading).toHaveBeenCalledWith(
      '\u274c Betterleaks Scan Results'
    )
    expect(mockSummary.addHeading).toHaveBeenCalledWith('Findings by Rule', 3)
    expect(mockSummary.addTable).toHaveBeenCalledWith([
      [
        {data: 'Rule ID', header: true},
        {data: 'Description', header: true},
        {data: 'Count', header: true}
      ],
      ['github-pat', 'GitHub PAT', '2'],
      ['generic-api-key', 'Generic API Key', '1']
    ])
  })

  it('renders validation and analysis tables when enabled', async () => {
    const report = makeReport([makeFinding('github-pat', 'GitHub PAT')], {
      status_counts: {
        valid: 1,
        invalid: 0,
        revoked: 0,
        needs_validation: 0,
        unknown: 0,
        error: 0,
        none: 0
      },
      severity_counts: {high: 1, medium: 0, unknown: 0, none: 0}
    })

    await writeSummary({
      report,
      scanMode: 'filesystem',
      reportPath: 'report.sarif',
      reportFormat: 'sarif',
      exitCode: 1,
      validate: true,
      analyze: true
    })

    expect(mockSummary.addHeading).toHaveBeenCalledWith(
      'Validation & Analysis',
      3
    )
    expect(mockSummary.addTable).toHaveBeenCalledWith(
      expect.arrayContaining([['1', '0', '0', '0', '0', '0', '0']])
    )
    expect(mockSummary.addTable).toHaveBeenCalledWith(
      expect.arrayContaining([['1', '0', '0', '0']])
    )
  })

  it('reports scan failure when exit code is unexpected or report is missing on non-zero exit', async () => {
    await writeSummary({
      scanMode: 'filesystem',
      reportPath: 'report.sarif',
      reportFormat: 'sarif',
      exitCode: 126
    })

    expect(mockSummary.addTable).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.arrayContaining([
          'Scan failed (exit code 126)',
          'filesystem',
          'N/A',
          '126'
        ])
      ])
    )
    expect(mockSummary.addRaw).toHaveBeenCalledWith(
      expect.not.stringContaining('Report written to')
    )
  })

  it('reports incomplete scans with partial finding counts', async () => {
    const report = makeReport([makeFinding('github-pat', 'GitHub PAT')], {
      state: 'incomplete'
    })

    await writeSummary({
      report,
      scanMode: 'git',
      reportPath: 'report.jsonl',
      reportFormat: 'jsonl',
      exitCode: 1,
      scanIncomplete: true
    })

    expect(mockSummary.addTable).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.arrayContaining([
          'Scan incomplete (1 partial leak(s) found)',
          'git',
          '1',
          '1'
        ])
      ])
    )
  })
})
