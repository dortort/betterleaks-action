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
} from './constants.js'

interface GitHubRelease {
  tag_name: string
  draft?: boolean
  prerelease?: boolean
}

interface StableV1Version {
  tag: string
  minor: number
  patch: number
}

const RELEASES_PER_PAGE = 100
const MAX_RELEASE_PAGES = 10
const STABLE_V1_TAG_RE = /^v?1\.(\d+)\.(\d+)$/
const MAJOR_VERSION_RE = /^v?(\d+)(?:\.|-|$)/i
const NEXT_LINK_RE = /<[^>]+>;\s*rel="next"/i

function stripVPrefix(version: string): string {
  return version.startsWith('v') || version.startsWith('V')
    ? version.slice(1)
    : version
}

function ensureVPrefix(version: string): string {
  return `v${stripVPrefix(version)}`
}

function parseStableV1Tag(tag: string): StableV1Version | undefined {
  const match = STABLE_V1_TAG_RE.exec(tag)
  if (!match) {
    return undefined
  }
  return {
    tag: ensureVPrefix(tag),
    minor: Number(match[1]),
    patch: Number(match[2])
  }
}

function isNewerV1(
  candidate: StableV1Version,
  current: StableV1Version
): boolean {
  if (candidate.minor !== current.minor) {
    return candidate.minor > current.minor
  }
  return candidate.patch > current.patch
}

function assertSupportedExplicitVersion(version: string): string {
  const tag = ensureVPrefix(version)
  const match = MAJOR_VERSION_RE.exec(version)
  if (match && Number(match[1]) >= 2) {
    throw new Error(
      `Betterleaks ${tag} is not supported by dortort/betterleaks-action v0.x (which supports Betterleaks v1.x only). Upgrade to a v2-compatible major release of dortort/betterleaks-action when available, or pin a v1.x version (e.g., v1.10.1) or use 'latest'.`
    )
  }
  return tag
}

function hasNextPage(
  linkHeader: string | string[] | undefined,
  pageLength: number
): boolean {
  if (linkHeader !== undefined) {
    const value = Array.isArray(linkHeader) ? linkHeader.join(',') : linkHeader
    return NEXT_LINK_RE.test(value)
  }
  return pageLength === RELEASES_PER_PAGE
}

function isRateLimitStatus(statusCode: unknown): boolean {
  return statusCode === 403 || statusCode === 429
}

export async function resolveVersion(
  version: string,
  token: string
): Promise<string> {
  const normalized = version.trim()
  if (normalized !== '' && normalized !== 'latest') {
    return assertSupportedExplicitVersion(normalized)
  }

  const http = new HttpClient('betterleaks-action')
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json'
  }
  if (token) {
    headers['Authorization'] = `token ${token}`
  }

  let bestV1: StableV1Version | undefined

  for (let page = 1; page <= MAX_RELEASE_PAGES; page++) {
    const url = `https://api.github.com/repos/${TOOL_REPO_OWNER}/${TOOL_REPO_NAME}/releases?per_page=${RELEASES_PER_PAGE}&page=${page}`
    let response
    try {
      response = await http.getJson<GitHubRelease[]>(url, headers)
    } catch (error) {
      const statusCode =
        typeof error === 'object' && error !== null && 'statusCode' in error
          ? (error as {statusCode?: unknown}).statusCode
          : undefined
      if (isRateLimitStatus(statusCode)) {
        throw new Error(
          'GitHub API rate limit exceeded. Provide a github-token input for authenticated requests.'
        )
      }
      throw error
    }

    if (isRateLimitStatus(response.statusCode)) {
      throw new Error(
        'GitHub API rate limit exceeded. Provide a github-token input for authenticated requests.'
      )
    }

    if (response.statusCode !== 200 || !Array.isArray(response.result)) {
      throw new Error(
        `Failed to resolve latest v1.x version: HTTP ${response.statusCode}`
      )
    }

    if (response.result.length === 0) {
      break
    }

    for (const release of response.result) {
      if (release.draft || release.prerelease || !release.tag_name) {
        continue
      }
      const parsed = parseStableV1Tag(release.tag_name)
      if (!parsed) {
        continue
      }
      if (!bestV1 || isNewerV1(parsed, bestV1)) {
        bestV1 = parsed
      }
    }

    if (!hasNextPage(response.headers?.link, response.result.length)) {
      break
    }
  }

  if (!bestV1) {
    throw new Error(
      "No stable Betterleaks v1.x release found. Pin a specific v1.x version via the 'version' input."
    )
  }

  return bestV1.tag
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
