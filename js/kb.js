/* ============================================================
 * kb.js — 知识库（多级目录 + Markdown 笔记）
 * 树形目录（无限级）、Markdown 编辑/分屏预览、自动保存、
 * 时间记录、搜索、插图（复用压缩上传）、LaTeX 公式（内置 KaTeX）
 * ============================================================ */
import { openModal, closeModal, toast, esc, confirmBox } from "./app.js";
import * as store from "./storage.js";
import { fileToCompressedDataUrl } from "./knowledge.js";

/* ---------- 模块状态 ---------- */
const state = {
  selectedId: null,     // 当前选中节点 id
  expanded: new Set(),  // 已展开的文件夹 id
  q: "",                // 搜索词
  viewMode: "split",    // split | edit | preview
};

let saveTimer = null;

/* ---------- Markdown 渲染（自研、安全：先转义 HTML） ---------- */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/* ---------- LaTeX 公式（KaTeX，本地内置、动态加载） ---------- */
let katexPromise = null;
function ensureKatex() {
  if (window.katex) return Promise.resolve(true);
  if (katexPromise) return katexPromise;
  katexPromise = new Promise((resolve, reject) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "./vendor/katex/katex.min.css";
    document.head.appendChild(link);
    const s = document.createElement("script");
    s.src = "./vendor/katex/katex.min.js";
    s.onload = () => resolve(true);
    s.onerror = () => { katexPromise = null; reject(new Error("KaTeX 加载失败")); };
    document.head.appendChild(s);
  });
  return katexPromise;
}

function renderMath(tex, display) {
  const fallback = () => display
    ? `<div class="kb-math">${escapeHtml(tex)}</div>`
    : `<span class="kb-math">${escapeHtml(tex)}</span>`;
  if (typeof window.katex === "undefined") return fallback();
  try {
    return window.katex.renderToString(String(tex || "").trim(), {
      throwOnError: false, displayMode: !!display,
      strict: "ignore", trust: false, output: "html",
    });
  } catch (e) { return fallback(); }
}

