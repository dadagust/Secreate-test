/**
 * PreToolUse hook for the Bash and PowerShell tools of Claude Code and the Bash tool of Codex
 * (.codex/hooks.json): blocks the Git, GitHub/GitLab and file operations that AGENTS.md
 * allows only with the user's explicit approval (push, merge, writes to PR/MR, issues,
 * releases and the API, destructive reset, history rewrites, branch switching, stash, mass
 * discard or deletion, bypassing Git hooks or commit signing).
 *
 * Permission rules in settings.json match a command by its prefix, so `git commit -m x
 * --no-verify` or `LEFTHOOK=0 git commit` slip past them. This hook parses the command
 * statically: chains, pipes, subshells, command substitutions, `bash -c`, `eval`, heredocs
 * fed to a shell, wrappers such as `env` or `timeout`, Windows paths and abbreviated Git
 * options. It is a guard against mistakes, not a sandbox: variables, aliases, scripts run
 * from files and code in other languages are out of its reach (docs/agents/tooling.md).
 * A blocked command exits with code 2 and the reason on stderr; the user can still run it.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const separators = ['&&', '||', '|&', ';', '|', '&', '\n', '(', ')']
const keywords = new Set([
  'if',
  'then',
  'else',
  'elif',
  'do',
  'while',
  'until',
  '!',
  '{',
  '}',
])
const wrappers = new Set([
  'env',
  'command',
  'builtin',
  'exec',
  'nohup',
  'time',
  'timeout',
  'nice',
  'ionice',
  'setsid',
  'stdbuf',
  'sudo',
  'xargs',
])
const wrapperValueOptions = {
  env: ['-u', '-C', '--unset', '--chdir'],
  timeout: ['-s', '-k', '--signal', '--kill-after'],
  nice: ['-n', '--adjustment'],
  ionice: ['-c', '-n', '-p'],
  sudo: ['-u', '-g', '-h', '-p', '-C'],
  xargs: ['-I', '-n', '-P', '-d', '-a', '-E', '-L', '-s'],
}
const posixShells = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh'])
const powerShells = new Set(['pwsh', 'powershell'])
const scriptShells = new Set([...posixShells, ...powerShells, 'cmd'])
const removers = new Set(['rm', 'remove-item', 'ri', 'rmdir', 'rd', 'del', 'erase'])
const scriptReaders = new Set([
  ...scriptShells,
  'eval',
  'source',
  'iex',
  'invoke-expression',
])
const packageRunners = new Set([
  'npx',
  'pnpx',
  'bunx',
  'pnpm',
  'npm',
  'yarn',
  'bun',
  'corepack',
])
// Options of package runners and of their exec/dlx subcommands that take a value.
const runnerValueOptions = new Set([
  '-p',
  '--package',
  '-C',
  '--dir',
  '-F',
  '--filter',
  '--prefix',
  '--cwd',
  '--node-options',
  '--workspace-concurrency',
  '--reporter',
  '--loglevel',
  '--userconfig',
  '--registry',
  '--cache',
  '--store-dir',
  '--use-node-version',
])
// In npm and npx `-w` names a workspace; in pnpm it is the flag `--workspace-root`.
const npmValueOptions = new Set(['-w', '--workspace'])
const uvRunners = new Set(['uv', 'uvx'])
// Long options of uv, `uv run` and `uv tool run` that take a value (docs.astral.sh/uv/reference/cli).
const uvValueOptions = new Set([
  '--allow-insecure-host',
  '--trusted-host',
  '--build-constraints',
  '--build-constraint',
  '--cache-dir',
  '--color',
  '--config-file',
  '--config-setting',
  '--config-settings',
  '--config-settings-package',
  '--constraints',
  '--constraint',
  '--default-index',
  '--directory',
  '--env-file',
  '--exclude-newer',
  '--exclude-newer-package',
  '--extra',
  '--extra-index-url',
  '--find-links',
  '--fork-strategy',
  '--from',
  '--group',
  '--index',
  '--index-strategy',
  '--index-url',
  '--keyring-provider',
  '--link-mode',
  '--no-binary-package',
  '--no-build-isolation-package',
  '--no-build-package',
  '--no-editable-package',
  '--no-extra',
  '--no-group',
  '--no-sources-package',
  '--only-group',
  '--overrides',
  '--override',
  '--package',
  '--prerelease',
  '--prerelease-package',
  '--preview-features',
  '--project',
  '--python',
  '--python-platform',
  '--python-preference',
  '--refresh-package',
  '--reinstall-package',
  '--resolution',
  '--torch-backend',
  '--upgrade-group',
  '--upgrade-package',
  '--with',
  '--with-editable',
  '--with-requirements',
])
// Flags of the same commands; a long option in neither list is read both ways (uvCommands).
const uvFlags = new Set([
  '--active',
  '--all-extras',
  '--all-groups',
  '--all-packages',
  '--compile-bytecode',
  '--compile',
  '--exact',
  '--frozen',
  '--gui-script',
  '--help',
  '--isolated',
  '--lfs',
  '--locked',
  '--managed-python',
  '--module',
  '--native-tls',
  '--no-binary',
  '--no-build',
  '--no-build-isolation',
  '--no-cache',
  '--no-cache-dir',
  '--no-config',
  '--no-default-groups',
  '--no-dev',
  '--no-editable',
  '--no-env-file',
  '--no-index',
  '--no-managed-python',
  '--no-preview',
  '--no-progress',
  '--no-project',
  '--no-workspace',
  '--no-python-downloads',
  '--no-require-build-hashes',
  '--no-sources',
  '--no-sync',
  '--offline',
  '--only-dev',
  '--preview',
  '--quiet',
  '--refresh',
  '--reinstall',
  '--force-reinstall',
  '--require-build-hashes',
  '--script',
  '--system-certs',
  '--upgrade',
  '--verbose',
])
// Letters of uv short options that take a value; `-C` is `--config-setting`, not a directory.
const uvValueLetters = new Set(['b', 'C', 'c', 'f', 'i', 'p', 'P', 'w'])
const knownCommands = new Set([
  ...scriptReaders,
  ...removers,
  ...packageRunners,
  ...uvRunners,
  'git',
  'gh',
  'glab',
  'lefthook',
  'export',
  'set',
  'setx',
  'start-process',
  'saps',
  'start',
])
// Unquoted backslash escapes only these; elsewhere it is a Windows path separator.
const escapable = new Set([
  ' ',
  '\t',
  '"',
  "'",
  '\\',
  '$',
  '`',
  '&',
  ';',
  '|',
  '(',
  ')',
  '<',
  '>',
])

const hookBypass = 'skipping the Git hooks'
const signingBypass = 'skipping commit signing'
const discardsDirectory =
  'restoring a directory or glob discards the uncommitted changes in it; restore your own files one by one or ask the user'
const configReadOptions = new Set(['--get', '--get-all', '--get-regexp', '--list', '-l'])

const forgeHosts = { gh: 'GitHub', glab: 'GitLab' }
// gh and glab subcommands that only read or change local settings. Anything else may write to
// GitHub or GitLab or print credentials, and so may aliases such as `gh pr new` or `gh co`,
// so a subcommand that is not listed here is blocked.
const forgeReadVerbs = new Set([
  'view',
  'list',
  'ls',
  'status',
  'diff',
  'checks',
  'download',
  'watch',
  'get',
  'show',
  'clone',
  'verify',
  'verify-asset',
  'trace',
  'logs',
  'lint',
  'contributors',
  'check',
  'field-list',
  'item-list',
  'issues',
  'read-file',
  'read-dir',
  'trusted-root',
  'set-default',
])
const forgeReadGroups = new Set([
  'status',
  'browse',
  'search',
  'completion',
  'help',
  'version',
])
// Without a subcommand these only print help; any other name may be an alias or extension.
const forgeGroups = new Set([
  'pr',
  'mr',
  'merge-request',
  'issue',
  'release',
  'repo',
  'run',
  'workflow',
  'ci',
  'secret',
  'variable',
  'label',
  'gist',
  'snippet',
  'cache',
  'project',
  'codespace',
  'auth',
  'config',
  'alias',
  'extension',
  'org',
  'ruleset',
  'attestation',
  'ssh-key',
  'gpg-key',
  'schedule',
  'cluster',
  'user',
  'token',
])
const forgeNestedGroups = new Set([
  'deploy-key',
  'autolink',
  'license',
  'gitignore',
  'members',
  'agent',
])
const forgeMergeRequestGroups = new Set(['pr', 'mr', 'merge-request'])
const forgeValueOptions = new Set(['-R', '--repo', '-g', '--group'])
const forgeApiValueOptions = new Set([
  '--method',
  '--header',
  '--raw-field',
  '--field',
  '--input',
  '--jq',
  '--template',
  '--cache',
  '--preview',
  '--hostname',
])
const forgeApiShortValueOptions = new Set(['-X', '-H', '-f', '-F', '-q', '-t', '-p'])
const forgeApiBodyOptions = new Set(['-f', '-F', '--raw-field', '--field', '--input'])

function baseName(word) {
  return (word.split(/[\\/]/).pop() ?? '')
    .toLowerCase()
    .replace(/\.(exe|cmd|bat|ps1)$/, '')
}

/** `g\it` and `r\un` as bash reads them. */
function unescapeLetters(word) {
  return word.replace(/\\(\w)/g, '$1')
}

