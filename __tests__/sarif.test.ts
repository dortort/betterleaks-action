import {parseSarifResults} from '../src/sarif'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

describe('sarif', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sarif-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, {recursive: true, force: true})
  })

  it('returns 0 leaks when file does not exist', async () => {
    const result = await parseSarifResults('/nonexistent/path.sarif')
    expect(result.leakCount).toBe(0)
  })

  it('counts results across runs', async () => {
    const sarif = {
      version: '2.1.0',
      runs: [
        {
          results: [
            {ruleId: 'aws-access-key', message: {text: 'Secret found'}},
            {ruleId: 'generic-api-key', message: {text: 'Secret found'}}
          ]
        }
      ]
    }
    const sarifPath = path.join(tmpDir, 'report.sarif')
    fs.writeFileSync(sarifPath, JSON.stringify(sarif))

    const result = await parseSarifResults(sarifPath)
    expect(result.leakCount).toBe(2)
  })

  it('counts results across multiple runs', async () => {
    const sarif = {
      version: '2.1.0',
      runs: [
        {results: [{ruleId: 'a'}]},
        {results: [{ruleId: 'b'}, {ruleId: 'c'}]}
      ]
    }
    const sarifPath = path.join(tmpDir, 'report.sarif')
    fs.writeFileSync(sarifPath, JSON.stringify(sarif))

    const result = await parseSarifResults(sarifPath)
    expect(result.leakCount).toBe(3)
  })

  it('returns 0 for empty runs', async () => {
    const sarif = {version: '2.1.0', runs: [{results: []}]}
    const sarifPath = path.join(tmpDir, 'report.sarif')
    fs.writeFileSync(sarifPath, JSON.stringify(sarif))

    const result = await parseSarifResults(sarifPath)
    expect(result.leakCount).toBe(0)
  })

  it('returns 0 for runs with no results key', async () => {
    const sarif = {version: '2.1.0', runs: [{}]}
    const sarifPath = path.join(tmpDir, 'report.sarif')
    fs.writeFileSync(sarifPath, JSON.stringify(sarif))

    const result = await parseSarifResults(sarifPath)
    expect(result.leakCount).toBe(0)
  })

  it('throws on invalid JSON', async () => {
    const sarifPath = path.join(tmpDir, 'bad.sarif')
    fs.writeFileSync(sarifPath, 'not json')

    await expect(parseSarifResults(sarifPath)).rejects.toThrow('invalid JSON')
  })
})