function inline(s) {
  // 行内公式 $...$（在 HTML 转义之前提取，保证 LaTeX 原样传给 KaTeX）
  const math = [];
  s = String(s).replace(/(^|[^$\w])\$([^$\n]+?)\$(?![$\d])/g, (m, pre, tex) => {
    math.push(renderMath(tex, false));
    return pre + "\u0000M" + (math.length - 1) + "\u0000";
  });
  s = escapeHtml(s);
  s = s.replace(/\u0000M(\d+)\u0000/g, (m, idx) => math[+idx] || "");
  s = s.replace(/`([^`\n]+)`/g, (m, c) => `<code>${c}</code>`);
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, src) => {
    if (!/^(https?:|data:image\/|\/)/i.test(src)) src = "#";
    return `<img src="${src}" alt="${alt}" loading="lazy" />`;
  });
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, t, url) => {
    if (!/^(https?:|mailto:)/i.test(url)) url = "#";
    return `<a href="${url}" target="_blank" rel="noopener">${t}</a>`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  s = s.replace(/(^|[^*\w])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  return s;
}

function parseRow(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((s) => s.trim());
}

function renderList(items) {
  const stack = [{ indent: -1, children: [] }];
  items.forEach((it) => {
    const m = it.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
    if (!m) return;
    const indent = m[1].replace(/\t/g, "  ").length;
    const ordered = /^\d+\./.test(m[2]);
    let content = m[3];
    const task = content.match(/^\[([ xX])\]\s+(.*)$/);
    if (task) {
      const done = task[1].toLowerCase() === "x";
      content = `<label class="kb-task${done ? " done" : ""}"><input type="checkbox" disabled ${done ? "checked" : ""}/> ${inline(task[2])}</label>`;
    } else {
      content = inline(content);
    }
    const node = { indent, ordered, html: content, children: [] };
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop();
    stack[stack.length - 1].children.push(node);
    stack.push(node);
  });
  const render = (children) => {
    if (!children.length) return "";
    const tag = children[0].ordered ? "ol" : "ul";
    return `<${tag}>${children.map((c) => `<li>${c.html}${render(c.children)}</li>`).join("")}</${tag}>`;
  };
  return render(stack[0].children);
}

export function mdToHtml(src) {
  const lines = String(src || "").replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // 块级公式 $$...$$（可单行或多行包裹）
    if (/^\s*\$\$/.test(line)) {
      const one = line.match(/^\s*\$\$(.+?)\$\$\s*$/);
      let tex;
      if (one) { tex = one[1]; i++; }
      else {
        const buf = [];
        const head = line.replace(/^\s*\$\$/, "");
        if (head.trim()) buf.push(head);
        i++;
        while (i < lines.length && !/^\s*\$\$\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
        if (i < lines.length) i++; // 跳过闭合 $$
        tex = buf.join("\n");
      }
      out.push(renderMath(tex, true));
      continue;
    }
    // 代码块
    const fence = line.match(/^```\s*([\w-]*)\s*$/);
    if (fence) {
      const lang = fence[1];
      const buf = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++;
      out.push(`<pre><code${lang ? ` class="lang-${lang}"` : ""}>${buf.map(escapeHtml).join("\n")}</code></pre>`);
      continue;
    }
    // 表格：当前行以 | 开头且下一行是分隔行
    if (/^\s*\|.*\|\s*$/.test(line) && lines[i + 1] && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes("-")) {
      const header = parseRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { rows.push(parseRow(lines[i])); i++; }
      out.push(`<table><thead><tr>${header.map((h) => `<th>${inline(h)}</th>`).join("")}</tr></thead>` +
        `<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
      continue;
    }
    // 水平线
    if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(line)) { out.push("<hr/>"); i++; continue; }
    // 标题
    const h = line.match(/^\s{0,3}(#{1,6})\s+(.*)$/);
    if (h) { out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue; }
    // 引用（连续行）
    if (/^\s*>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, "")); i++; }
      out.push(`<blockquote>${mdToHtml(buf.join("\n"))}</blockquote>`);
      continue;
    }
    // 列表
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const items = [];
      while (i < lines.length && (/^\s*([-*+]|\d+\.)\s+/.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length && !/^\s*([-*+]|\d+\.)\s+/.test(lines[i])))) {
        const t = lines[i];
        if (/^\s*([-*+]|\d+\.)\s+/.test(t)) items.push(t);
        else items[items.length - 1] += "\n" + t;
        i++;
      }
      out.push(renderList(items));
      continue;
    }
    // 空行
    if (/^\s*$/.test(line)) { i++; continue; }
    // 段落（收集到空行或特殊块）
    const buf = [line];
    i++;
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^```/.test(lines[i]) &&
           !/^\s*([-*+]|\d+\.)\s+/.test(lines[i]) && !/^\s*>\s?/.test(lines[i]) &&
           !/^\s*(---+|\*\*\*+|___+)\s*$/.test(lines[i]) && !/^\s{0,3}#{1,6}\s/.test(lines[i]) &&
           !/^\s*\$\$/.test(lines[i]) && !/^\s*\|.*\|\s*$/.test(lines[i])) {
      buf.push(lines[i]);
      i++;
    }
    out.push(`<p>${buf.map(inline).join("<br/>")}</p>`);
  }
  return out.join("\n");
}

