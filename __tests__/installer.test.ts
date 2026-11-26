import {describe, it, expect, beforeEach, vi, type MockedClass} from 'vitest'
import {resolveVersion, getDownloadUrl} from '../src/installer.js'
import {HttpClient} from '@actions/http-client'

vi.mock('@actions/http-client')
vi.mock('@actions/core')

const MockHttpClient = HttpClient as MockedClass<typeof HttpClient>

describe('installer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('resolveVersion', () => {
    it('returns the version with v prefix for explicit v1.x pins without calling GitHub API', async () => {
      const mockGetJson = vi.fn()
      MockHttpClient.prototype.getJson = mockGetJson

      const result = await resolveVersion('1.1.1', '')
      expect(result).toBe('v1.1.1')
      expect(mockGetJson).not.toHaveBeenCalled()
    })

    it('passes through explicit v1.x versions already having v prefix', async () => {
      const mockGetJson = vi.fn()
      MockHttpClient.prototype.getJson = mockGetJson

      const result = await resolveVersion('v1.10.1', '')
      expect(result).toBe('v1.10.1')
      expect(mockGetJson).not.toHaveBeenCalled()
    })

    it.each(['v2.0.0', '2.0.0', 'v2.0.0-rc.15', '2.0.0-rc.15', 'v2', 'v3.0.0'])(
      'fails fast with a migration message for unsupported explicit version %s',
      async unsupportedVersion => {
        const mockGetJson = vi.fn()
        MockHttpClient.prototype.getJson = mockGetJson

        await expect(resolveVersion(unsupportedVersion, '')).rejects.toThrow(
          /not supported by dortort\/betterleaks-action v0\.x.*v1\.x only.*v2-compatible major release/i
        )
        expect(mockGetJson).not.toHaveBeenCalled()
      }
    )

    it('resolves latest to highest stable v1.x even when v2.0.0 stable and v2 RCs appear first', async () => {
      const mockGetJson = vi.fn().mockResolvedValue({
        statusCode: 200,
        headers: {},
        result: [
          {tag_name: 'v2.0.0', draft: false, prerelease: false},
          {tag_name: 'v2.0.0-rc.15', draft: false, prerelease: true},
          {tag_name: 'v1.9.1', draft: false, prerelease: false},
          {tag_name: 'v1.10.1', draft: false, prerelease: false},
          {tag_name: 'v1.10.0', draft: false, prerelease: false}
        ]
      })
      MockHttpClient.prototype.getJson = mockGetJson

      const result = await resolveVersion('latest', 'fake-token')
      expect(result).toBe('v1.10.1')
      expect(mockGetJson).toHaveBeenCalledTimes(1)
      expect(mockGetJson).toHaveBeenCalledWith(
        'https://api.github.com/repos/betterleaks/betterleaks/releases?per_page=100&page=1',
        expect.objectContaining({
          Accept: 'application/vnd.github+json',
          Authorization: 'token fake-token'
        })
      )
    })

    it('skips drafts, prereleases, and prerelease-suffixed v1 tags', async () => {
      const mockGetJson = vi.fn().mockResolvedValue({
        statusCode: 200,
        headers: {},
        result: [
          {tag_name: 'v1.12.0', draft: true, prerelease: false},
          {tag_name: 'v1.11.0', draft: false, prerelease: true},
          {tag_name: 'v1.11.0-rc.1', draft: false, prerelease: false},
          {tag_name: 'v1.10.1', draft: false, prerelease: false},
          {tag_name: 'v1.9.0', draft: false, prerelease: false}
        ]
      })
      MockHttpClient.prototype.getJson = mockGetJson

      const result = await resolveVersion('latest', '')
      expect(result).toBe('v1.10.1')
      expect(mockGetJson).toHaveBeenCalledWith(
        expect.stringContaining('/releases?per_page=100&page=1'),
        {Accept: 'application/vnd.github+json'}
      )
    })

    it('paginates via Link header when earlier pages only contain v2 releases', async () => {
      const mockGetJson = vi
        .fn()
        .mockResolvedValueOnce({
          statusCode: 200,
          headers: {
            link: '<https://api.github.com/repos/betterleaks/betterleaks/releases?per_page=100&page=2>; rel="next"'
          },
          result: [
            {tag_name: 'v2.1.0', draft: false, prerelease: false},
            {tag_name: 'v2.0.0', draft: false, prerelease: false}
          ]
        })
        .mockResolvedValueOnce({
          statusCode: 200,
          headers: {},
          result: [
            {tag_name: 'v2.0.0-rc.15', draft: false, prerelease: true},
            {tag_name: 'v1.10.1', draft: false, prerelease: false},
            {tag_name: 'v1.10.0', draft: false, prerelease: false}
          ]
        })
      MockHttpClient.prototype.getJson = mockGetJson

      const result = await resolveVersion('latest', 'fake-token')
      expect(result).toBe('v1.10.1')
      expect(mockGetJson).toHaveBeenCalledTimes(2)
      expect(mockGetJson).toHaveBeenNthCalledWith(
        1,
        'https://api.github.com/repos/betterleaks/betterleaks/releases?per_page=100&page=1',
        expect.anything()
      )
      expect(mockGetJson).toHaveBeenNthCalledWith(
        2,
        'https://api.github.com/repos/betterleaks/betterleaks/releases?per_page=100&page=2',
        expect.anything()
      )
    })

    it('paginates when a full page of 100 releases has no Link header', async () => {
      const page1Releases = Array.from({length: 100}, (_, index) => ({
        tag_name: `v2.0.${100 - index}`,
        draft: false,
        prerelease: false
      }))
      const mockGetJson = vi
        .fn()
        .mockResolvedValueOnce({
          statusCode: 200,
          result: page1Releases
        })
        .mockResolvedValueOnce({
          statusCode: 200,
          result: [{tag_name: 'v1.10.1', draft: false, prerelease: false}]
        })
      MockHttpClient.prototype.getJson = mockGetJson

      const result = await resolveVersion('latest', '')
      expect(result).toBe('v1.10.1')
      expect(mockGetJson).toHaveBeenCalledTimes(2)
    })

    it('selects the highest stable v1.x across page boundaries', async () => {
      const mockGetJson = vi
        .fn()
        .mockResolvedValueOnce({
          statusCode: 200,
          headers: {
            link: '<https://api.github.com/repos/betterleaks/betterleaks/releases?per_page=100&page=2>; rel="next"'
          },
          result: [
            {tag_name: 'v2.0.0', draft: false, prerelease: false},
            {tag_name: 'v1.9.1', draft: false, prerelease: false}
          ]
        })
        .mockResolvedValueOnce({
          statusCode: 200,
          headers: {
            link: '<https://api.github.com/repos/betterleaks/betterleaks/releases?per_page=100&page=1>; rel="prev"'
          },
          result: [{tag_name: 'v1.10.1', draft: false, prerelease: false}]
        })
      MockHttpClient.prototype.getJson = mockGetJson

      const result = await resolveVersion('latest', '')
      expect(result).toBe('v1.10.1')
      expect(mockGetJson).toHaveBeenCalledTimes(2)
    })

    it('throws when no stable v1.x release exists', async () => {
      const mockGetJson = vi.fn().mockResolvedValue({
        statusCode: 200,
        headers: {},
        result: [
          {tag_name: 'v2.0.0', draft: false, prerelease: false},
          {tag_name: 'v1.10.1', draft: true, prerelease: false},
          {tag_name: 'v1.10.0', draft: false, prerelease: true}
        ]
      })
      MockHttpClient.prototype.getJson = mockGetJson

      await expect(resolveVersion('latest', '')).rejects.toThrow(
        /No stable Betterleaks v1\.x release found/i
      )
    })

    it('throws on rate limit response status', async () => {
      const mockGetJson = vi.fn().mockResolvedValue({
        statusCode: 403,
        result: null
      })
      MockHttpClient.prototype.getJson = mockGetJson

      await expect(resolveVersion('latest', '')).rejects.toThrow('rate limit')
    })

    it('throws on rejected rate limit HttpClientError', async () => {
      const err = Object.assign(new Error('API rate limit exceeded'), {
        statusCode: 403
      })
      const mockGetJson = vi.fn().mockRejectedValue(err)
      MockHttpClient.prototype.getJson = mockGetJson

      await expect(resolveVersion('latest', '')).rejects.toThrow('rate limit')
    })

    it('throws on non-200 response', async () => {
      const mockGetJson = vi.fn().mockResolvedValue({
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

    it('constructs correct URL for v2 prerelease tags', () => {
      const url = getDownloadUrl('v2.0.0-rc.9', 'linux', 'x64')
      expect(url).toBe(
        'https://github.com/betterleaks/betterleaks/releases/download/v2.0.0-rc.9/betterleaks_2.0.0-rc.9_linux_x64.tar.gz'
      )
    })

    it('throws for unsupported platform', () => {
      expect(() => getDownloadUrl('v1.1.1', 'freebsd', 'x64')).toThrow(
        'Unsupported platform/arch'
      )
    })
  })
})
