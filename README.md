# Betterleaks Action

[![CI](https://github.com/dortort/betterleaks-action/actions/workflows/ci.yml/badge.svg)](https://github.com/dortort/betterleaks-action/actions/workflows/ci.yml)
[![Integration Test](https://github.com/dortort/betterleaks-action/actions/workflows/integration.yml/badge.svg)](https://github.com/dortort/betterleaks-action/actions/workflows/integration.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A GitHub Action for scanning repositories and directories for secrets and credentials using [Betterleaks](https://github.com/betterleaks/betterleaks).

Betterleaks is a modern, open-source secrets detection tool built as the successor to Gitleaks. This action wraps the Betterleaks CLI, providing seamless integration with your GitHub CI/CD pipeline.

## Features

- **Smart scan mode**: Automatically selects `git` scan on push events and `dir` scan on pull requests
- **Cross-platform**: Supports Linux, macOS, and Windows runners (x64 and ARM64)
- **Fast**: JavaScript action with binary caching — no Docker pull overhead
- **SARIF output**: Native SARIF support for GitHub Code Scanning integration
- **Job summaries**: Markdown summary of scan results in your workflow run

## Quick Start

```yaml
- uses: dortort/betterleaks-action@main
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
```

This uses smart defaults: auto-detects scan mode from the event type, outputs SARIF, and fails if leaks are found.

## Usage with SARIF Upload

For GitHub Code Scanning integration, use the recommended two-step approach with [`github/codeql-action/upload-sarif`](https://github.com/github/codeql-action):

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
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0  # Required for git scan mode

      - uses: dortort/betterleaks-action@main
        id: betterleaks
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          fail-on-leak: 'false'  # Don't fail here; let code scanning handle it

      - uses: github/codeql-action/upload-sarif@v3
        if: always()
        with:
          sarif_file: ${{ steps.betterleaks.outputs.sarif-path }}
```

## Full Usage

```yaml
- uses: dortort/betterleaks-action@main
  with:
    # Betterleaks version (e.g., v1.1.1 or latest)
    version: 'latest'

    # Scan mode: git, dir, stdin, or auto
    # auto: pull_request -> dir, push -> git
    scan-mode: 'auto'

    # Path to scan (positional argument)
    scan-path: '.'

    # Path to Betterleaks config file
    config: ''

    # Path to baseline file for incremental adoption
    baseline-path: ''

    # Report format (single value): json, csv, junit, sarif, or template
    report-format: 'sarif'

    # Path to write the report file
    report-path: 'betterleaks-report.sarif'

    # Redact secrets from output
    redact: 'true'

    # Custom exit code when leaks are found
    exit-code: ''

    # Enable verbose output
    verbose: 'false'

    # Disable colored output
    no-color: 'true'

    # Suppress ASCII banner
    no-banner: 'true'

    # Enable live secret validation
    validation: 'true'

    # Additional CLI arguments
    extra-args: ''

    # Fail the action if leaks are found
    fail-on-leak: 'true'

    # GitHub token for API calls
    github-token: ${{ secrets.GITHUB_TOKEN }}

    # Scan timeout in seconds
    timeout: '300'
```

## Inputs

| Input | Description | Default |
|-------|-------------|---------|
| `version` | Betterleaks version | `latest` |
| `scan-mode` | Scan mode: `git`, `dir`, `stdin`, `auto` | `auto` |
| `scan-path` | Path to scan | `.` |
| `config` | Path to config file | |
| `baseline-path` | Path to baseline file | |
| `report-format` | Report format (single value): `json`, `csv`, `junit`, `sarif`, `template` | `sarif` |
| `report-path` | Path to write the report | `betterleaks-report.sarif` |
| `redact` | Redact secrets from output | `true` |
| `exit-code` | Custom exit code for leaks | |
| `verbose` | Enable verbose output | `false` |
| `no-color` | Disable colored output | `true` |
| `no-banner` | Suppress ASCII banner | `true` |
| `validation` | Enable secret validation | `true` |
| `extra-args` | Additional CLI arguments | |
| `fail-on-leak` | Fail if leaks found | `true` |
| `github-token` | GitHub token for API calls | `${{ github.token }}` |
| `timeout` | Scan timeout in seconds | `300` |

## Outputs

| Output | Description |
|--------|-------------|
| `exit-code` | Betterleaks process exit code |
| `report-path` | Path to the generated report |
| `sarif-path` | Path to SARIF file (for `codeql-action/upload-sarif`) |
| `leaks-found` | Whether leaks were found (`true`/`false`) |
| `leak-count` | Number of leaks found (SARIF format only) |

## Scan Modes

| Mode | Description |
|------|-------------|
| `auto` | Selects mode based on event type (recommended) |
| `git` | Scans git history using `git log -p` |
| `dir` | Scans files in the working directory |
| `stdin` | Reads from standard input |

**Auto mode mapping:**
- `push` -> `git` scan
- `pull_request` / `pull_request_target` -> `dir` scan
- `schedule` / `workflow_dispatch` -> `dir` scan

## Configuration

Betterleaks uses the following config file precedence:

1. `--config` flag (via `config` input)
2. `BETTERLEAKS_CONFIG` environment variable
3. `.betterleaks.toml` in the target directory
4. `.gitleaks.toml` in the target directory (backward compatible)
5. Built-in default rules

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | No leaks detected |
| `1` | Leaks detected |
| `126` | Unknown flag error |

## License

MIT

## Credits

This action wraps [Betterleaks](https://github.com/betterleaks/betterleaks), a modern open-source secrets detection tool. Betterleaks is maintained by [Zach Rice](https://github.com/zricethezav) and sponsored by [Aikido Security](https://www.aikido.dev/).
