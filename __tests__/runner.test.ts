import {determineScanMode, buildArgs, ActionInputs} from '../src/runner'

function makeInputs(overrides: Partial<ActionInputs> = {}): ActionInputs {
  return {
    scanMode: 'auto',
    scanPath: '.',
    config: '',
    baselinePath: '',
    reportFormat: 'sarif',
    reportPath: 'betterleaks-report.sarif',
    redact: true,
    exitCode: '',
    verbose: false,
    noColor: true,
    noBanner: true,
    validation: true,
    logOpts: '',
    extraArgs: '',
    timeout: 300,
    ...overrides
  }
}

describe('runner', () => {
  describe('determineScanMode', () => {
    it('returns explicit mode when not auto', () => {
      expect(determineScanMode('git', 'push')).toBe('git')
      expect(determineScanMode('dir', 'push')).toBe('dir')
    })

    it('returns git for push events', () => {
      expect(determineScanMode('auto', 'push')).toBe('git')
    })

    it('returns dir for pull_request events', () => {
      expect(determineScanMode('auto', 'pull_request')).toBe('dir')
    })

    it('returns dir for pull_request_target events', () => {
      expect(determineScanMode('auto', 'pull_request_target')).toBe('dir')
    })

    it('returns dir for schedule events', () => {
      expect(determineScanMode('auto', 'schedule')).toBe('dir')
    })

    it('returns dir for workflow_dispatch events', () => {
      expect(determineScanMode('auto', 'workflow_dispatch')).toBe('dir')
    })

    it('returns dir for unknown events', () => {
      expect(determineScanMode('auto', 'unknown_event')).toBe('dir')
    })
  })

  describe('buildArgs', () => {
    it('builds basic dir scan args', () => {
      const args = buildArgs('dir', makeInputs())
      expect(args).toContain('dir')
      expect(args).toContain('.')
      expect(args).toContain('--report-format')
      expect(args).toContain('sarif')
      expect(args).toContain('--redact')
      expect(args).toContain('--no-color')
      expect(args).toContain('--no-banner')
    })

    it('builds git scan args without positional path', () => {
      const args = buildArgs('git', makeInputs({scanPath: '.'}))
      expect(args[0]).toBe('git')
      // git mode with '.' should not add positional arg
    })

    it('includes config when set', () => {
      const args = buildArgs('dir', makeInputs({config: '.betterleaks.toml'}))
      expect(args).toContain('--config')
      expect(args).toContain('.betterleaks.toml')
    })

    it('includes baseline-path when set', () => {
      const args = buildArgs('dir', makeInputs({baselinePath: 'baseline.json'}))
      expect(args).toContain('--baseline-path')
      expect(args).toContain('baseline.json')
    })

    it('includes custom exit-code when set', () => {
      const args = buildArgs('dir', makeInputs({exitCode: '2'}))
      expect(args).toContain('--exit-code')
      expect(args).toContain('2')
    })

    it('includes verbose flag', () => {
      const args = buildArgs('dir', makeInputs({verbose: true}))
      expect(args).toContain('--verbose')
    })

    it('passes --validation=false when validation is disabled', () => {
      const args = buildArgs('dir', makeInputs({validation: false}))
      expect(args).toContain('--validation=false')
    })

    it('does not pass --validation=false when validation is enabled', () => {
      const args = buildArgs('dir', makeInputs({validation: true}))
      expect(args).not.toContain('--validation=false')
    })

    it('splits extra-args by whitespace', () => {
      const args = buildArgs('dir', makeInputs({extraArgs: '--git-workers 4 --max-decode-depth 3'}))
      expect(args).toContain('--git-workers')
      expect(args).toContain('4')
      expect(args).toContain('--max-decode-depth')
      expect(args).toContain('3')
    })

    it('includes --log-opts in git mode when set', () => {
      const args = buildArgs('git', makeInputs({logOpts: 'abc123..def456'}))
      expect(args).toContain('--log-opts')
      expect(args).toContain('abc123..def456')
    })

    it('does not include --log-opts in dir mode even when set', () => {
      const args = buildArgs('dir', makeInputs({logOpts: 'abc123..def456'}))
      expect(args).not.toContain('--log-opts')
    })

    it('does not include --log-opts when empty', () => {
      const args = buildArgs('git', makeInputs({logOpts: ''}))
      expect(args).not.toContain('--log-opts')
    })

    it('uses custom scan-path as positional arg', () => {
      const args = buildArgs('dir', makeInputs({scanPath: 'src/'}))
      expect(args[0]).toBe('dir')
      expect(args[1]).toBe('src/')
    })
  })
})