/** A whole tree, root, home or .git, in POSIX or Windows spelling. */
function isMassPath(arg) {
  const slashed = nativePath(arg).replace(/\\/g, '/')
  const path = slashed.length > 1 ? slashed.replace(/\/+$/, '') : slashed
  return (
    // Git pathspecs for the repository root, checked before trailing slashes are trimmed.
    /^:(\/|\(top\))?$/.test(slashed) ||
    ['.', '..', '/', '~', '*'].includes(path) ||
    /^(\.\/)*\.git(\/|$)/.test(path) ||
    /^(\.\/)?\.?\*$/.test(path) ||
    /^(\.\/)?\*\/\.\.$/.test(path) ||
    /^\/\*$/.test(path) ||
    /^~\/\*?$/.test(path) ||
    /^[a-z]:\/?\*?$/i.test(path) ||
    /^\$\{?(HOME|PWD|USERPROFILE|env:USERPROFILE|env:HOME)\}?$/i.test(path)
  )
}

/** Git accepts any unambiguous prefix of a long option. */
function hasLongOption(args, option, minLength) {
  return args.some((arg) => {
    const name = arg.split('=')[0]
    return name.startsWith('--') && name.length >= minLength && option.startsWith(name)
  })
}

function isHookOverride(word) {
  return (
    /^(\$env:)?(LEFTHOOK(_EXCLUDE)?|HUSKY_SKIP_HOOKS)=/i.test(word) ||
    /^(\$env:)?HUSKY=["']?0/i.test(word) ||
    /^GIT_CONFIG_(KEY_\d+=core\.hookspath|PARAMETERS=.*hookspath)/i.test(word)
  )
}

/** `commit.gpgsign=false` and the like; Git reads an empty value as false. */
function turnsOffSigning(setting) {
  return /^(commit|tag)\.gpgsign=(false|no|off|0)?$/i.test(setting)
}

function checkForgeApi(name, args) {
  let method = null
  let endpoint = null
  let sendsBody = false
  const fields = []
  const take = (option, value) => {
    if (option === '-X' || option === '--method') method = value.toUpperCase()
    if (forgeApiBodyOptions.has(option)) {
      sendsBody = true
      fields.push(option === '--input' ? '=@' : value)
    }
  }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (!arg.startsWith('-') || arg === '-') {
      endpoint ??= arg
    } else if (arg.startsWith('--')) {
      const [option] = arg.split('=')
      if (arg.includes('=')) take(option, arg.slice(arg.indexOf('=') + 1))
      else if (forgeApiValueOptions.has(option)) take(option, args[++i] ?? '')
    } else {
      // A cluster of short flags (`-iXPOST`): the first one that takes a value ends it.
      for (let j = 1; j < arg.length; j++) {
        const option = `-${arg[j]}`
        if (forgeApiShortValueOptions.has(option)) {
          take(option, j + 1 < arg.length ? arg.slice(j + 1) : (args[++i] ?? ''))
          break
        }
      }
    }
  }
  const host = forgeHosts[name]
  if (/(^|\/)graphql$/.test(endpoint ?? '')) {
    // A query read from a file or stdin cannot be checked for a mutation.
    return fields.some((field) => /=@/.test(field) || /\bmutation\b/i.test(field))
      ? `${name} api graphql with a mutation writes to ${host} and needs an explicit request from the user`
      : null
  }
  // Both CLIs send POST once fields are given, unless the method is set explicitly.
  const effective = method ?? (sendsBody ? 'POST' : 'GET')
  return ['GET', 'HEAD'].includes(effective)
    ? null
    : `${name} api ${effective} writes to ${host} and needs an explicit request from the user`
}

