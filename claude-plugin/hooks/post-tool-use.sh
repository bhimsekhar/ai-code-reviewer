#!/usr/bin/env bash
# AI Code Reviewer — PostToolUse hook
# Fires after every Write or Edit tool call in Claude Code.
# POSTs the generated code to the VS Code extension's embedded coordinator.
#
# Environment: Claude Code sets HOOK_EVENT_JSON or passes the event on stdin.
# This script reads from stdin (Claude Code PostToolUse passes JSON on stdin).

COORDINATOR_URL="http://localhost:3131/api/inbound"

# ─── Check for jq ──────────────────────────────────────────────────────────
if ! command -v jq &> /dev/null; then
  # jq not found — silently skip (Claude still writes code normally)
  exit 0
fi

# ─── Read the hook event from stdin ────────────────────────────────────────
HOOK_JSON=$(cat)

if [ -z "$HOOK_JSON" ]; then
  exit 0
fi

# ─── Extract tool name ─────────────────────────────────────────────────────
TOOL_NAME=$(echo "$HOOK_JSON" | jq -r '.tool_name // empty' 2>/dev/null)

if [ "$TOOL_NAME" != "Write" ] && [ "$TOOL_NAME" != "Edit" ]; then
  # Not a Write or Edit call — nothing to do
  exit 0
fi

# ─── Extract fields from tool_input ────────────────────────────────────────
FILE_PATH=$(echo "$HOOK_JSON" | jq -r '.tool_input.file_path // empty' 2>/dev/null)

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# ─── Detect language from file extension ───────────────────────────────────
EXTENSION="${FILE_PATH##*.}"
case "$EXTENSION" in
  java)               LANGUAGE="java" ;;
  kt | kts)           LANGUAGE="kotlin" ;;
  ts | tsx)           LANGUAGE="typescript" ;;
  js | jsx | mjs)     LANGUAGE="javascript" ;;
  py)                 LANGUAGE="python" ;;
  go)                 LANGUAGE="go" ;;
  rs)                 LANGUAGE="rust" ;;
  cs)                 LANGUAGE="csharp" ;;
  rb)                 LANGUAGE="ruby" ;;
  php)                LANGUAGE="php" ;;
  swift)              LANGUAGE="swift" ;;
  cpp | cc | cxx)     LANGUAGE="cpp" ;;
  c)                  LANGUAGE="c" ;;
  *)                  LANGUAGE="unknown" ;;
esac

# ─── Build the payload based on tool type ──────────────────────────────────
if [ "$TOOL_NAME" = "Write" ]; then
  # Write tool: full file content in tool_input.content
  CONTENT=$(echo "$HOOK_JSON" | jq -r '.tool_input.content // ""' 2>/dev/null)
  PAYLOAD=$(jq -n \
    --arg file "$FILE_PATH" \
    --arg content "$CONTENT" \
    --arg language "$LANGUAGE" \
    --arg toolName "Write" \
    '{
      file: $file,
      content: $content,
      language: $language,
      source: "claude-code",
      toolName: $toolName
    }')
else
  # Edit tool: the new content fragment is in tool_input.new_string
  NEW_STRING=$(echo "$HOOK_JSON" | jq -r '.tool_input.new_string // ""' 2>/dev/null)
  PAYLOAD=$(jq -n \
    --arg file "$FILE_PATH" \
    --arg new_string "$NEW_STRING" \
    --arg language "$LANGUAGE" \
    --arg toolName "Edit" \
    '{
      file: $file,
      content: $new_string,
      new_string: $new_string,
      language: $language,
      source: "claude-code",
      toolName: $toolName
    }')
fi

# ─── POST to coordinator (silently ignore failures) ────────────────────────
# If the coordinator is not running, Claude Code continues normally — no gate.
curl -s -o /dev/null \
  --max-time 5 \
  --connect-timeout 2 \
  -X POST \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" \
  "$COORDINATOR_URL" 2>/dev/null || true

exit 0
