import * as exec from '@actions/exec'

export interface ActionInputs {
  scanMode: string
  scanPath: string
  config: string
  baselinePath: string
  reportFormat: string
  reportPath: string
  redact: boolean
  exitCode: string
  verbose: boolean
  noColor: boolean
  noBanner: boolean
  validation: boolean
  extraArgs: string
  timeout: number
}

export interface RunResult {
  exitCode: number
  stdout: string
  stderr: string
}

export function determineScanMode(inputMode: string, eventName: string): string {
  if (inputMode !== 'auto') {
    return inputMode
  }

  switch (eventName) {
    case 'push':
      return 'git'
    case 'pull_request':
    case 'pull_request_target':
    case 'schedule':
    case 'workflow_dispatch':
    default:
      return 'dir'
  }
}

export function buildArgs(scanMode: string, inputs: ActionInputs): string[] {
  const args: string[] = [scanMode]

  // scan-path is a positional argument
  if (inputs.scanPath && inputs.scanPath !== '.') {
    args.push(inputs.scanPath)
  } else if (scanMode === 'dir') {
    args.push('.')
  }

  if (inputs.config) {
    args.push('--config', inputs.config)
  }
  if (inputs.baselinePath) {
    args.push('--baseline-path', inputs.baselinePath)
  }
  if (inputs.reportFormat) {
    args.push('--report-format', inputs.reportFormat)
  }
  if (inputs.reportPath) {
    args.push('--report-path', inputs.reportPath)
  }
  if (inputs.redact) {
    args.push('--redact')
  }
  if (inputs.exitCode) {
    args.push('--exit-code', inputs.exitCode)
  }
  if (inputs.verbose) {
    args.push('--verbose')
  }
  if (inputs.noColor) {
    args.push('--no-color')
  }
  if (inputs.noBanner) {
    args.push('--no-banner')
  }
  if (!inputs.validation) {
    args.push('--validation=false')
  }
  if (inputs.extraArgs) {
    args.push(...inputs.extraArgs.split(/\s+/).filter(Boolean))
  }

  return args
}

export async function run(
  binaryPath: string,
  args: string[],
  timeout: number
): Promise<RunResult> {
  let stdout = ''
  let stderr = ''

  const exitCode = await exec.exec(binaryPath, args, {
    ignoreReturnCode: true,
    listeners: {
      stdout: (data: Buffer) => {
        stdout += data.toString()
      },
      stderr: (data: Buffer) => {
        stderr += data.toString()
      }
    }
  })

  return {exitCode, stdout, stderr}
}
