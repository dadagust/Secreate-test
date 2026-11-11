/**
 * Builds PROJECT_OVERVIEW.md and its standalone interactive HTML from a maintained source.
 *
 *   node scripts/generate-project-overview.mjs          write the HTML
 *   node scripts/generate-project-overview.mjs --check  fail if the committed HTML is stale
 *
 * The output depends on the source, README title and this script (no timestamps), so --check
 * can compare it byte for byte. Supported Markdown: #/##/### headings, paragraphs,
 * "-" and "1." lists, pipe tables, fenced code, inline code, bold and links.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const sourcePath = join(rootDir, 'docs/project/overview-source.txt')
const markdownPath = join(rootDir, 'PROJECT_OVERVIEW.md')
const outputPath = join(rootDir, 'PROJECT_OVERVIEW.html')
const checkOnly = process.argv.includes('--check')
// The project name lives in the first heading of README.md.
const projectName =
  /^# (.+)$/m.exec(readFileSync(join(rootDir, 'README.md'), 'utf8'))?.[1].trim() ??
  'Project'

function escapeHtml(text) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function resolveStandaloneHref(href) {
  if (href === 'PROJECT_OVERVIEW.md') return 'docs/.vitepress/dist/project/overview.html'

  const suffixIndex = href.search(/[?#]/)
  const path = suffixIndex === -1 ? href : href.slice(0, suffixIndex)
  const suffix = suffixIndex === -1 ? '' : href.slice(suffixIndex)
  if (!path.startsWith('docs/') || !path.endsWith('.md')) return href

  let outputPath = path.slice('docs/'.length).replace(/\.md$/, '.html')
  outputPath = outputPath.replace(/(^|\/)README\.html$/, '$1index.html')
  return `docs/.vitepress/dist/${outputPath}${suffix}`
}

const inlinePattern = /`([^`]+)`|\[((?:[^\]`]|`[^`]*`)+)\]\(([^)\s]+)\)|\*\*(.+?)\*\*/g

function renderInline(text) {
  let html = ''
  let lastIndex = 0
  for (const match of text.matchAll(inlinePattern)) {
    html += escapeHtml(text.slice(lastIndex, match.index))
    const [, code, linkText, href, bold] = match
    if (code !== undefined) {
      html += `<code>${escapeHtml(code)}</code>`
    } else if (linkText !== undefined) {
      const targetHref = resolveStandaloneHref(href)
      const external = /^https?:\/\//.test(targetHref)
      const rel = external ? ' rel="noopener noreferrer"' : ''
      // A link with another scheme (javascript:, data:) stays plain text.
      const unsafe = /^[a-z][a-z0-9+.-]*:/i.test(targetHref) && !/^(https?|mailto):/i.test(targetHref)
      html += unsafe
        ? renderInline(linkText)
        : `<a href="${escapeHtml(targetHref)}"${rel}>${renderInline(linkText)}</a>`
    } else {
      html += `<strong>${renderInline(bold)}</strong>`
    }
    lastIndex = match.index + match[0].length
  }
  return html + escapeHtml(text.slice(lastIndex))
}

