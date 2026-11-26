import {describe, it, expect} from 'vitest'
import {
  determineScanMode,
  buildArgs,
  parseLeakExitCode,
  parseTimeout,
  parseReportFormat,
  resolveReportPath,
  splitExtraArgs,
  run,
  type ActionInputs
} from '../src/runner.js'

function makeInputs(overrides: Partial<ActionInputs> = {}): ActionInputs {
  return {
    scanMode: 'auto',
    scanPath: '.',
    config: '',
    reportFormat: 'sarif',
    reportPath: 'betterleaks-report.sarif',
    redact: true,
    exitCode: '',
    noColor: true,
    noBanner: true,
    validate: false,
    analyze: false,
    extraArgs: '',
    timeout: 300,
    ...overrides
  }
}

describe('runner', () => {
  describe('determineScanMode', () => {
    it('maps explicit v2 modes and aliases', () => {
      expect(determineScanMode('filesystem', 'push')).toBe('filesystem')
      expect(determineScanMode('fs', 'push')).toBe('filesystem')
      expect(determineScanMode('dir', 'push')).toBe('filesystem')
      expect(determineScanMode('git', 'pull_request')).toBe('git')
      expect(determineScanMode('stdin', 'push')).toBe('stdin')
    })

    it('maps auto mode from GitHub event names', () => {
      expect(determineScanMode('auto', 'push')).toBe('git')
      expect(determineScanMode('auto', 'pull_request')).toBe('filesystem')
      expect(determineScanMode('auto', 'pull_request_target')).toBe('filesystem')
      expect(determineScanMode('auto', 'schedule')).toBe('filesystem')
      expect(determineScanMode('auto', 'workflow_dispatch')).toBe('filesystem')
      expect(determineScanMode('auto', 'unknown_event')).toBe('filesystem')
      expect(determineScanMode('', 'pull_request')).toBe('filesystem')
    })

    it('throws on unknown scan mode', () => {
      expect(() => determineScanMode('detect', 'push')).toThrow(
        'Invalid scan-mode'
      )
    })
  })

  describe('parseReportFormat and resolveReportPath', () => {
    it('accepts sarif, json, and jsonl and defaults empty to sarif', () => {
      expect(parseReportFormat('')).toBe('sarif')
      expect(parseReportFormat('sarif')).toBe('sarif')
      expect(parseReportFormat('JSON')).toBe('json')
      expect(parseReportFormat('jsonl')).toBe('jsonl')
    })

    it('rejects removed v1 report formats', () => {
      expect(() => parseReportFormat('csv')).toThrow(
        'Unsupported report-format'
      )
      expect(() => parseReportFormat('junit')).toThrow(
        'Unsupported report-format'
      )
      expect(() => parseReportFormat('template')).toThrow(
        'Unsupported report-format'
      )
    })

    it('defaults report-path based on format and validates json/jsonl extensions', () => {
      expect(resolveReportPath('', 'sarif')).toBe('betterleaks-report.sarif')
      expect(resolveReportPath('', 'json')).toBe('betterleaks-report.json')
      expect(resolveReportPath('', 'jsonl')).toBe('betterleaks-report.jsonl')
      expect(resolveReportPath('out/custom.sarif', 'sarif')).toBe(
        'out/custom.sarif'
      )
      expect(resolveReportPath('out/findings.json', 'json')).toBe(
        'out/findings.json'
      )
      expect(resolveReportPath('out/findings.jsonl', 'jsonl')).toBe(
        'out/findings.jsonl'
      )

      expect(() => resolveReportPath('report.sarif', 'json')).toThrow(
        'must end in .json'
      )
      expect(() => resolveReportPath('report.json', 'jsonl')).toThrow(
        'must end in .jsonl'
      )
    })
  })

  describe('splitExtraArgs', () => {
    it('splits whitespace and respects single and double quotes', () => {
      expect(
        splitExtraArgs("--jobs 4 --author 'Jane Doe <jane@example.com>'")
      ).toEqual(['--jobs', '4', '--author', 'Jane Doe <jane@example.com>'])
      expect(splitExtraArgs('--isolate-rule "github-pat"')).toEqual([
        '--isolate-rule',
        'github-pat'
      ])
    })

    it('throws on unterminated quotes', () => {
      expect(() => splitExtraArgs("--author 'Jane")).toThrow(
        'Unterminated quote'
      )
    })
  })

  describe('buildArgs', () => {
    it('builds v2 filesystem scan args with --output and safe defaults', () => {
      const args = buildArgs('filesystem', makeInputs(), '/tmp/report.json')
      expect(args).toEqual([
        'filesystem',
        '.',
        '--output',
        '/tmp/report.json',
        '--redact',
        '--no-color',
        '--no-banner'
      ])
      expect(args).not.toContain('--validate')
      expect(args).not.toContain('--analyze')
    })

    it('builds git scan args without redundant dot positional arg', () => {
      const args = buildArgs('git', makeInputs({scanPath: '.'}), 'out.json')
      expect(args[0]).toBe('git')
      expect(args[1]).toBe('--output')
    })

    it('passes custom scan-path for git and filesystem, and omits it for stdin', () => {
      expect(
        buildArgs('git', makeInputs({scanPath: 'subrepo'}), 'out.json').slice(
          0,
          2
        )
      ).toEqual(['git', 'subrepo'])
      expect(
        buildArgs(
          'filesystem',
          makeInputs({scanPath: 'src/'}),
          'out.json'
        ).slice(0, 2)
      ).toEqual(['filesystem', 'src/'])
      expect(
        buildArgs('stdin', makeInputs({scanPath: 'src/'}), 'out.json').slice(
          0,
          2
        )
      ).toEqual(['stdin', '--output'])
    })

    it('passes --config, --exit-code, --validate, --analyze, and extra-args when enabled', () => {
      const args = buildArgs(
        'filesystem',
        makeInputs({
          config: '.betterleaks.toml',
          exitCode: '2',
          redact: false,
          noColor: false,
          noBanner: false,
          validate: true,
          analyze: true,
          extraArgs: '--jobs 4 --max-decode-depth 3'
        }),
        'out.json'
      )
      expect(args).toEqual([
        'filesystem',
        '.',
        '--config',
        '.betterleaks.toml',
        '--output',
        'out.json',
        '--exit-code',
        '2',
        '--validate',
        '--analyze',
        '--jobs',
        '4',
        '--max-decode-depth',
        '3'
      ])
    })
  })

  describe('parseLeakExitCode and parseTimeout', () => {
    it('parses valid exit codes and rejects invalid values', () => {
      expect(parseLeakExitCode('')).toBe(1)
      expect(parseLeakExitCode('   ')).toBe(1)
      expect(parseLeakExitCode('0')).toBe(0)
      expect(parseLeakExitCode('2')).toBe(2)
      expect(() => parseLeakExitCode('-1')).toThrow('Invalid exit-code input')
      expect(() => parseLeakExitCode('abc')).toThrow('Invalid exit-code input')
    })

    it('parses valid timeouts and rejects non-positive values', () => {
      expect(parseTimeout('')).toBe(300)
      expect(parseTimeout('60')).toBe(60)
      expect(() => parseTimeout('0')).toThrow('Invalid timeout input')
      expect(() => parseTimeout('-5')).toThrow('Invalid timeout input')
      expect(() => parseTimeout('abc')).toThrow('Invalid timeout input')
    })
  })

  describe('run', () => {
    it('captures exit code, stdout, and stderr from a child process', async () => {
      const result = await run(
        process.execPath,
        ['-e', 'console.log("ok"); console.error("warn"); process.exit(2)'],
        10
      )
      expect(result.exitCode).toBe(2)
      expect(result.stdout.trim()).toBe('ok')
      expect(result.stderr.trim()).toBe('warn')
    })

    it('enforces scan timeout and terminates hanging processes', async () => {
      await expect(
        run(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], 1)
      ).rejects.toThrow('timed out after 1 seconds')
    }, 10000)
  })
})
