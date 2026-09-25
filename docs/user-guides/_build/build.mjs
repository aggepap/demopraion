// Markdown guides -> styled HTML -> PDF (headless Chromium).
// Usage: cd docs/user-guides/_build && npm install && node build.mjs [slug ...]
// Needs a Chromium: set CHROME, or it uses Playwright's cached build.
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, '..', 'src');
const OUT = join(here, 'out'); // intermediate HTML; PDFs land in docs/user-guides/
const CHROME = process.env.CHROME ?? `${process.env.HOME}/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`;
mkdirSync(OUT, { recursive: true });

const css = readFileSync(join(here, 'style.css'), 'utf8');
const only = process.argv.slice(2);

function frontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  const meta = {};
  if (!m) return { meta, body: text };
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { meta, body: text.slice(m[0].length) };
}

const slugify = (s, n) => `s${n}-` + s.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');

function render(md) {
  // [[Label]] -> on-screen UI label chip
  md = md.replace(/\[\[([^\]]+)\]\]/g, (_, l) => `<span class="ui">${l}</span>`);
  let html = marked.parse(md);

  // Callouts: blockquote whose first strong word picks the style.
  html = html.replace(/<blockquote>\s*<p><strong>([^<]+)<\/strong>/g, (all, word) => {
    const w = word.toLowerCase();
    const kind = /προσοχ|σημαντικ|κίνδυν/.test(w) ? 'warn' : /συμβουλ|tip|χρυσός/.test(w) ? 'tip' : 'note';
    return `<blockquote class="${kind}"><p><strong>${word}</strong>`;
  });

  // Number h2 sections and build a TOC from them.
  const toc = [];
  let n = 0;
  html = html.replace(/<h2>([\s\S]*?)<\/h2>/g, (_, t) => {
    n += 1;
    const id = slugify(t, n);
    toc.push({ id, t, n });
    return `<h2 id="${id}"><span class="num">${n}</span>${t}</h2>`;
  });
  return { html, toc };
}

function page(meta, html, toc, pages = {}) {
  const tocHtml = toc
    .map((e) => `<li><a href="#${e.id}"><span class="tn">${e.n}</span><span class="tt">${e.t}</span><span class="tp">${pages[e.n] ?? ''}</span></a></li>`)
    .join('');
  return `<!doctype html><html lang="el"><head><meta charset="utf-8">
<title>${meta.title}</title>
<link rel="stylesheet" href="../fonts/fonts.css">
<style>${css}
@page { @bottom-left { content: "${meta.title}"; } }
</style></head><body>
<section class="cover">
  <div class="cover-top">
    <div class="kicker">Οδηγός χρήσης · Πίνακας διαχείρισης</div>
    <div class="guide-no">${meta.number}</div>
  </div>
  <div class="cover-main">
    <h1>${meta.title}</h1>
    <p class="subtitle">${meta.subtitle}</p>
  </div>
  <div class="cover-bottom">
    <p>${meta.audience ?? 'Για όσους διαχειρίζονται καθημερινά το site. Δεν χρειάζονται τεχνικές γνώσεις.'}</p>
    <p class="edition">Έκδοση Σεπτεμβρίου 2026</p>
  </div>
</section>
<nav class="toc"><h2 class="toc-h">Περιεχόμενα</h2><ol>${tocHtml}</ol></nav>
<main>${html}</main>
</body></html>`;
}

async function headingPages(pdfPath, toc, title) {
  const doc = await getDocument({ data: new Uint8Array(readFileSync(pdfPath)), verbosity: 0 }).promise;
  const found = {};
  const norm = (x) => x.replace(/<[^>]+>/g, '').replace(/&[a-z#0-9]+;/g, '').replace(/\s+/g, '');
  for (let p = 3; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    // Each section starts a page, so its heading leads the page text once the
    // running footer (page number + guide title) is stripped.
    const text = norm(tc.items.map((i) => i.str).join('')).replace(/^\d+/, '').replace(norm(title), '');
    for (const e of toc) if (!found[e.n] && text.startsWith(norm(e.t).slice(0, 25))) found[e.n] = p;
  }
  return found;
}

const files = readdirSync(SRC).filter((f) => f.endsWith('.md')).sort();
for (const f of files) {
  const slug = f.replace(/\.md$/, '');
  if (only.length && !only.some((o) => slug.includes(o))) continue;
  const { meta, body } = frontmatter(readFileSync(join(SRC, f), 'utf8'));
  const { html, toc } = render(body);
  const htmlPath = join(OUT, `${slug}.html`);
  const pdfPath = join(here, '..', `${slug}.pdf`);
  const print = () => execFileSync(CHROME, [
    '--headless', '--no-sandbox', '--disable-gpu', '--no-pdf-header-footer',
    '--generate-pdf-document-outline',
    '--virtual-time-budget=5000', '--run-all-compositor-stages-before-draw',
    `--print-to-pdf=${pdfPath}`, `file://${htmlPath}`,
  ], { stdio: 'pipe' });
  // Pass 1 without page numbers, locate each numbered heading, pass 2 with them.
  writeFileSync(htmlPath, page(meta, html, toc));
  print();
  const pages = await headingPages(pdfPath, toc, meta.title);
  writeFileSync(htmlPath, page(meta, html, toc, pages));
  print();
  console.log('built', pdfPath);
}
