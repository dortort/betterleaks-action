import * as fs from 'fs'

interface SarifRun {
  results?: unknown[]
}

interface SarifReport {
  runs?: SarifRun[]
}

export interface SarifResults {
  leakCount: number
}

export async function parseSarifResults(
  reportPath: string
): Promise<SarifResults> {
  if (!fs.existsSync(reportPath)) {
    return {leakCount: 0}
  }

  const content = fs.readFileSync(reportPath, 'utf-8')

  let report: SarifReport
  try {
    report = JSON.parse(content) as SarifReport
  } catch {
    throw new Error(`Failed to parse SARIF file at ${reportPath}: invalid JSON`)
  }

  let leakCount = 0
  if (report.runs) {
    for (const run of report.runs) {
      leakCount += run.results?.length ?? 0
    }
  }

  return {leakCount}
}
