export const TOOL_NAME = 'betterleaks'
export const TOOL_REPO_OWNER = 'betterleaks'
export const TOOL_REPO_NAME = 'betterleaks'
export const TOOL_INFORMATION_URI = 'https://github.com/betterleaks/betterleaks'

export const SUPPORTED_MAJOR_VERSION = 2

export const SARIF_SCHEMA = 'https://json.schemastore.org/sarif-2.1.0.json'
export const SARIF_VERSION = '2.1.0'

export const EXIT_CODE_CLEAN = 0
export const EXIT_CODE_LEAKS_FOUND = 1
export const EXIT_CODE_UNKNOWN_FLAG = 126

export const PLATFORM_MAP: Record<string, string> = {
  'linux-x64': 'linux_x64',
  'linux-arm64': 'linux_arm64',
  'darwin-x64': 'darwin_x64',
  'darwin-arm64': 'darwin_arm64',
  'win32-x64': 'windows_x64',
  'win32-arm64': 'windows_arm64'
}

export function getArchiveExtension(platform: string): string {
  return platform.startsWith('win32') ? 'zip' : 'tar.gz'
}

export function getBinaryName(platform: string): string {
  return platform.startsWith('win32') ? 'betterleaks.exe' : 'betterleaks'
}
