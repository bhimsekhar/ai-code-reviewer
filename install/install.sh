#!/bin/bash
set -e

VSIX_URL="https://raw.githubusercontent.com/bhimsekhar/ai-code-reviewer/main/vscode-extension/ai-code-reviewer-1.0.0.vsix"
TMP="/tmp/ai-code-reviewer.vsix"

echo "=== AI Code Reviewer — Installation ==="

# ─── Check VS Code CLI ──────────────────────────────────────────────────────
if ! command -v code &> /dev/null; then
  echo ""
  echo "Error: VS Code CLI 'code' not found in PATH."
  echo "Fix: open VS Code → Command Palette → 'Shell Command: Install code command in PATH'"
  exit 1
fi

# ─── Download VSIX ──────────────────────────────────────────────────────────
echo "Downloading extension..."
curl -fsSL "$VSIX_URL" -o "$TMP"

# ─── Install ─────────────────────────────────────────────────────────────────
echo "Installing VS Code extension..."
code --install-extension "$TMP" --force
rm -f "$TMP"

echo ""
echo "=== Done ==="
echo ""
echo "Reload VS Code (Ctrl+Shift+P → 'Developer: Reload Window')."
echo "On first load, AI Code Reviewer will automatically wire up the Claude Code hook."
echo "Then ask Claude Code to write any file — it will stream with comprehension gates."
echo ""