function createSlugger() {
  const used = new Map()
  return (text) => {
    const base =
      text
        .toLowerCase()
        .replace(/`/g, '')
        .replace(/[^\p{L}\p{N}\s-]/gu, '')
        .trim()
        .replace(/\s+/g, '-') || 'section'
    const count = used.get(base) ?? 0
    used.set(base, count + 1)
    return count === 0 ? base : `${base}-${count}`
  }
}

function splitTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

/** Parses Markdown into a heading tree: document -> h2 sections -> h3 subsections. */
function parse(markdown) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const slug = createSlugger()
  const doc = { title: '', intro: [], sections: [] }
  let target = doc.intro
  let section = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (line.startsWith('```')) {
      const code = []
      for (i++; i < lines.length && !lines[i].startsWith('```'); i++) code.push(lines[i])
      target.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`)
      continue
    }

    const heading = /^(#{1,3}) (.+)$/.exec(line)
    if (heading) {
      const [, hashes, text] = heading
      if (hashes.length === 1) {
        doc.title = text
      } else if (hashes.length === 2) {
        section = { title: text, id: slug(text), blocks: [], subsections: [] }
        doc.sections.push(section)
        target = section.blocks
      } else if (section) {
        const subsection = { title: text, id: slug(text), blocks: [] }
        section.subsections.push(subsection)
        target = subsection.blocks
      }
      continue
    }

    if (line.trim().startsWith('|')) {
      const rows = []
      for (; i < lines.length && lines[i].trim().startsWith('|'); i++) {
        rows.push(splitTableRow(lines[i]))
      }
      i--
      const [header = [], , ...body] = rows
      const head = header.map((cell) => `<th scope="col">${renderInline(cell)}</th>`)
      const bodyRows = body.map(
        (row) =>
          `<tr>${row.map((cell) => `<td>${renderInline(cell)}</td>`).join('')}</tr>`,
      )
      target.push(
        `<div class="table-wrap"><table><thead><tr>${head.join('')}</tr></thead><tbody>${bodyRows.join('')}</tbody></table></div>`,
      )
      continue
    }

    const listItem = /^(-|\d+\.) (.+)$/.exec(line)
    if (listItem) {
      const ordered = listItem[1] !== '-'
      const items = []
      for (; i < lines.length; i++) {
        const item = /^(-|\d+\.) (.+)$/.exec(lines[i])
        if (!item || (item[1] !== '-') !== ordered) break
        items.push(`<li>${renderInline(item[2])}</li>`)
      }
      i--
      target.push(
        ordered
          ? `<ol class="flow">${items.join('')}</ol>`
          : `<ul>${items.join('')}</ul>`,
      )
      continue
    }

    if (line.trim() === '') continue

    const paragraph = [line.trim()]
    while (
      i + 1 < lines.length &&
      lines[i + 1].trim() !== '' &&
      !/^(#{1,3} |```|\||-\s|\d+\.\s)/.test(lines[i + 1].trim())
    ) {
      paragraph.push(lines[++i].trim())
    }
    target.push(`<p>${renderInline(paragraph.join(' '))}</p>`)
  }

  return doc
}

function renderSection(section) {
  const subsections = section.subsections
    .map(
      (sub) => `
        <details class="sub" id="${sub.id}" open>
          <summary><h3>${renderInline(sub.title)}</h3></summary>
          <div class="sub-body">${sub.blocks.join('\n')}</div>
        </details>`,
    )
    .join('')
  return `
      <section class="card" id="${section.id}" aria-labelledby="${section.id}-title">
        <h2 id="${section.id}-title">${renderInline(section.title)}</h2>
        ${section.blocks.join('\n')}${subsections}
      </section>`
}

function renderNav(sections) {
  return sections
    .map((section) => {
      const children = section.subsections.length
        ? `<ul>${section.subsections
            .map((sub) => `<li><a href="#${sub.id}">${renderInline(sub.title)}</a></li>`)
            .join('')}</ul>`
        : ''
      return `<li><a href="#${section.id}" data-section="${section.id}">${renderInline(section.title)}</a>${children}</li>`
    })
    .join('\n          ')
}

