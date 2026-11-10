import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import { findViolation } from './guard-commands.mjs'

const blocked = [
  'git push',
  'git push --force origin main',
  'cd sub && git push',
  'git  push',
  'git --no-pager -C . push origin HEAD',
  '"C:/Program Files/Git/bin/git.exe" push',
  'git reset --hard',
  'git reset --hard HEAD~1',
  'git reset --soft HEAD~2',
  'git reset HEAD~1',
  'git reset ORIG_HEAD',
  'git clean -fd',
  'git clean -xdf',
  'git clean --force',
  'git commit --no-verify -m "fix: x"',
  'git commit -m "fix: x" --no-verify',
  'git commit -nm "fix: x"',
  'git merge --no-verify feature',
  'LEFTHOOK=0 git commit -m "fix: x"',
  'env LEFTHOOK=0 git commit -m "fix: x"',
  'export LEFTHOOK=0',
  'LEFTHOOK_EXCLUDE=typecheck git commit -m x',
  '$env:LEFTHOOK=0; git commit -m x',
  '$env:LEFTHOOK = "0"',
  'git -c core.hooksPath=/dev/null commit -m x',
  'git config core.hooksPath .nohooks',
  'git stash',
  'git stash -u',
  'git stash push -m wip',
  'git stash drop',
  'git switch main',
  'git checkout main',
  'git checkout -b feature',
  'git checkout -- .',
  'git checkout HEAD -- .',
  'git restore .',
  'git restore --staged --worktree .',
  'git rebase -i HEAD~3',
  'git rebase main',
  'git commit --amend --no-edit',
  'git filter-branch --tree-filter x HEAD',
  'git branch -D feature',
  'git branch -f main HEAD~1',
  'git reflog expire --expire=now --all',
  'git rm -r .',
  'bash -c "git push"',
  "sh -c 'git reset --hard'",
  'echo "$(git push)"',
  'echo `git push`',
  'rm -rf .',
  'rm -rf /',
  'rm -rf *',
  'rm -rf .git',
  'Remove-Item -Recurse -Force .',
  'rmdir /s /q .',
  'xargs git push',
  // Bypasses found in the second review pass.
  'cat <<< hi\ngit push',
  'echo "<<X"\ngit push',
  'echo $((1<<2))\ngit reset --hard',
  "bash <<'EOF'\ngit push\nEOF",
  'sh -s <<EOF\ngit reset --hard\nEOF',
  "cat <<'EOF' | bash\ngit push\nEOF",
  'git \\\npush',
  'git `\npush',
  'C:\\tools\\git.exe push',
  '& C:\\Git\\cmd\\git.exe push',
  '.\\git.exe push',
  'Remove-Item -Recurse -Force .\\*',
  'Remove-Item -Recurse -Force .\\.git',
  'rm -rf C:\\',
  'env -i git push',
  'env -u X git push',
  'time -p git push',
  'timeout 5 git push',
  'nice -n 10 git push',
  'builtin git push',
  'if true; then git push; fi',
  'for i in 1; do git push; done',
  '{ git push; }',
  '! git push',
  '& { git push }',
  'bash -lc "git push"',
  'bash -xc "git reset --hard"',
  'cmd /k git push',
  'cmd /c "git push"',
  'powershell "git push"',
  'pwsh -NoProfile -Command "git push"',
  `pwsh -EncodedCommand ${Buffer.from('git push', 'utf16le').toString('base64')}`,
  'eval "git push"',
  'iex "git push"',
  'Invoke-Expression "git push"',
  'Start-Process git -ArgumentList push',
  'git push>out',
  'git push>/dev/null 2>&1',
  'pnpm test 2>&1 && git push',
  'git commit --no-ver -m x',
  'git commit --ame',
  'git reset --har',
  'rm -rf /*',
  'rm -rf .*',
  'rm -rf .git/',
  'rm -rf ./.git',
  'rm -rf .git/hooks',
  'rm -rf $HOME',
  'rm -rf "$HOME"',
  'rm -rf $PWD',
  'rm -rf $env:USERPROFILE',
  'rd -r .',
  'rmdir -Recurse .',
  'del -Recurse .',
  'ri -r -fo .',
  'Remove-Item -Rec .',
  'Remove-Item -Recurse:$true .',
  'del /s /q .',
  'git merge feature',
  'git pull',
  'gh pr create --fill',
  'gh pr merge 5',
  'glab mr create',
  'glab mr merge 5',
  'git reset origin/main',
  // Found in the re-review of the fixes.
  'git restore :/',
  'git restore -- :/',
  'git checkout -- :/',
  'git rm -r :/',
  'git restore :(top)',
  'git restore :',
  'Remove-Item .\\ -Recurse -Force',
  'Remove-Item -Path C:\\ -Recurse',
  'Remove-Item -LiteralPath C:\\ -Recurse',
  'git \\push',
  'g\\it push',
  'git pu\\sh',
  "bash -c 'git \\push'",
  'bash <<< "git push"',
  "bash <<< 'git push'",
  "sh <<< $'git push'",
  'git commit -m "$(cat <<EOF\nfix: $(git push)\nEOF\n)"',
  'git -ccore.hooksPath=/dev/null commit -m x',
  'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/x git commit -m x',
  'pnpm exec lefthook uninstall',
  'lefthook uninstall',
  'HUSKY=0 git commit -m x',
  'env HUSKY=0 git commit -m x',
  'export HUSKY=0',
  '$env:HUSKY=0; git commit -m x',
  '$env:HUSKY = 0; git commit -m x',
  '$env:HUSKY = "0"',
  'setx HUSKY 0',
  'HUSKY_SKIP_HOOKS=1 git commit -m x',
  'SKIP=ruff git commit -m x',
  'env SKIP=eslint,mypy git commit -m x',
  'export SKIP=ruff',
  '$env:SKIP="ruff"; git commit -m x',
  'pre-commit uninstall',
  'uvx pre-commit uninstall',
  'python -m pre_commit uninstall',
  // Writes to GitHub and GitLab besides creating and merging PR/MR.
  'gh pr comment 5 -b x',
  'gh pr review 5 --approve',
  'gh pr close 5',
  'gh pr reopen 5',
  'gh pr edit 5 --add-label bug',
  'gh pr ready 5',
  'gh pr update-branch 5',
  'gh pr --repo o/r comment 5 -b x',
  'gh -R o/r pr comment 5 -b x',
  'gh.exe pr comment 5 -b x',
  'gh issue create -t x -b y',
  'gh issue comment 3 -b x',
  'gh issue close 3',
  'gh issue edit 3 --title x',
  'gh issue develop 3 --checkout',
  'gh release create v1.0.0',
  'gh release upload v1 dist.zip',
  'gh release delete v1 -y',
  'gh repo create o/r --private',
  'gh repo edit --visibility public',
  'gh repo fork',
  'gh repo sync',
  'gh repo deploy-key add key.pub',
  'gh secret set TOKEN',
  'gh variable delete X',
  'gh workflow run ci.yml',
  'gh run rerun 123',
  'gh run cancel 123',
  'gh label create bug',
  'gh label clone o/other',
  'gh gist create a.txt',
  'gh cache delete --all',
  'gh project item-add 1 --url x',
  'gh api -X POST repos/o/r/issues -f title=x',
  'gh api --method=DELETE repos/o/r/git/refs/heads/x',
  'gh api -XPATCH repos/o/r',
  'gh api repos/o/r/issues -f title=x',
  'gh api repos/o/r/issues --input body.json',
  'gh api graphql -f query="mutation { addStar(input: {}) { clientMutationId } }"',
  'gh api graphql -F query=@mutation.graphql',
  'cd sub && gh pr comment 5 -b x',
  'bash -c "gh release create v1"',
  'glab mr note 5 -m x',
  'glab mr approve 5',
  'glab mr close 5',
  'glab mr update 5 --title x',
  'glab mr rebase 5',
  'glab issue create -t x',
  'glab issue note 3 -m x',
  'glab release create v1',
  'glab ci run',
  'glab ci retry 123',
  'glab variable set X y',
  'glab repo fork',
  'glab api -X PUT projects/1',
  'glab api projects/1/issues -f title=x',
  // Aliases, unknown subcommands and option values that look like help (second review).
  'gh pr new --fill',
  'gh issue new',
  'gh repo new o/r',
  'gh release new v1',
  'gh gist new a.txt',
  'gh alias set co "pr checkout"',
  'gh alias import aliases.yml',
  'gh pmerge',
  'gh dash',
  'gh config set editor vim',
  'gh extension install o/gh-x',
  'gh codespace stop',
  'gh skill publish',
  'gh auth token',
  'gh auth status --show-token',
  'gh auth status -t',
  'gh auth token -h github.com',
  'gh issue create --title -h',
  'gh pr comment 5 -b -h',
  'gh pr c\\omment 5 -b x',
  'glab mr new',
  'glab mr accept 5',
  'glab issue del 3',
  'glab repo mirror',
  'glab repo members add',
  'glab token rotate',
  'glab cluster agent bootstrap x',
  'gh api -iXPOST repos/o/r/issues',
  'gh api -ifa=b repos/o/r/issues',
  'gh api -XPOST repos/o/r/issues -f title=x',
  // An option value before the subcommand shifts the word taken for it (re-review).
  'gh pr --body view comment 5',
  'gh pr -b list comment 5',
  'gh issue --title list create',
  'gh issue -t status create --body x',
  'gh pr --body view merge 5',
  'gh run --job view rerun 5',
  'gh repo --visibility view create x',
  'glab mr -m view note 5',
  'glab mr --message list note 5',
  'gh pr comment 5 -b --help',
  'gh --body search pr comment 5',
  'gh -b status pr comment 5',
  'gh --body api pr comment 5',
  'gh --body version issue create',
  'gh --title browse issue create',
  'gh auth status -at',
  'gh auth status -ta',
  'gh auth status -th github.com',
  'glab config get token',
  'gh config get oauth_token -h github.com',
  'git tag --no-sig v1',
  // Checking out a PR or MR switches the branch.
  'gh pr checkout 5',
  'gh pr co 5',
  'gh co 5',
  'gh \\pr checkout 5',
  'glab mr checkout 5',
  'glab mr co 5',
  'glab merge-request checkout 5',
  // Turning off commit signing.
  'git commit --no-gpg-sign -m x',
  'git commit --no-gpg -m x',
  'git rebase --continue --no-gpg-sign',
  'git cherry-pick --no-gpg-sign abc1234',
  'git -c commit.gpgsign=false commit -m x',
  'git -c commit.gpgSign=no commit -m x',
  'git -c tag.gpgsign=false tag -a v1 -m x',
  'git --config-env=commit.gpgsign=SIGN commit -m x',
  'git config commit.gpgsign false',
  'git config --global commit.gpgsign false',
  'git config --unset commit.gpgsign',
  'git config unset commit.gpgsign',
  'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=commit.gpgsign GIT_CONFIG_VALUE_0=false git commit -m x',
  'export GIT_CONFIG_KEY_0=commit.gpgsign',
  `export GIT_CONFIG_PARAMETERS="'commit.gpgsign=false'"`,
  '$env:GIT_CONFIG_KEY_0="commit.gpgsign"',
  '$env:GIT_CONFIG_KEY_0 = "commit.gpgsign"',
  'setx GIT_CONFIG_KEY_0 commit.gpgsign',
  'git --config-env commit.gpgsign=SIGN commit -m x',
  'git --config-env core.hooksPath=HOOKS commit -m x',
  'git config commit.gpgsign ""',
  'git tag --no-sign v1',
  // Package runners start the command they are given (audit of 45c3e02).
  'pnpm exec git push',
  'pnpm dlx git push',
  'pnpm --filter app exec git push',
  'pnpm -C sub exec git push',
  'pnpm git push',
  'pnpm exec gh pr comment 5 -b x',
  'pnpm exec -c "git push && echo done"',
  'pnpm exec --shell-mode "git reset --hard"',
  'npx git push',
  'npx -y git push',
  'npx -c "git push"',
  'npx --call="git push"',
  'pnpx git push',
  'bunx git push',
  'npm exec -- git push',
  'npm x git push',
  'yarn exec git push',
  'yarn dlx git push',
  'SKIP=ruff pnpm exec git commit -m x',
  'cd sub && npx git push',
  'git worktree remove --force ../x',
  'git worktree remove -f ../x',
  'npx --registry https://registry.example git push',
  'npx -w app git push',
  'npm exec --workspace app -- git push',
  'pnpm --store-dir x exec git push',
  'yarn run git push',
  'yarn workspace app exec git push',
  'bun x git push',
  'corepack pnpm exec git push',
  'FOO="a b" npx -c "git push"',
  'pnpm -w exec env X=1 git push',
  'pnpm -w exec timeout 5 git push',
  // uv runs commands of a Python project.
  'uv run git push',
  'uv run --no-sync git push',
  'uv run --locked --no-sync git push',
  'uvx git push',
  'uv tool run git push',
  'uv tool uvx git push',
  'uv --directory sub run git push',
  'uv --directory=sub run git push',
  'uv -q run -- git push',
  'uv run --with requests git push',
  'uv run -w requests git push',
  'uv run -qw requests git push',
  'uv run --python=3.13 git push',
  'uv run -p3.13 git push',
  'uv run -C key=value git push',
  'uvx --from pkg git push',
  'SKIP=ruff uv run git commit -m x',
  'uv run bash -c "git push"',
  'uv run gh pr comment 5 -b x',
  'pnpm uv run git push',
  'uv run -Ckey=value git push',
  'uv run -C=key=value git push',
  'uv run -qp 3.13 git push',
  'uv tool --directory sub run git push',
  'uvx --directory sub git push',
  'uv.exe run git push',
  'uv run --index-url https://pypi.example/simple git push',
  'uv run --exclude-newer 2026-01-01 git push',
  'uv run --python-platform linux git push',
  'uv run --env-file .env git push',
  'uv run --group dev git push',
  'uv run --package app git push',
  'uv run --extra docs git push',
  'uv run --find-links ./wheels git push',
  // A long option of a newer uv may take a value; both readings are checked.
  'uv run --future-option value git push',
  'uvx --future-option value git push',
  'uv run --f1 a --f2 b --f3 c --f4 d --f5 e --f6 f --f7 g --f8 h --f9 i git push',
  'pnpm C:\\tools\\git.exe push',
  'yarn C:\\tools\\git.exe push',
  'uvx pre-commit@latest uninstall',
  'uvx pre-commit==3.7 uninstall',
  'uv r\\un git push',
  'uv tool r\\un git push',
  'pnpm e\\xec git push',
  ...(process.platform === 'win32'
    ? ['rm -rf /c', 'rm -rf /c/', 'rm -rf /c/*', 'rm -rf /d/']
    : []),
]

