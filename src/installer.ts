import * as core from '@actions/core'
import * as tc from '@actions/tool-cache'
import {HttpClient} from '@actions/http-client'
import * as path from 'path'
import {
  TOOL_NAME,
  TOOL_REPO_OWNER,
  TOOL_REPO_NAME,
  SUPPORTED_MAJOR_VERSION,
  PLATFORM_MAP,
  getArchiveExtension,
  getBinaryName
} from './constants.js'

interface GitHubRelease {
  tag_name: string
  draft?: boolean
  prerelease?: boolean
}

interface ParsedSemver {
  major: number
  minor: number
  patch: number
  prerelease: string[]
}

export interface InstallResult {
  binaryPath: string
  version: string
}

const SEMVER_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/
const MAX_RELEASE_PAGES = 5
const RELEASES_PER_PAGE = 100

export function stripVPrefix(version: string): string {
  return version.startsWith('v') ? version.slice(1) : version
}

function ensureVPrefix(version: string): string {
  return version.startsWith('v') ? version : `v${version}`
}

export function parseSemver(version: string): ParsedSemver | null {
  const match = SEMVER_PATTERN.exec(version.trim())
  if (!match) {
    return null
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : []
  }
}

export function compareSemver(a: ParsedSemver, b: ParsedSemver): number {
  if (a.major !== b.major) return a.major - b.major
  if (a.minor !== b.minor) return a.minor - b.minor
  if (a.patch !== b.patch) return a.patch - b.patch

  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0
  if (a.prerelease.length === 0) return 1
  if (b.prerelease.length === 0) return -1

  const len = Math.max(a.prerelease.length, b.prerelease.length)
  for (let i = 0; i < len; i++) {
    const aPart = a.prerelease[i]
    const bPart = b.prerelease[i]
    if (aPart === undefined) return -1
    if (bPart === undefined) return 1

    const aNum = /^\d+$/.test(aPart) ? Number(aPart) : null
    const bNum = /^\d+$/.test(bPart) ? Number(bPart) : null
    if (aNum !== null && bNum !== null) {
      if (aNum !== bNum) return aNum - bNum
    } else if (aNum !== null) {
      return -1
    } else if (bNum !== null) {
      return 1
    } else if (aPart !== bPart) {
      return aPart < bPart ? -1 : 1
    }
  }

  return 0
}

async function fetchReleases(token: string): Promise<GitHubRelease[]> {
  const http = new HttpClient('betterleaks-action')
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json'
  }
  if (token) {
    headers['Authorization'] = `token ${token}`
  }

  const allReleases: GitHubRelease[] = []
  for (let page = 1; page <= MAX_RELEASE_PAGES; page++) {
    const url = `https://api.github.com/repos/${TOOL_REPO_OWNER}/${TOOL_REPO_NAME}/releases?per_page=${RELEASES_PER_PAGE}&page=${page}`
    const response = await http.getJson<GitHubRelease[]>(url, headers)

    if (response.statusCode === 403) {
      throw new Error(
        'GitHub API rate limit exceeded. Provide a github-token input for authenticated requests.'
      )
    }

    if (response.statusCode !== 200 || !Array.isArray(response.result)) {
      throw new Error(
        `Failed to list Betterleaks releases: HTTP ${response.statusCode}`
      )
    }

    allReleases.push(...response.result)
    if (response.result.length < RELEASES_PER_PAGE) {
      break
    }
  }

  return allReleases
}

export async function resolveVersion(
  version: string,
  token: string
): Promise<string> {
  const trimmed = version.trim()
  if (!trimmed) {
    throw new Error(
      "Betterleaks version cannot be empty. Specify 'latest', 'latest-rc', or a v2.x version (e.g., v2.0.0-rc.15)."
    )
  }

  if (trimmed === 'latest' || trimmed === 'latest-rc') {
    const includePrerelease = trimmed === 'latest-rc'
    const releases = await fetchReleases(token)

    let bestTag: string | null = null
    let bestSemver: ParsedSemver | null = null

    for (const release of releases) {
      if (release.draft) continue
      if (!includePrerelease && release.prerelease) continue

      const parsed = parseSemver(release.tag_name)
      if (!parsed || parsed.major !== SUPPORTED_MAJOR_VERSION) continue
      if (!includePrerelease && parsed.prerelease.length > 0) continue

      if (!bestSemver || compareSemver(parsed, bestSemver) > 0) {
        bestSemver = parsed
        bestTag = ensureVPrefix(release.tag_name)
      }
    }

    if (!bestTag) {
      if (!includePrerelease) {
        throw new Error(
          "No stable Betterleaks v2 release found yet. Pin an explicit release candidate (e.g., version: 'v2.0.0-rc.15') or use version: 'latest-rc' until v2.0.0 is released."
        )
      }
      throw new Error(
        'No Betterleaks v2 release or release candidate found on GitHub.'
      )
    }

    return bestTag
  }

  const parsed = parseSemver(trimmed)
  if (!parsed) {
    throw new Error(
      `Invalid Betterleaks version '${trimmed}'. Expected 'latest', 'latest-rc', or a semantic version like 'v2.0.0' or 'v2.0.0-rc.15'.`
    )
  }

  const tag = ensureVPrefix(trimmed)
  if (parsed.major === 1) {
    throw new Error(
      `Betterleaks ${tag} is a v1 release and is not supported by this Betterleaks v2-native action. Use dortort/betterleaks-action@v0 for Betterleaks v1, or specify a v2.x version (e.g., v2.0.0-rc.15).`
    )
  }
  if (parsed.major !== SUPPORTED_MAJOR_VERSION) {
    throw new Error(
      `Unsupported Betterleaks version ${tag}: this action requires Betterleaks v${SUPPORTED_MAJOR_VERSION}.x.`
    )
  }

  return tag
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
): Promise<InstallResult> {
  const platform = process.platform
  const arch = process.arch
  const resolvedVersion = await resolveVersion(version, token)
  const numericVersion = stripVPrefix(resolvedVersion)

  const cachedPath = tc.find(TOOL_NAME, numericVersion, arch)
  if (cachedPath) {
    core.info(`Found cached betterleaks ${numericVersion}`)
    return {
      binaryPath: path.join(cachedPath, getBinaryName(platform)),
      version: resolvedVersion
    }
  }

  const downloadUrl = getDownloadUrl(resolvedVersion, platform, arch)
  core.info(`Downloading betterleaks ${resolvedVersion} from ${downloadUrl}`)
  const downloadPath = await tc.downloadTool(
    downloadUrl,
    undefined,
    token ? `token ${token}` : undefined
  )

  let extractedPath: string
  if (platform === 'win32') {
    extractedPath = await tc.extractZip(downloadPath)
  } else {
    extractedPath = await tc.extractTar(downloadPath)
  }

  const cachedDir = await tc.cacheDir(
    extractedPath,
    TOOL_NAME,
    numericVersion,
    arch
  )
  const binaryPath = path.join(cachedDir, getBinaryName(platform))

  if (platform !== 'win32') {
    const {chmod} = await import('fs/promises')
    await chmod(binaryPath, 0o755)
  }

  core.info(`Betterleaks ${resolvedVersion} installed to ${binaryPath}`)
  return {binaryPath, version: resolvedVersion}
}