const styles = `
    :root {
      color-scheme: light dark;
      --bg: #f6f7f9; --surface: #ffffff; --text: #1b1f24; --muted: #57606a;
      --border: #d8dee4; --accent: #0b62d6; --accent-soft: #e7f0fd; --code: #eef1f4;
      --radius: 10px;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #0f1216; --surface: #171b21; --text: #e6e9ed; --muted: #9aa4af;
        --border: #2b323b; --accent: #6aa8ff; --accent-soft: #16263d; --code: #222831;
      }
    }
    * { box-sizing: border-box; }
    html { scroll-padding-top: 5rem; }
    body { margin: 0; background: var(--bg); color: var(--text);
      font: 16px/1.6 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
    a { color: var(--accent); }
    a:focus-visible, button:focus-visible, input:focus-visible, summary:focus-visible {
      outline: 3px solid var(--accent); outline-offset: 2px; border-radius: 4px; }
    code { font: 0.875em/1.4 ui-monospace, SFMono-Regular, Consolas, monospace;
      background: var(--code); padding: 0.1em 0.35em; border-radius: 4px; overflow-wrap: anywhere; }
    pre { background: var(--code); padding: 1rem; border-radius: var(--radius); overflow-x: auto; }
    pre code { padding: 0; background: none; }
    .skip { position: absolute; left: -999px; top: 0; }
    .skip:focus { left: 1rem; top: 1rem; z-index: 20; background: var(--surface); padding: 0.5rem 1rem; }
    .topbar { position: sticky; top: 0; z-index: 10; display: flex; flex-wrap: wrap; gap: 0.75rem;
      align-items: center; padding: 0.75rem 1.25rem; background: var(--surface);
      border-bottom: 1px solid var(--border); }
    .brand { font-weight: 700; margin-right: auto; }
    .brand small { display: block; font-weight: 400; color: var(--muted); font-size: 0.8rem; }
    .search { display: flex; gap: 0.5rem; align-items: center; flex: 1 1 18rem; max-width: 32rem; }
    .search input { flex: 1; min-width: 0; font: inherit; padding: 0.45rem 0.75rem;
      border: 1px solid var(--border); border-radius: 8px; background: var(--bg); color: var(--text); }
    button { font: inherit; font-size: 0.875rem; padding: 0.45rem 0.8rem; cursor: pointer;
      border: 1px solid var(--border); border-radius: 8px; background: var(--surface); color: var(--text); }
    button:hover { border-color: var(--accent); }
    .menu-toggle { display: none; }
    .layout { display: grid; grid-template-columns: 17rem minmax(0, 1fr); gap: 2rem;
      max-width: 78rem; margin: 0 auto; padding: 1.5rem 1.25rem 3rem; }
    nav.toc { position: sticky; top: 5.5rem; align-self: start; max-height: calc(100vh - 7rem);
      overflow-y: auto; font-size: 0.9rem; }
    nav.toc ul { list-style: none; margin: 0; padding: 0; }
    nav.toc ul ul { padding-left: 0.9rem; margin: 0.15rem 0 0.5rem; border-left: 1px solid var(--border); }
    nav.toc a { display: block; padding: 0.2rem 0.5rem; border-radius: 6px; color: var(--muted); text-decoration: none; }
    nav.toc > ul > li > a { color: var(--text); font-weight: 600; }
    nav.toc a:hover, nav.toc a[aria-current='true'] { background: var(--accent-soft); color: var(--accent); }
    main h1 { font-size: 2rem; line-height: 1.2; margin: 0 0 0.5rem; }
    .intro { color: var(--muted); max-width: 48rem; }
    .card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
      padding: 1.25rem 1.5rem; margin: 1.25rem 0; }
    .card h2 { margin: 0 0 0.75rem; font-size: 1.4rem; }
    details.sub { border-top: 1px solid var(--border); padding: 0.5rem 0; }
    details.sub:first-of-type { border-top: 0; }
    summary { cursor: pointer; list-style-position: outside; margin-left: 1rem; }
    summary h3 { display: inline; font-size: 1.1rem; margin: 0; }
    .sub-body { padding: 0.25rem 0 0.5rem; }
    .table-wrap { overflow-x: auto; margin: 0.75rem 0; }
    table { border-collapse: collapse; width: 100%; font-size: 0.925rem; }
    th, td { text-align: left; vertical-align: top; padding: 0.5rem 0.75rem; border-bottom: 1px solid var(--border); }
    th { background: var(--bg); font-weight: 600; }
    ol.flow { list-style: none; counter-reset: step; padding: 0; display: grid; gap: 0.5rem; }
    ol.flow li { counter-increment: step; position: relative; padding: 0.6rem 0.9rem 0.6rem 2.9rem;
      background: var(--accent-soft); border-radius: 8px; }
    ol.flow li::before { content: counter(step); position: absolute; left: 0.8rem; top: 0.6rem;
      width: 1.5rem; height: 1.5rem; border-radius: 50%; background: var(--accent); color: var(--surface);
      font-size: 0.8rem; font-weight: 700; display: grid; place-items: center; }
    ol.flow li + li::after { content: ''; position: absolute; left: 1.5rem; top: -0.5rem; height: 0.5rem;
      border-left: 2px solid var(--accent); }
    .status { color: var(--muted); font-size: 0.9rem; min-height: 1.5em; }
    [hidden] { display: none !important; }
    footer { color: var(--muted); font-size: 0.85rem; border-top: 1px solid var(--border); padding-top: 1rem; }
    @media (max-width: 900px) {
      .topbar { position: static; }
      html { scroll-padding-top: 0.5rem; }
      .layout { grid-template-columns: minmax(0, 1fr); gap: 0; padding-top: 1rem; }
      .menu-toggle { display: inline-block; }
      nav.toc { position: static; max-height: none; background: var(--surface); border: 1px solid var(--border);
        border-radius: var(--radius); padding: 0.75rem; margin-bottom: 1rem; }
      nav.toc[data-collapsed='true'] { display: none; }
      .card { padding: 1rem; }
      main h1 { font-size: 1.6rem; }
    }
    @media print { .topbar, nav.toc { display: none; } .layout { display: block; } details.sub > .sub-body { display: block; } }
`

