$ClaudeDir    = Join-Path $env:USERPROFILE ".claude"
$HooksDir     = Join-Path $ClaudeDir "hooks"
$HookDest     = Join-Path $HooksDir "ai-code-reviewer-post-tool-use.sh"
$SettingsPath = Join-Path $ClaudeDir "settings.json"
$HookSrc      = "C:\Users\bhims\ai-code-reviewer\claude-plugin\hooks\post-tool-use.sh"

if (-not (Test-Path $ClaudeDir)) {
    Write-Host "~/.claude not found — is Claude Code installed?" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $HooksDir)) {
    New-Item -ItemType Directory -Path $HooksDir | Out-Null
}

Copy-Item $HookSrc $HookDest -Force
Write-Host "Hook copied to $HookDest" -ForegroundColor Green

$Settings = @{}
if (Test-Path $SettingsPath) {
    try { $Settings = Get-Content $SettingsPath -Raw | ConvertFrom-Json -AsHashtable }
    catch { $Settings = @{} }
}

if (-not $Settings.ContainsKey("hooks"))                        { $Settings["hooks"] = @{} }
if (-not $Settings["hooks"].ContainsKey("PostToolUse"))         { $Settings["hooks"]["PostToolUse"] = @() }

$already = $Settings["hooks"]["PostToolUse"] | Where-Object {
    $entry = $_
    if ($entry.hooks) {
        $entry.hooks | Where-Object { $_.command -like "*ai-code-reviewer*" }
    }
}

if (-not $already) {
    $Settings["hooks"]["PostToolUse"] += @{
        matcher = "Write|Edit"
        hooks   = @(@{ type = "command"; command = $HookDest })
    }
    $Settings | ConvertTo-Json -Depth 10 | Set-Content $SettingsPath
    Write-Host "Claude Code hook registered in settings.json" -ForegroundColor Green
} else {
    Write-Host "Hook already registered — no change needed." -ForegroundColor Yellow
}
