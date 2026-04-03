import * as core from '@actions/core'
import * as tc from '@actions/tool-cache'
import {HttpClient} from '@actions/http-client'
import * as path from 'path'
import {
  TOOL_NAME,
  TOOL_REPO_OWNER,
  TOOL_REPO_NAME,
  PLATFORM_MAP,
  getArchiveExtension,
  getBinaryName
} from './constants'

interface GitHubRelease {
  tag_name: string
}

function stripVPrefix(version: string): string {
  return version.startsWith('v') ? version.slice(1) : version
}

function ensureVPrefix(version: string): string {
  return version.startsWith('v') ? version : `v${version}`
}

export async function resolveVersion(
  version: string,
  token: string
): Promise<string> {
  if (version !== 'latest') {
    return ensureVPrefix(version)
  }

  const http = new HttpClient('betterleaks-action')
  const headers: Record<string, string> = {}
  if (token) {
    headers['Authorization'] = `token ${token}`
  }

  const url = `https://api.github.com/repos/${TOOL_REPO_OWNER}/${TOOL_REPO_NAME}/releases/latest`
  const response = await http.getJson<GitHubRelease>(url, headers)

  if (response.statusCode === 403) {
    throw new Error(
      'GitHub API rate limit exceeded. Provide a github-token input for authenticated requests.'
    )
  }

  if (response.statusCode !== 200 || !response.result) {
    throw new Error(
      `Failed to resolve latest version: HTTP ${response.statusCode}`
    )
  }

  return response.result.tag_name
}

export function getDownloadUrl(
  version: string,
  platform: string,
  arch: string
): string {
  const key = `${platform}-${arch}`
  const assetSuffix = PLATFORM_MAP[key]
  if (!assetSuffix) {
    throw new Error(`Unsupported platform/arch: ${key}`)
  }

  const tag = ensureVPrefix(version)
  const numericVersion = stripVPrefix(version)
  const ext = getArchiveExtension(platform)

  return `https://github.com/${TOOL_REPO_OWNER}/${TOOL_REPO_NAME}/releases/download/${tag}/betterleaks_${numericVersion}_${assetSuffix}.${ext}`
}

export async function install(
  version: string,
  token: string
): Promise<string> {
  const platform = process.platform
  const arch = process.arch
  const resolvedVersion = await resolveVersion(version, token)
  const numericVersion = stripVPrefix(resolvedVersion)

  // Check tool cache first
  const cachedPath = tc.find(TOOL_NAME, numericVersion, arch)
  if (cachedPath) {
    core.info(`Found cached betterleaks ${numericVersion}`)
    return path.join(cachedPath, getBinaryName(platform))
  }

  // Download
  const downloadUrl = getDownloadUrl(resolvedVersion, platform, arch)
  core.info(`Downloading betterleaks ${resolvedVersion} from ${downloadUrl}`)
  const downloadPath = await tc.downloadTool(downloadUrl, undefined, token ? `token ${token}` : undefined)

  // Extract
  let extractedPath: string
  if (platform === 'win32') {
    extractedPath = await tc.extractZip(downloadPath)
  } else {
    extractedPath = await tc.extractTar(downloadPath)
  }

  // Cache
  const cachedDir = await tc.cacheDir(extractedPath, TOOL_NAME, numericVersion, arch)
  const binaryPath = path.join(cachedDir, getBinaryName(platform))

  // Ensure executable
  if (platform !== 'win32') {
    const {chmod} = await import('fs/promises')
    await chmod(binaryPath, 0o755)
  }

  core.info(`Betterleaks ${resolvedVersion} installed to ${binaryPath}`)
  return binaryPath
}