// Runs in the browser. Kept free of template placeholders so the HTML stays deterministic.
const script = `
    (function () {
      var input = document.getElementById('overview-search');
      var status = document.getElementById('search-status');
      var sections = Array.prototype.slice.call(document.querySelectorAll('main section.card'));
      var nav = document.getElementById('toc');
      var toggle = document.getElementById('menu-toggle');
      var mobile = window.matchMedia('(max-width: 900px)');

      function setMenu(open) {
        toggle.setAttribute('aria-expanded', String(open));
        nav.setAttribute('data-collapsed', String(!open));
      }
      setMenu(!mobile.matches);
      mobile.addEventListener('change', function (e) { setMenu(!e.matches); });
      toggle.addEventListener('click', function () {
        setMenu(toggle.getAttribute('aria-expanded') !== 'true');
      });
      nav.addEventListener('click', function (e) {
        if (e.target.closest('a') && mobile.matches) setMenu(false);
      });

      function setAll(open) {
        document.querySelectorAll('details.sub').forEach(function (d) { d.open = open; });
      }
      document.getElementById('expand-all').addEventListener('click', function () { setAll(true); });
      document.getElementById('collapse-all').addEventListener('click', function () { setAll(false); });

      function filter() {
        var query = input.value.trim().toLowerCase();
        var shown = 0;
        sections.forEach(function (section) {
          var title = section.querySelector('h2').textContent.toLowerCase();
          var titleMatch = !query || title.indexOf(query) !== -1;
          var subs = Array.prototype.slice.call(section.querySelectorAll('details.sub'));
          var anySub = false;
          subs.forEach(function (sub) {
            var match = titleMatch || sub.textContent.toLowerCase().indexOf(query) !== -1;
            sub.hidden = !match;
            if (match && query) sub.open = true;
            if (match) anySub = true;
          });
          var visible = titleMatch || anySub ||
            (subs.length === 0 && section.textContent.toLowerCase().indexOf(query) !== -1);
          section.hidden = !visible;
          var link = nav.querySelector('[data-section="' + section.id + '"]');
          if (link) link.parentElement.hidden = !visible;
          if (visible) shown++;
        });
        status.textContent = !query ? '' : shown ? 'Найдено разделов: ' + shown : 'Ничего не найдено';
      }
      input.addEventListener('input', filter);
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { input.value = ''; filter(); }
      });
      document.addEventListener('keydown', function (e) {
        var tag = document.activeElement && document.activeElement.tagName;
        if (e.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA') { e.preventDefault(); input.focus(); }
      });

      if ('IntersectionObserver' in window) {
        var observer = new IntersectionObserver(function (entries) {
          entries.forEach(function (entry) {
            if (!entry.isIntersecting) return;
            nav.querySelectorAll('a[aria-current]').forEach(function (a) { a.removeAttribute('aria-current'); });
            var link = nav.querySelector('[data-section="' + entry.target.id + '"]');
            if (link) link.setAttribute('aria-current', 'true');
          });
        }, { rootMargin: '-20% 0px -70% 0px' });
        sections.forEach(function (section) { observer.observe(section); });
      }
    })();
`

