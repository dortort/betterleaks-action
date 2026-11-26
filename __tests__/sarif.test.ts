import {describe, it, expect, beforeEach, afterEach} from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  normalizeArtifactUri,
  mapFindingLevel,
  buildRegion,
  buildResultMessage,
  convertToSarif,
  writeSarifReport
} from '../src/sarif.js'
import type {BetterleaksFinding, BetterleaksReport} from '../src/report.js'

function makeFinding(
  overrides: Partial<BetterleaksFinding> = {}
): BetterleaksFinding {
  return {
    rule_id: 'github-pat',
    rule_hash:
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    description: 'GitHub Personal Access Token',
    confidence: 'high',
    match: {
      full: 'token = REDACTED',
      value: 'REDACTED',
      entropy: 4.5,
      fingerprint:
        '1111111111111111111111111111111111111111111111111111111111111111'
    },
    attributes: {resource: 'fs.content'},
    location: {
      path: 'src/config.ts',
      start_line: 10,
      end_line: 10,
      start_column: 9,
      end_column: 48
    },
    ...overrides
  }
}

function makeReport(findings: BetterleaksFinding[]): BetterleaksReport {
  return {
    schema_version: '1',
    findings,
    scan: {
      state: 'complete',
      source: {type: 'filesystem', targets: ['.']},
      started: '2026-11-26T15:00:00Z',
      finished: '2026-11-26T15:00:01Z',
      betterleaks_version: '2.0.0-rc.15',
      config_hash:
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      bytes_scanned: 1024,
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
      }
    }
  }
}

