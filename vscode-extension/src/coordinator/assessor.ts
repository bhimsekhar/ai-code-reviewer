import { Tier } from '../types'

export interface Assessment {
  tier: Tier
  isBoilerplate: boolean
  riskPatterns: string[]    // which patterns matched
  methodCount: number
  complexity: number        // count of if/else/for/while/switch/catch/ternary
}

// Risk pattern regexes
const RISK_PATTERNS: Record<string, RegExp> = {
  sql: /executeQuery|createStatement|prepareStatement|\.query\s*\(|SELECT\s+.+FROM|INSERT\s+INTO|UPDATE\s+.+SET|DELETE\s+FROM/i,
  authentication: /authenticate|\.login\s*\(|verifyPassword|checkPassword|validateCredential/i,
  authorization: /hasRole|hasAuthority|isAuthorized|@PreAuthorize|@Secured|checkPermission/i,
  cryptography: /encrypt|decrypt|BCrypt|MessageDigest|Cipher\.|SecretKey|KeyPair|\.hash\s*\(/i,
  file_io: /new\s+File\s*\(|FileInputStream|FileOutputStream|Files\.|Paths\.get|readFile|writeFile|createWriteStream/i,
  network: /HttpClient|RestTemplate|WebClient|new\s+URL\s*\(|fetch\s*\(|axios\.|URLConnection/i,
  env_vars: /System\.getenv|process\.env\.|getenv\s*\(|os\.environ/i,
  hardcoded_secret: /(?:password|secret|api_key|apikey|token)\s*=\s*["'][^"']{8,}/i
}

// Boilerplate method name pattern
const BOILERPLATE_METHOD_NAME = /^(?:get|set|is|has)[A-Z]\w*$|^(?:toString|equals|hashCode|constructor|__init__|__str__|__repr__)$/

// Method boundary regexes per language family
const METHOD_REGEXES: RegExp[] = [
  // Java/Kotlin
  /(public|private|protected|static|final)\s+[\w<>\[\]]+\s+\w+\s*\([^{]*\)\s*(?:throws\s+[\w,\s]+)?\s*\{/gm,
  // TypeScript/JS
  /(?:^|\s)(?:async\s+)?(?:function\s+\w+|\w+\s*[=:]\s*(?:async\s+)?(?:function|\([^)]*\)\s*=>))\s*[({]/gm,
  // Python
  /^(?:async\s+)?def\s+\w+\s*\(/gm
]

// Complexity keywords
const COMPLEXITY_PATTERN = /\b(?:if|else|for|while|switch|catch|case)\b|[?][^:]/g

function countMethods(content: string): number {
  let total = 0
  for (const regex of METHOD_REGEXES) {
    const re = new RegExp(regex.source, regex.flags)
    const matches = content.match(re)
    if (matches) {
      total += matches.length
    }
  }
  // Deduplicate by using highest single-regex count to avoid double counting
  // across language families — use max of individual counts
  let max = 0
  for (const regex of METHOD_REGEXES) {
    const re = new RegExp(regex.source, regex.flags)
    const matches = content.match(re)
    if (matches && matches.length > max) {
      max = matches.length
    }
  }
  return max
}

function countComplexity(content: string): number {
  const matches = content.match(COMPLEXITY_PATTERN)
  return matches ? matches.length : 0
}

function isBoilerplateContent(content: string): boolean {
  // Extract method names and check them
  const methodNamePattern = /(?:public|private|protected|static|final|\bdef\b|function)\s+([\w]+)\s*\(/g
  let match: RegExpExecArray | null
  let allBoilerplate = true
  let found = false

  while ((match = methodNamePattern.exec(content)) !== null) {
    found = true
    const methodName = match[1]
    // Check if name is boilerplate
    if (!BOILERPLATE_METHOD_NAME.test(methodName)) {
      allBoilerplate = false
      break
    }
    // Check body length — extract a rough "body" by counting lines between braces
    const bodyStart = content.indexOf('{', match.index)
    if (bodyStart === -1) { continue }
    // Count non-empty lines until matching close brace
    let depth = 1
    let i = bodyStart + 1
    let bodyLines = 0
    while (i < content.length && depth > 0) {
      if (content[i] === '{') { depth++ }
      if (content[i] === '}') { depth-- }
      if (content[i] === '\n' && content.slice(bodyStart, i).trim().length > 0) {
        const line = content.slice(content.lastIndexOf('\n', i - 1) + 1, i).trim()
        if (line.length > 0) { bodyLines++ }
      }
      i++
    }
    if (bodyLines > 3) {
      allBoilerplate = false
      break
    }
  }

  return found && allBoilerplate
}

export function assess(content: string, _language: string): Assessment {
  const riskPatterns: string[] = []

  for (const [name, regex] of Object.entries(RISK_PATTERNS)) {
    if (regex.test(content)) {
      riskPatterns.push(name)
    }
  }

  const methodCount = countMethods(content)
  const complexity = countComplexity(content)
  const isBoilerplate = isBoilerplateContent(content)

  let tier: Tier

  if (isBoilerplate && riskPatterns.length === 0) {
    tier = 'skip'
  } else if (riskPatterns.length > 0) {
    tier = 3
  } else if (complexity > 5 || methodCount > 8) {
    tier = 2
  } else {
    tier = 1
  }

  return { tier, isBoilerplate, riskPatterns, methodCount, complexity }
}