const allowed = [
  './mvnw verify',
  '.\\mvnw.cmd verify',
  'npm --prefix frontend run build',
  'docker compose config',
  'git status',
  'git status --short',
  'git diff --stat',
  'git log --oneline -5',
  'git log --grep="--no-verify"',
  'git show HEAD~1',
  'git add .',
  'git commit -m "fix: mention git push and reset --hard in the message"',
  "git commit -q -F - <<'EOF'\nfix: x\n\ngit push --force and git reset --hard are only words here\nEOF",
  'git commit -F - <<-EOF\n\tgit push\n\tEOF',
  'git checkout -- pnpm-lock.yaml',
  'git checkout HEAD -- src/a.ts',
  'git restore src/a.ts',
  'git restore --source HEAD~1 -- src/a.ts',
  'git reset HEAD src/main.tsx',
  'git reset src/main.tsx',
  'git reset -- src/a.ts',
  'git reset',
  'git clean -n',
  'git stash list',
  'git stash show -p',
  'git stash apply',
  'git branch -d merged-feature',
  'git branch --show-current',
  'git rebase --abort',
  'git worktree list',
  'echo "git push"',
  "grep -rn 'reset --hard' docs",
  'pnpm test',
  'pnpm exec playwright test --project preview',
  'rm -rf node_modules/.vite',
  'rm -rf "C:/tmp/scratch/dist"',
  'rm file.txt',
  'Remove-Item -Recurse -Force .\\dist',
  'LEFTHOOK_VERBOSE=1 git commit -m x',
  'FOO=bar pnpm test',
  'SKIP=1 pnpm test',
  'SKIP_ENV_VALIDATION=1 pnpm build',
  'export SKIP_X=1',
  'HUSKY_DEBUG=1 git commit -m x',
  'HUSKY=2 git commit -m x',
  'export HUSKY=2',
  '$env:HUSKY = 2',
  'setx HUSKY 1',
  'pre-commit run --all-files',
  'uvx pre-commit install',
  'git -C project config --get core.hooksPath',
  'git config --list',
  'git -C project rev-parse --git-path hooks',
  // Reading from GitHub and GitLab, and local gh/glab settings.
  'gh pr view 5 --comments',
  'gh pr status',
  'gh pr diff 5',
  'gh pr checks 5',
  'gh pr list --search "create in:title"',
  'gh pr comment --help',
  'gh issue view 3',
  'gh issue list -l bug',
  'gh release view v1',
  'gh release list',
  'gh release download v1',
  'gh repo view',
  'gh repo clone o/r',
  'gh repo set-default o/r',
  'gh run view 123 --log',
  'gh run list',
  'gh run watch 123',
  'gh workflow list',
  'gh auth status',
  'gh search prs --author @me',
  'gh label list',
  'gh secret list',
  'gh alias list',
  'gh config get editor',
  'gh extension list',
  'gh status',
  'gh browse -n',
  'gh search issues "is:open"',
  'gh repo license view mit',
  'gh repo gitignore list',
  'gh completion -s bash',
  'gh pr',
  'glab mr',
  'gh -R o/r pr list',
  'gh --repo=o/r pr view 5',
  'gh --version',
  'gh pr --repo=o/r list',
  'gh pr -Ro/r view 5',
  'gh pr comment --help 5 -b x',
  'gh repo read-file README.md',
  'glab mr issues 5',
  'gh auth status -h github.com',
  'gh pr comment 5 -b x --help',
  'gh api repos/o/r/pulls',
  'gh api -X GET search/issues -f q=repo:o/r',
  'gh api --method GET repos/o/r',
  'gh api -i repos/o/r',
  'gh api graphql -f query="query { viewer { login } }"',
  'gh api /graphql -f query="query { viewer { login } }"',
  'gh api https://api.github.com/graphql -f query="query { viewer { login } }"',
  'glab mr view 5',
  'glab mr list',
  'glab mr diff 5',
  'glab issue list',
  'glab ci view',
  'glab ci status',
  'glab api projects/1',
  'glab mr view 5 -R o/r',
  'glab ci trace 123',
  'glab variable get X',
  'glab auth status',
  'pnpm exec eslint .',
  'pnpm exec playwright test --project preview',
  'pnpm exec backlog task list --plain',
  'pnpm exec git status',
  'npx skills add o/r --skill x -a universal -y',
  'npx -y lefthook install',
  'pnpm dlx create-vite app',
  'pnpm test',
  'pnpm start',
  'pnpm add -D zod',
  'npm run build',
  'uv sync --frozen',
  'uv run pytest -q',
  'uv run --locked --no-sync pytest -q',
  'uv run --with pytest-cov pytest',
  'uv run -m pytest',
  'uv run python manage.py check',
  'uv run git status',
  'uvx ruff check',
  'uv tool install ruff',
  'uv pip install ruff',
  'uv run --future-flag pytest',
  'uvx ruff@latest check',
  'uvx ruff[extras]==1 check',
  'uv --version',
  'git worktree remove ../x',
  'git worktree list',
  'git commit -S -m x',
  'git -c commit.gpgsign=true commit -m x',
  'git config commit.gpgsign true',
  'git config --get commit.gpgsign',
  // False positives found in the second review pass.
  "git commit -m 'use `git push` carefully'",
  "pnpm exec backlog task edit 9 --notes 'blocks `git push` and `rm -rf .`'",
  "echo '$(git push)'",
  'git restore --staged .',
  'git clean -n -f',
  'git merge --abort',
  'gh pr view 5',
  'gh pr list',
  'cat <<< hi',
  'echo $((1<<2))',
  'pnpm test 2>&1 | tail -5',
  'git log --format=%H -1 @{u}',
  'node -e "console.log(1)"',
  'git status # git push later',
  "cat <<'EOF' > notes.md\ngit push is documented here\nEOF",
  'echo "$(git rev-parse HEAD)"',
  'Remove-Item -Force file.txt',
  'rm -rf ./dist',
  'rm -rf node_modules/.cache/e2e-preview-4175',
  'command -v git',
  // A deleted or renamed file can still be unstaged (re-review).
  'git reset deleted-file.ts',
  'git reset HEAD path/to/deleted.ts',
  "git commit -F - <<'EOF'\nfix: mention $(git push) literally\nEOF",
  'cat <<< "git push"',
  'Remove-Item -Recurse -Force .\\dist\\assets',
]