/**
 * gh and glab: only the read-only subcommands pass. `--help` counts only on its own (`-b --help`
 * is a body), and `-h` not at all: it is the hostname option of `gh auth`.
 */
function checkForge(name, args) {
  if (args.some((arg, i) => arg === '--help' && !(args[i - 1] ?? '').startsWith('-')))
    return null
  const positional = []
  const positionalIndex = []
  let firstOtherOption = -1
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (forgeValueOptions.has(arg)) {
      i++
    } else if (arg.startsWith('-')) {
      if (firstOtherOption === -1 && !/^(--repo=|--group=|-R.|-g.)/.test(arg)) {
        firstOtherOption = i
      }
    } else {
      positionalIndex.push(i)
      // Bash drops a backslash before any character (`gh pr c\omment`).
      positional.push(arg.replace(/\\(\w)/g, '$1'))
    }
  }
  const [group, verb, nestedVerb] = positional
  if (group === undefined) return null
  // The CLIs find a command after `--flag value` pairs (`gh --body search pr comment`), so an
  // option before the group or the subcommand hides which word is which.
  const optionBefore = (index) => firstOtherOption !== -1 && firstOtherOption < index
  if (optionBefore(positionalIndex[0])) {
    return `${name} with options before the command needs an explicit request from the user`
  }
  if (forgeReadGroups.has(group)) return null
  if (group === 'api') return checkForgeApi(name, args.slice(positionalIndex[0] + 1))
  if (
    group === 'co' ||
    (forgeMergeRequestGroups.has(group) && ['checkout', 'co'].includes(verb))
  ) {
    const command = group === 'co' ? 'co' : `${group} ${verb}`
    return `${name} ${command} checks out a PR or MR, which switches branches and needs explicit approval from the user`
  }
  const nested = forgeNestedGroups.has(verb)
  const action = nested ? nestedVerb : verb
  if (optionBefore(positionalIndex[nested ? 2 : 1] ?? args.length)) {
    return `${name} ${group} with options before the subcommand needs an explicit request from the user`
  }
  if (action === undefined && forgeGroups.has(group)) return null
  if (
    (group === 'auth' &&
      args.some((arg) => arg === '--show-token' || /^-[a-z]*t[a-z]*$/i.test(arg))) ||
    (group === 'config' && positional.some((word) => /token/i.test(word)))
  ) {
    return `${name} ${group} ${action} prints a token into the session`
  }
  // `gh label clone` copies labels into the repository, unlike `gh repo clone`.
  if (forgeReadVerbs.has(action) && !(group === 'label' && action === 'clone'))
    return null
  const command = positional.slice(0, nested ? 3 : 2).join(' ')
  return `${name} ${command} is not a known read-only command: it may write to ${forgeHosts[name]} or print credentials and needs an explicit request from the user`
}

