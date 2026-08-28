/* ============================================================
 * kb.js — 知识库（全新设计：卡片列表 + 简洁 Markdown 编辑器）
 * 左侧笔记卡片列表、右侧编辑器、图片占位符、LaTeX、自动保存
 * ============================================================ */
import { openModal, closeModal, toast, esc, confirmBox } from "./app.js";
import * as store from "./storage.js";
import { fileToCompressedDataUrl } from "./knowledge.js";

/* ---------- 模块状态 ---------- */
const state = {
  selectedId: null,
  q: "",
  viewMode: "preview",  // split | edit | preview
  categoryFilter: "all", // all | 分类名
};

let saveTimer = null;

/* ---------- Markdown 渲染（自研、安全：先转义 HTML） ---------- */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/* 提取摘要（纯文本前 N 字） */
function extractSummary(content, maxLen = 80) {
  if (!content) return "";
  // 移除图片 markdown
  let text = content.replace(/!\[([^\]]*)\]\([^)]+\)/g, "[图片]");
  // 移除 markdown 符号
  text = text.replace(/[#*>`_~\-]/g, "").replace(/\n+/g, " ").trim();
  return text.length > maxLen ? text.substring(0, maxLen) + "…" : text;
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

/* 渲染行内/块级公式（安全回退） */
function renderMath(text) {
  if (!window.katex) return text;
  // 块级 $$...$$
  text = text.replace(/\$\$([\s\S]+?)\$\$/g, (_, expr) => {
    try { return `<div class="math-block">${window.katex.renderToString(expr.trim(), { displayMode: true, throwOnError: false })}</div>`; }
    catch { return `<div class="math-block math-fallback">$$${escapeHtml(expr)}$$</div>`; }
  });
  // 行内 $...$
  text = text.replace(/(^|[^\\])\$([^\n$]+?)\$/g, (_, pre, expr) => {
    try { return pre + `<span class="math-inline">${window.katex.renderToString(expr.trim(), { displayMode: false, throwOnError: false })}</span>`; }
    catch { return pre + `$${escapeHtml(expr)}$`; }
  });
  return text;
}

/* ---------- Markdown → HTML ---------- */
function mdToHtml(md) {
  if (!md) return "";
  let html = escapeHtml(md);
  // 代码块 ```
  html = html.replace(/```([\s\S]*?)```/g, (_, code) => `<pre><code>${code}</code></pre>`);
  // 行内代码
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  // 图片 → 卡片
  html = html.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, src) =>
    `<span class="md-image-card"><img src="${src}" alt="${alt}" /><span class="md-image-caption">${escapeHtml(alt)}</span></span>`);
  // 链接
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  // 标题
  html = html.replace(/^###### (.+)$/gm, "<h6>$1</h6>");
  html = html.replace(/^##### (.+)$/gm, "<h5>$1</h5>");
  html = html.replace(/^#### (.+)$/gm, "<h4>$1</h4>");
  html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");
  // 引用
  html = html.replace(/^&gt; (.+)$/gm, "<blockquote>$1</blockquote>");
  // 粗体、斜体、删除线
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  html = html.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  // 无序列表
  html = html.replace(/^[-*] (.+)$/gm, "<li>$1</li>");
  html = html.replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`);
  // 有序列表
  html = html.replace(/^\d+\. (.+)$/gm, "<li>$1</li>");
  html = html.replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ol>${m}</ol>`);
  // 表格（简单）
  html = html.replace(/^\|(.+)\|\n\|[-:| ]+\|\n((?:\|.+\|\n?)+)/gm, (_, header, body) => {
    const ths = header.split("|").filter(Boolean).map(h => `<th>${h.trim()}</th>`).join("");
    const trs = body.trim().split("\n").map(row => {
      const tds = row.split("|").filter(Boolean).map(d => `<td>${d.trim()}</td>`).join("");
      return `<tr>${tds}</tr>`;
    }).join("");
    return `<table><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`;
  });
  // 段落
  html = html.replace(/\n\n/g, "</p><p>");
  html = "<p>" + html + "</p>";
  // 清理空段落
  html = html.replace(/<p><\/p>/g, "");
  html = html.replace(/<p>\s*<\/p>/g, "");
  // 公式
  html = renderMath(html);
  return html;
}

/* ---------- 工具函数 ---------- */
function fmtTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return "刚刚";
  if (diff < 3600000) return Math.floor(diff / 60000) + "分钟前";
  if (diff < 86400000) return Math.floor(diff / 3600000) + "小时前";
  if (diff < 604800000) return Math.floor(diff / 86400000) + "天前";
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function defaultNoteTitle() {
  const d = new Date();
  return `未命名笔记 ${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}

/* 获取所有笔记（排除文件夹） */
function getAllNotes() {
  return store.listKb().filter(n => n.type === "note");
}

/* 获取所有分类（从笔记的 category 字段提取） */
function getAllCategories() {
  const cats = new Set();
  getAllNotes().forEach(n => { if (n.category) cats.add(n.category); });
  return Array.from(cats).sort();
}

/* ---------- 主渲染 ---------- */
export function renderKnowledgeBase(container) {
  const notes = getAllNotes();
  const selectedNote = state.selectedId ? store.getKbNode(state.selectedId) : null;

  container.innerHTML = `
    <div class="kb-layout">
      <!-- 左侧：笔记列表 -->
      <aside class="kb-sidebar" id="kbSidebar">
        <div class="kb-sidebar-header">
          <h2 class="kb-sidebar-title">知识库</h2>
          <button class="btn btn-primary btn-sm kb-new-btn" id="kbNewNote" type="button">+ 新建</button>
        </div>
        <div class="kb-search-wrap">
          <input type="search" class="kb-search" id="kbSearch" placeholder="搜索笔记标题或内容…" value="${esc(state.q)}" />
        </div>
        <div class="kb-category-filter" id="kbCategoryFilter">
          ${renderCategoryFilter()}
        </div>
        <div class="kb-note-list" id="kbNoteList">
          ${renderNoteList(notes)}
        </div>
        <div class="kb-sidebar-footer">
          <span class="kb-count">共 ${notes.length} 篇笔记</span>
        </div>
      </aside>

      <!-- 右侧：编辑器 -->
      <main class="kb-editor-panel" id="kbEditorPanel">
        <button class="kb-toggle-sidebar" id="kbToggleSidebar" type="button" title="折叠/展开笔记列表">☰</button>
        ${selectedNote ? renderEditor(selectedNote) : renderEmptyState()}
      </main>
    </div>
  `;

  bindEvents(container);
}

/* ---------- 分类筛选 ---------- */
function renderCategoryFilter() {
  const cats = getAllCategories();
  let html = `<button class="kb-cat-tag ${state.categoryFilter === 'all' ? 'active' : ''}" data-cat="all">全部</button>`;
  cats.forEach(cat => {
    html += `<button class="kb-cat-tag ${state.categoryFilter === cat ? 'active' : ''}" data-cat="${esc(cat)}">${esc(cat)}</button>`;
  });
  return html;
}

/* ---------- 笔记列表 ---------- */
function renderNoteList(notes) {
  // 筛选
  let filtered = notes;
  if (state.categoryFilter !== "all") {
    filtered = filtered.filter(n => n.category === state.categoryFilter);
  }
  if (state.q) {
    const q = state.q.toLowerCase();
    filtered = filtered.filter(n =>
      n.title.toLowerCase().includes(q) ||
      String(n.content || "").toLowerCase().includes(q)
    );
  }
  // 按更新时间排序
  filtered.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  if (filtered.length === 0) {
    return `<div class="kb-empty-list">
      <div class="kb-empty-icon">📝</div>
      <p class="kb-empty-text">${state.q ? "没有找到匹配的笔记" : "还没有笔记，点击上方新建吧"}</p>
    </div>`;
  }

  return filtered.map(n => `
    <div class="kb-note-card ${state.selectedId === n.id ? 'active' : ''}" data-note-id="${n.id}">
      <div class="kb-note-card-header">
        <h3 class="kb-note-card-title">${esc(n.title || "未命名")}</h3>
        <button class="kb-note-card-delete" data-delete="${n.id}" title="删除">×</button>
      </div>
      <p class="kb-note-card-summary">${esc(extractSummary(n.content))}</p>
      <div class="kb-note-card-meta">
        ${n.category ? `<span class="kb-note-card-cat">${esc(n.category)}</span>` : ""}
        <span class="kb-note-card-time">${fmtTime(n.updatedAt)}</span>
      </div>
    </div>
  `).join("");
}

/* ---------- 空状态 ---------- */
function renderEmptyState() {
  return `<div class="kb-empty-editor">
    <div class="kb-empty-editor-icon">📚</div>
    <h2 class="kb-empty-editor-title">选择一篇笔记开始阅读</h2>
    <p class="kb-empty-editor-desc">或者点击左侧「+ 新建」创建一篇新笔记</p>
  </div>`;
}

/* ---------- 编辑器 ---------- */
function renderEditor(note) {
  const vm = state.viewMode;
  return `
    <div class="kb-editor" id="kbEditor">
      <div class="kb-editor-top">
        <input class="kb-title-input" id="kbTitle" value="${esc(note.title)}" placeholder="笔记标题" />
        <div class="kb-editor-actions">
          <input class="kb-cat-input" id="kbCategory" type="text" placeholder="分类（可选）" value="${esc(note.category || "")}" list="kbCatList" />
          <datalist id="kbCatList">${getAllCategories().map(c => `<option value="${esc(c)}">`).join("")}</datalist>
          <button class="btn btn-primary btn-sm" id="kbSaveBtn" type="button">💾 保存</button>
        </div>
      </div>
      <div class="kb-editor-meta">
        <span>创建 ${fmtTime(note.createdAt)}</span>
        <span>更新 ${fmtTime(note.updatedAt)}</span>
      </div>
      <div class="kb-mdbar">
        <button data-md="bold" title="加粗"><b>B</b></button>
        <button data-md="italic" title="斜体"><i>I</i></button>
        <button data-md="strike" title="删除线"><s>S</s></button>
        <button data-md="h2" title="标题">H</button>
        <button data-md="quote" title="引用">❝</button>
        <button data-md="ul" title="无序列表">•</button>
        <button data-md="ol" title="有序列表">1.</button>
        <button data-md="code" title="代码">&lt;/&gt;</button>
        <button data-md="link" title="链接">🔗</button>
        <button data-md="image" title="插入图片">🖼</button>
        <button data-md="math" title="块级公式">Σ</button>
        <button data-md="mathi" title="行内公式">$x$</button>
        <span class="kb-mode">
          <button data-mode="edit" class="${vm === 'edit' ? 'on' : ''}">编辑</button>
          <button data-mode="split" class="${vm === 'split' ? 'on' : ''}">分屏</button>
          <button data-mode="preview" class="${vm === 'preview' ? 'on' : ''}">预览</button>
        </span>
      </div>
      <div class="kb-editor-body mode-${vm}">
        <div class="kb-textarea-wrap">
          <textarea class="kb-textarea" id="kbText" placeholder="用 Markdown 写笔记…
# 标题
- 列表
**加粗**
$$公式$$
粘贴图片自动插入">${esc(note.content || "")}</textarea>
        </div>
        <div class="kb-preview markdown-body" id="kbPreview"></div>
      </div>
      <div class="kb-savebar">
        <span class="kb-save-dot" id="kbSaveDot"></span>
        <span id="kbSaveState">已保存</span>
        <span class="kb-auto-save">自动保存 · 10秒</span>
      </div>
    </div>
  `;
}

/* ---------- 事件绑定 ---------- */
function bindEvents(container) {
  // 折叠/展开侧边栏
  const toggleBtn = container.querySelector("#kbToggleSidebar");
  const sidebar = container.querySelector("#kbSidebar");
  if (toggleBtn && sidebar) {
    toggleBtn.onclick = () => {
      sidebar.classList.toggle("collapsed");
      toggleBtn.textContent = sidebar.classList.contains("collapsed") ? "📑" : "☰";
      toggleBtn.title = sidebar.classList.contains("collapsed") ? "展开笔记列表" : "折叠笔记列表";
    };
  }

  // 新建笔记
  const newBtn = container.querySelector("#kbNewNote");
  if (newBtn) newBtn.onclick = () => {
    const n = store.addKbNode({ type: "note", title: defaultNoteTitle(), content: "" });
    state.selectedId = n.id;
    renderKnowledgeBase(container);
    // 聚焦标题
    setTimeout(() => {
      const titleInput = container.querySelector("#kbTitle");
      if (titleInput) { titleInput.focus(); titleInput.select(); }
    }, 50);
  };

  // 搜索
  const search = container.querySelector("#kbSearch");
  if (search) {
    search.oninput = (e) => {
      state.q = e.target.value.trim();
      const list = container.querySelector("#kbNoteList");
      if (list) list.innerHTML = renderNoteList(getAllNotes());
    };
  }

  // 分类筛选
  const catFilter = container.querySelector("#kbCategoryFilter");
  if (catFilter) {
    catFilter.onclick = (e) => {
      const tag = e.target.closest("[data-cat]");
      if (!tag) return;
      state.categoryFilter = tag.dataset.cat;
      catFilter.innerHTML = renderCategoryFilter();
      const list = container.querySelector("#kbNoteList");
      if (list) list.innerHTML = renderNoteList(getAllNotes());
    };
  }

  // 笔记卡片点击
  const noteList = container.querySelector("#kbNoteList");
  if (noteList) {
    noteList.onclick = (e) => {
      // 删除按钮
      const deleteBtn = e.target.closest("[data-delete]");
      if (deleteBtn) {
        e.stopPropagation();
        const id = deleteBtn.dataset.delete;
        confirmBox("确定删除这篇笔记吗？", () => {
          store.deleteKbNode(id);
          if (state.selectedId === id) state.selectedId = null;
          renderKnowledgeBase(container);
          toast("已删除", "ok");
        });
        return;
      }
      // 选中笔记
      const card = e.target.closest("[data-note-id]");
      if (!card) return;
      state.selectedId = card.dataset.noteId;
      renderKnowledgeBase(container);
    };
  }

  // 编辑器事件
  const editor = container.querySelector("#kbEditor");
  if (editor) bindEditorEvents(editor, container);
}

/* ---------- 编辑器事件 ---------- */
function bindEditorEvents(editor, container) {
  const ta = editor.querySelector("#kbText");
  const pv = editor.querySelector("#kbPreview");
  const dot = editor.querySelector("#kbSaveDot");
  const saveState = editor.querySelector("#kbSaveState");
  const note = store.getKbNode(state.selectedId);
  if (!note) return;

  const refreshPreview = () => { pv.innerHTML = mdToHtml(ta.value); };
  const markDirty = (label) => { dot.classList.add("dirty"); saveState.textContent = label || "编辑中…"; };
  const markSaved = (t) => { dot.classList.remove("dirty"); saveState.textContent = t || "已保存"; };

  // 预览初始
  refreshPreview();
  ensureKatex().then(() => { if (pv.isConnected) refreshPreview(); }).catch(() => {});

  // 自动保存（10秒防抖）
  const saveContent = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      store.updateKbNode(note.id, { content: ta.value });
      markSaved();
      const meta = editor.querySelector(".kb-editor-meta");
      if (meta) meta.innerHTML = `<span>创建 ${fmtTime(note.createdAt)}</span><span>更新 ${fmtTime(Date.now())}</span>`;
      // 更新列表中的时间
      const list = container.querySelector("#kbNoteList");
      if (list) list.innerHTML = renderNoteList(getAllNotes());
    }, 10000);
  };

  ta.addEventListener("input", () => {
    refreshPreview();
    markDirty();
    saveContent();
  });

  // 粘贴图片
  ta.addEventListener("paste", async (ev) => {
    const items = ev.clipboardData?.items;
    if (!items) return;
    let imageFile = null;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        imageFile = item.getAsFile();
        break;
      }
    }
    if (!imageFile) return;
    ev.preventDefault();
    if (imageFile.size > 8 * 1024 * 1024) { toast("图片过大（限 8MB）", "err"); return; }
    toast("图片处理中…", "ok");
    const dataUrl = await fileToCompressedDataUrl(imageFile, 1000, 0.75);
    if (!dataUrl) { toast("图片处理失败", "err"); return; }
    // 在光标位置插入图片 markdown
    const s = ta.selectionStart, e2 = ta.selectionEnd;
    ta.value = ta.value.slice(0, s) + `\n![图片](${dataUrl})\n` + ta.value.slice(e2);
    ta.selectionStart = ta.selectionEnd = s + dataUrl.length + 12;
    refreshPreview();
    markDirty();
    saveContent();
    toast("已插入图片", "ok");
  });

  // 标题自动保存
  const titleInput = editor.querySelector("#kbTitle");
  if (titleInput) {
    titleInput.addEventListener("input", () => {
      markDirty("标题编辑中…");
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        store.updateKbNode(note.id, { title: titleInput.value });
        markSaved();
        const list = container.querySelector("#kbNoteList");
        if (list) list.innerHTML = renderNoteList(getAllNotes());
      }, 10000);
    });
    titleInput.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") { ev.preventDefault(); ta.focus(); }
    });
  }

  // 分类自动保存
  const catInput = editor.querySelector("#kbCategory");
  if (catInput) {
    catInput.addEventListener("change", () => {
      store.updateKbNode(note.id, { category: catInput.value.trim() || null });
      markSaved();
      // 更新分类筛选和列表
      const catFilter = container.querySelector("#kbCategoryFilter");
      if (catFilter) catFilter.innerHTML = renderCategoryFilter();
      const list = container.querySelector("#kbNoteList");
      if (list) list.innerHTML = renderNoteList(getAllNotes());
      toast("分类已更新", "ok");
    });
  }

  // 手动保存
  const saveBtn = editor.querySelector("#kbSaveBtn");
  if (saveBtn) {
    saveBtn.onclick = () => {
      clearTimeout(saveTimer);
      store.updateKbNode(note.id, { content: ta.value, title: titleInput?.value, category: catInput?.value.trim() || null });
      markSaved();
      toast("已保存", "ok");
      const list = container.querySelector("#kbNoteList");
      if (list) list.innerHTML = renderNoteList(getAllNotes());
    };
  }

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
    image: () => insertImage(ta, refreshPreview, markDirty, saveContent),
    math: () => wrapSelection(ta, "\n$$\n", "\n$$\n", "\\frac{a}{b}"),
    mathi: () => wrapSelection(ta, "$", "$", "x^2"),
  };
  editor.querySelectorAll("[data-md]").forEach((btn) => {
    btn.onclick = () => { const fn = toolActions[btn.dataset.md]; if (fn) { fn(); ta.focus(); refreshPreview(); } };
  });

  // 模式切换
  editor.querySelectorAll("[data-mode]").forEach((btn) => {
    btn.onclick = () => {
      state.viewMode = btn.dataset.mode;
      const body = editor.querySelector(".kb-editor-body");
      body.classList.remove("mode-edit", "mode-split", "mode-preview");
      body.classList.add("mode-" + btn.dataset.mode);
      editor.querySelectorAll("[data-mode]").forEach((b) => b.classList.toggle("on", b.dataset.mode === btn.dataset.mode));
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
  ta.selectionStart = ta.selectionEnd = s + prefix.length;
}
function insertAtCursor(ta, text) {
  const s = ta.selectionStart, e2 = ta.selectionEnd;
  ta.value = ta.value.slice(0, s) + text + ta.value.slice(e2);
  ta.selectionStart = ta.selectionEnd = s + text.length;
}

/* 插入图片（文件选择） */
function insertImage(ta, refreshPreview, markDirty, saveContent) {
  const input = document.createElement("input");
  input.type = "file"; input.accept = "image/*";
  input.onchange = async () => {
    const file = input.files && input.files[0];
    if (!file || !file.type.startsWith("image/")) return;
    if (file.size > 8 * 1024 * 1024) { toast("图片过大（限 8MB）", "err"); return; }
    toast("图片处理中…", "ok");
    const dataUrl = await fileToCompressedDataUrl(file, 1000, 0.75);
    if (!dataUrl) { toast("图片处理失败", "err"); return; }
    insertAtCursor(ta, `\n![图片](${dataUrl})\n`);
    refreshPreview(); markDirty(); saveContent();
    toast("已插入图片", "ok");
  };
  input.click();
}
