# Betterleaks Action

[![CI](https://github.com/dortort/betterleaks-action/actions/workflows/ci.yml/badge.svg)](https://github.com/dortort/betterleaks-action/actions/workflows/ci.yml)
[![Integration Test](https://github.com/dortort/betterleaks-action/actions/workflows/integration.yml/badge.svg)](https://github.com/dortort/betterleaks-action/actions/workflows/integration.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A GitHub Action for scanning repositories and filesystems for secrets and credentials using [Betterleaks v2](https://github.com/betterleaks/betterleaks), with built-in **SARIF 2.1.0** conversion for GitHub Code Scanning.

> [!NOTE]
> This major release targets **Betterleaks v2** natively. If you need Betterleaks v1, pin `dortort/betterleaks-action@v0`.

## Features

- **Native Betterleaks v2 support**: Uses Betterleaks v2 commands (`filesystem`, `git`, `stdin`), `--output` streaming reports, and opt-in `--validate` / `--analyze` stages
- **Built-in SARIF 2.1.0 conversion**: Restores GitHub Code Scanning SARIF output (removed from the Betterleaks v2 CLI) directly from Betterleaks v2 JSON reports, with workspace-relative URIs, rule deduplication, fingerprints, and severity/validation-aware alert levels
- **Safe defaults**: Credential validation is **off by default** (`validate: 'false'`), so CI runs make zero outbound provider HTTP requests unless you explicitly opt in
- **Smart scan mode**: Automatically runs `git` on `push` events and `filesystem` on pull requests, schedules, and manual dispatches
- **Cross-platform & fast**: Node 24 JavaScript action with binary caching across Linux, macOS, and Windows (x64 and ARM64) — no Docker pull overhead
- **Rich job summaries & exact counts**: Reports exact `leak-count` across all formats (`sarif`, `json`, `jsonl`) and renders a Markdown job summary with per-rule breakdowns and validation/analysis counts

## Quick Start

For reproducible builds, pin a concrete Betterleaks v2 version (or use `version: 'latest'` once `v2.0.0` stable ships; while v2 is in release candidate, pin an explicit tag like `v2.0.0-rc.15` or use `version: 'latest-rc'`):

```yaml
- uses: dortort/betterleaks-action@v1
  with:
    version: 'v2.0.0' # Pin an explicit v2 release (or e.g. 'v2.0.0-rc.15')
    github-token: ${{ secrets.GITHUB_TOKEN }}
```

This uses safe defaults: auto-detects scan mode from the event type, performs local detection without outbound validation requests, writes a SARIF 2.1.0 report, and fails if leaks are found.

## Usage with GitHub Code Scanning (SARIF 2.1.0)

Betterleaks v2 dropped its built-in SARIF reporter in favor of structured JSON/JSONL output. When `report-format: 'sarif'` (the default) is used, this action runs Betterleaks v2 with JSON output and converts it to spec-compliant **SARIF 2.1.0** ready for [`github/codeql-action/upload-sarif`](https://github.com/github/codeql-action):

```yaml
name: Secrets Scan
on: [push, pull_request]

permissions:
  contents: read
  security-events: write

jobs:
  betterleaks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0

      - uses: dortort/betterleaks-action@v1
        id: betterleaks
        with:
          version: 'v2.0.0'
          github-token: ${{ secrets.GITHUB_TOKEN }}
          fail-on-leak: 'false'

      - uses: github/codeql-action/upload-sarif@v3
        if: always()
        with:
          sarif_file: ${{ steps.betterleaks.outputs.sarif-path }}
```

### SARIF Level Mapping

Findings are mapped to SARIF `level` values based on validation/analysis results and detection confidence:

| Betterleaks Finding State | SARIF `level` |
|---|---|
| `analysis.status` is `invalid` or `revoked` | `note` |
| `analysis.status` is `valid` or `analysis.severity` is `high` | `error` |
| `analysis.severity` is `medium` | `warning` |
| Unvalidated, `confidence` is `high` or unset | `error` |
| Unvalidated, `confidence` is `medium` or `low` | `warning` |

## Without GitHub Advanced Security

If your repository doesn't use GitHub Code Scanning, all outputs (`leaks-found`, `leak-count`, `exit-code`, `report-path`) and the Markdown job summary still work. Upload the report (`sarif`, `json`, or `jsonl`) as a workflow artifact:

```yaml
name: Secrets Scan
on: [push, pull_request]

jobs:
  betterleaks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0

      - uses: dortort/betterleaks-action@v1
        id: betterleaks
        with:
          version: 'v2.0.0'
          report-format: 'json'
          github-token: ${{ secrets.GITHUB_TOKEN }}

      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: betterleaks-report
          path: ${{ steps.betterleaks.outputs.report-path }}
```

## Full Usage

```yaml
- uses: dortort/betterleaks-action@v1
  with:
    # Betterleaks v2 version: explicit pin (recommended, e.g., v2.0.0 or v2.0.0-rc.15),
    # 'latest' (newest stable v2.x), or 'latest-rc' (newest v2.x including release candidates)
    version: 'latest'

    # Scan mode: filesystem (or fs), git, stdin, or auto
    # auto: push -> git, pull_request/schedule/workflow_dispatch -> filesystem
    scan-mode: 'auto'

    # Path to scan (positional argument for filesystem and git modes)
    scan-path: '.'

    # Explicit path to Betterleaks v2 config file (not auto-discovered in v2)
    config: ''

    # Report format: sarif, json, or jsonl
    report-format: 'sarif'

    # Path to write the report file (defaults to betterleaks-report.<format>)
    report-path: ''

    # Redact secrets from output
    redact: 'true'

    # Custom exit code when leaks are found
    exit-code: ''

    # Disable colored output
    no-color: 'true'

    # Suppress ASCII banner
    no-banner: 'true'

    # Opt in to live credential validation against provider APIs
    validate: 'false'

    # Opt in to identity and permission analysis (implies validate)
    analyze: 'false'

    # Additional CLI arguments passed directly to betterleaks
    extra-args: ''

    # Fail the action if leaks are found
    fail-on-leak: 'true'

    # GitHub token for authenticated API calls (version resolution)
    github-token: ${{ secrets.GITHUB_TOKEN }}

    # Scan timeout in seconds (enforced by the action)
    timeout: '300'
```

## Inputs

| Input | Description | Default |
|-------|-------------|---------|
| `version` | Betterleaks v2 version (`v2.0.0`, `v2.0.0-rc.15`, `latest`, or `latest-rc`) | `latest` |
| `scan-mode` | Scan mode: `filesystem` (`fs`), `git`, `stdin`, `auto` | `auto` |
| `scan-path` | Path to scan (positional argument for `filesystem` and `git`) | `.` |
| `config` | Path to Betterleaks v2 config file | |
| `report-format` | Report format: `sarif`, `json`, or `jsonl` | `sarif` |
| `report-path` | Path to write the report file | `betterleaks-report.<format>` |
| `redact` | Redact secrets from output | `true` |
| `exit-code` | Custom exit code when leaks are found | |
| `no-color` | Disable colored output | `true` |
| `no-banner` | Suppress ASCII banner | `true` |
| `validate` | Enable live credential validation (opt-in) | `false` |
| `analyze` | Enable credential analysis (opt-in; implies `validate`) | `false` |
| `extra-args` | Additional CLI arguments passed to `betterleaks` | |
| `fail-on-leak` | Fail the action if leaks are found | `true` |
| `github-token` | GitHub token for authenticated API calls | `${{ github.token }}` |
| `timeout` | Scan timeout in seconds | `300` |

## Outputs

| Output | Description |
|--------|-------------|
| `exit-code` | Betterleaks process exit code |
| `report-path` | Path to the generated report file |
| `sarif-path` | Path to SARIF 2.1.0 file when `report-format` is `sarif` |
| `leaks-found` | Whether leaks were found (`true`/`false`) |
| `leak-count` | Number of leaks found (available for `sarif`, `json`, and `jsonl`) |

## Version Resolution

- **Explicit version (recommended)**: Pass a concrete tag such as `version: 'v2.0.0'` or `version: 'v2.0.0-rc.15'` for reproducible CI runs and zero GitHub API calls.
- **`latest`**: Resolves to the newest non-draft, non-prerelease `v2.x` release on `betterleaks/betterleaks`. Fails clearly if no stable `v2.x` release has been published yet.
- **`latest-rc`**: Resolves to the newest non-draft `v2.x` release, including `v2.0.0-rc.*` release candidates (and prefers stable `v2.0.0+` once published).
- **v1 versions rejected**: Passing a `v1.x` version fails fast and points to `dortort/betterleaks-action@v0`.

## Scan Modes

| Mode | Description |
|------|-------------|
| `auto` | Selects mode based on event type (recommended) |
| `filesystem` (`fs`) | Scans files and directories in the working tree |
| `git` | Scans Git repository history in-process |
| `stdin` | Reads content from standard input |

**Auto mode mapping:**
- `push` -> `git`
- `pull_request` / `pull_request_target` / `schedule` / `workflow_dispatch` -> `filesystem`

## Configuration

Betterleaks v2 **no longer auto-discovers** `.betterleaks.toml` or `.gitleaks.toml` from the target or working directory. Select custom configs explicitly in order of precedence:

1. `config` input (`--config` flag)
2. `BETTERLEAKS_CONFIG` environment variable (file path)
3. `BETTERLEAKS_CONFIG_TOML` environment variable (inline TOML)
4. Embedded default rules

See the upstream [Betterleaks v2 migration guide](https://github.com/betterleaks/betterleaks/blob/main/docs/v2_migration.md) for TOML config updates.

## Migrating from v0.x (Betterleaks v1)

To stay on Betterleaks v1 without changes, pin your workflow to `dortort/betterleaks-action@v0`.

When upgrading to Betterleaks v2:

| v0.x Input / Behavior | v1+ (Betterleaks v2) Equivalent |
|---|---|
| `version: 'v1.x.y'` | Requires `v2.x` (e.g. `v2.0.0` or `v2.0.0-rc.15`). Stay on `@v0` for Betterleaks v1. |
| `scan-mode: 'dir'` | Use `scan-mode: 'filesystem'` (or `'fs'`). `'dir'` is accepted as a deprecated alias with a warning. |
| `validation: 'true'` (default `'true'`) | Replaced by `validate: 'false'` (opt-in) and `analyze: 'false'` (opt-in, implies `validate`). |
| `report-format: 'csv' \| 'junit' \| 'template'` | Removed in Betterleaks v2. Use `'sarif'` (built-in SARIF 2.1.0 converter), `'json'`, or `'jsonl'`. |
| `baseline-path` | Removed in Betterleaks v2. Use `.betterleaksignore` (SHA-256 value fingerprints) or `--ignore-file` via `extra-args`. |
| `verbose` | Removed in Betterleaks v2 (findings print by default). |
| Auto-loaded `.betterleaks.toml` | Pass `config: '.betterleaks.toml'` explicitly. |

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | No leaks detected |
| `1` | Leaks detected (or scan error; distinguished via Betterleaks v2 `scan.state`) |
| `126` | Unknown flag error |

## License

MIT

## Credits

This action wraps [Betterleaks](https://github.com/betterleaks/betterleaks), a tool for detecting secrets like passwords, API keys, and tokens in git repos and files. Betterleaks development is supported by [Aikido Security](https://www.aikido.dev).
