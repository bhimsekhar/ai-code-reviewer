#Requires -Version 5.1
<#
.SYNOPSIS
    AI Code Reviewer — one-line Windows installer.

.DESCRIPTION
    Downloads the VSIX from GitHub and installs it into VS Code.
    The extension wires up the Claude Code hook automatically on first launch.

.EXAMPLE
    irm https://raw.githubusercontent.com/bhimsekhar/ai-code-reviewer/main/install/install.ps1 | iex
#>

$ErrorActionPreference = 'Stop'

$VsixUrl  = "https://raw.githubusercontent.com/bhimsekhar/ai-code-reviewer/master/vscode-extension/ai-code-reviewer-1.0.0.vsix"
$TempPath = Join-Path $env:TEMP "ai-code-reviewer.vsix"

Write-Host "=== AI Code Reviewer — Installation ===" -ForegroundColor Cyan

# ─── Check VS Code CLI ──────────────────────────────────────────────────────
if (-not (Get-Command code -ErrorAction SilentlyContinue)) {
    Write-Host ""
    Write-Host "Error: VS Code CLI 'code' not found in PATH." -ForegroundColor Red
    Write-Host "Fix: open VS Code → Command Palette → 'Shell Command: Install code command in PATH'"
    exit 1
}

# ─── Download VSIX ──────────────────────────────────────────────────────────
Write-Host "Downloading extension..."
Invoke-WebRequest -Uri $VsixUrl -OutFile $TempPath -UseBasicParsing

# ─── Install ─────────────────────────────────────────────────────────────────
Write-Host "Installing VS Code extension..."
& code --install-extension $TempPath --force
Remove-Item $TempPath -Force -ErrorAction SilentlyContinue

Write-Host ""
# ─── Wire Claude Code hook ───────────────────────────────────────────────────
Write-Host "Wiring Claude Code hook..."

$ClaudeDir   = Join-Path $env:USERPROFILE ".claude"
$HooksDir    = Join-Path $ClaudeDir "hooks"
$HookDest    = Join-Path $HooksDir "ai-code-reviewer-post-tool-use.sh"
$SettingsPath = Join-Path $ClaudeDir "settings.json"
$HookUrl     = "https://raw.githubusercontent.com/bhimsekhar/ai-code-reviewer/master/claude-plugin/hooks/post-tool-use.sh"

if (Test-Path $ClaudeDir) {
    # Ensure hooks directory exists
    if (-not (Test-Path $HooksDir)) {
        New-Item -ItemType Directory -Path $HooksDir | Out-Null
    }

    # Download hook script
    Invoke-WebRequest -Uri $HookUrl -OutFile $HookDest -UseBasicParsing

    # Read or create settings.json
    $Settings = @{}
    if (Test-Path $SettingsPath) {
        try {
            $Settings = Get-Content $SettingsPath -Raw | ConvertFrom-Json -AsHashtable
        } catch {
            $Settings = @{}
        }
    }

    if (-not $Settings.ContainsKey('hooks')) { $Settings['hooks'] = @{} }
    if (-not $Settings['hooks'].ContainsKey('PostToolUse')) { $Settings['hooks']['PostToolUse'] = @() }

    # Avoid duplicate
    $AlreadyRegistered = $Settings['hooks']['PostToolUse'] | Where-Object {
        $_.hooks | Where-Object { $_.command -like '*ai-code-reviewer*' }
    }

    if (-not $AlreadyRegistered) {
        $Settings['hooks']['PostToolUse'] += @{
            matcher = 'Write|Edit'
            hooks   = @(@{ type = 'command'; command = $HookDest })
        }
        $Settings | ConvertTo-Json -Depth 10 | Set-Content $SettingsPath
        Write-Host "Claude Code hook registered." -ForegroundColor Green
    } else {
        Write-Host "Claude Code hook already registered — skipped." -ForegroundColor Yellow
    }
} else {
    Write-Host "~/.claude not found — Claude Code may not be installed. Skipping hook wiring." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=== Done ===" -ForegroundColor Green
Write-Host ""
Write-Host "Reload VS Code (Ctrl+Shift+P -> 'Developer: Reload Window')."
Write-Host "Then ask Claude Code to write any file — it will stream with comprehension gates."
Write-Host ""
