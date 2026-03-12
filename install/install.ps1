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

$VsixUrl  = "https://raw.githubusercontent.com/bhimsekhar/ai-code-reviewer/main/vscode-extension/ai-code-reviewer-1.0.0.vsix"
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
Write-Host "=== Done ===" -ForegroundColor Green
Write-Host ""
Write-Host "Reload VS Code (Ctrl+Shift+P -> 'Developer: Reload Window')."
Write-Host "On first load, AI Code Reviewer will automatically wire up the Claude Code hook."
Write-Host "Then ask Claude Code to write any file — it will stream with comprehension gates."
Write-Host ""
