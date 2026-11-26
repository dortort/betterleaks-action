import {describe, it, expect, beforeEach, vi, type MockedClass} from 'vitest'
import {
  resolveVersion,
  getDownloadUrl,
  parseSemver,
  compareSemver
} from '../src/installer.js'
import {HttpClient} from '@actions/http-client'

vi.mock('@actions/http-client')
vi.mock('@actions/core')

const MockHttpClient = HttpClient as MockedClass<typeof HttpClient>

describe('installer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('parseSemver and compareSemver', () => {
    it('parses stable and prerelease versions', () => {
      expect(parseSemver('v2.0.0')).toEqual({
        major: 2,
        minor: 0,
        patch: 0,
        prerelease: []
      })
      expect(parseSemver('2.0.0-rc.15')).toEqual({
        major: 2,
        minor: 0,
        patch: 0,
        prerelease: ['rc', '15']
      })
      expect(parseSemver('not-a-version')).toBeNull()
    })

    it('orders stable above prerelease and compares numeric rc identifiers properly', () => {
      const rc9 = parseSemver('v2.0.0-rc.9')!
      const rc15 = parseSemver('v2.0.0-rc.15')!
      const stable = parseSemver('v2.0.0')!
      const patch = parseSemver('v2.0.1')!

      expect(compareSemver(rc15, rc9)).toBeGreaterThan(0)
      expect(compareSemver(stable, rc15)).toBeGreaterThan(0)
      expect(compareSemver(patch, stable)).toBeGreaterThan(0)
      expect(compareSemver(rc9, rc9)).toBe(0)
    })
  })

  describe('resolveVersion', () => {
    it('returns v2 version with v prefix when omitted', async () => {
      expect(await resolveVersion('2.0.0', '')).toBe('v2.0.0')
      expect(await resolveVersion('2.0.0-rc.15', '')).toBe('v2.0.0-rc.15')
    })

    it('passes through v2 versions already having v prefix', async () => {
      expect(await resolveVersion('v2.0.0-rc.15', '')).toBe('v2.0.0-rc.15')
      expect(await resolveVersion('v2.1.0', '')).toBe('v2.1.0')
    })

    it('fails fast on v1 versions and points to @v0', async () => {
      await expect(resolveVersion('v1.10.1', '')).rejects.toThrow(
        'dortort/betterleaks-action@v0'
      )
      await expect(resolveVersion('1.1.1', '')).rejects.toThrow(
        'dortort/betterleaks-action@v0'
      )
    })

    it('fails fast on unsupported major versions and malformed strings', async () => {
      await expect(resolveVersion('v3.0.0', '')).rejects.toThrow(
        'requires Betterleaks v2.x'
      )
      await expect(resolveVersion('abc', '')).rejects.toThrow(
        'Invalid Betterleaks version'
      )
      await expect(resolveVersion('  ', '')).rejects.toThrow('cannot be empty')
    })

    it('resolves latest to newest stable non-draft v2 release ignoring v1 and v3', async () => {
      const mockGetJson = vi.fn().mockResolvedValue({
        statusCode: 200,
        result: [
          {tag_name: 'v3.0.0', draft: false, prerelease: false},
          {tag_name: 'v2.2.0-rc.1', draft: false, prerelease: true},
          {tag_name: 'v2.1.0', draft: true, prerelease: false},
          {tag_name: 'v2.0.2', draft: false, prerelease: false},
          {tag_name: 'v2.0.10', draft: false, prerelease: false},
          {tag_name: 'v1.10.1', draft: false, prerelease: false}
        ]
      })
      MockHttpClient.prototype.getJson = mockGetJson

      const result = await resolveVersion('latest', 'fake-token')
      expect(result).toBe('v2.0.10')
      expect(mockGetJson).toHaveBeenCalledWith(
        expect.stringContaining('/releases?per_page=100&page=1'),
        expect.objectContaining({Authorization: 'token fake-token'})
      )
    })

    it('errors clearly for latest when only v2 release candidates and v1 releases exist', async () => {
      const mockGetJson = vi.fn().mockResolvedValue({
        statusCode: 200,
        result: [
          {tag_name: 'v2.0.0-rc.15', draft: false, prerelease: true},
          {tag_name: 'v1.10.1', draft: false, prerelease: false}
        ]
      })
      MockHttpClient.prototype.getJson = mockGetJson

      await expect(resolveVersion('latest', '')).rejects.toThrow(
        'No stable Betterleaks v2 release found yet'
      )
    })

    it('resolves latest-rc to newest v2 release candidate or stable v2 release', async () => {
      const mockGetJson = vi.fn().mockResolvedValue({
        statusCode: 200,
        result: [
          {tag_name: 'v2.0.0-rc.9', draft: false, prerelease: true},
          {tag_name: 'v2.0.0-rc.15', draft: false, prerelease: true},
          {tag_name: 'v2.0.0-rc.16', draft: true, prerelease: true},
          {tag_name: 'v1.10.1', draft: false, prerelease: false}
        ]
      })
      MockHttpClient.prototype.getJson = mockGetJson

      expect(await resolveVersion('latest-rc', '')).toBe('v2.0.0-rc.15')
    })

    it('prefers stable v2.0.0 over v2.0.0-rc.15 for latest-rc', async () => {
      const mockGetJson = vi.fn().mockResolvedValue({
        statusCode: 200,
        result: [
          {tag_name: 'v2.0.0-rc.15', draft: false, prerelease: true},
          {tag_name: 'v2.0.0', draft: false, prerelease: false}
        ]
      })
      MockHttpClient.prototype.getJson = mockGetJson

      expect(await resolveVersion('latest-rc', '')).toBe('v2.0.0')
    })

    it('errors clearly for latest-rc when no v2 releases exist at all', async () => {
      const mockGetJson = vi.fn().mockResolvedValue({
        statusCode: 200,
        result: [{tag_name: 'v1.10.1', draft: false, prerelease: false}]
      })
      MockHttpClient.prototype.getJson = mockGetJson

      await expect(resolveVersion('latest-rc', '')).rejects.toThrow(
        'No Betterleaks v2 release or release candidate found'
      )
    })

    it('throws on rate limit', async () => {
      const mockGetJson = vi.fn().mockResolvedValue({
        statusCode: 403,
        result: null
      })
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
      const url = getDownloadUrl('v2.0.0', 'linux', 'x64')
      expect(url).toBe(
        'https://github.com/betterleaks/betterleaks/releases/download/v2.0.0/betterleaks_2.0.0_linux_x64.tar.gz'
      )
    })

    it('constructs correct URL for darwin-arm64', () => {
      const url = getDownloadUrl('v2.0.0-rc.15', 'darwin', 'arm64')
      expect(url).toBe(
        'https://github.com/betterleaks/betterleaks/releases/download/v2.0.0-rc.15/betterleaks_2.0.0-rc.15_darwin_arm64.tar.gz'
      )
    })

    it('constructs correct URL for win32-x64 with zip', () => {
      const url = getDownloadUrl('v2.0.0-rc.15', 'win32', 'x64')
      expect(url).toBe(
        'https://github.com/betterleaks/betterleaks/releases/download/v2.0.0-rc.15/betterleaks_2.0.0-rc.15_windows_x64.zip'
      )
    })

    it('handles version without v prefix', () => {
      const url = getDownloadUrl('2.0.0-rc.15', 'linux', 'x64')
      expect(url).toBe(
        'https://github.com/betterleaks/betterleaks/releases/download/v2.0.0-rc.15/betterleaks_2.0.0-rc.15_linux_x64.tar.gz'
      )
    })

    it('throws for unsupported platform', () => {
      expect(() => getDownloadUrl('v2.0.0', 'freebsd', 'x64')).toThrow(
        'Unsupported platform/arch'
      )
    })
  })
})