// Git exports GIT_DIR, GIT_INDEX_FILE and friends to hooks; inherited by the git commands
// of the reset test, they would initialise and branch in the real repository.
for (const key of Object.keys(process.env)) {
  if (key.startsWith('GIT_')) delete process.env[key]
}

describe('guard-commands', () => {
  for (const command of blocked) {
    it(`blocks ${JSON.stringify(command)}`, () => {
      assert.notEqual(findViolation(command), null)
    })
  }
  for (const command of allowed) {
    it(`allows ${JSON.stringify(command)}`, () => {
      assert.equal(findViolation(command), null)
    })
  }

  it('names the rule that blocks a command', () => {
    const reasons = {
      'gh pr new --fill': /not a known read-only command/,
      'gh co 5': /switches branches/,
      'gh api -iXPOST repos/o/r/issues': /api POST writes to GitHub/,
      'glab api projects/1/issues -f title=x': /api POST writes to GitLab/,
      'gh api graphql -F query=@q.graphql': /graphql with a mutation/,
      'gh auth status -t': /prints a token/,
      'git commit --no-gpg-sign -m x': /commit signing/,
      'export GIT_CONFIG_KEY_0=commit.gpgsign': /commit signing/,
      'git --config-env core.hooksPath=HOOKS commit -m x': /core\.hooksPath/,
    }
    for (const [command, reason] of Object.entries(reasons)) {
      assert.match(findViolation(command) ?? '', reason, command)
    }
  })

  it('answers the hook protocol: exit 2 with a reason, exit 0 otherwise', () => {
    const script = fileURLToPath(new URL('./guard-commands.mjs', import.meta.url))
    const run = (command) =>
      spawnSync(process.execPath, [script], {
        input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }),
        encoding: 'utf8',
      })
    const denied = run('git push')
    assert.equal(denied.status, 2)
    assert.match(denied.stderr, /git push needs an explicit request/)
    assert.equal(run('git status').status, 0)
    assert.equal(
      spawnSync(process.execPath, [script], { input: 'not json', encoding: 'utf8' })
        .status,
      0,
    )
  })

  it('blocks restoring or deleting a directory only when it holds uncommitted work', () => {
    const repo = mkdtempSync(join(tmpdir(), 'guard-commands-'))
    const scratch = mkdtempSync(join(tmpdir(), 'guard-scratch-'))
    // A global commit.gpgsign=true would make the commits below fail silently.
    const gitIn = (cwd, ...args) =>
      spawnSync(
        'git',
        [
          '-c',
          'user.name=t',
          '-c',
          'user.email=t@t',
          '-c',
          'commit.gpgsign=false',
          ...args,
        ],
        { cwd, stdio: 'ignore' },
      )
    const write = (file, text) => {
      mkdirSync(dirname(join(repo, file)), { recursive: true })
      writeFileSync(join(repo, file), text)
    }
    try {
      gitIn(repo, 'init', '-q')
      for (const file of ['src/a.ts', 'src/b.ts', 'docs/x.md']) write(file, 'one\n')
      write('.gitignore', 'dist/\nproject/\nworktrees/\n')
      gitIn(repo, 'add', '.')
      gitIn(repo, 'commit', '-q', '-m', 'init')
      write('src/a.ts', 'changed\n')
      write('new/n.ts', 'untracked\n')
      write('dist/out.js', 'ignored\n')
      // An ignored nested repository (like project/ of the adoption prompt) with its own work.
      write('project/src/p.ts', 'one\n')
      gitIn(join(repo, 'project'), 'init', '-q')
      gitIn(join(repo, 'project'), 'add', '.')
      gitIn(join(repo, 'project'), 'commit', '-q', '-m', 'init')
      write('project/src/p.ts', 'changed\n')
      // An ignored directory with a repository of its own, like a worktree under .claude/.
      write('worktrees/wt1/wip.txt', 'untracked\n')
      gitIn(join(repo, 'worktrees/wt1'), 'init', '-q')
      // A repository three levels down in otherwise clean, ignored-free directories.
      write('deep/a/b/.gitkeep', '')
      gitIn(join(repo, 'deep/a/b'), 'init', '-q')
      gitIn(repo, 'add', 'deep')
      gitIn(repo, 'commit', '-q', '-m', 'deep')
      gitIn(scratch, 'init', '-q')
      writeFileSync(join(scratch, 'tmp.txt'), 'untracked\n')
      // Git Bash spells C:\Users\... as /c/Users/...
      const msysRepo = repo
        .replace(/\\/g, '/')
        .replace(/^([a-z]):/i, (_, drive) => `/${drive.toLowerCase()}`)

      for (const command of [
        'git checkout -- src',
        'git checkout HEAD -- src/',
        'git restore src',
        'git restore --worktree --staged src',
        "git restore '*.ts'",
        "git restore ':/src'",
        "git restore ':(top)src'",
        'rm -rf src',
        'rm -r new',
        'rm -Recurse new',
        'Remove-Item -Recurse -Force new',
        'Remove-Item -Recurse -Force docs,new',
        'rm -rf ../does-not-exist src',
        'git rm -rf src',
        'pnpm exec git restore src',
        'rm -rf project/src',
        'git -C project restore src',
        'git -C project checkout -- src',
        'cd project && rm -rf src',
        'pnpm --dir project exec git restore src',
        'uv --directory project run git restore src',
        // For uv `-C` is --config-setting and `--project` only finds the project, so the
        // command runs here, not in docs/.
        'uv run -C docs git restore src',
        'uv --project docs run git restore src',
        'uv run --future-option x --directory project git restore src',
        'rm -rf worktrees/wt1',
        'rm -rf worktrees',
        'rm -rf deep',
        'rm -rf project',
        `rm -rf "${repo}"`,
        'cd $DIR && rm -rf src',
        'cd src && cd - && rm -rf new',
        'pushd docs; popd; rm -rf new',
        'rm -rP new',
        'rm --recurs new',
        ...(process.platform === 'win32' ? [`rm -rf ${msysRepo}/new`] : []),
      ]) {
        assert.notEqual(findViolation(command, repo), null, command)
      }
      for (const command of [
        'git checkout -- src/a.ts',
        'git restore src/a.ts',
        'git restore docs',
        'git restore --staged src',
        'rm -rf dist',
        'rm -rf docs',
        'rm new/n.ts',
        'rm -Force new/n.ts',
        'rm -Verbose -ErrorAction SilentlyContinue new/n.ts',
        'git rm -r docs',
        'git rm -rf --cached src',
        'cd docs && rm -rf ../dist',
        'uv --directory docs run git restore src',
        // A throwaway repository in the temporary directory, outside the session's tree.
        `rm -rf "${scratch}"`,
      ]) {
        assert.equal(findViolation(command, repo), null, command)
      }

      // The hook takes the directory from the `cwd` field of its input.
      const script = fileURLToPath(new URL('./guard-commands.mjs', import.meta.url))
      const hook = spawnSync(process.execPath, [script], {
        input: JSON.stringify({
          tool_name: 'Bash',
          tool_input: { command: 'rm -rf new' },
          cwd: repo,
        }),
        encoding: 'utf8',
      })
      assert.equal(hook.status, 2)
      assert.match(hook.stderr, /uncommitted or untracked files/)
    } finally {
      rmSync(repo, { recursive: true, force: true })
      rmSync(scratch, { recursive: true, force: true })
    }
  })

  it('asks the repository whether a git reset argument is a branch or a file', () => {
    // A throwaway repository, so the check does not depend on the branches of the checkout
    // (CI often has a detached HEAD without a local main).
    const repo = mkdtempSync(join(tmpdir(), 'guard-commands-'))
    const git = (...args) =>
      spawnSync(
        'git',
        [
          '-c',
          'user.name=t',
          '-c',
          'user.email=t@t',
          '-c',
          'commit.gpgsign=false',
          ...args,
        ],
        { cwd: repo, stdio: 'ignore' },
      )
    const previous = process.env.CLAUDE_PROJECT_DIR
    try {
      git('init', '-q')
      git('commit', '-q', '--allow-empty', '-m', 'init')
      git('branch', 'feature')
      process.env.CLAUDE_PROJECT_DIR = repo
      assert.notEqual(findViolation('git reset feature'), null)
      assert.equal(findViolation('git reset removed-file.ts'), null)
    } finally {
      if (previous === undefined) delete process.env.CLAUDE_PROJECT_DIR
      else process.env.CLAUDE_PROJECT_DIR = previous
      rmSync(repo, { recursive: true, force: true })
    }
  })
})