/* ---------- 树工具 ---------- */
function childrenOf(id) {
  const pid = id || null;
  return store.listKb().filter((n) => (n.parentId || null) === pid)
    .sort((a, b) => (a.sort || 0) - (b.sort || 0) || (b.createdAt - a.createdAt));
}
function nodeById(id) { return store.getKbNode(id); }
function isDescendant(id, ancestorId) {
  let cur = nodeById(id);
  while (cur && cur.parentId) {
    if (cur.parentId === ancestorId) return true;
    cur = nodeById(cur.parentId);
  }
  return false;
}
function fmtTime(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* ---------- 主渲染 ---------- */
export function renderKnowledgeBase(container) {
  // 清理失效选中（被删或搜索无结果）
  if (state.selectedId && !nodeById(state.selectedId)) state.selectedId = null;
  const data = store.getData();
  const kbCount = store.listKb().length;

  container.innerHTML = `
    <div class="section-head">
      <div>
        <h2>知识库</h2>
        <div class="hint">多级目录 · Markdown 笔记 · LaTeX 公式 · 自动保存 · ${kbCount} 个节点</div>
      </div>
    </div>

    <div class="kb-toolbar">
      <div class="kb-actions">
        <button class="btn btn-primary btn-sm" id="kbAddNote" type="button">+ 新建笔记</button>
        <button class="btn btn-ghost btn-sm" id="kbAddFolder" type="button">+ 新建文件夹</button>
      </div>
      <div class="search kb-search"><input class="input" id="kbSearch" type="search" placeholder="搜索标题或内容" value="${esc(state.q)}" /></div>
    </div>

    <div class="kb-main">
      <div class="card kb-tree">
        <div class="kb-tree-head">📂 目录</div>
        <div class="kb-tree-list" id="kbTreeList"></div>
      </div>
      <div class="card kb-editor" id="kbEditor"></div>
    </div>
  `;

  // 树
  const treeWrap = container.querySelector("#kbTreeList");
  treeWrap.innerHTML = renderTreeHtml();

  // 编辑器
  const editor = container.querySelector("#kbEditor");
  renderEditor(editor);

  // 事件
  container.querySelector("#kbAddNote").onclick = () => { const n = store.addKbNode({ type: "note", parentId: state.selectedId && nodeById(state.selectedId)?.type === "folder" ? state.selectedId : null }); state.selectedId = n.id; state.expanded.add(n.parentId || "root"); renderKnowledgeBase(container); selectEditorFocus(editor, n.id); };
  container.querySelector("#kbAddFolder").onclick = () => { const n = store.addKbNode({ type: "folder", parentId: state.selectedId && nodeById(state.selectedId)?.type === "folder" ? state.selectedId : null }); state.selectedId = n.id; state.expanded.add(n.parentId || "root"); renderKnowledgeBase(container); };
  const search = container.querySelector("#kbSearch");
  search.oninput = (e) => {
    state.q = e.target.value.trim();
    treeWrap.innerHTML = renderTreeHtml();
  };

  // 树点击委托
  treeWrap.onclick = (e) => {
    const nodeEl = e.target.closest("[data-node-id]");
    if (!nodeEl) return;
    const id = nodeEl.dataset.nodeId;
    const node = nodeById(id);
    if (!node) return;
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act) { handleAction(act, id, container); return; }
    if (node.type === "folder") {
      // 点击文件夹：切换展开（若在展开箭头/标题上）；默认选中并展开
      if (state.selectedId === id) toggleFolder(id, treeWrap, editor);
      else { state.selectedId = id; renderKnowledgeBase(container); }
    } else {
      state.selectedId = id;
      renderKnowledgeBase(container);
    }
  };
}

/* 渲染树（含搜索过滤与展开态） */
function renderTreeHtml() {
  const q = state.q.toLowerCase();
  const matchSet = new Set();
  const parentSet = new Set();
  if (q) {
    store.listKb().forEach((n) => {
      const hit = n.title.toLowerCase().includes(q) ||
        (n.type === "note" && String(n.content || "").toLowerCase().includes(q));
      if (hit) {
        matchSet.add(n.id);
        let p = n.parentId;
        while (p) { parentSet.add(p); p = nodeById(p)?.parentId; }
      }
    });
    parentSet.forEach((id) => matchSet.add(id));
  }
  const roots = childrenOf(null);
  if (!roots.length) {
    return `<div class="kb-tree-empty">还没有内容<br/>点击上方「+ 新建笔记」开始</div>`;
  }
  return roots.map((n) => nodeHtml(n, q ? matchSet : null)).join("");
}

function nodeHtml(node, matchSet) {
  const isMatch = !matchSet || matchSet.has(node.id);
  const hasMatchChild = matchSet && childrenOf(node.id).some((c) => matchSet.has(c.id));
  if (matchSet && !isMatch && !hasMatchChild) return "";
  const isFolder = node.type === "folder";
  const expanded = state.expanded.has(node.id);
  const selected = state.selectedId === node.id;
  const kids = childrenOf(node.id);
  const ops = isFolder
    ? `<span class="kb-ops"><button data-act="add-note" title="新建笔记">＋笔记</button><button data-act="add-folder" title="新建子文件夹">＋夹</button><button data-act="rename" title="重命名">改名</button><button data-act="move" title="移动到">移动</button><button data-act="del" title="删除">删除</button></span>`
    : `<span class="kb-ops"><button data-act="rename" title="重命名">改名</button><button data-act="move" title="移动到">移动</button><button data-act="del" title="删除">删除</button></span>`;
  const inner = isFolder
    ? `<span class="kb-caret">${expanded ? "▾" : "▸"}</span><span class="kb-ico">${expanded ? "📂" : "📁"}</span><span class="kb-label">${esc(node.title)}</span>${ops}`
    : `<span class="kb-caret"></span><span class="kb-ico">📄</span><span class="kb-label">${esc(node.title)}</span>${ops}`;
  const sub = expanded && kids.length ? `<div class="kb-children">${kids.map((c) => nodeHtml(c, matchSet)).join("")}</div>` : "";
  return `<div class="kb-node ${isFolder ? "kb-folder" : "kb-note"}${selected ? " selected" : ""}" data-node-id="${node.id}">
    ${inner}
    ${sub}
  </div>`;
}

