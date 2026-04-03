import {resolveVersion, getDownloadUrl} from '../src/installer'
import {HttpClient} from '@actions/http-client'

jest.mock('@actions/http-client')
jest.mock('@actions/core')

const MockHttpClient = HttpClient as jest.MockedClass<typeof HttpClient>

describe('installer', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('resolveVersion', () => {
    it('returns the version with v prefix for non-latest', async () => {
      const result = await resolveVersion('1.1.1', '')
      expect(result).toBe('v1.1.1')
    })

    it('passes through versions already having v prefix', async () => {
      const result = await resolveVersion('v1.1.1', '')
      expect(result).toBe('v1.1.1')
    })

    it('resolves latest via GitHub API', async () => {
      const mockGetJson = jest.fn().mockResolvedValue({
        statusCode: 200,
        result: {tag_name: 'v1.1.1'}
      })
      MockHttpClient.prototype.getJson = mockGetJson

      const result = await resolveVersion('latest', 'fake-token')
      expect(result).toBe('v1.1.1')
      expect(mockGetJson).toHaveBeenCalledWith(
        expect.stringContaining('/releases/latest'),
        expect.objectContaining({Authorization: 'token fake-token'})
      )
    })

    it('throws on rate limit', async () => {
      const mockGetJson = jest.fn().mockResolvedValue({
        statusCode: 403,
        result: null
      })
      MockHttpClient.prototype.getJson = mockGetJson

      await expect(resolveVersion('latest', '')).rejects.toThrow('rate limit')
    })

    it('throws on non-200 response', async () => {
      const mockGetJson = jest.fn().mockResolvedValue({
        statusCode: 404,
        result: null
      })
      MockHttpClient.prototype.getJson = mockGetJson

      await expect(resolveVersion('latest', '')).rejects.toThrow('HTTP 404')
    })
  })

  describe('getDownloadUrl', () => {
    it('constructs correct URL for linux-x64', () => {
      const url = getDownloadUrl('v1.1.1', 'linux', 'x64')
      expect(url).toBe(
        'https://github.com/betterleaks/betterleaks/releases/download/v1.1.1/betterleaks_1.1.1_linux_x64.tar.gz'
      )
    })

    it('constructs correct URL for darwin-arm64', () => {
      const url = getDownloadUrl('v1.1.1', 'darwin', 'arm64')
      expect(url).toBe(
        'https://github.com/betterleaks/betterleaks/releases/download/v1.1.1/betterleaks_1.1.1_darwin_arm64.tar.gz'
      )
    })

    it('constructs correct URL for win32-x64 with zip', () => {
      const url = getDownloadUrl('v1.1.1', 'win32', 'x64')
      expect(url).toBe(
        'https://github.com/betterleaks/betterleaks/releases/download/v1.1.1/betterleaks_1.1.1_windows_x64.zip'
      )
    })

    it('handles version without v prefix', () => {
      const url = getDownloadUrl('1.1.1', 'linux', 'x64')
      expect(url).toBe(
        'https://github.com/betterleaks/betterleaks/releases/download/v1.1.1/betterleaks_1.1.1_linux_x64.tar.gz'
      )
    })

    it('throws for unsupported platform', () => {
      expect(() => getDownloadUrl('v1.1.1', 'freebsd', 'x64')).toThrow(
        'Unsupported platform/arch'
      )
    })
  })
})
