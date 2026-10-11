import {writeSummary} from '../src/summary'
import * as core from '@actions/core'

jest.mock('@actions/core')

describe('summary', () => {
  let mockWrite: jest.Mock
  let mockSummary: Record<string, jest.Mock>

  beforeEach(() => {
    mockWrite = jest.fn().mockResolvedValue(undefined)
    mockSummary = {
      addHeading: jest.fn().mockReturnThis(),
      addTable: jest.fn().mockReturnThis(),
      addRaw: jest.fn().mockReturnThis(),
      write: mockWrite
    }
    Object.defineProperty(core, 'summary', {
      value: mockSummary,
      writable: true
    })
  })

  it('writes summary for clean scan', async () => {
    await writeSummary(0, 'dir', 'report.sarif', 0)
    expect(mockSummary.addHeading).toHaveBeenCalledWith(
      expect.stringContaining('Betterleaks Scan Results')
    )
    expect(mockSummary.addTable).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.arrayContaining(['No leaks detected'])
      ])
    )
    expect(mockWrite).toHaveBeenCalled()
  })

  it('writes summary for leaky scan', async () => {
    await writeSummary(3, 'git', 'report.sarif', 1)
    expect(mockSummary.addHeading).toHaveBeenCalledWith(
      expect.stringContaining('Betterleaks Scan Results')
    )
    expect(mockSummary.addTable).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.arrayContaining(['3 leak(s) found'])
      ])
    )
  })

  it('includes report path in output', async () => {
    await writeSummary(0, 'dir', 'custom-report.sarif', 0)
    expect(mockSummary.addRaw).toHaveBeenCalledWith(
      expect.stringContaining('custom-report.sarif')
    )
  })

  // Regression: a non-SARIF report format leaves leakCount undefined. Reading
  // that as zero rendered a leaky scan as "No leaks detected".
  it('does not report clean when leaks were found but the count is unknown', async () => {
    await writeSummary(undefined, 'dir', 'report.json', 1)
    expect(mockSummary.addHeading).toHaveBeenCalledWith(
      expect.stringContaining('❌')
    )
    expect(mockSummary.addTable).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.arrayContaining(['Leaks detected', 'dir', 'unknown', '1'])
      ])
    )
  })

  // Regression: a scan that dies before writing a report yields leakCount 0
  // via the !existsSync branch in parseSarifResults, which rendered clean.
  it('does not report clean when the scan exited unexpectedly', async () => {
    await writeSummary(0, 'dir', 'report.sarif', 126)
    expect(mockSummary.addHeading).toHaveBeenCalledWith(
      expect.stringContaining('❌')
    )
    expect(mockSummary.addHeading).not.toHaveBeenCalledWith(
      expect.stringContaining('✅')
    )
  })
})