/* ---------- 编辑器 ---------- */
function renderEditor(editor) {
  const node = state.selectedId ? nodeById(state.selectedId) : null;
  if (!node) {
    editor.innerHTML = `
      <div class="kb-editor-empty">
        <div class="empty-ico">📚</div>
        <h3>选择或新建一篇笔记</h3>
        <p>左侧为目录，点「+ 新建笔记」或点选已有笔记开始编辑。<br/>支持 Markdown 语法，内容自动保存。</p>
      </div>`;
    return;
  }
  if (node.type === "folder") {
    const kids = childrenOf(node.id);
    editor.innerHTML = `
      <div class="kb-editor-folder">
        <div class="kb-folder-head">📁 ${esc(node.title)}</div>
        <div class="muted" style="font-size:13px;margin-top:4px">创建于 ${fmtTime(node.createdAt)} · 包含 ${kids.length} 项</div>
        <div style="margin-top:16px;display:flex;gap:10px">
          <button class="btn btn-primary btn-sm" id="kbFoldAddNote">+ 在此新建笔记</button>
          <button class="btn btn-ghost btn-sm" id="kbFoldAddFolder">+ 新建子文件夹</button>
        </div>
        ${kids.length ? `<div style="margin-top:16px;display:flex;flex-direction:column;gap:6px">${kids.map((k) => `
          <div style="padding:8px 12px;background:var(--surface-2);border:1px solid var(--line-soft);border-radius:var(--r-sm);font-size:13.5px">${k.type === "folder" ? "📁" : "📄"} ${esc(k.title)}</div>`).join("")}</div>` : ""}
      </div>`;
    const e = editor;
    e.querySelector("#kbFoldAddNote").onclick = () => { const n = store.addKbNode({ type: "note", parentId: node.id }); state.selectedId = n.id; state.expanded.add(node.id); renderKnowledgeBase(document.getElementById("view-kb")); };
    e.querySelector("#kbFoldAddFolder").onclick = () => { store.addKbNode({ type: "folder", parentId: node.id }); state.expanded.add(node.id); renderKnowledgeBase(document.getElementById("view-kb")); };
    return;
  }

  // note 编辑
  const vm = state.viewMode;
  editor.innerHTML = `
    <div class="kb-editor-top">
      <input class="kb-title-input" id="kbTitle" value="${esc(node.title)}" placeholder="笔记标题" />
      <div class="kb-meta muted">创建 ${fmtTime(node.createdAt)} · 更新 ${fmtTime(node.updatedAt)}</div>
    </div>
    <div class="kb-mdbar">
      <button data-md="bold" title="加粗">B</button>
      <button data-md="italic" title="斜体"><em>I</em></button>
      <button data-md="strike" title="删除线"><s>S</s></button>
      <button data-md="h2" title="二级标题">H</button>
      <button data-md="quote" title="引用">❝</button>
      <button data-md="ul" title="无序列表">• 列表</button>
      <button data-md="ol" title="有序列表">1. 列表</button>
      <button data-md="code" title="代码">&lt;/&gt;</button>
      <button data-md="link" title="链接">🔗</button>
      <button data-md="image" title="插入图片">🖼</button>
      <button data-md="table" title="表格">≡ 表格</button>
      <button data-md="math" title="块级公式">Σ 公式</button>
      <button data-md="mathi" title="行内公式">$x$</button>
      <span class="kb-mode">
        <button data-mode="split" class="${vm === "split" ? "on" : ""}">分屏</button>
        <button data-mode="edit" class="${vm === "edit" ? "on" : ""}">编辑</button>
        <button data-mode="preview" class="${vm === "preview" ? "on" : ""}">预览</button>
      </span>
    </div>
    <div class="kb-editor-body mode-${vm}">
      <textarea class="kb-textarea" id="kbText" placeholder="用 Markdown 写笔记…
# 标题
- 列表
行内代码：前后各一个反引号
**加粗**">${esc(node.content || "")}</textarea>
      <div class="kb-preview markdown-body" id="kbPreview"></div>
    </div>
    <div class="kb-savebar"><span class="kb-save-dot" id="kbSaveDot"></span><span id="kbSaveState">已保存</span></div>
  `;

  const e = editor;
  const ta = e.querySelector("#kbText");
  const pv = e.querySelector("#kbPreview");
  const dot = e.querySelector("#kbSaveDot");
  const saveState = e.querySelector("#kbSaveState");

  const refreshPreview = () => { pv.innerHTML = mdToHtml(ta.value); };
  const markDirty = (label) => { dot.classList.add("dirty"); saveState.textContent = label || "编辑中…"; };
  const markSaved = (t) => { dot.classList.remove("dirty"); saveState.textContent = t || "已保存"; };

  // 预览初始
  refreshPreview();
  // KaTeX 加载完成后重渲染（公式从回退文本变为真正的数学排版）
  ensureKatex().then(() => { if (pv.isConnected) refreshPreview(); }).catch(() => {});

  // 自动保存（400ms 防抖）
  const saveContent = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      store.updateKbNode(node.id, { content: ta.value });
      markSaved();
      const meta = e.querySelector(".kb-meta");
      if (meta) meta.textContent = `创建 ${fmtTime(node.createdAt)} · 更新 ${fmtTime(Date.now())}`;
    }, 400);
  };
  ta.addEventListener("input", () => { refreshPreview(); markDirty(); saveContent(); });

  // 标题自动保存
  const titleInput = e.querySelector("#kbTitle");
  const saveTitle = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { store.updateKbNode(node.id, { title: titleInput.value }); markSaved(); }, 500);
  };
  titleInput.addEventListener("input", () => { markDirty("标题编辑中…"); saveTitle(); });
  titleInput.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); ta.focus(); } });

  // 工具栏
  const toolActions = {
    bold: () => wrapSelection(ta, "**", "**", "加粗文字"),
    italic: () => wrapSelection(ta, "*", "*", "斜体文字"),
    strike: () => wrapSelection(ta, "~~", "~~", "删除线文字"),
    h2: () => prependLine(ta, "## "),
    quote: () => prependLine(ta, "> "),
    ul: () => prependLine(ta, "- "),
    ol: () => prependLine(ta, "1. "),
    code: () => wrapSelection(ta, "`", "`", "code"),
    link: () => wrapSelection(ta, "[", "](https://)", "链接文字"),
    table: () => {
      const tpl = "\n| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n| 内容 | 内容 | 内容 |\n";
      insertAtCursor(ta, tpl);
    },
    image: () => insertImage(ta, refreshPreview, markDirty, saveContent),
    math: () => wrapSelection(ta, "\n$$\n", "\n$$\n", "\\frac{a}{b}"),
    mathi: () => wrapSelection(ta, "$", "$", "x^2"),
  };
  e.querySelectorAll("[data-md]").forEach((btn) => {
    btn.onclick = () => { const fn = toolActions[btn.dataset.md]; if (fn) { fn(); ta.focus(); } };
  });

  // 模式切换
  e.querySelectorAll("[data-mode]").forEach((btn) => {
    btn.onclick = () => {
      state.viewMode = btn.dataset.mode;
      renderEditor(editor); // 重渲染编辑器保持焦点数据
    };
  });
}

