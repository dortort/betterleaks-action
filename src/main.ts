import * as core from '@actions/core'
import {install} from './installer'
import {determineScanMode, buildArgs, run, ActionInputs} from './runner'
import {parseSarifResults} from './sarif'
import {writeSummary} from './summary'
import {EXIT_CODE_LEAKS_FOUND} from './constants'

function getInputs(): ActionInputs {
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
    extraArgs: core.getInput('extra-args'),
    timeout: parseInt(core.getInput('timeout'), 10) || 300
  }
}

async function main(): Promise<void> {
  try {
    const inputs = getInputs()
    const version = core.getInput('version')
    const token = core.getInput('github-token')
    const failOnLeak = core.getBooleanInput('fail-on-leak')

    // Install betterleaks
    const binaryPath = await install(version, token)

    // Determine scan mode
    const eventName = process.env.GITHUB_EVENT_NAME || ''
    const scanMode = determineScanMode(inputs.scanMode, eventName)
    core.info(`Scan mode: ${scanMode} (event: ${eventName})`)

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
