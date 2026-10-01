import * as core from '@actions/core'
import {install} from './installer'
import {determineScanMode, buildArgs, run, ActionInputs} from './runner'
import {parseSarifResults} from './sarif'
import {writeSummary} from './summary'
import {EXIT_CODE_LEAKS_FOUND} from './constants'

const ZERO_SHA = '0000000000000000000000000000000000000000'

function computeLogOpts(explicitLogOpts: string, scanMode: string): string {
  // User-provided log-opts always wins
  if (explicitLogOpts) {
    return explicitLogOpts
  }

  // Only auto-compute for git scan mode on push events
  if (scanMode !== 'git' || process.env.GITHUB_EVENT_NAME !== 'push') {
    return ''
  }

  const eventPath = process.env.GITHUB_EVENT_PATH
  if (!eventPath) {
    return ''
  }

  try {
    const fs = require('fs')
    const event = JSON.parse(fs.readFileSync(eventPath, 'utf-8'))
    const before: string = event.before || ''
    const after: string = event.after || ''
    const forced: boolean = event.forced || false

    // New branch: before is all zeros — fall back to full history
    if (!before || before === ZERO_SHA) {
      core.info('New branch detected — scanning full git history')
      return ''
    }

    // Deleted branch: after is all zeros — skip
    if (!after || after === ZERO_SHA) {
      core.info('Branch deletion detected — scanning full git history')
      return ''
    }

    // Force push: before SHA may not exist — fall back to full history
    if (forced) {
      core.info('Force push detected — scanning full git history')
      return ''
    }

    core.info(`Scanning commit range: ${before}..${after}`)
    return `${before}..${after}`
  } catch {
    core.warning('Failed to read push event payload — scanning full git history')
    return ''
  }
}

function getInputs(scanMode: string): ActionInputs {
  const explicitLogOpts = core.getInput('log-opts')
  return {
    scanMode: core.getInput('scan-mode'),
    scanPath: core.getInput('scan-path'),
    config: core.getInput('config'),
    baselinePath: core.getInput('baseline-path'),
    reportFormat: core.getInput('report-format'),
    reportPath: core.getInput('report-path'),
    redact: core.getBooleanInput('redact'),
    exitCode: core.getInput('exit-code'),
    verbose: core.getBooleanInput('verbose'),
    noColor: core.getBooleanInput('no-color'),
    noBanner: core.getBooleanInput('no-banner'),
    validation: core.getBooleanInput('validation'),
    logOpts: computeLogOpts(explicitLogOpts, scanMode),
    extraArgs: core.getInput('extra-args'),
    timeout: parseInt(core.getInput('timeout'), 10) || 300
  }
}

async function main(): Promise<void> {
  try {
    const version = core.getInput('version')
    const token = core.getInput('github-token')
    const failOnLeak = core.getBooleanInput('fail-on-leak')

    // Install betterleaks
    const binaryPath = await install(version, token)

    // Determine scan mode
    const eventName = process.env.GITHUB_EVENT_NAME || ''
    const scanMode = determineScanMode(core.getInput('scan-mode'), eventName)
    core.info(`Scan mode: ${scanMode} (event: ${eventName})`)

    // Get inputs (needs scanMode for log-opts auto-computation)
    const inputs = getInputs(scanMode)

    // Build args and run
    const args = buildArgs(scanMode, inputs)
    const result = await run(binaryPath, args, inputs.timeout)

    // Set basic outputs
    core.setOutput('exit-code', result.exitCode)
    core.setOutput('report-path', inputs.reportPath)
    core.setOutput('leaks-found', result.exitCode === EXIT_CODE_LEAKS_FOUND)

    // Parse SARIF if applicable
    let leakCount = 0
    if (inputs.reportFormat === 'sarif') {
      core.setOutput('sarif-path', inputs.reportPath)
      const sarifResults = await parseSarifResults(inputs.reportPath)
      leakCount = sarifResults.leakCount
      core.setOutput('leak-count', leakCount)
    }

    // Write job summary
    await writeSummary(leakCount, scanMode, inputs.reportPath, result.exitCode)

    // Fail if leaks found and fail-on-leak is true
    if (result.exitCode === EXIT_CODE_LEAKS_FOUND && failOnLeak) {
      core.setFailed(
        `Betterleaks detected ${leakCount || 'one or more'} secret(s). See report at ${inputs.reportPath}`
      )
    } else if (result.exitCode !== 0 && result.exitCode !== EXIT_CODE_LEAKS_FOUND) {
      core.setFailed(
        `Betterleaks exited with unexpected code ${result.exitCode}: ${result.stderr}`
      )
    }
  } catch (error) {
    core.setFailed(
      error instanceof Error ? error.message : 'Unknown error occurred'
    )
  }
}

main()