function renderDocument(doc) {
  const title = doc.title || 'Обзор проекта'
  return `<!--
GENERATED FILE — DO NOT EDIT MANUALLY.
Canonical source: docs/project/overview-source.txt
Regenerate using the project overview build command: npm run overview:build
-->
<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="generator" content="scripts/generate-project-overview.mjs">
  <link rel="icon" href="data:,">
  <title>${escapeHtml(title)} — ${escapeHtml(projectName)}</title>
  <style>${styles}  </style>
</head>
<body>
  <a class="skip" href="#content">Перейти к содержимому</a>
  <header class="topbar">
    <div class="brand">${escapeHtml(projectName)}<small>${escapeHtml(title)} · источник: <a href="${resolveStandaloneHref('PROJECT_OVERVIEW.md')}">PROJECT_OVERVIEW.md</a></small></div>
    <button type="button" class="menu-toggle" id="menu-toggle" aria-controls="toc" aria-expanded="true">Разделы</button>
    <div class="search" role="search">
      <input id="overview-search" type="search" placeholder="Поиск по обзору (/)" aria-label="Поиск по обзору" aria-describedby="search-status" autocomplete="off">
    </div>
    <button type="button" id="expand-all">Развернуть всё</button>
    <button type="button" id="collapse-all">Свернуть всё</button>
  </header>
  <div class="layout">
    <nav class="toc" id="toc" aria-label="Разделы обзора">
      <ul>
          ${renderNav(doc.sections)}
      </ul>
    </nav>
    <main id="content" tabindex="-1">
      <h1>${renderInline(title)}</h1>
      <div class="intro">${doc.intro.join('\n')}</div>
      <p id="search-status" class="status" role="status" aria-live="polite"></p>
${doc.sections.map(renderSection).join('\n')}
      <footer>
        <p>Ссылки на документы открывают их HTML-страницы из <code>docs/.vitepress/dist/</code>. Если папки ещё нет, сначала соберите документацию командой <code>npm run docs:build</code>. Этот обзор сгенерирован из <code>docs/project/overview-source.txt</code>; используйте <code>npm run overview:build</code> для обновления и <code>npm run overview:check</code> для проверки.</p>
      </footer>
    </main>
  </div>
  <script>${script}  </script>
</body>
</html>
`
}

const markdown = readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n')
const html = renderDocument(parse(markdown))

if (checkOnly) {
  for (const [path, expected] of [[markdownPath, markdown], [outputPath, html]]) {
    let current = null
    try { current = readFileSync(path, 'utf8').replace(/\r\n/g, '\n') }
    catch (error) { if (error.code !== 'ENOENT') throw error }
    if (current !== expected) {
      console.error(`${path} is missing or out of date. Run: npm run overview:build`)
      process.exitCode = 1
    } else console.log(`${path} is up to date.`)
  }
} else {
  writeFileSync(markdownPath, markdown)
  writeFileSync(outputPath, html)
  console.log('Generated PROJECT_OVERVIEW.md and PROJECT_OVERVIEW.html')
}
