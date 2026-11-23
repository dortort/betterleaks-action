import * as core from '@actions/core'
import {install} from './installer.js'
import {
  determineScanMode,
  buildArgs,
  parseLeakExitCode,
  run,
  ActionInputs
} from './runner.js'
import {parseSarifResults} from './sarif.js'
import {writeSummary} from './summary.js'
import {EXIT_CODE_CLEAN} from './constants.js'

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
    const leakExitCode = parseLeakExitCode(inputs.exitCode)
    const version = core.getInput('version')
    const token = core.getInput('github-token')
    const failOnLeak = core.getBooleanInput('fail-on-leak')

    // Install betterleaks
    const binaryPath = await install(version, token)

    // Determine scan mode
    const eventName = process.env.GITHUB_EVENT_NAME || ''
    const scanMode = determineScanMode(inputs.scanMode, eventName)
    core.info(`Scan mode: ${scanMode} (event: ${eventName})`)

    const args = buildArgs(scanMode, inputs)
    const result = await run(binaryPath, args, inputs.timeout)

    const isUnexpectedError =
      result.exitCode !== EXIT_CODE_CLEAN && result.exitCode !== leakExitCode

    core.setOutput('exit-code', result.exitCode)
    core.setOutput('report-path', inputs.reportPath)

    let leakCount: number | undefined
    if (inputs.reportFormat === 'sarif') {
      core.setOutput('sarif-path', inputs.reportPath)
      if (!isUnexpectedError) {
        const sarifResults = await parseSarifResults(inputs.reportPath)
        leakCount = sarifResults.leakCount
        core.setOutput('leak-count', leakCount)
      }
    }

    const leaksFound =
      !isUnexpectedError &&
      ((leakCount !== undefined && leakCount > 0) ||
        (leakExitCode !== EXIT_CODE_CLEAN && result.exitCode === leakExitCode))

    core.setOutput('leaks-found', leaksFound)

    await writeSummary(
      leakCount,
      scanMode,
      inputs.reportPath,
      result.exitCode,
      leakExitCode
    )

    if (isUnexpectedError) {
      core.setFailed(
        `Betterleaks exited with unexpected code ${result.exitCode}: ${result.stderr}`
      )
    } else if (leaksFound && failOnLeak) {
      core.setFailed(
        `Betterleaks detected ${leakCount || 'one or more'} secret(s). See report at ${inputs.reportPath}`
      )
    }
  } catch (error) {
    core.setFailed(
      error instanceof Error ? error.message : 'Unknown error occurred'
    )
  }
}

main()
