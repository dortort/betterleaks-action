import * as core from '@actions/core'
import {EXIT_CODE_CLEAN, EXIT_CODE_LEAKS_FOUND} from './constants.js'

export async function writeSummary(
  leakCount: number | undefined,
  scanMode: string,
  reportPath: string,
  exitCode: number,
  leakExitCode: number = EXIT_CODE_LEAKS_FOUND
): Promise<void> {
  const isError = exitCode !== EXIT_CODE_CLEAN && exitCode !== leakExitCode
  const hasPositiveCount = leakCount !== undefined && leakCount > 0
  const isLeakExit =
    leakExitCode !== EXIT_CODE_CLEAN && exitCode === leakExitCode
  const leaksDetected = !isError && (hasPositiveCount || isLeakExit)
  const isIndeterminate =
    !isError &&
    !leaksDetected &&
    leakExitCode === EXIT_CODE_CLEAN &&
    leakCount === undefined

  let statusEmoji: string
  let statusText: string
  let leaksFoundCell: string

  if (isError) {
    statusEmoji = '\u274c'
    statusText = `Scan failed (exit code ${exitCode})`
    leaksFoundCell = 'N/A'
  } else if (leaksDetected) {
    statusEmoji = '\u274c'
    statusText = hasPositiveCount
      ? `${leakCount} leak(s) found`
      : 'Leaks detected'
    leaksFoundCell = hasPositiveCount ? String(leakCount) : 'unknown'
  } else if (isIndeterminate) {
    statusEmoji = '\u26a0\ufe0f'
    statusText = 'Scan completed (leak status unavailable)'
    leaksFoundCell = 'unknown'
  } else {
    statusEmoji = '\u2705'
    statusText = 'No leaks detected'
    leaksFoundCell = String(leakCount ?? 0)
  }

  const footer = isError
    ? '\n\nPowered by [Betterleaks](https://github.com/betterleaks/betterleaks)'
    : `\n\nReport written to \`${reportPath}\`\n\n` +
      'Powered by [Betterleaks](https://github.com/betterleaks/betterleaks)'

  await core.summary
    .addHeading(`${statusEmoji} Betterleaks Scan Results`)
    .addTable([
      [
        {data: 'Status', header: true},
        {data: 'Scan Mode', header: true},
        {data: 'Leaks Found', header: true},
        {data: 'Exit Code', header: true}
      ],
      [statusText, scanMode, leaksFoundCell, String(exitCode)]
    ])
    .addRaw(footer)
    .write()
}
