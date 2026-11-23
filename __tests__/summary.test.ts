import {describe, it, expect, beforeEach, vi, type Mock} from 'vitest'
import {writeSummary} from '../src/summary.js'
import * as core from '@actions/core'

vi.mock('@actions/core')

describe('summary', () => {
  let mockWrite: Mock
  let mockSummary: Record<string, Mock>

  beforeEach(() => {
    mockWrite = vi.fn().mockResolvedValue(undefined)
    mockSummary = {
      addHeading: vi.fn().mockReturnThis(),
      addTable: vi.fn().mockReturnThis(),
      addRaw: vi.fn().mockReturnThis(),
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

  it('reports clean for non-SARIF format when exit code is 0', async () => {
    await writeSummary(undefined, 'dir', 'report.json', 0)
    expect(mockSummary.addHeading).toHaveBeenCalledWith(
      expect.stringContaining('\u2705')
    )
    expect(mockSummary.addTable).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.arrayContaining(['No leaks detected', 'dir', '0', '0'])
      ])
    )
  })

  it('reports leaks detected for non-SARIF format when exit code indicates leaks', async () => {
    await writeSummary(undefined, 'dir', 'report.json', 1)
    expect(mockSummary.addHeading).toHaveBeenCalledWith(
      expect.stringContaining('\u274c')
    )
    expect(mockSummary.addTable).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.arrayContaining(['Leaks detected', 'dir', 'unknown', '1'])
      ])
    )
  })

  it('reports scan error rather than leaks when exit code is unexpected', async () => {
    await writeSummary(undefined, 'dir', 'report.json', 126)
    expect(mockSummary.addHeading).toHaveBeenCalledWith(
      expect.stringContaining('\u274c')
    )
    expect(mockSummary.addTable).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.arrayContaining(['Scan failed (exit code 126)', 'dir', 'N/A', '126'])
      ])
    )
    expect(mockSummary.addRaw).toHaveBeenCalledWith(
      expect.not.stringContaining('Report written to')
    )
  })

  it('reports scan error even when leakCount is 0 and exit code is unexpected', async () => {
    await writeSummary(0, 'dir', 'report.sarif', 126)
    expect(mockSummary.addHeading).toHaveBeenCalledWith(
      expect.stringContaining('\u274c')
    )
    expect(mockSummary.addTable).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.arrayContaining(['Scan failed (exit code 126)', 'dir', 'N/A', '126'])
      ])
    )
  })

  it('preserves positive SARIF findings when custom leak exit code is 0', async () => {
    await writeSummary(3, 'dir', 'report.sarif', 0, 0)
    expect(mockSummary.addHeading).toHaveBeenCalledWith(
      expect.stringContaining('\u274c')
    )
    expect(mockSummary.addTable).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.arrayContaining(['3 leak(s) found', 'dir', '3', '0'])
      ])
    )
  })

  it('reports indeterminate status for non-SARIF format when custom leak exit code is 0', async () => {
    await writeSummary(undefined, 'dir', 'report.json', 0, 0)
    expect(mockSummary.addHeading).toHaveBeenCalledWith(
      expect.stringContaining('\u26a0\ufe0f')
    )
    expect(mockSummary.addTable).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.arrayContaining([
          'Scan completed (leak status unavailable)',
          'dir',
          'unknown',
          '0'
        ])
      ])
    )
  })

  it('supports custom non-zero leak exit codes and distinguishes runtime exit 1', async () => {
    await writeSummary(2, 'dir', 'report.sarif', 2, 2)
    expect(mockSummary.addTable).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.arrayContaining(['2 leak(s) found', 'dir', '2', '2'])
      ])
    )

    vi.clearAllMocks()
    await writeSummary(undefined, 'dir', 'report.json', 1, 2)
    expect(mockSummary.addTable).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.arrayContaining(['Scan failed (exit code 1)', 'dir', 'N/A', '1'])
      ])
    )
  })

  it('reports Leaks detected with unknown count when leak exit occurs with 0 parsed SARIF count', async () => {
    await writeSummary(0, 'dir', 'report.sarif', 1)
    expect(mockSummary.addHeading).toHaveBeenCalledWith(
      expect.stringContaining('\u274c')
    )
    expect(mockSummary.addTable).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.arrayContaining(['Leaks detected', 'dir', 'unknown', '1'])
      ])
    )
  })
})
