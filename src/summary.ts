import * as core from '@actions/core'
import {EXIT_CODE_CLEAN} from './constants'

export async function writeSummary(
  leakCount: number | undefined,
  scanMode: string,
  reportPath: string,
  exitCode: number
): Promise<void> {
  // The exit code is the authoritative signal. leakCount is only available for
  // SARIF reports, and is absent whenever the scan failed before writing one,
  // so treating a missing count as zero reported those scans as clean.
  const passed = exitCode === EXIT_CODE_CLEAN
  const statusEmoji = passed ? '\u2705' : '\u274c'
  const statusText = passed
    ? 'No leaks detected'
    : leakCount === undefined
      ? 'Leaks detected'
      : `${leakCount} leak(s) found`

  await core.summary
    .addHeading(`${statusEmoji} Betterleaks Scan Results`)
    .addTable([
      [
        {data: 'Status', header: true},
        {data: 'Scan Mode', header: true},
        {data: 'Leaks Found', header: true},
        {data: 'Exit Code', header: true}
      ],
      [
        statusText,
        scanMode,
        leakCount === undefined ? 'unknown' : String(leakCount),
        String(exitCode)
      ]
    ])
    .addRaw(
      `\n\nReport written to \`${reportPath}\`\n\n` +
        'Powered by [Betterleaks](https://github.com/betterleaks/betterleaks)'
    )
    .write()
}