describe('sarif converter', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sarif-convert-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, {recursive: true, force: true})
  })

  describe('normalizeArtifactUri', () => {
    it('strips workspace root from POSIX absolute paths', () => {
      expect(
        normalizeArtifactUri(
          '/home/runner/work/repo/repo/test-fixtures/fake-secrets.txt',
          '/home/runner/work/repo/repo'
        )
      ).toBe('test-fixtures/fake-secrets.txt')
    })

    it('normalizes Windows backslashes and strips Windows workspace root', () => {
      expect(
        normalizeArtifactUri(
          'D:\\a\\repo\\repo\\test-fixtures\\fake-secrets.txt',
          'd:\\a\\repo\\repo'
        )
      ).toBe('test-fixtures/fake-secrets.txt')
      expect(
        normalizeArtifactUri(
          'test-fixtures\\nested\\secret.env',
          'D:\\a\\repo\\repo'
        )
      ).toBe('test-fixtures/nested/secret.env')
    })

    it('strips leading ./ and encodes URI-unsafe characters per segment', () => {
      expect(
        normalizeArtifactUri('./dir/my secret#1.txt', '/workspace')
      ).toBe('dir/my%20secret%231.txt')
    })

    it('returns file:// URI for absolute paths outside the workspace', () => {
      expect(normalizeArtifactUri('/tmp/other/file.txt', '/workspace')).toBe(
        'file:///tmp/other/file.txt'
      )
    })

    it('uses fallback URI when path is missing', () => {
      expect(normalizeArtifactUri(undefined, '/workspace', 'stdin')).toBe(
        'stdin'
      )
      expect(
        normalizeArtifactUri('', '/workspace', 'git.commit_message')
      ).toBe('git.commit_message')
    })
  })

  describe('mapFindingLevel', () => {
    it('maps invalid and revoked credentials to note', () => {
      expect(
        mapFindingLevel(makeFinding({analysis: {status: 'invalid'}}))
      ).toBe('note')
      expect(
        mapFindingLevel(makeFinding({analysis: {status: 'revoked'}}))
      ).toBe('note')
    })

    it('maps valid credentials and high severity to error', () => {
      expect(
        mapFindingLevel(
          makeFinding({
            confidence: 'low',
            analysis: {status: 'valid', severity: 'medium'}
          })
        )
      ).toBe('error')
      expect(
        mapFindingLevel(
          makeFinding({
            confidence: 'low',
            analysis: {status: 'unknown', severity: 'high'}
          })
        )
      ).toBe('error')
    })

    it('maps medium severity without valid status to warning', () => {
      expect(
        mapFindingLevel(
          makeFinding({
            confidence: 'high',
            analysis: {status: 'unknown', severity: 'medium'}
          })
        )
      ).toBe('warning')
    })

    it('falls back to confidence when unvalidated', () => {
      expect(mapFindingLevel(makeFinding({confidence: 'high'}))).toBe('error')
      expect(mapFindingLevel(makeFinding({confidence: ''}))).toBe('error')
      expect(mapFindingLevel(makeFinding({confidence: 'medium'}))).toBe(
        'warning'
      )
      expect(mapFindingLevel(makeFinding({confidence: 'low'}))).toBe('warning')
    })
  })

  describe('buildRegion', () => {
    it('converts inclusive end_column to exclusive SARIF endColumn', () => {
      expect(
        buildRegion({
          start_line: 5,
          end_line: 5,
          start_column: 5,
          end_column: 64
        })
      ).toEqual({
        startLine: 5,
        endLine: 5,
        startColumn: 5,
        endColumn: 65
      })
    })

    it('guarantees endColumn > startColumn for single-character matches', () => {
      expect(
        buildRegion({
          start_line: 1,
          end_line: 1,
          start_column: 5,
          end_column: 5
        })
      ).toEqual({
        startLine: 1,
        endLine: 1,
        startColumn: 5,
        endColumn: 6
      })
    })

    it('returns undefined when start_line is absent or < 1', () => {
      expect(buildRegion({})).toBeUndefined()
      expect(buildRegion({start_line: 0})).toBeUndefined()
    })
  })

  describe('buildResultMessage', () => {
    it('includes description and non-secret metadata without leaking secret values', () => {
      const msg = buildResultMessage(
        makeFinding({
          description: 'AWS Secret Access Key',
          analysis: {status: 'valid', severity: 'high'},
          attributes: {'git.sha': '734f62e9b0fed5820242b1fa4a205876efeabc87'},
          encodings: ['base64']
        })
      )
      expect(msg).toBe(
        'AWS Secret Access Key (validation: valid, severity: high; commit 734f62e; decoded: base64)'
      )
      expect(msg).not.toContain('REDACTED')
    })
  })

  describe('convertToSarif', () => {
    it('emits spec-compliant SARIF 2.1.0 with deduplicated rules and fingerprints', () => {
      const report = makeReport([
        makeFinding({
          rule_id: 'github-pat',
          tags: ['github'],
          location: {
            path: '/workspace/a.ts',
            start_line: 1,
            end_line: 1,
            start_column: 1,
            end_column: 40
          }
        }),
        makeFinding({
          rule_id: 'github-pat',
          location: {
            path: '/workspace/b.ts',
            start_line: 2,
            end_line: 2,
            start_column: 1,
            end_column: 40
          }
        }),
        makeFinding({
          rule_id: 'generic-api-key',
          description: 'Generic API Key',
          confidence: 'low',
          analysis: {
            status: 'valid',
            severity: 'high',
            capabilities: ['read', 'write'],
            identity: {username: 'octocat'}
          },
          attributes: {
            resource: 'git.patch_content',
            'git.sha': 'abcdef1234567890',
            'git.author_name': 'Alice'
          },
          location: {
            path: 'c.env',
            start_line: 3,
            end_line: 3,
            start_column: 5,
            end_column: 20
          }
        })
      ])

      const sarif = convertToSarif(report, {workspaceRoot: '/workspace'})

      expect(sarif.$schema).toBe('https://json.schemastore.org/sarif-2.1.0.json')
      expect(sarif.version).toBe('2.1.0')
      expect(sarif.runs).toHaveLength(1)

      const [run] = sarif.runs
      expect(run.tool.driver.name).toBe('Betterleaks')
      expect(run.tool.driver.version).toBe('2.0.0-rc.15')
      expect(run.tool.driver.semanticVersion).toBe('2.0.0-rc.15')
      expect(run.tool.driver.rules).toHaveLength(2)
      expect(run.tool.driver.rules[0].id).toBe('github-pat')
      expect(run.tool.driver.rules[0].properties?.tags).toEqual([
        'security',
        'secrets',
        'github'
      ])

      expect(run.results).toHaveLength(3)
      expect(run.results[0].ruleIndex).toBe(0)
      expect(run.results[1].ruleIndex).toBe(0)
      expect(run.results[2].ruleIndex).toBe(1)
      expect(run.results[0].locations[0].physicalLocation.artifactLocation.uri).toBe(
        'a.ts'
      )
      expect(run.results[1].locations[0].physicalLocation.artifactLocation.uri).toBe(
        'b.ts'
      )
      expect(run.results[0].partialFingerprints.betterleaksLocationFingerprint).not.toBe(
        run.results[1].partialFingerprints.betterleaksLocationFingerprint
      )
      expect(run.results[0].partialFingerprints.betterleaksSecretFingerprint).toBe(
        '1111111111111111111111111111111111111111111111111111111111111111'
      )
      expect(run.results[2].level).toBe('error')
      expect(run.results[2].properties?.validationStatus).toBe('valid')
      expect(run.results[2].properties?.capabilities).toEqual(['read', 'write'])
      expect(run.results[2].properties?.commit).toBe('abcdef1234567890')
      expect(run.invocations?.[0].executionSuccessful).toBe(true)
    })

    it('emits valid empty SARIF 2.1.0 when there are zero findings', () => {
      const sarif = convertToSarif(makeReport([]), {workspaceRoot: '/workspace'})
      expect(sarif.runs[0].tool.driver.rules).toEqual([])
      expect(sarif.runs[0].results).toEqual([])
    })
  })

  describe('writeSarifReport', () => {
    it('creates parent directories and writes formatted JSON', () => {
      const outputPath = path.join(tmpDir, 'nested', 'dir', 'report.sarif')
      const sarif = convertToSarif(makeReport([]))
      writeSarifReport(sarif, outputPath)

      expect(fs.existsSync(outputPath)).toBe(true)
      const parsed = JSON.parse(fs.readFileSync(outputPath, 'utf-8'))
      expect(parsed.version).toBe('2.1.0')
    })
  })
})