/** Index of each heredoc operator outside quotes, ignoring `<<<` and arithmetic shifts. */
function heredocMarkers(line) {
  const markers = []
  let quote = null
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (quote) {
      if (char === quote) quote = null
      else if (char === '\\' && quote === '"') i++
    } else if (char === "'" || char === '"') {
      quote = char
    } else if (line.startsWith('<<', i) && line[i + 2] !== '<' && line[i - 1] !== '<') {
      const match = /^<<(-?)\s*(['"]?)([A-Za-z_][\w.-]*)\2/.exec(line.slice(i))
      if (match) {
        markers.push({
          index: i,
          delimiter: match[3],
          indented: match[1] === '-',
          quoted: match[2] !== '',
        })
      }
      i++
    }
  }
  return markers
}

/** Whether the heredoc on this line is read by a shell, so its body is a script. */
function feedsShell(line, index) {
  const owner =
    line
      .slice(0, index)
      .split(/&&|\|\||[;|(]/)
      .pop() ?? ''
  const words = owner
    .trim()
    .split(/\s+/)
    .filter((word) => !/^\w+=/.test(word))
  while (
    words.length > 0 &&
    (wrappers.has(baseName(words[0])) || keywords.has(words[0]))
  ) {
    words.shift()
  }
  const name = baseName(words[0] ?? '')
  if (scriptShells.has(name) || ['eval', 'source', '.'].includes(name)) return true
  return /\|\s*(sudo\s+)?(bash|sh|zsh|dash|ksh|pwsh|powershell)\b/.test(line.slice(index))
}

/** End index of a `$(` substitution starting at `start`, balancing nested parentheses. */
function substitutionEnd(text, start) {
  let depth = 0
  for (let i = start; i < text.length; i++) {
    if (text[i] === '(') depth++
    else if (text[i] === ')' && --depth === 0) return i
  }
  return text.length
}

/** Scripts of `$(...)` and backtick substitutions anywhere in the text. */
function substitutionsIn(text) {
  const scripts = []
  for (let i = 0; i < text.length; i++) {
    if (text.startsWith('$(', i)) {
      const end = substitutionEnd(text, i + 1)
      scripts.push(text.slice(i + 2, end))
      i = end
    } else if (text[i] === '`') {
      const end = text.indexOf('`', i + 1)
      scripts.push(text.slice(i + 1, end === -1 ? undefined : end))
      i = end === -1 ? text.length : end
    }
  }
  return scripts
}

/**
 * Drops heredoc bodies that are plain data (commit messages, file contents) and keeps the
 * ones a shell executes. A body without its closing delimiter is kept as commands. With an
 * unquoted delimiter the shell still expands substitutions in a data body; those are
 * returned as nested scripts.
 */
function stripHeredocs(command) {
  const lines = command.split(/\r?\n/)
  const kept = []
  const nested = []
  for (let i = 0; i < lines.length; i++) {
    kept.push(lines[i])
    let next = i + 1
    for (const marker of heredocMarkers(lines[i])) {
      let end = next
      const matches = (line) =>
        (marker.indented ? line.replace(/^\t+/, '') : line) === marker.delimiter
      while (end < lines.length && !matches(lines[end])) end++
      if (end >= lines.length) break
      const body = lines.slice(next, end)
      if (feedsShell(lines[i], marker.index)) kept.push(...body)
      else if (!marker.quoted) nested.push(...substitutionsIn(body.join('\n')))
      next = end + 1
    }
    i = next - 1
  }
  return { script: kept.join('\n'), nested }
}

/**
 * Splits a script into simple commands (lists of words after quote removal) and collects
 * the scripts of command substitutions, which run even inside double quotes.
 */
function parseScript(script) {
  const commands = []
  const nested = []
  let words = []
  let word = ''
  let inWord = false
  let skipNextWord = false
  let hereString = false
  let hereStrings = []
  const endWord = () => {
    if (inWord && !skipNextWord) words.push(word)
    if (inWord && skipNextWord && hereString) hereStrings.push(word)
    if (inWord) {
      skipNextWord = false
      hereString = false
    }
    word = ''
    inWord = false
  }
  const endCommand = () => {
    endWord()
    // `bash <<< "git push"` runs the here-string as a script.
    if (words.some((candidate) => scriptReaders.has(baseName(candidate)))) {
      nested.push(...hereStrings)
    }
    if (words.length > 0) commands.push(words)
    words = []
    hereStrings = []
    skipNextWord = false
    hereString = false
  }

  for (let i = 0; i < script.length; i++) {
    const char = script[i]
    if (char === '$' && script[i + 1] === "'") {
      // ANSI-C quoting `$'...'`: the quote itself is handled on the next character.
      inWord = true
    } else if (char === "'") {
      const end = script.indexOf("'", i + 1)
      word += end === -1 ? script.slice(i + 1) : script.slice(i + 1, end)
      inWord = true
      i = end === -1 ? script.length : end
    } else if (char === '"') {
      inWord = true
      for (i++; i < script.length && script[i] !== '"'; i++) {
        if (script[i] === '\\' && '"\\$`'.includes(script[i + 1] ?? '')) {
          word += script[++i]
        } else if (script.startsWith('$(', i)) {
          const end = substitutionEnd(script, i + 1)
          nested.push(script.slice(i + 2, end))
          i = end
        } else if (script[i] === '`') {
          const end = script.indexOf('`', i + 1)
          nested.push(script.slice(i + 1, end === -1 ? undefined : end))
          i = end === -1 ? script.length : end
        } else {
          word += script[i]
        }
      }
    } else if (
      char === '\\' &&
      /\s/.test(script[i + 1] ?? '') &&
      /^([A-Za-z]:|\.{1,2}|~)$/.test(word)
    ) {
      // `C:\ ` or `.\ ` is a Windows path followed by a space, not an escaped space.
      word += char
      inWord = true
    } else if (char === '\\' && escapable.has(script[i + 1] ?? '')) {
      word += script[++i]
      inWord = true
    } else if (script.startsWith('$(', i)) {
      const end = substitutionEnd(script, i + 1)
      nested.push(script.slice(i + 2, end))
      i = end
      inWord = true
    } else if (char === '`') {
      const end = script.indexOf('`', i + 1)
      nested.push(script.slice(i + 1, end === -1 ? undefined : end))
      i = end === -1 ? script.length : end
      inWord = true
    } else if (char === '#' && !inWord) {
      while (i + 1 < script.length && script[i + 1] !== '\n') i++
    } else if (char === '<' || char === '>') {
      // Redirection: `>out`, `2>&1`, `&>file`, `<<<text`; its target is not an argument.
      if (/^\d+$/.test(word)) inWord = false
      endWord()
      const isHereString = script.startsWith('<<<', i)
      while (script[i + 1] !== undefined && '<>&'.includes(script[i + 1])) i++
      hereString = isHereString
      // `>&2` duplicates a descriptor and has no target word to skip.
      const duplicatesDescriptor = script[i] === '&' && /[\d-]/.test(script[i + 1] ?? '')
      if (duplicatesDescriptor) i++
      skipNextWord = !duplicatesDescriptor
    } else {
      const separator = separators.find((candidate) => script.startsWith(candidate, i))
      if (separator) {
        endCommand()
        i += separator.length - 1
      } else if (/\s/.test(char)) {
        endWord()
      } else {
        word += char
        inWord = true
      }
    }
  }
  endCommand()
  return { commands, nested }
}

/**
 * Whether `git reset <arg>` names a commit rather than a path. Relative refs and hashes are
 * recognised by shape; anything else is asked from the repository (a read-only call), so a
 * deleted or renamed file can still be unstaged.
 */
function isCommit(arg, cwd) {
  if (
    /^((HEAD|@)([~^]|@\{)|ORIG_HEAD$|FETCH_HEAD$|[0-9a-f]{7,40}$|(origin|upstream)\/)/.test(
      arg,
    )
  ) {
    return true
  }
  const result = spawnSync(
    'git',
    ['rev-parse', '--verify', '--quiet', `${arg}^{commit}`],
    { cwd, stdio: 'ignore', timeout: 5000 },
  )
  return result.status === 0
}

function isDirectory(path) {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/** Git Bash spells `C:\x` as `/c/x`, which Git for Windows and Node do not read as a path. */
function nativePath(path) {
  return process.platform === 'win32'
    ? path.replace(/^\/(?:cygdrive\/)?([a-z])(?=\/|$)/i, (_, drive) => `${drive}:`)
    : path
}

function nearestDirectory(path) {
  let current = path
  while (!isDirectory(current)) {
    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
  return current
}

/** Pathspec magic (`:/src`, `:(top)src`) and globs are resolved by Git, not by the file system. */
function isPathspecPattern(target) {
  return target.startsWith(':') || /[*?[]/.test(target)
}

/**
 * Whether `git status` reports changes under any target. Each target is asked in its own
 * directory, so a nested repository or a worktree answers for itself; ignored paths, paths
 * outside a repository and targets Git cannot read report nothing, so `rm -rf dist` stays
 * allowed. Restoring keeps untracked files, deleting does not. `--no-optional-locks` keeps
 * the call from refreshing the index, which a parallel `git add` could trip over.
 */
function hasUncommittedChanges(targets, cwd, { untracked }) {
  return targets.some((target) => {
    const native = nativePath(target)
    const path = resolve(cwd, native)
    const pattern = isPathspecPattern(native)
    const directory = pattern ? cwd : nearestDirectory(path)
    if (directory === null) return false
    const result = spawnSync(
      'git',
      [
        '--no-optional-locks',
        'status',
        '--porcelain',
        `--untracked-files=${untracked ? 'all' : 'no'}`,
        '--',
        pattern ? native : relative(directory, path) || '.',
      ],
      { cwd: directory, encoding: 'utf8', timeout: 5000 },
    )
    return result.status === 0 && result.stdout.trim() !== ''
  })
}

/** Directories and patterns among the restore targets: restoring them discards whole groups. */
function broadTargets(targets, cwd) {
  return targets.filter(
    (target) =>
      isPathspecPattern(target) || isDirectory(resolve(cwd, nativePath(target))),
  )
}

/**
 * Follows `cd`, `pushd`, `popd`, `cd -` and `Set-Location`, so later commands of the same
 * line are checked in the right directory. A target the guard cannot read (`cd $dir`,
 * `cd ~`) leaves the directory as it was. A `cd` inside a subshell is not undone at `)`.
 */
function changeDirectory(words, location) {
  const name = baseName(words[0] ?? '')
  if (name === 'popd') {
    location.current = location.stack.pop() ?? location.current
    return
  }
  if (!['cd', 'pushd', 'chdir', 'set-location', 'sl'].includes(name)) return
  const target = words.slice(1).find((word) => word === '-' || !word.startsWith('-'))
  if (target === '-') {
    ;[location.current, location.previous] = [location.previous, location.current]
    return
  }
  if (target === undefined || /[$`%(~]/.test(target)) return
  if (name === 'pushd') location.stack.push(location.current)
  location.previous = location.current
  location.current = resolve(location.current, nativePath(target))
}

/**
 * A directory that is a repository or worktree or holds one up to three levels down
 * (`.claude/worktrees/x`): `git status` does not report unpushed commits, branches or
 * stashes that deleting it destroys. `node_modules` is not searched.
 */
function holdsRepository(path, depth = 3) {
  if (!isDirectory(path)) return false
  if (existsSync(join(path, '.git'))) return true
  if (depth === 0) return false
  try {
    return readdirSync(path, { withFileTypes: true }).some(
      (entry) =>
        entry.isDirectory() &&
        entry.name !== 'node_modules' &&
        holdsRepository(join(path, entry.name), depth - 1),
    )
  } catch {
    return false
  }
}

/**
 * A path in the system temporary directory, outside the session's own tree: scratch
 * repositories and clones an agent made for itself, which it may delete.
 */
function isScratchPath(path, cwd) {
  const inside = (parent) => {
    const rest = relative(parent, path)
    return rest === '' || (!rest.startsWith('..') && !isAbsolute(rest))
  }
  return inside(tmpdir()) && !inside(cwd)
}

function checkGit(args, sessionCwd) {
  let cwd = sessionCwd
  const valueOptions = [
    '-c',
    '-C',
    '--git-dir',
    '--work-tree',
    '--namespace',
    '--super-prefix',
    '--config-env',
  ]
  let i = 0
  while (i < args.length && args[i].startsWith('-')) {
    const option = args[i]
    const value = ['-c', '--config-env'].includes(option)
      ? (args[i + 1] ?? '')
      : option.replace(/^(-c|--config-env=)/, '')
    if (
      (option.startsWith('-c') || option.startsWith('--config-env')) &&
      /^core\.hookspath=/i.test(value)
    ) {
      return `overriding core.hooksPath means ${hookBypass}`
    }
    // `--config-env` takes the value from a variable the hook cannot see.
    if (
      (option.startsWith('-c') && turnsOffSigning(value)) ||
      (option.startsWith('--config-env') && /^(commit|tag)\.gpgsign=/i.test(value))
    ) {
      return `overriding commit.gpgsign means ${signingBypass}`
    }
    // `git -C project restore src` works in project/, so its files are checked there.
    if (option === '-C') cwd = resolve(cwd, nativePath(args[i + 1] ?? ''))
    else if (option.startsWith('-C')) cwd = resolve(cwd, nativePath(option.slice(2)))
    i += valueOptions.includes(option) ? 2 : 1
  }
  // Bash drops a backslash before any character (`git \push`); paths keep theirs below.
  const unescape = (arg) => arg?.replace(/\\(\w)/g, '$1')
  const subcommand = unescape(args[i])
  const rest = args.slice(i + 1)
  const first = unescape(rest[0])
  const options = rest.filter((arg) => arg.startsWith('-')).map(unescape)
  const dashDash = rest.indexOf('--')
  const beforeDashDash = dashDash === -1 ? rest : rest.slice(0, dashDash)
  const paths = dashDash === -1 ? [] : rest.slice(dashDash + 1)
  const shortCluster = (letter) =>
    options.some(
      (arg) => !arg.startsWith('--') && new RegExp(`^-[a-zA-Z]*${letter}`).test(arg),
    )

  if (hasLongOption(options, '--no-verify', 6)) return `--no-verify means ${hookBypass}`
  if (hasLongOption(options, '--no-gpg-sign', 6))
    return `--no-gpg-sign means ${signingBypass}`
  if (subcommand === 'tag' && hasLongOption(options, '--no-sign', 8))
    return `git tag --no-sign means ${signingBypass}`

  switch (subcommand) {
    case 'push':
      return 'git push needs an explicit request from the user'
    case 'pull':
      return 'git pull merges or rebases and needs an explicit request from the user'
    case 'merge':
      return ['--abort', '--continue', '--quit'].includes(first)
        ? null
        : 'git merge needs an explicit request from the user'
    case 'reset': {
      if (
        hasLongOption(options, '--hard', 4) ||
        hasLongOption(options, '--soft', 4) ||
        hasLongOption(options, '--keep', 4) ||
        hasLongOption(options, '--merge', 4)
      ) {
        return 'git reset --hard/--soft/--keep/--merge discards work or rewrites history'
      }
      const target = beforeDashDash.find(
        (arg) =>
          !arg.startsWith('-') && arg !== 'HEAD' && arg !== '@' && isCommit(arg, cwd),
      )
      return target === undefined
        ? null
        : `git reset ${target} moves the branch to another commit; unstage files with \`git restore --staged <file>\``
    }
    case 'clean':
      return (shortCluster('f') || hasLongOption(options, '--force', 4)) &&
        !(shortCluster('n') || hasLongOption(options, '--dry-run', 4))
        ? 'git clean -f deletes untracked files'
        : null
    case 'commit':
      if (hasLongOption(options, '--amend', 4))
        return 'git commit --amend rewrites history'
      return shortCluster('n') ? `git commit -n means ${hookBypass}` : null
    case 'stash':
      return rest.length === 0 ||
        ['push', 'save', 'drop', 'clear'].includes(first) ||
        first.startsWith('-')
        ? "git stash can hide other people's uncommitted work"
        : null
    case 'switch':
      return 'switching branches needs explicit approval from the user'
    case 'checkout':
      if (dashDash === -1) {
        return 'git checkout without "--" switches branches; restore files with `git checkout -- <file>` or `git restore <file>`'
      }
      if (paths.some(isMassPath))
        return 'restoring the whole tree discards uncommitted work'
      return hasUncommittedChanges(broadTargets(paths, cwd), cwd, { untracked: false })
        ? discardsDirectory
        : null
    case 'restore': {
      const staged = shortCluster('S') || hasLongOption(options, '--staged', 4)
      const worktree = shortCluster('W') || hasLongOption(options, '--worktree', 4)
      const targets = dashDash === -1 ? rest.filter((arg) => !arg.startsWith('-')) : paths
      if (staged && !worktree) return null
      if (targets.some(isMassPath))
        return 'restoring the whole tree discards uncommitted work'
      return hasUncommittedChanges(broadTargets(targets, cwd), cwd, { untracked: false })
        ? discardsDirectory
        : null
    }
    case 'worktree':
      return first === 'remove' &&
        (shortCluster('f') || hasLongOption(options, '--force', 4))
        ? "git worktree remove --force deletes the worktree's uncommitted work"
        : null
    case 'rebase':
      return ['--abort', '--quit', '--continue', '--skip'].includes(first)
        ? null
        : 'git rebase rewrites history'
    case 'filter-branch':
    case 'filter-repo':
    case 'update-ref':
      return `git ${subcommand} rewrites history or refs`
    case 'branch':
      return options.some((arg) => /^-[a-zA-Z]*[DMf]/.test(arg)) ||
        hasLongOption(options, '--force', 4)
        ? 'force-deleting or force-moving a branch loses commits'
        : null
    case 'reflog':
      return ['expire', 'delete'].includes(first)
        ? 'pruning the reflog loses history'
        : null
    case 'config': {
      if (rest.some((arg) => configReadOptions.has(arg))) return null
      if (rest.some((arg) => /^core\.hookspath$/i.test(arg))) {
        return `changing core.hooksPath means ${hookBypass}`
      }
      const signing = rest.findIndex((arg) => /^(commit|tag)\.gpgsign$/i.test(arg))
      if (signing === -1) return null
      const unsets = rest.some((arg) => ['--unset', '--unset-all', 'unset'].includes(arg))
      const value = rest[signing + 1]
      return unsets || (value !== undefined && turnsOffSigning(`commit.gpgsign=${value}`))
        ? `turning off commit.gpgsign means ${signingBypass}`
        : null
    }
    case 'rm': {
      if (!shortCluster('r')) return null
      if (rest.some(isMassPath)) return 'git rm -r on the whole tree is a mass deletion'
      // Without --force Git itself refuses to remove modified files; --cached keeps them.
      const forced =
        (shortCluster('f') || hasLongOption(options, '--force', 4)) &&
        !hasLongOption(options, '--cached', 4)
      const targets = beforeDashDash.filter((arg) => !arg.startsWith('-')).concat(paths)
      return forced && hasUncommittedChanges(targets, cwd, { untracked: false })
        ? 'git rm -rf of a path with uncommitted changes loses them; ask the user'
        : null
    }
    default:
      return null
  }
}

function checkRemove(name, args, cwd) {
  const powerShellRecurse = (arg) => /^-r(e(c(u(r(s(e)?)?)?)?)?)?(:\$true)?$/i.test(arg)
  // `rm` is both POSIX rm (`-rf`) and the PowerShell alias, where `-Force` or `-Verbose`
  // contain an r without meaning recursion.
  const recursive = args.some((arg) =>
    name === 'rm'
      ? hasLongOption([arg], '--recursive', 3) ||
        /^-[fiIdvxP]*[rR][fiIdvxPrR]*$/.test(arg) ||
        powerShellRecurse(arg)
      : powerShellRecurse(arg) || /^\/s$/i.test(arg),
  )
  if (!recursive) return null
  // `/s` and `/q` are switches of cmd's rd and del; for rm, `/c` is a Git Bash drive root.
  // PowerShell takes several paths separated by commas (`Remove-Item new,src`).
  const targets = args
    .filter((arg) => !arg.startsWith('-') && (name === 'rm' || !/^\/[a-z]$/i.test(arg)))
    .flatMap((arg) =>
      arg.includes(',') ? [arg, ...arg.split(',').filter(Boolean)] : [arg],
    )
  if (targets.some(isMassPath)) {
    return 'recursive deletion of the whole tree, the home directory, a drive root or .git is a mass deletion'
  }
  const kept = targets.filter(
    (target) => !isScratchPath(resolve(cwd, nativePath(target)), cwd),
  )
  if (kept.some((target) => holdsRepository(resolve(cwd, nativePath(target))))) {
    return 'recursive deletion of a Git repository or worktree loses its unpushed commits, branches and stashes; remove a worktree with `git worktree remove`, otherwise ask the user'
  }
  return hasUncommittedChanges(kept, cwd, { untracked: true })
    ? 'recursive deletion of a path with uncommitted or untracked files loses them; delete only your own files or ask the user'
    : null
}

/**
 * What a package runner starts: `npx git push`, `pnpm exec git push`, `pnpm dlx x`,
 * `npm exec -- git push`, `bun x`, `yarn run git push`, `corepack pnpm …`, or `pnpm git push`
 * (pnpm runs a binary when there is no script of that name). `{ words }` for a command,
 * `{ script }` for a command line the runner hands to a shell (`npx -c`, `npm exec --call`,
 * `pnpm exec --shell-mode`), null for a script or a tool the guard does not check. `dir` is
 * the directory from `--dir`, `-C`, `--prefix` or `--cwd`, where the command runs.
 */
function runnerCommand(name, args) {
  if (name === 'corepack') return { words: args }
  let rest = args
  let shellMode = false
  let dir
  const skipOptions = () => {
    while (rest[0]?.startsWith('-')) {
      const [option] = rest[0].split('=')
      if (rest[0] === '--') {
        rest = rest.slice(1)
        return null
      }
      const attached = rest[0].includes('=')
        ? rest[0].slice(rest[0].indexOf('=') + 1)
        : null
      const value = attached ?? rest[1] ?? ''
      if (['npx', 'npm'].includes(name) && ['-c', '--call'].includes(option)) return value
      if (['pnpm', 'pnpx'].includes(name) && ['-c', '--shell-mode'].includes(option)) {
        shellMode = true
      }
      if (['-C', '--dir', '--prefix', '--cwd'].includes(option)) dir = value
      const takesValue =
        runnerValueOptions.has(option) ||
        (['npm', 'npx'].includes(name) && npmValueOptions.has(option))
      rest = attached === null && takesValue ? rest.slice(2) : rest.slice(1)
    }
    return null
  }
  if (['pnpm', 'npm', 'yarn', 'bun'].includes(name)) {
    let call = skipOptions()
    // `yarn workspace <name> <command>` runs the command in that workspace.
    while (call === null && name === 'yarn' && rest[0] === 'workspace') {
      rest = rest.slice(2)
      call = skipOptions()
    }
    if (call !== null) return { script: call, dir }
    const [word = ''] = rest
    const subcommand = unescapeLetters(word)
    if (['exec', 'dlx', 'x'].includes(subcommand)) rest = rest.slice(1)
    else if (subcommand === 'run' && ['yarn', 'bun'].includes(name)) rest = rest.slice(1)
    // `C:\tools\git.exe` keeps its backslashes, `g\it` loses them.
    else if (knownCommands.has(baseName(word)) || knownCommands.has(baseName(subcommand)))
      return { words: rest, dir }
    else return null
  }
  const call = skipOptions()
  if (call !== null) return { script: call, dir }
  return shellMode ? { script: rest.join(' '), dir } : { words: rest, dir }
}

/**
 * What uv starts: `uv run git push`, `uv --directory sub run …`, `uvx tool …` or
 * `uv tool run tool …`; empty for the other uv commands. A long option missing from
 * uvValueOptions and uvFlags may take a value in a newer uv, so both readings are
 * returned; the flag reading ends at that value, so there is one reading per such option.
 * `dir` is the directory from `--directory`, where the command runs.
 */
function uvCommands(name, args) {
  const commands = []
  const visit = (start, stage, startDir) => {
    let rest = start
    let dir = startDir
    while (rest[0]?.startsWith('-')) {
      if (rest[0] === '--') {
        rest = rest.slice(1)
        break
      }
      const [option] = rest[0].split('=')
      const attached = rest[0].includes('=')
      if (option === '--directory') {
        dir = attached ? rest[0].slice(rest[0].indexOf('=') + 1) : rest[1]
      }
      const letters = /^-[^-]/.test(option) ? [...option.slice(1)] : null
      // In a cluster the first value letter takes the rest: `-qp 3.13`, `-qp3.13`.
      const takesValue =
        !attached &&
        (letters === null
          ? uvValueOptions.has(option)
          : letters.findIndex((letter) => uvValueLetters.has(letter)) ===
            letters.length - 1)
      const unknown = letters === null && !attached && !takesValue && !uvFlags.has(option)
      if (unknown && rest[1] !== undefined && !rest[1].startsWith('-')) {
        visit(rest.slice(2), stage, dir)
      }
      rest = rest.slice(takesValue ? 2 : 1)
    }
    const word = unescapeLetters(rest[0] ?? '')
    if (stage === 'uv' && word === 'run') visit(rest.slice(1), 'run', dir)
    else if (stage === 'uv' && word === 'tool') visit(rest.slice(1), 'tool', dir)
    // `uvx` itself runs as `uv tool uvx`.
    else if (stage === 'tool' && ['run', 'uvx'].includes(word))
      visit(rest.slice(1), 'tool run', dir)
    else if (stage === 'run') commands.push({ words: rest, dir })
    else if (stage === 'tool run' && rest.length > 0) {
      // `uvx pre-commit@latest uninstall` runs pre-commit.
      const tool = rest[0].replace(/(?<=.)[@[=<>~!].*$/, '')
      commands.push({ words: [tool, ...rest.slice(1)], dir })
    }
  }
  visit(args, name === 'uv' ? 'uv' : 'tool run', undefined)
  return commands
}

/** The script a shell runs from its arguments, or null when it reads a file or stdin. */
function shellScript(name, args) {
  if (posixShells.has(name)) {
    const index = args.findIndex((arg) => /^-[a-zA-Z]*c[a-zA-Z]*$/.test(arg))
    return index === -1 ? null : args.slice(index + 1).join(' ')
  }
  if (name === 'cmd') {
    const index = args.findIndex((arg) => /^\/[ck]$/i.test(arg))
    return index === -1 ? null : args.slice(index + 1).join(' ')
  }
  const valueOptions =
    /^-(ex(ecutionpolicy)?|ep|w(orkingdirectory)?|wd|o(utputformat)?|i(nputformat)?|configurationname|v(ersion)?)$/i
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (/^-c(o(m(m(a(n(d)?)?)?)?)?)?$/i.test(arg)) return args.slice(i + 1).join(' ')
    if (/^-(e|ec|encodedcommand)$/i.test(arg)) {
      return Buffer.from(args[i + 1] ?? '', 'base64').toString('utf16le')
    }
    if (/^-f(ile)?$/i.test(arg)) return null
    if (valueOptions.test(arg)) i++
    else if (!arg.startsWith('-')) return args.slice(i).join(' ')
  }
  return null
}

function checkCommand(words, cwd) {
  let start = 0
  // pre-commit reads SKIP for any Git command it hooks; elsewhere SKIP is an ordinary name.
  let skipsPreCommitHooks = false
  while (start < words.length) {
    const word = words[start]
    if (isHookOverride(word))
      return `LEFTHOOK=0, LEFTHOOK_EXCLUDE, HUSKY=0 or a core.hooksPath override means ${hookBypass}`
    if (/^GIT_CONFIG_(KEY_\d+=(commit|tag)\.gpgsign|PARAMETERS=.*gpgsign)/i.test(word))
      return `overriding commit.gpgsign means ${signingBypass}`
    if (/^SKIP=/i.test(word)) skipsPreCommitHooks = true
    if (/^[A-Za-z_]\w*=/.test(word) || keywords.has(word)) {
      start++
    } else if (wrappers.has(baseName(word))) {
      const name = baseName(word)
      start++
      while (start < words.length && words[start].startsWith('-')) {
        start += wrapperValueOptions[name]?.includes(words[start]) ? 2 : 1
      }
      if (name === 'timeout' && /^\d/.test(words[start] ?? '')) start++
    } else {
      break
    }
  }
  const [head, ...args] = words.slice(start)
  if (head === undefined) return null
  // `g\it` is `git` to bash, while `C:\tools\git.exe` must keep its backslashes.
  const plainName = baseName(head)
  const unescapedName = baseName(unescapeLetters(head))
  const name = knownCommands.has(plainName) ? plainName : unescapedName

  if (skipsPreCommitHooks && name === 'git') return `SKIP=<hook> means ${hookBypass}`
  // Only HUSKY=0 disables husky; `$env:HUSKY = 0` splits into words, so match the whole line.
  const disablesHusky =
    (['export', 'set'].includes(name) &&
      args.some((arg) => /^HUSKY=["']?0/i.test(arg))) ||
    (name === 'setx' &&
      /^HUSKY$/i.test(args[0] ?? '') &&
      /^["']?0/.test(args[1] ?? '')) ||
    /^\$env:HUSKY\s*=\s*["']?0/i.test([head, ...args].join(' '))
  if (
    disablesHusky ||
    (['export', 'set', 'setx'].includes(name) &&
      args.some((arg) =>
        /^(LEFTHOOK(_EXCLUDE)?|HUSKY_SKIP_HOOKS|SKIP)(=|$)/i.test(arg),
      )) ||
    /^\$env:(LEFTHOOK(_EXCLUDE)?|HUSKY_SKIP_HOOKS|SKIP)(=|$)/i.test(head)
  ) {
    return `LEFTHOOK=0, LEFTHOOK_EXCLUDE, HUSKY=0 or SKIP=<hook> means ${hookBypass}`
  }
  if (
    (['export', 'set', 'setx'].includes(name) || /^\$env:/i.test(head)) &&
    /GIT_CONFIG_(KEY_\d+|PARAMETERS)\W.*gpgsign/i.test([head, ...args].join(' '))
  ) {
    return `overriding commit.gpgsign means ${signingBypass}`
  }
  const uninstaller = words.find(
    (word, index) =>
      ['lefthook', 'pre-commit', 'pre_commit'].includes(baseName(word)) &&
      words[index + 1] === 'uninstall',
  )
  if (uninstaller !== undefined) {
    return `${baseName(uninstaller)} uninstall removes the Git hooks`
  }
  if (scriptShells.has(name)) {
    const script = shellScript(name, args)
    return script === null ? null : findViolation(script, cwd)
  }
  if (['eval', 'iex', 'invoke-expression'].includes(name))
    return findViolation(args.join(' '), cwd)
  if (['start-process', 'saps', 'start'].includes(name)) {
    const listIndex = args.findIndex((arg) => /^-a(rg(ument(list)?)?)?$/i.test(arg))
    const file = args.find(
      (arg, index) => !arg.startsWith('-') && index !== listIndex + 1,
    )
    const list = listIndex === -1 ? '' : (args[listIndex + 1] ?? '').replace(/,/g, ' ')
    return file === undefined ? null : findViolation(`${file} ${list}`, cwd)
  }
  if (packageRunners.has(name) || uvRunners.has(name)) {
    // Variables before the runner (`SKIP=ruff pnpm exec git commit`) reach the inner command.
    const assignments = words
      .slice(0, start)
      .filter((word) => /^[A-Za-z_]\w*=/.test(word))
    // A value with spaces would split the joined command line; hook overrides have none.
    const prefix = assignments.filter((word) => !/\s/.test(word))
    const inners = uvRunners.has(name)
      ? uvCommands(name, args)
      : [runnerCommand(name, args)]
    for (const inner of inners) {
      if (inner === null) continue
      const innerCwd = inner.dir === undefined ? cwd : resolve(cwd, nativePath(inner.dir))
      const reason =
        'script' in inner
          ? findViolation([...prefix, inner.script].join(' '), innerCwd)
          : checkCommand([...assignments, ...inner.words], innerCwd)
      if (reason) return reason
    }
    return null
  }
  if (name === 'gh' || name === 'glab') return checkForge(name, args)
  if (name === 'git') return checkGit(args, cwd)
  if (removers.has(name)) return checkRemove(name, args, cwd)
  return null
}

/**
 * Returns why the command is blocked, or null when it may run. `cwd` is the directory the
 * command runs in; restores and deletions ask `git status` there.
 */
export function findViolation(
  command,
  cwd = process.env.CLAUDE_PROJECT_DIR ?? process.cwd(),
) {
  const heredocs = stripHeredocs(command.replace(/\\\r?\n/g, '').replace(/`\r?\n/g, ''))
  const { commands, nested } = parseScript(heredocs.script)
  const location = { current: cwd, previous: cwd, stack: [] }
  for (const words of commands) {
    const reason = checkCommand(words, location.current)
    if (reason) return reason
    changeDirectory(words, location)
  }
  for (const inner of [...heredocs.nested, ...nested]) {
    const reason = findViolation(inner, cwd)
    if (reason) return reason
  }
  return null
}

function invokedDirectly() {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (process.argv[1] && invokedDirectly()) {
  let command = ''
  let cwd
  try {
    // Claude Code and Codex both pass the session directory as `cwd`.
    const input = JSON.parse(readFileSync(0, 'utf8'))
    command = input.tool_input?.command ?? ''
    cwd = typeof input.cwd === 'string' && input.cwd !== '' ? input.cwd : undefined
  } catch {
    process.exit(0)
  }
  const reason = findViolation(command, cwd)
  if (reason) {
    console.error(
      `Blocked by .claude/hooks/guard-commands.mjs: ${reason}. AGENTS.md allows this only with the user's explicit approval; ask the user to run it themselves.`,
    )
    process.exit(2)
  }
}
