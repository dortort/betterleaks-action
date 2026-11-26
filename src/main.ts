import * as core from '@actions/core'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {install} from './installer.js'
import {
  determineScanMode,
  buildArgs,
  parseLeakExitCode,
  parseReportFormat,
  parseTimeout,
  resolveReportPath,
  run,
  type ActionInputs
} from './runner.js'
import {parseReport, type BetterleaksReport} from './report.js'
import {convertToSarif, writeSarifReport} from './sarif.js'
import {writeSummary} from './summary.js'
import {EXIT_CODE_CLEAN} from './constants.js'

function getInputs(): ActionInputs {
  const reportFormat = parseReportFormat(core.getInput('report-format'))
  const reportPath = resolveReportPath(
    core.getInput('report-path'),
    reportFormat
  )

  return {
    scanMode: core.getInput('scan-mode'),
    scanPath: core.getInput('scan-path'),
    config: core.getInput('config'),
    reportFormat,
    reportPath,
    redact: core.getBooleanInput('redact'),
    exitCode: core.getInput('exit-code'),
    noColor: core.getBooleanInput('no-color'),
    noBanner: core.getBooleanInput('no-banner'),
    validate: core.getBooleanInput('validate'),
    analyze: core.getBooleanInput('analyze'),
    extraArgs: core.getInput('extra-args'),
    timeout: parseTimeout(core.getInput('timeout'))
  }
}

async function main(): Promise<void> {
  let tempDir: string | undefined

  try {
    const inputs = getInputs()
    const leakExitCode = parseLeakExitCode(inputs.exitCode)
    const version = core.getInput('version') || 'latest'
    const token = core.getInput('github-token')
    const failOnLeak = core.getBooleanInput('fail-on-leak')

    if (inputs.scanMode.trim().toLowerCase() === 'dir') {
      core.warning(
        "scan-mode 'dir' is a legacy alias for 'filesystem'. Update your workflow to use 'filesystem'."
      )
    }

    const {binaryPath, version: installedVersion} = await install(
      version,
      token
    )

    const eventName = process.env.GITHUB_EVENT_NAME || ''
    const scanMode = determineScanMode(inputs.scanMode, eventName)
    core.info(`Scan mode: ${scanMode} (event: ${eventName || 'local'})`)

    let cliOutputPath: string
    if (inputs.reportFormat === 'sarif') {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'betterleaks-action-'))
      cliOutputPath = path.join(tempDir, 'report.json')
    } else {
      const reportDir = path.dirname(inputs.reportPath)
      if (reportDir && reportDir !== '.') {
        fs.mkdirSync(reportDir, {recursive: true})
      }
      cliOutputPath = inputs.reportPath
    }

    const args = buildArgs(scanMode, inputs, cliOutputPath)
    const result = await run(binaryPath, args, inputs.timeout)

    let report: BetterleaksReport | undefined
    if (fs.existsSync(cliOutputPath) && fs.statSync(cliOutputPath).size > 0) {
      report = parseReport(
        cliOutputPath,
        inputs.reportFormat === 'jsonl' ? 'jsonl' : 'json'
      )
    }

    const scanIncomplete = report?.scan.state === 'incomplete'
    const isUnexpectedExit =
      result.exitCode !== EXIT_CODE_CLEAN && result.exitCode !== leakExitCode
    const missingReportOnFailure = !report && result.exitCode !== EXIT_CODE_CLEAN
    const isScanFailure =
      isUnexpectedExit || scanIncomplete || missingReportOnFailure

    core.setOutput('exit-code', result.exitCode)
    core.setOutput('report-path', inputs.reportPath)

    if (inputs.reportFormat === 'sarif' && report) {
      const sarif = convertToSarif(report, {
        fallbackVersion: installedVersion
      })
      writeSarifReport(sarif, inputs.reportPath)
      core.setOutput('sarif-path', inputs.reportPath)
    }

    const leakCount = report ? report.findings.length : undefined
    if (leakCount !== undefined) {
      core.setOutput('leak-count', leakCount)
    }

    const leaksFound =
      (leakCount !== undefined && leakCount > 0) ||
      (!isScanFailure &&
        leakExitCode !== EXIT_CODE_CLEAN &&
        result.exitCode === leakExitCode)

    core.setOutput('leaks-found', leaksFound)

    await writeSummary({
      report,
      scanMode,
      reportPath: inputs.reportPath,
      reportFormat: inputs.reportFormat,
      exitCode: result.exitCode,
      leakExitCode,
      validate: inputs.validate,
      analyze: inputs.analyze,
      scanIncomplete
    })

    if (scanIncomplete) {
      core.setFailed(
        `Betterleaks scan ended incomplete (exit code ${result.exitCode})${
          leakCount ? ` with ${leakCount} partial finding(s)` : ''
        }: ${result.stderr}`
      )
    } else if (isUnexpectedExit || missingReportOnFailure) {
      core.setFailed(
        `Betterleaks exited with unexpected code ${result.exitCode}: ${result.stderr}`
      )
    } else if (leaksFound && failOnLeak) {
      core.setFailed(
        `Betterleaks detected ${leakCount ?? 'one or more'} secret(s). See report at ${inputs.reportPath}`
      )
    }
  } catch (error) {
    core.setFailed(
      error instanceof Error ? error.message : 'Unknown error occurred'
    )
  } finally {
    if (tempDir) {
      fs.rmSync(tempDir, {recursive: true, force: true})
    }
  }
}

main()
