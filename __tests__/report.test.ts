import {describe, it, expect, beforeEach, afterEach} from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  parseJsonReport,
  parseJsonlReport,
  parseReport,
  type BetterleaksReport
} from '../src/report.js'

function makeSampleReport(): BetterleaksReport {
  return {
    schema_version: '1',
    findings: [
      {
        rule_id: 'generic-api-key',
        rule_hash:
          'd119f291486b4b1b94fd62d540e88afa28095a95f739ee9497cf9ad3b3d77eb3',
        description: 'Detected a Generic API Key.',
        confidence: 'low',
        match: {
          full: 'secret_access_key = REDACTED',
          value: 'REDACTED',
          entropy: 4.66,
          fingerprint:
            '78314b11be2e581549ac1c4f616563fad3fdf0c3b71678f6e2299182080e0598'
        },
        attributes: {resource: 'fs.content'},
        location: {
          path: 'test-fixtures/fake-secrets.txt',
          start_line: 5,
          end_line: 5,
          start_column: 5,
          end_column: 64
        }
      }
    ],
    scan: {
      state: 'complete',
      source: {type: 'filesystem', targets: ['test-fixtures']},
      started: '2026-11-26T15:08:22.325184Z',
      finished: '2026-11-26T15:08:22.426825Z',
      betterleaks_version: '2.0.0-rc.15',
      config_hash:
        '509bfd217933add09e933e217463a427f3ea44b5136606582ad316ada195411a',
      bytes_scanned: 314,
      num_findings: 1,
      confidence_counts: {high: 0, medium: 0, low: 1, none: 0, other: 0},
      severity_counts: {high: 0, medium: 0, unknown: 0, none: 1},
      status_counts: {
        valid: 0,
        invalid: 0,
        revoked: 0,
        needs_validation: 0,
        unknown: 0,
        error: 0,
        none: 1
      }
    }
  }
}

describe('report parser', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'betterleaks-report-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, {recursive: true, force: true})
  })

  describe('parseJsonReport', () => {
    it('parses a valid Betterleaks v2 JSON report', () => {
      const sample = makeSampleReport()
      const filePath = path.join(tmpDir, 'out.json')
      fs.writeFileSync(filePath, JSON.stringify(sample))

      const report = parseJsonReport(filePath)
      expect(report.schema_version).toBe('1')
      expect(report.findings).toHaveLength(1)
      expect(report.scan.num_findings).toBe(1)
      expect(report.scan.betterleaks_version).toBe('2.0.0-rc.15')
    })

    it('throws when the file does not exist', () => {
      expect(() => parseJsonReport(path.join(tmpDir, 'missing.json'))).toThrow(
        'not found'
      )
    })

    it('throws on invalid JSON', () => {
      const filePath = path.join(tmpDir, 'bad.json')
      fs.writeFileSync(filePath, '{not json')
      expect(() => parseJsonReport(filePath)).toThrow('invalid JSON')
    })

    it('throws when required v2 envelope fields are missing', () => {
      const filePath = path.join(tmpDir, 'v1.json')
      fs.writeFileSync(filePath, JSON.stringify([{RuleID: 'legacy'}]))
      expect(() => parseJsonReport(filePath)).toThrow(
        'Invalid Betterleaks v2 JSON report'
      )
    })
  })

  describe('parseJsonlReport', () => {
    it('parses finding envelopes and trailing scan metadata', () => {
      const sample = makeSampleReport()
      const filePath = path.join(tmpDir, 'out.jsonl')
      const lines = [
        JSON.stringify({schema_version: '1', finding: sample.findings[0]}),
        JSON.stringify({schema_version: '1', scan: sample.scan})
      ]
      fs.writeFileSync(filePath, `${lines.join('\n')}\n`)

      const report = parseJsonlReport(filePath)
      expect(report.schema_version).toBe('1')
      expect(report.findings).toHaveLength(1)
      expect(report.findings[0].rule_id).toBe('generic-api-key')
      expect(report.scan.state).toBe('complete')
      expect(report.scan.num_findings).toBe(1)
    })

    it('parses zero-finding JSONL containing only a scan record', () => {
      const sample = makeSampleReport()
      sample.scan.num_findings = 0
      const filePath = path.join(tmpDir, 'clean.jsonl')
      fs.writeFileSync(
        filePath,
        `${JSON.stringify({schema_version: '1', scan: sample.scan})}\n`
      )

      const report = parseJsonlReport(filePath)
      expect(report.findings).toHaveLength(0)
      expect(report.scan.state).toBe('complete')
      expect(report.scan.num_findings).toBe(0)
    })

    it('synthesizes an incomplete scan summary if JSONL was truncated before the final scan record', () => {
      const sample = makeSampleReport()
      sample.findings[0].analysis = {status: 'valid', severity: 'high'}
      const filePath = path.join(tmpDir, 'truncated.jsonl')
      fs.writeFileSync(
        filePath,
        `${JSON.stringify({schema_version: '1', finding: sample.findings[0]})}\n`
      )

      const report = parseJsonlReport(filePath)
      expect(report.findings).toHaveLength(1)
      expect(report.scan.state).toBe('incomplete')
      expect(report.scan.num_findings).toBe(1)
      expect(report.scan.status_counts.valid).toBe(1)
      expect(report.scan.severity_counts.high).toBe(1)
    })

    it('throws on invalid JSONL line or unrecognized record', () => {
      const badPath = path.join(tmpDir, 'bad.jsonl')
      fs.writeFileSync(badPath, 'not-json\n')
      expect(() => parseJsonlReport(badPath)).toThrow('line 1')

      const unknownPath = path.join(tmpDir, 'unknown.jsonl')
      fs.writeFileSync(unknownPath, '{"schema_version":"1","other":{}}\n')
      expect(() => parseJsonlReport(unknownPath)).toThrow(
        'Unrecognized Betterleaks JSONL record'
      )
    })
  })

  describe('parseReport', () => {
    it('dispatches based on format', () => {
      const sample = makeSampleReport()
      const jsonPath = path.join(tmpDir, 'r.json')
      const jsonlPath = path.join(tmpDir, 'r.jsonl')
      fs.writeFileSync(jsonPath, JSON.stringify(sample))
      fs.writeFileSync(
        jsonlPath,
        `${JSON.stringify({schema_version: '1', scan: {...sample.scan, num_findings: 0}})}\n`
      )

      expect(parseReport(jsonPath, 'json').findings).toHaveLength(1)
      expect(parseReport(jsonlPath, 'jsonl').findings).toHaveLength(0)
    })
  })
})
