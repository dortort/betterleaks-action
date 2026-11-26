import {spawn} from 'child_process'
import {EXIT_CODE_LEAKS_FOUND} from './constants.js'
import type {ReportFormat} from './report.js'

export type ScanMode = 'filesystem' | 'git' | 'stdin'

const VALID_REPORT_FORMATS: ReadonlySet<string> = new Set([
  'sarif',
  'json',
  'jsonl'
])

export interface ActionInputs {
  scanMode: string
  scanPath: string
  config: string
  reportFormat: ReportFormat
  reportPath: string
  redact: boolean
  exitCode: string
  noColor: boolean
  noBanner: boolean
  validate: boolean
  analyze: boolean
  extraArgs: string
  timeout: number
}

export interface RunResult {
  exitCode: number
  stdout: string
  stderr: string
}

export function parseLeakExitCode(exitCodeInput: string): number {
  const trimmed = exitCodeInput.trim()
  if (!trimmed) {
    return EXIT_CODE_LEAKS_FOUND
  }
  const parsed = Number(trimmed)
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid exit-code input: ${exitCodeInput}`)
  }
  return parsed
}

export function parseTimeout(timeoutInput: string): number {
  const trimmed = timeoutInput.trim()
  if (!trimmed) {
    return 300
  }
  const parsed = Number(trimmed)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid timeout input: ${timeoutInput}`)
  }
  return parsed
}

export function parseReportFormat(formatInput: string): ReportFormat {
  const normalized = formatInput.trim().toLowerCase() || 'sarif'
  if (!VALID_REPORT_FORMATS.has(normalized)) {
    throw new Error(
      `Unsupported report-format '${formatInput}'. Betterleaks v2 supports 'json' and 'jsonl', and this action also provides built-in 'sarif' (SARIF 2.1.0) conversion.`
    )
  }
  return normalized as ReportFormat
}

export function resolveReportPath(
  reportPathInput: string,
  format: ReportFormat
): string {
  const trimmed = reportPathInput.trim()
  if (!trimmed) {
    return `betterleaks-report.${format}`
  }

  const lower = trimmed.toLowerCase()
  if (format === 'json' && !lower.endsWith('.json')) {
    throw new Error(
      `report-path '${trimmed}' must end in .json when report-format is 'json'`
    )
  }
  if (format === 'jsonl' && !lower.endsWith('.jsonl')) {
    throw new Error(
      `report-path '${trimmed}' must end in .jsonl when report-format is 'jsonl'`
    )
  }

  return trimmed
}

export function determineScanMode(
  inputMode: string,
  eventName: string
): ScanMode {
  const normalized = inputMode.trim().toLowerCase() || 'auto'

  if (normalized === 'auto') {
    return eventName === 'push' ? 'git' : 'filesystem'
  }
  if (normalized === 'filesystem' || normalized === 'fs' || normalized === 'dir') {
    return 'filesystem'
  }
  if (normalized === 'git' || normalized === 'stdin') {
    return normalized
  }

  throw new Error(
    `Invalid scan-mode '${inputMode}'. Expected 'auto', 'filesystem' (or 'fs'), 'git', or 'stdin'.`
  )
}

export function splitExtraArgs(extraArgs: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quote: "'" | '"' | null = null
  let hasToken = false

  for (let i = 0; i < extraArgs.length; i++) {
    const ch = extraArgs[i]

    if (quote) {
      if (ch === quote) {
        quote = null
      } else if (ch === '\\' && quote === '"' && i + 1 < extraArgs.length) {
        current += extraArgs[++i]
      } else {
        current += ch
      }
      continue
    }

    if (ch === "'" || ch === '"') {
      quote = ch
      hasToken = true
    } else if (/\s/.test(ch)) {
      if (hasToken) {
        tokens.push(current)
        current = ''
        hasToken = false
      }
    } else {
      current += ch
      hasToken = true
    }
  }

  if (quote) {
    throw new Error(`Unterminated quote in extra-args: ${extraArgs}`)
  }
  if (hasToken) {
    tokens.push(current)
  }

  return tokens
}

export function buildArgs(
  scanMode: ScanMode,
  inputs: ActionInputs,
  cliOutputPath: string
): string[] {
  const args: string[] = [scanMode]

  if (scanMode === 'filesystem') {
    args.push(inputs.scanPath || '.')
  } else if (scanMode === 'git' && inputs.scanPath && inputs.scanPath !== '.') {
    args.push(inputs.scanPath)
  }

  if (inputs.config) {
    args.push('--config', inputs.config)
  }
  if (cliOutputPath) {
    args.push('--output', cliOutputPath)
  }
  if (inputs.redact) {
    args.push('--redact')
  }
  if (inputs.exitCode.trim()) {
    args.push('--exit-code', inputs.exitCode.trim())
  }
  if (inputs.noColor) {
    args.push('--no-color')
  }
  if (inputs.noBanner) {
    args.push('--no-banner')
  }
  if (inputs.validate) {
    args.push('--validate')
  }
  if (inputs.analyze) {
    args.push('--analyze')
  }
  if (inputs.extraArgs.trim()) {
    args.push(...splitExtraArgs(inputs.extraArgs))
  }

  return args
}

export async function run(
  binaryPath: string,
  args: string[],
  timeoutSeconds: number
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(binaryPath, args, {
      stdio: ['inherit', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false
    let killTimer: ReturnType<typeof setTimeout> | undefined

    const clearTimers = (): void => {
      if (timeoutTimer) clearTimeout(timeoutTimer)
      if (killTimer) clearTimeout(killTimer)
    }

    const timeoutTimer =
      timeoutSeconds > 0
        ? setTimeout(() => {
            timedOut = true
            child.kill('SIGTERM')
            killTimer = setTimeout(() => {
              child.kill('SIGKILL')
            }, 5000)
            killTimer.unref()
          }, timeoutSeconds * 1000)
        : undefined
    timeoutTimer?.unref()

    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      stdout += text
      process.stdout.write(chunk)
    })

    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      stderr += text
      process.stderr.write(chunk)
    })

    child.on('error', (error: Error) => {
      if (settled) return
      settled = true
      clearTimers()
      reject(error)
    })

    child.on('close', (code: number | null) => {
      if (settled) return
      settled = true
      clearTimers()
      if (timedOut) {
        reject(
          new Error(
            `Betterleaks scan timed out after ${timeoutSeconds} seconds`
          )
        )
        return
      }
      resolve({exitCode: code ?? 1, stdout, stderr})
    })
  })
}
