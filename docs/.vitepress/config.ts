import { defineConfig } from 'vitepress'

// Root files such as AGENTS.md are included into pages and link to `docs/...` or to other
// root files from the repository root; package AGENTS.md files link to the root one as
// `../AGENTS.md`. On the site these links must point to the matching page.
const repositoryDocsPrefix = 'docs/'
const includedRootFiles: Record<string, string> = {
  'AGENTS.md': '/agents/rules',
  '../AGENTS.md': '/agents/rules',
  'backend/AGENTS.md': '/agents/backend',
  'frontend/AGENTS.md': '/agents/frontend',
  'PROGRESS.md': '/agents/progress',
  'PROJECT_OVERVIEW.md': '/project/overview',
}

export default defineConfig({
  lang: 'ru-RU',
  title: 'Secreate-test',
  description: 'Документация Secreate-test для людей и coding-агентов',
  cleanUrls: true,
  rewrites: {
    'adr/README.md': 'adr/index.md',
  },
  markdown: {
    config(md) {
      md.core.ruler.push('repository-docs-links', (state) => {
        for (const blockToken of state.tokens) {
          for (const token of blockToken.children ?? []) {
            const href = token.type === 'link_open' ? token.attrGet('href') : null
            if (href?.startsWith(repositoryDocsPrefix)) {
              const sitePath = href.slice(repositoryDocsPrefix.length)
              // README.md pages are published as the folder index (see `rewrites`).
              token.attrSet('href', `/${sitePath.replace(/(^|\/)README\.md$/, '$1')}`)
            } else if (href && href in includedRootFiles) {
              token.attrSet('href', includedRootFiles[href])
            }
          }
        }
      })
    },
  },
  themeConfig: {
    nav: [
      { text: 'Проект', link: '/project/overview' },
      { text: 'Агенты', link: '/agents/' },
      { text: 'ADR', link: '/adr/' },
    ],
    sidebar: [
      {
        text: 'Проект',
        items: [
          { text: 'Обзор проекта', link: '/project/overview' },
          { text: 'Архитектура', link: '/project/architecture' },
          { text: 'Приёмка спецификации', link: '/project/acceptance' },
          { text: 'Frontend', link: '/project/frontend' },
          { text: 'Модель данных', link: '/project/data-model' },
          { text: 'Конфигурация', link: '/project/configuration' },
          { text: 'API и контракты', link: '/project/api' },
          { text: 'Аутентификация и безопасность', link: '/project/auth-and-security' },
          { text: 'Бизнес-допущения и ограничения', link: '/project/business-assumptions' },
          { text: 'Интеграции и фоновые задачи', link: '/project/integrations' },
          { text: 'Нагрузка NF08 и приёмка', link: '/project/performance' },
          { text: 'Деплой и наблюдаемость', link: '/project/deployment' },
          { text: 'Тестирование', link: '/project/testing' },
          { text: 'Соглашения по коду', link: '/project/conventions' },
          { text: 'Проверки качества', link: '/project/quality-checks' },
        ],
      },
      {
        text: 'Работа агентов',
        items: [
          { text: 'Обзор', link: '/agents/' },
          { text: 'Правила агентов (AGENTS.md)', link: '/agents/rules' },
          { text: 'Правила backend', link: '/agents/backend' },
          { text: 'Правила frontend', link: '/agents/frontend' },
          { text: 'Состояние проекта', link: '/agents/progress' },
          { text: 'Работа с задачами', link: '/agents/task-workflow' },
          { text: 'Восстановление контекста', link: '/agents/context-recovery' },
          { text: 'Инструменты агентов', link: '/agents/tooling' },
        ],
      },
      {
        text: 'Решения',
        items: [
          { text: 'Индекс ADR', link: '/adr/' },
          { text: '0001 Агентный процесс', link: '/adr/0001-agent-workflow' },
        ],
      },
    ],
    outline: {
      label: 'На этой странице',
    },
    docFooter: {
      prev: 'Предыдущая страница',
      next: 'Следующая страница',
    },
    notFound: {
      title: 'Страница не найдена',
      quote: 'Такой страницы нет. Проверьте адрес или воспользуйтесь поиском.',
      linkText: 'На главную',
    },
    returnToTopLabel: 'Наверх',
    skipToContentLabel: 'Перейти к содержимому',
    sidebarMenuLabel: 'Меню',
    darkModeSwitchLabel: 'Оформление',
    lightModeSwitchTitle: 'Светлая тема',
    darkModeSwitchTitle: 'Тёмная тема',
    search: {
      provider: 'local',
      options: {
        locales: {
          root: {
            translations: {
              button: {
                buttonText: 'Поиск',
                buttonAriaLabel: 'Поиск',
              },
              modal: {
                displayDetails: 'Показать подробный список',
                resetButtonTitle: 'Сбросить поиск',
                backButtonTitle: 'Закрыть поиск',
                noResultsText: 'Ничего не найдено',
                footer: {
                  selectText: 'выбрать',
                  selectKeyAriaLabel: 'Enter',
                  navigateText: 'перейти',
                  navigateUpKeyAriaLabel: 'стрелка вверх',
                  navigateDownKeyAriaLabel: 'стрелка вниз',
                  closeText: 'закрыть',
                  closeKeyAriaLabel: 'Esc',
                },
              },
            },
          },
        },
      },
    },
  },
})
