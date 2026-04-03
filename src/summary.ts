import * as core from '@actions/core'

export async function writeSummary(
  leakCount: number,
  scanMode: string,
  reportPath: string,
  exitCode: number
): Promise<void> {
  const passed = leakCount === 0
  const statusEmoji = passed ? '\u2705' : '\u274c'
  const statusText = passed ? 'No leaks detected' : `${leakCount} leak(s) found`

  await core.summary
    .addHeading(`${statusEmoji} Betterleaks Scan Results`)
    .addTable([
      [
        {data: 'Status', header: true},
        {data: 'Scan Mode', header: true},
        {data: 'Leaks Found', header: true},
        {data: 'Exit Code', header: true}
      ],
      [statusText, scanMode, String(leakCount), String(exitCode)]
    ])
    .addRaw(
      `\n\nReport written to \`${reportPath}\`\n\n` +
        'Powered by [Betterleaks](https://github.com/betterleaks/betterleaks)'
    )
    .write()
}