/* ---------- 编辑器辅助 ---------- */
function wrapSelection(ta, before, after, placeholder) {
  const s = ta.selectionStart, e2 = ta.selectionEnd;
  const sel = ta.value.slice(s, e2) || placeholder;
  ta.value = ta.value.slice(0, s) + before + sel + after + ta.value.slice(e2);
  ta.selectionStart = s + before.length;
  ta.selectionEnd = s + before.length + sel.length;
}
function prependLine(ta, prefix) {
  const s = ta.selectionStart;
  const lineStart = ta.value.lastIndexOf("\n", s - 1) + 1;
  ta.value = ta.value.slice(0, lineStart) + prefix + ta.value.slice(lineStart);
  ta.selectionStart = ta.selectionEnd = lineStart + prefix.length;
}
function insertAtCursor(ta, text) {
  const s = ta.selectionStart, e2 = ta.selectionEnd;
  ta.value = ta.value.slice(0, s) + text + ta.value.slice(e2);
  ta.selectionStart = ta.selectionEnd = s + text.length;
}
async function insertImage(ta, refreshPreview, markDirty, saveContent) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.onchange = async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast("请选择图片文件", "err"); return; }
    if (file.size > 8 * 1024 * 1024) { toast("图片过大（限 8MB）", "err"); return; }
    toast("图片处理中…", "ok");
    const dataUrl = await fileToCompressedDataUrl(file, 1000, 0.75);
    if (!dataUrl) { toast("图片处理失败", "err"); return; }
    insertAtCursor(ta, `![图片](${dataUrl})\n`);
    refreshPreview(); markDirty(); saveContent();
    toast("已插入图片（建议再用文字简要说明）", "ok");
  };
  input.click();
}
function selectEditorFocus(editor, id) {
  const ta = editor.querySelector("#kbText");
  if (ta) setTimeout(() => ta.focus(), 30);
}

