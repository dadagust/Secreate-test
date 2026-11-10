# Сверка снимка

Источник: INVENTORY.md, снимок 45c98382. Исторические проектные данные и Fly не перенесены. Serena/MCP необязательны. Команды приложения подключаются после появления манифестов.

| Источник | Результат | Решение | Проверка |
| --- | --- | --- | --- |
| `.gitattributes` | `.gitattributes` | перенесён и адаптирован | наличие, check:agents |
| `.gitignore` | `.gitignore` | перенесён и адаптирован | наличие, check:agents |
| `.mcp.json` | — | Fly или настройки RSA исключены; Serena/MCP опциональны | осмотр дерева |
| `ADAPT_PROMPT.md` | `ADAPT_PROMPT.md` | перенесён и адаптирован | наличие, check:agents |
| `AGENTS.md` | `AGENTS.md` | перенесён и адаптирован | наличие, check:agents |
| `CLAUDE.md` | `CLAUDE.md` | перенесён и адаптирован | наличие, check:agents |
| `lefthook.yml` | `lefthook.yml` | перенесён и адаптирован | наличие, check:agents |
| `package-lock.json` | `package-lock.json` | пересобран npm | npm ci |
| `package.json` | `package.json` | перенесён и адаптирован | наличие, check:agents |
| `PROGRESS.md` | `PROGRESS.md` | перенесён и адаптирован | наличие, check:agents |
| `PROJECT_OVERVIEW.html` | `PROJECT_OVERVIEW.html` | сгенерирован из текущего обзора | npm run overview:check |
| `PROJECT_OVERVIEW.md` | `PROJECT_OVERVIEW.md` | перенесён и адаптирован | наличие, check:agents |
| `README-TEMPLATE.md` | `README.md` | объединён в нейтральный README | осмотр |
| `skills-lock.json` | `skills-lock.json` | перенесён и адаптирован | наличие, check:agents |
| `SPEC.md` | — | историческая спецификация исключена | осмотр дерева |
| `START_PROMPT.md` | `START_PROMPT.md` | универсальный вход | осмотр с произвольным путём |
| `.agents/skills/code-review/SKILL.md` | `.agents/skills/code-review/SKILL.md` | сохранён, адаптирован при необходимости | npm run skills:check |
| `.agents/skills/code-review/agents/openai.yaml` | `.agents/skills/code-review/agents/openai.yaml` | сохранён, адаптирован при необходимости | npm run skills:check |
| `.agents/skills/codebase-design/DEEPENING.md` | `.agents/skills/codebase-design/DEEPENING.md` | сохранён, адаптирован при необходимости | npm run skills:check |
| `.agents/skills/codebase-design/DESIGN-IT-TWICE.md` | `.agents/skills/codebase-design/DESIGN-IT-TWICE.md` | сохранён, адаптирован при необходимости | npm run skills:check |
| `.agents/skills/codebase-design/SKILL.md` | `.agents/skills/codebase-design/SKILL.md` | сохранён, адаптирован при необходимости | npm run skills:check |
| `.agents/skills/codebase-design/agents/openai.yaml` | `.agents/skills/codebase-design/agents/openai.yaml` | сохранён, адаптирован при необходимости | npm run skills:check |
| `.agents/skills/context7-cli/SKILL.md` | `.agents/skills/context7-cli/SKILL.md` | сохранён, адаптирован при необходимости | npm run skills:check |
| `.agents/skills/context7-cli/references/docs.md` | `.agents/skills/context7-cli/references/docs.md` | сохранён, адаптирован при необходимости | npm run skills:check |
| `.agents/skills/context7-cli/references/setup.md` | `.agents/skills/context7-cli/references/setup.md` | сохранён, адаптирован при необходимости | npm run skills:check |
| `.agents/skills/context7-cli/references/skills.md` | `.agents/skills/context7-cli/references/skills.md` | сохранён, адаптирован при необходимости | npm run skills:check |
| `.agents/skills/documentation-and-adrs/SKILL.md` | `.agents/skills/documentation-and-adrs/SKILL.md` | сохранён, адаптирован при необходимости | npm run skills:check |
| `.agents/skills/executing-plans/SKILL.md` | `.agents/skills/executing-plans/SKILL.md` | сохранён, адаптирован при необходимости | npm run skills:check |
| `.agents/skills/find-skills/SKILL.md` | `.agents/skills/find-skills/SKILL.md` | сохранён, адаптирован при необходимости | npm run skills:check |
| `.agents/skills/frontend-design/LICENSE.txt` | `.agents/skills/frontend-design/LICENSE.txt` | сохранён, адаптирован при необходимости | npm run skills:check |
| `.agents/skills/frontend-design/SKILL.md` | `.agents/skills/frontend-design/SKILL.md` | сохранён, адаптирован при необходимости | npm run skills:check |
| `.agents/skills/git-workflow-and-versioning/SKILL.md` | `.agents/skills/git-workflow-and-versioning/SKILL.md` | сохранён, адаптирован при необходимости | npm run skills:check |
| `.agents/skills/handoff/SKILL.md` | `.agents/skills/handoff/SKILL.md` | сохранён, адаптирован при необходимости | npm run skills:check |
| `.agents/skills/handoff/agents/openai.yaml` | `.agents/skills/handoff/agents/openai.yaml` | сохранён, адаптирован при необходимости | npm run skills:check |
| `.agents/skills/improve-codebase-architecture/HTML-REPORT.md` | `.agents/skills/improve-codebase-architecture/HTML-REPORT.md` | сохранён, адаптирован при необходимости | npm run skills:check |
| `.agents/skills/improve-codebase-architecture/SKILL.md` | `.agents/skills/improve-codebase-architecture/SKILL.md` | сохранён, адаптирован при необходимости | npm run skills:check |
| `.agents/skills/improve-codebase-architecture/agents/openai.yaml` | `.agents/skills/improve-codebase-architecture/agents/openai.yaml` | сохранён, адаптирован при необходимости | npm run skills:check |
| `.agents/skills/systematic-debugging/condition-based-waiting-example.ts` | `.agents/skills/systematic-debugging/condition-based-waiting-example.ts` | сохранён, адаптирован при необходимости | npm run skills:check |
| `.agents/skills/systematic-debugging/condition-based-waiting.md` | `.agents/skills/systematic-debugging/condition-based-waiting.md` | сохранён, адаптирован при необходимости | npm run skills:check |
| `.agents/skills/systematic-debugging/CREATION-LOG.md` | `.agents/skills/systematic-debugging/CREATION-LOG.md` | сохранён, адаптирован при необходимости | npm run skills:check |
| `.agents/skills/systematic-debugging/defense-in-depth.md` | `.agents/skills/systematic-debugging/defense-in-depth.md` | сохранён, адаптирован при необходимости | npm run skills:check |
| `.agents/skills/systematic-debugging/find-polluter.sh` | `.agents/skills/systematic-debugging/find-polluter.sh` | сохранён, адаптирован при необходимости | npm run skills:check |
| `.agents/skills/systematic-debugging/root-cause-tracing.md` | `.agents/skills/systematic-debugging/root-cause-tracing.md` | сохранён, адаптирован при необходимости | npm run skills:check |
| `.agents/skills/systematic-debugging/SKILL.md` | `.agents/skills/systematic-debugging/SKILL.md` | сохранён, адаптирован при необходимости | npm run skills:check |
| `.agents/skills/systematic-debugging/test-academic.md` | `.agents/skills/systematic-debugging/test-academic.md` | сохранён, адаптирован при необходимости | npm run skills:check |
| `.agents/skills/systematic-debugging/test-pressure-1.md` | `.agents/skills/systematic-debugging/test-pressure-1.md` | сохранён, адаптирован при необходимости | npm run skills:check |
| `.agents/skills/systematic-debugging/test-pressure-2.md` | `.agents/skills/systematic-debugging/test-pressure-2.md` | сохранён, адаптирован при необходимости | npm run skills:check |
| `.agents/skills/systematic-debugging/test-pressure-3.md` | `.agents/skills/systematic-debugging/test-pressure-3.md` | сохранён, адаптирован при необходимости | npm run skills:check |
| `.agents/skills/test-driven-development/SKILL.md` | `.agents/skills/test-driven-development/SKILL.md` | сохранён, адаптирован при необходимости | npm run skills:check |
| `.agents/skills/test-driven-development/writing-good-tests.md` | `.agents/skills/test-driven-development/writing-good-tests.md` | сохранён, адаптирован при необходимости | npm run skills:check |
| `.agents/skills/vercel-composition-patterns/AGENTS.md` | `.agents/skills/vercel-composition-patterns/AGENTS.md` | сохранён, адаптирован при необходимости | npm run skills:check |
| `.agents/skills/vercel-composition-patterns/README.md` | `.agents/skills/vercel-composition-patterns/README.md` | сохранён, адаптирован при необходимости | npm run skills:check |
| `.agents/skills/vercel-composition-patterns/SKILL.md` | `.agents/skills/vercel-composition-patterns/SKILL.md` | сохранён, адаптирован при необходимости | npm run skills:check |
| `.agents/skills/vercel-composition-patterns/rules/architecture-avoid-boolean-props.md` | `.agents/skills/vercel-composition-patterns/rules/architecture-avoid-boolean-props.md` | сохранён, адаптирован при необходимости | npm run skills:check |
| `.agents/skills/vercel-composition-patterns/rules/architecture-compound-components.md` | `.agents/skills/vercel-composition-patterns/rules/architecture-compound-components.md` | сохранён, адаптирован при необходимости | npm run skills:check |
| `.agents/skills/vercel-composition-patterns/rules/patterns-children-over-render-props.md` | `.agents/skills/vercel-composition-patterns/rules/patterns-children-over-render-props.md` | сохранён, адаптирован при необходимости | npm run skills:check |
| `.agents/skills/vercel-composition-patterns/rules/patterns-explicit-variants.md` | `.agents/skills/vercel-composition-patterns/rules/patterns-explicit-variants.md` | сохранён, адаптирован при необходимости | npm run skills:check |
| `.agents/skills/vercel-composition-patterns/rules/react19-no-forwardref.md` | `.agents/skills/vercel-composition-patterns/rules/react19-no-forwardref.md` | сохранён, адаптирован при необходимости | npm run skills:check |
| `.agents/skills/vercel-composition-patterns/rules/state-context-interface.md` | `.agents/skills/vercel-composition-patterns/rules/state-context-interface.md` | сохранён, адаптирован при необходимости | npm run skills:check |
| `.agents/skills/vercel-composition-patterns/rules/state-decouple-implementation.md` | `.agents/skills/vercel-composition-patterns/rules/state-decouple-implementation.md` | сохранён, адаптирован при необходимости | npm run skills:check |
| `.agents/skills/vercel-composition-patterns/rules/state-lift-state.md` | `.agents/skills/vercel-composition-patterns/rules/state-lift-state.md` | сохранён, адаптирован при необходимости | npm run skills:check |
| `.agents/skills/vercel-composition-patterns/rules/_sections.md` | `.agents/skills/vercel-composition-patterns/rules/_sections.md` | сохранён, адаптирован при необходимости | npm run skills:check |
| `.agents/skills/vercel-composition-patterns/rules/_template.md` | `.agents/skills/vercel-composition-patterns/rules/_template.md` | сохранён, адаптирован при необходимости | npm run skills:check |
| `.agents/skills/verification-before-completion/SKILL.md` | `.agents/skills/verification-before-completion/SKILL.md` | сохранён, адаптирован при необходимости | npm run skills:check |
| `.agents/skills/web-design-guidelines/SKILL.md` | `.agents/skills/web-design-guidelines/SKILL.md` | сохранён, адаптирован при необходимости | npm run skills:check |
| `.agents/skills/writing-plans/plan-document-reviewer-prompt.md` | `.agents/skills/writing-plans/plan-document-reviewer-prompt.md` | сохранён, адаптирован при необходимости | npm run skills:check |
| `.agents/skills/writing-plans/SKILL.md` | `.agents/skills/writing-plans/SKILL.md` | сохранён, адаптирован при необходимости | npm run skills:check |
| `.claude/settings.json` | `.claude/settings.json` | перенесён и адаптирован | наличие, check:agents |
| `.claude/agents/reviewer.md` | `.claude/agents/reviewer.md` | перенесён и адаптирован | наличие, check:agents |
| `.claude/agents/verifier.md` | `.claude/agents/verifier.md` | перенесён и адаптирован | наличие, check:agents |
| `.claude/hooks/codex-hooks.test.mjs` | `.claude/hooks/codex-hooks.test.mjs` | перенесён и адаптирован | npm run test:tools |
| `.claude/hooks/context-recovery.mjs` | `.claude/hooks/context-recovery.mjs` | перенесён и адаптирован | npm run test:tools |
| `.claude/hooks/guard-commands.mjs` | `.claude/hooks/guard-commands.mjs` | перенесён и адаптирован | npm run test:tools |
| `.claude/hooks/guard-commands.test.mjs` | `.claude/hooks/guard-commands.test.mjs` | перенесён и адаптирован | npm run test:tools |
| `.claude/hooks/serena-hook.mjs` | `.claude/hooks/serena-hook.mjs` | перенесён и адаптирован | npm run test:tools |
| `.claude/skills/code-review/SKILL.md` | `.claude/skills/code-review/SKILL.md` | зеркало из .agents/skills | npm run skills:check |
| `.claude/skills/code-review/agents/openai.yaml` | `.claude/skills/code-review/agents/openai.yaml` | зеркало из .agents/skills | npm run skills:check |
| `.claude/skills/codebase-design/DEEPENING.md` | `.claude/skills/codebase-design/DEEPENING.md` | зеркало из .agents/skills | npm run skills:check |
| `.claude/skills/codebase-design/DESIGN-IT-TWICE.md` | `.claude/skills/codebase-design/DESIGN-IT-TWICE.md` | зеркало из .agents/skills | npm run skills:check |
| `.claude/skills/codebase-design/SKILL.md` | `.claude/skills/codebase-design/SKILL.md` | зеркало из .agents/skills | npm run skills:check |
| `.claude/skills/codebase-design/agents/openai.yaml` | `.claude/skills/codebase-design/agents/openai.yaml` | зеркало из .agents/skills | npm run skills:check |
| `.claude/skills/context7-cli/SKILL.md` | `.claude/skills/context7-cli/SKILL.md` | зеркало из .agents/skills | npm run skills:check |
| `.claude/skills/context7-cli/references/docs.md` | `.claude/skills/context7-cli/references/docs.md` | зеркало из .agents/skills | npm run skills:check |
| `.claude/skills/context7-cli/references/setup.md` | `.claude/skills/context7-cli/references/setup.md` | зеркало из .agents/skills | npm run skills:check |
| `.claude/skills/context7-cli/references/skills.md` | `.claude/skills/context7-cli/references/skills.md` | зеркало из .agents/skills | npm run skills:check |
| `.claude/skills/documentation-and-adrs/SKILL.md` | `.claude/skills/documentation-and-adrs/SKILL.md` | зеркало из .agents/skills | npm run skills:check |
| `.claude/skills/executing-plans/SKILL.md` | `.claude/skills/executing-plans/SKILL.md` | зеркало из .agents/skills | npm run skills:check |
| `.claude/skills/find-skills/SKILL.md` | `.claude/skills/find-skills/SKILL.md` | зеркало из .agents/skills | npm run skills:check |
| `.claude/skills/frontend-design/LICENSE.txt` | `.claude/skills/frontend-design/LICENSE.txt` | зеркало из .agents/skills | npm run skills:check |
| `.claude/skills/frontend-design/SKILL.md` | `.claude/skills/frontend-design/SKILL.md` | зеркало из .agents/skills | npm run skills:check |
| `.claude/skills/git-workflow-and-versioning/SKILL.md` | `.claude/skills/git-workflow-and-versioning/SKILL.md` | зеркало из .agents/skills | npm run skills:check |
| `.claude/skills/handoff/SKILL.md` | `.claude/skills/handoff/SKILL.md` | зеркало из .agents/skills | npm run skills:check |
| `.claude/skills/handoff/agents/openai.yaml` | `.claude/skills/handoff/agents/openai.yaml` | зеркало из .agents/skills | npm run skills:check |
| `.claude/skills/improve-codebase-architecture/HTML-REPORT.md` | `.claude/skills/improve-codebase-architecture/HTML-REPORT.md` | зеркало из .agents/skills | npm run skills:check |
| `.claude/skills/improve-codebase-architecture/SKILL.md` | `.claude/skills/improve-codebase-architecture/SKILL.md` | зеркало из .agents/skills | npm run skills:check |
| `.claude/skills/improve-codebase-architecture/agents/openai.yaml` | `.claude/skills/improve-codebase-architecture/agents/openai.yaml` | зеркало из .agents/skills | npm run skills:check |
| `.claude/skills/systematic-debugging/condition-based-waiting-example.ts` | `.claude/skills/systematic-debugging/condition-based-waiting-example.ts` | зеркало из .agents/skills | npm run skills:check |
| `.claude/skills/systematic-debugging/condition-based-waiting.md` | `.claude/skills/systematic-debugging/condition-based-waiting.md` | зеркало из .agents/skills | npm run skills:check |
| `.claude/skills/systematic-debugging/CREATION-LOG.md` | `.claude/skills/systematic-debugging/CREATION-LOG.md` | зеркало из .agents/skills | npm run skills:check |
| `.claude/skills/systematic-debugging/defense-in-depth.md` | `.claude/skills/systematic-debugging/defense-in-depth.md` | зеркало из .agents/skills | npm run skills:check |
| `.claude/skills/systematic-debugging/find-polluter.sh` | `.claude/skills/systematic-debugging/find-polluter.sh` | зеркало из .agents/skills | npm run skills:check |
| `.claude/skills/systematic-debugging/root-cause-tracing.md` | `.claude/skills/systematic-debugging/root-cause-tracing.md` | зеркало из .agents/skills | npm run skills:check |
| `.claude/skills/systematic-debugging/SKILL.md` | `.claude/skills/systematic-debugging/SKILL.md` | зеркало из .agents/skills | npm run skills:check |
| `.claude/skills/systematic-debugging/test-academic.md` | `.claude/skills/systematic-debugging/test-academic.md` | зеркало из .agents/skills | npm run skills:check |
| `.claude/skills/systematic-debugging/test-pressure-1.md` | `.claude/skills/systematic-debugging/test-pressure-1.md` | зеркало из .agents/skills | npm run skills:check |
| `.claude/skills/systematic-debugging/test-pressure-2.md` | `.claude/skills/systematic-debugging/test-pressure-2.md` | зеркало из .agents/skills | npm run skills:check |
| `.claude/skills/systematic-debugging/test-pressure-3.md` | `.claude/skills/systematic-debugging/test-pressure-3.md` | зеркало из .agents/skills | npm run skills:check |
| `.claude/skills/test-driven-development/SKILL.md` | `.claude/skills/test-driven-development/SKILL.md` | зеркало из .agents/skills | npm run skills:check |
| `.claude/skills/test-driven-development/writing-good-tests.md` | `.claude/skills/test-driven-development/writing-good-tests.md` | зеркало из .agents/skills | npm run skills:check |
| `.claude/skills/vercel-composition-patterns/AGENTS.md` | `.claude/skills/vercel-composition-patterns/AGENTS.md` | зеркало из .agents/skills | npm run skills:check |
| `.claude/skills/vercel-composition-patterns/README.md` | `.claude/skills/vercel-composition-patterns/README.md` | зеркало из .agents/skills | npm run skills:check |
| `.claude/skills/vercel-composition-patterns/SKILL.md` | `.claude/skills/vercel-composition-patterns/SKILL.md` | зеркало из .agents/skills | npm run skills:check |
| `.claude/skills/vercel-composition-patterns/rules/architecture-avoid-boolean-props.md` | `.claude/skills/vercel-composition-patterns/rules/architecture-avoid-boolean-props.md` | зеркало из .agents/skills | npm run skills:check |
| `.claude/skills/vercel-composition-patterns/rules/architecture-compound-components.md` | `.claude/skills/vercel-composition-patterns/rules/architecture-compound-components.md` | зеркало из .agents/skills | npm run skills:check |
| `.claude/skills/vercel-composition-patterns/rules/patterns-children-over-render-props.md` | `.claude/skills/vercel-composition-patterns/rules/patterns-children-over-render-props.md` | зеркало из .agents/skills | npm run skills:check |
| `.claude/skills/vercel-composition-patterns/rules/patterns-explicit-variants.md` | `.claude/skills/vercel-composition-patterns/rules/patterns-explicit-variants.md` | зеркало из .agents/skills | npm run skills:check |
| `.claude/skills/vercel-composition-patterns/rules/react19-no-forwardref.md` | `.claude/skills/vercel-composition-patterns/rules/react19-no-forwardref.md` | зеркало из .agents/skills | npm run skills:check |
| `.claude/skills/vercel-composition-patterns/rules/state-context-interface.md` | `.claude/skills/vercel-composition-patterns/rules/state-context-interface.md` | зеркало из .agents/skills | npm run skills:check |
| `.claude/skills/vercel-composition-patterns/rules/state-decouple-implementation.md` | `.claude/skills/vercel-composition-patterns/rules/state-decouple-implementation.md` | зеркало из .agents/skills | npm run skills:check |
| `.claude/skills/vercel-composition-patterns/rules/state-lift-state.md` | `.claude/skills/vercel-composition-patterns/rules/state-lift-state.md` | зеркало из .agents/skills | npm run skills:check |
| `.claude/skills/vercel-composition-patterns/rules/_sections.md` | `.claude/skills/vercel-composition-patterns/rules/_sections.md` | зеркало из .agents/skills | npm run skills:check |
| `.claude/skills/vercel-composition-patterns/rules/_template.md` | `.claude/skills/vercel-composition-patterns/rules/_template.md` | зеркало из .agents/skills | npm run skills:check |
| `.claude/skills/verification-before-completion/SKILL.md` | `.claude/skills/verification-before-completion/SKILL.md` | зеркало из .agents/skills | npm run skills:check |
| `.claude/skills/web-design-guidelines/SKILL.md` | `.claude/skills/web-design-guidelines/SKILL.md` | зеркало из .agents/skills | npm run skills:check |
| `.claude/skills/writing-plans/plan-document-reviewer-prompt.md` | `.claude/skills/writing-plans/plan-document-reviewer-prompt.md` | зеркало из .agents/skills | npm run skills:check |
| `.claude/skills/writing-plans/SKILL.md` | `.claude/skills/writing-plans/SKILL.md` | зеркало из .agents/skills | npm run skills:check |
| `.codex/hooks.json` | `.codex/hooks.json` | перенесён и адаптирован | наличие, check:agents |
| `.github/workflows/fly-deploy.yml` | — | Fly или настройки RSA исключены; Serena/MCP опциональны | осмотр дерева |
| `.serena/.gitignore` | — | Fly или настройки RSA исключены; Serena/MCP опциональны | осмотр дерева |
| `.serena/project.yml` | — | Fly или настройки RSA исключены; Serena/MCP опциональны | осмотр дерева |
| `backend/AGENTS.md` | `backend/AGENTS.md` | перенесён и адаптирован | наличие, check:agents |
| `backend/CLAUDE.md` | `backend/CLAUDE.md` | перенесён и адаптирован | наличие, check:agents |
| `backlog/config.yml` | `backlog/config.yml` | перенесён и адаптирован | наличие, check:agents |
| `backlog/tasks/.gitkeep` | `backlog/tasks/.gitkeep` | перенесён и адаптирован | наличие, check:agents |
| `backlog/tasks/task-001 - ╨Æ╨╜╨╡╨┤╤Ç╨╕╤é╤î-╨░╨│╨╡╨╜╤é╨╜╤ï╨╣-╤ü╨╗╨╛╨╣.md` | — | историческая задача исключена | пустой backlog/tasks |
| `backlog/tasks/task-002 - Документация-проекта-аудит-агентного-слоя-и-HTML-обзор.md` | — | историческая задача исключена | пустой backlog/tasks |
| `docs/index.md` | `docs/index.md` | перенесён и адаптирован | наличие, check:agents |
| `docs/.vitepress/config.ts` | `docs/.vitepress/config.ts` | перенесён и адаптирован | наличие, check:agents |
| `docs/adr/0001-agent-workflow.md` | `docs/adr/0001-agent-workflow.md` | перенесён и адаптирован | наличие, check:agents |
| `docs/adr/README.md` | `docs/adr/README.md` | перенесён и адаптирован | наличие, check:agents |
| `docs/agents/backend.md` | `docs/agents/backend.md` | перенесён и адаптирован | наличие, check:agents |
| `docs/agents/context-recovery.md` | `docs/agents/context-recovery.md` | перенесён и адаптирован | наличие, check:agents |
| `docs/agents/frontend.md` | `docs/agents/frontend.md` | перенесён и адаптирован | наличие, check:agents |
| `docs/agents/index.md` | `docs/agents/index.md` | перенесён и адаптирован | наличие, check:agents |
| `docs/agents/progress.md` | `docs/agents/progress.md` | перенесён и адаптирован | наличие, check:agents |
| `docs/agents/rules.md` | `docs/agents/rules.md` | перенесён и адаптирован | наличие, check:agents |
| `docs/agents/task-workflow.md` | `docs/agents/task-workflow.md` | перенесён и адаптирован | наличие, check:agents |
| `docs/agents/tooling.md` | `docs/agents/tooling.md` | перенесён и адаптирован | наличие, check:agents |
| `docs/project/api.md` | `docs/project/api.md` | нейтральная заготовка | npm run docs:build |
| `docs/project/architecture.md` | `docs/project/architecture.md` | нейтральная заготовка | npm run docs:build |
| `docs/project/auth-and-security.md` | `docs/project/auth-and-security.md` | нейтральная заготовка | npm run docs:build |
| `docs/project/configuration.md` | `docs/project/configuration.md` | нейтральная заготовка | npm run docs:build |
| `docs/project/conventions.md` | `docs/project/conventions.md` | нейтральная заготовка | npm run docs:build |
| `docs/project/data-model.md` | `docs/project/data-model.md` | нейтральная заготовка | npm run docs:build |
| `docs/project/deployment.md` | `docs/project/deployment.md` | нейтральная заготовка | npm run docs:build |
| `docs/project/frontend.md` | `docs/project/frontend.md` | нейтральная заготовка | npm run docs:build |
| `docs/project/integrations.md` | `docs/project/integrations.md` | нейтральная заготовка | npm run docs:build |
| `docs/project/overview.md` | `docs/project/overview.md` | нейтральная заготовка | npm run docs:build |
| `docs/project/quality-checks.md` | `docs/project/quality-checks.md` | нейтральная заготовка | npm run docs:build |
| `docs/project/testing.md` | `docs/project/testing.md` | нейтральная заготовка | npm run docs:build |
| `frontend/AGENTS.md` | `frontend/AGENTS.md` | перенесён и адаптирован | наличие, check:agents |
| `prompts/adapt-agent-layer.md` | `prompts/adapt-agent-layer.md` | перенесён и адаптирован | осмотр ссылок и текста |
| `prompts/audit-after-changes.md` | `prompts/audit-after-changes.md` | перенесён и адаптирован | осмотр ссылок и текста |
| `prompts/audit-project.md` | `prompts/audit-project.md` | перенесён и адаптирован | осмотр ссылок и текста |
| `prompts/collect-docs.md` | `prompts/collect-docs.md` | перенесён и адаптирован | осмотр ссылок и текста |
| `prompts/continue-task.md` | `prompts/continue-task.md` | перенесён и адаптирован | осмотр ссылок и текста |
| `prompts/deep-research.md` | `prompts/deep-research.md` | перенесён и адаптирован | осмотр ссылок и текста |
| `prompts/dependency-upgrade.md` | `prompts/dependency-upgrade.md` | перенесён и адаптирован | осмотр ссылок и текста |
| `prompts/docs-prompt-generator.md` | `prompts/docs-prompt-generator.md` | перенесён и адаптирован | осмотр ссылок и текста |
| `prompts/handoff-compact.md` | `prompts/handoff-compact.md` | перенесён и адаптирован | осмотр ссылок и текста |
| `prompts/handoff-full.md` | `prompts/handoff-full.md` | перенесён и адаптирован | осмотр ссылок и текста |
| `prompts/implementation-plan.md` | `prompts/implementation-plan.md` | перенесён и адаптирован | осмотр ссылок и текста |
| `prompts/investigate-bug.md` | `prompts/investigate-bug.md` | перенесён и адаптирован | осмотр ссылок и текста |
| `prompts/README.md` | `prompts/README.md` | перенесён и адаптирован | осмотр ссылок и текста |
| `prompts/review-implementation.md` | `prompts/review-implementation.md` | перенесён и адаптирован | осмотр ссылок и текста |
| `scripts/agent-instructions.test.mjs` | `scripts/agent-instructions.test.mjs` | перенесён и адаптирован | наличие, check:agents |
| `scripts/generate-project-overview.mjs` | `scripts/generate-project-overview.mjs` | перенесён и адаптирован | наличие, check:agents |
| `scripts/sync-agent-skills.mjs` | `scripts/sync-agent-skills.mjs` | перенесён и адаптирован | наличие, check:agents |
