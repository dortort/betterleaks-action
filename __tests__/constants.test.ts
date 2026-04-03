import {
  PLATFORM_MAP,
  getArchiveExtension,
  getBinaryName
} from '../src/constants'

describe('constants', () => {
  describe('PLATFORM_MAP', () => {
    it('maps all supported platform/arch combos', () => {
      expect(PLATFORM_MAP['linux-x64']).toBe('linux_x64')
      expect(PLATFORM_MAP['linux-arm64']).toBe('linux_arm64')
      expect(PLATFORM_MAP['darwin-x64']).toBe('darwin_x64')
      expect(PLATFORM_MAP['darwin-arm64']).toBe('darwin_arm64')
      expect(PLATFORM_MAP['win32-x64']).toBe('windows_x64')
      expect(PLATFORM_MAP['win32-arm64']).toBe('windows_arm64')
    })

    it('returns undefined for unsupported combos', () => {
      expect(PLATFORM_MAP['freebsd-x64']).toBeUndefined()
    })
  })

  describe('getArchiveExtension', () => {
    it('returns tar.gz for linux', () => {
      expect(getArchiveExtension('linux')).toBe('tar.gz')
    })
    it('returns tar.gz for darwin', () => {
      expect(getArchiveExtension('darwin')).toBe('tar.gz')
    })
    it('returns zip for win32', () => {
      expect(getArchiveExtension('win32')).toBe('zip')
    })
  })

  describe('getBinaryName', () => {
    it('returns betterleaks for linux', () => {
      expect(getBinaryName('linux')).toBe('betterleaks')
    })
    it('returns betterleaks.exe for win32', () => {
      expect(getBinaryName('win32')).toBe('betterleaks.exe')
    })
  })
})