/* ---------- 树操作 ---------- */
function toggleFolder(id, treeWrap, editor) {
  if (state.expanded.has(id)) state.expanded.delete(id);
  else state.expanded.add(id);
  treeWrap.innerHTML = renderTreeHtml();
  if (editor) renderEditor(editor);
}

function handleAction(act, id, container) {
  const node = nodeById(id);
  if (!node) return;
  const treeWrap = container.querySelector("#kbTreeList");
  const editor = container.querySelector("#kbEditor");
  if (act === "add-note") {
    const n = store.addKbNode({ type: "note", parentId: id });
    state.selectedId = n.id; state.expanded.add(id);
    renderKnowledgeBase(container);
  } else if (act === "add-folder") {
    const n = store.addKbNode({ type: "folder", parentId: id });
    state.selectedId = n.id; state.expanded.add(id);
    renderKnowledgeBase(container);
  } else if (act === "rename") {
    openModal({
      title: "重命名",
      body: `<div class="field"><label>新名称</label><input class="input" id="rn_name" value="${esc(node.title)}" /></div>`,
      footer: `<button class="btn btn-ghost" id="rn_cancel">取消</button><button class="btn btn-primary" id="rn_save">保存</button>`,
      onMount: (root) => {
        root.querySelector("#rn_name").focus();
        root.querySelector("#rn_cancel").onclick = () => closeModal();
        root.querySelector("#rn_save").onclick = () => {
          const v = root.querySelector("#rn_name").value.trim();
          if (!v) { toast("名称不能为空", "err"); return; }
          store.updateKbNode(id, { title: v });
          toast("已重命名", "ok");
          closeModal();
          renderKnowledgeBase(container);
        };
        root.querySelector("#rn_name").addEventListener("keydown", (ev) => { if (ev.key === "Enter") root.querySelector("#rn_save").click(); });
      },
    });
  } else if (act === "move") {
    moveNodeDialog(id, container);
  } else if (act === "del") {
    const isFolder = node.type === "folder";
    const msg = isFolder
      ? `删除文件夹「${node.title}」将<b>一并删除其下的所有子文件夹与笔记</b>，不可恢复。确认？`
      : `确认删除笔记「${node.title}」？`;
    confirmBox("删除", msg).then((ok) => {
      if (!ok) return;
      if (state.selectedId === id || isDescendant(state.selectedId, id)) state.selectedId = null;
      store.deleteKbNode(id);
      toast("已删除", "ok");
      renderKnowledgeBase(container);
    });
  }
}

function moveNodeDialog(id, container) {
  const node = nodeById(id);
  const folders = store.listKb().filter((n) => n.type === "folder" && n.id !== id && !isDescendant(n.id, id));
  const opts = [`<option value="">根目录</option>`].concat(
    folders.map((f) => {
      // 计算层级前缀
      let depth = 0, cur = f;
      while (cur.parentId) { depth++; cur = nodeById(cur.parentId); }
      return `<option value="${f.id}" ${node.parentId === f.id ? "selected" : ""}>${"　".repeat(depth)}${esc(f.title)}</option>`;
    })
  ).join("");
  openModal({
    title: `移动「${node.title}」`,
    body: `<div class="field"><label>目标文件夹</label><select class="select" id="mv_target">${opts}</select></div>`,
    footer: `<button class="btn btn-ghost" id="mv_cancel">取消</button><button class="btn btn-primary" id="mv_save">移动</button>`,
    onMount: (root) => {
      root.querySelector("#mv_cancel").onclick = () => closeModal();
      root.querySelector("#mv_save").onclick = () => {
        const target = root.querySelector("#mv_target").value || null;
        store.moveKbNode(id, target);
        toast("已移动", "ok");
        closeModal();
        renderKnowledgeBase(container);
      };
    },
  });
}
