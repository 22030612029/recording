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
    link.href = "../vendor/katex/katex.min.css";
    document.head.appendChild(link);
    const s = document.createElement("script");
    s.src = "../vendor/katex/katex.min.js";
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
  // 块级 \[...\]
  text = text.replace(/\\\[([\s\S]+?)\\\]/g, (_, expr) => {
    try { return `<div class="math-block">${window.katex.renderToString(expr.trim(), { displayMode: true, throwOnError: false })}</div>`; }
    catch { return `<div class="math-block math-fallback">\\[${escapeHtml(expr)}\\]</div>`; }
  });
  // 行内 $...$
  text = text.replace(/(^|[^\\])\$([^\n$]+?)\$/g, (_, pre, expr) => {
    try { return pre + `<span class="math-inline">${window.katex.renderToString(expr.trim(), { displayMode: false, throwOnError: false })}</span>`; }
    catch { return pre + `$${escapeHtml(expr)}$`; }
  });
  // 行内 \(...\)
  text = text.replace(/\\\(([\s\S]+?)\\\)/g, (_, expr) => {
    try { return `<span class="math-inline">${window.katex.renderToString(expr.trim(), { displayMode: false, throwOnError: false })}</span>`; }
    catch { return `\\(${escapeHtml(expr)}\\)`; }
  });
  return text;
}

/* ---------- HTML 消毒（XSS 防护） ---------- */
const ALLOWED_TAGS = new Set([
  "h1","h2","h3","h4","h5","h6","p","br","hr",
  "strong","em","del","u","sub","sup","mark",
  "ul","ol","li","blockquote","pre","code",
  "table","thead","tbody","tr","th","td",
  "a","img","span","div",
]);
const ALLOWED_ATTRS = {
  "a": ["href","title","target","rel"],
  "img": ["src","alt","title","class"],
  "span": ["class"],
  "div": ["class"],
  "code": ["class"],
  "pre": ["class"],
  "blockquote": ["class"],
};
const SAFE_PROTOCOLS = ["http://","https://","data:image/","mailto:","#"];

function sanitizeUrl(url) {
  if (!url) return "";
  const lower = url.toLowerCase().trim();
  // 禁止 javascript:、vbscript:、data:text/html 等危险协议
  if (lower.startsWith("javascript:") || lower.startsWith("vbscript:") ||
      lower.startsWith("data:text/html") || lower.startsWith("data:text/javascript")) {
    return "";
  }
  // 相对路径或安全协议允许
  if (lower.startsWith("/") || lower.startsWith("#") || SAFE_PROTOCOLS.some(p => lower.startsWith(p))) {
    return url;
  }
  return "";
}

function sanitizeHtml(html) {
  if (!html) return "";
  // 使用 DOMParser 解析，然后过滤危险标签和属性
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${html}</div>`, "text/html");
    const container = doc.body.firstChild;

    function cleanNode(node) {
      const children = Array.from(node.childNodes);
      children.forEach(child => {
        if (child.nodeType === 1) { // 元素节点
          const tag = child.tagName.toLowerCase();
          if (!ALLOWED_TAGS.has(tag)) {
            // 移除危险标签，但保留其文本内容
            const text = doc.createTextNode(child.textContent);
            node.replaceChild(text, child);
            return;
          }
          // 过滤属性
          const attrs = Array.from(child.attributes);
          attrs.forEach(attr => {
            const name = attr.name.toLowerCase();
            const allowed = ALLOWED_ATTRS[tag] || [];
            if (!allowed.includes(name) || name.startsWith("on")) {
              child.removeAttribute(attr.name);
            } else if (name === "href" || name === "src") {
              const safe = sanitizeUrl(attr.value);
              if (!safe) child.removeAttribute(attr.name);
              else child.setAttribute(name, safe);
            }
          });
          // 强制 a 标签添加 rel="noopener"
          if (tag === "a") {
            child.setAttribute("rel", "noopener noreferrer");
            child.setAttribute("target", "_blank");
          }
          // 递归处理子节点
          cleanNode(child);
        } else if (child.nodeType === 8) { // 注释节点
          node.removeChild(child);
        }
      });
    }

    cleanNode(container);
    return container.innerHTML;
  } catch (e) {
    // 解析失败，返回转义后的纯文本
    return escapeHtml(html);
  }
}

/* ---------- Markdown → HTML ---------- */
function mdToHtml(md) {
  if (!md) return "";
  let html = escapeHtml(md);
  // 代码块 ```
  html = html.replace(/```([\s\S]*?)```/g, (_, code) => `<pre><code>${code}</code></pre>`);
  // 行内代码
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  // 图片 → 卡片（src 消毒）
  html = html.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, src) => {
    const safeSrc = sanitizeUrl(src);
    if (!safeSrc) return escapeHtml(`![${alt}](${src})`);
    return `<span class="md-image-card"><img src="${safeSrc}" alt="${escapeHtml(alt)}" loading="lazy" /><span class="md-image-caption">${escapeHtml(alt)}</span></span>`;
  });
  // 链接（href 消毒）
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, href) => {
    const safeHref = sanitizeUrl(href);
    if (!safeHref) return escapeHtml(`[${text}](${href})`);
    return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer">${text}</a>`;
  });
  // 标题
  html = html.replace(/^###### (.+)$/gm, "<h6>$1</h6>");
  html = html.replace(/^##### (.+)$/gm, "<h5>$1</h5>");
  html = html.replace(/^#### (.+)$/gm, "<h4>$1</h4>");
  html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");
  // 多行引用块（连续的 > 行，包括空行 >）
  html = html.replace(/(?:^&gt;[^\n]*\n?)+/gm, (match) => {
    const lines = match.replace(/\n$/, "").split("\n").map(line => line.replace(/^&gt;\s?/, ""));
    const content = lines.join("<br>");
    const isSummary = content.includes("📝") && content.includes("总结");
    const cls = isSummary ? ' class="md-summary"' : "";
    return `<blockquote${cls}>${content}</blockquote>\n`;
  });
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
  // 表格（简单）- 内容已转义
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
  // 最终消毒
  return sanitizeHtml(html);
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
        <button data-md="summary" title="插入总结（Ctrl+J）">📝</button>
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
        <span class="kb-stats" id="kbStats"></span>
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
        confirmBox("删除确认", "确定删除这篇笔记吗？此操作不可撤销。").then((ok) => {
          if (ok) {
            store.deleteKbNode(id);
            if (state.selectedId === id) state.selectedId = null;
            renderKnowledgeBase(container);
            toast("已删除", "ok");
          }
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
  const titleInput = editor.querySelector("#kbTitle");
  const note = store.getKbNode(state.selectedId);
  if (!note) return;

  const refreshPreview = () => {
    pv.innerHTML = mdToHtml(ta.value);
    // 绑定图片点击事件（打开图片查看器）
    pv.querySelectorAll("img").forEach((img) => {
      img.style.cursor = "zoom-in";
      img.onclick = () => openImageViewer(img.src, img.alt);
    });
    updateStats();
  };
  const updateStats = () => {
    const statsEl = editor.querySelector("#kbStats");
    if (!statsEl) return;
    const text = ta.value;
    const chars = text.length;
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const readTime = Math.max(1, Math.ceil(chars / 400));
    statsEl.textContent = `${chars} 字 · ${words} 词 · 约 ${readTime} 分钟阅读`;
  };
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

  // 在选中文本前后包裹字符
  const wrapSelection = (before, after) => {
    const s = ta.selectionStart, e = ta.selectionEnd;
    const selected = ta.value.slice(s, e);
    ta.value = ta.value.slice(0, s) + before + selected + after + ta.value.slice(e);
    ta.selectionStart = s + before.length;
    ta.selectionEnd = e + before.length;
    ta.dispatchEvent(new Event("input"));
  };

  // 快捷键支持
  ta.addEventListener("keydown", (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key === "s") {
      ev.preventDefault();
      clearTimeout(saveTimer);
      store.updateKbNode(note.id, { content: ta.value, title: titleInput?.value });
      markSaved("已保存 · " + new Date().toLocaleTimeString());
      toast("已保存", "ok");
      return;
    }
    if ((ev.ctrlKey || ev.metaKey) && ev.key === "b") {
      ev.preventDefault();
      wrapSelection("**", "**");
      return;
    }
    if ((ev.ctrlKey || ev.metaKey) && ev.key === "i") {
      ev.preventDefault();
      wrapSelection("*", "*");
      return;
    }
    if ((ev.ctrlKey || ev.metaKey) && ev.key === "k") {
      ev.preventDefault();
      wrapSelection("[", "](链接)");
      return;
    }
    if ((ev.ctrlKey || ev.metaKey) && ev.key === "j") {
      ev.preventDefault();
      insertSummary(ta);
      refreshPreview();
      return;
    }
    if (ev.key === "Tab") {
      ev.preventDefault();
      const s = ta.selectionStart, e = ta.selectionEnd;
      ta.value = ta.value.slice(0, s) + "  " + ta.value.slice(e);
      ta.selectionStart = ta.selectionEnd = s + 2;
      ta.dispatchEvent(new Event("input"));
    }
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
    const dataUrl = await fileToCompressedDataUrl(imageFile, 1800, 0.88);
    if (!dataUrl) { toast("图片处理失败", "err"); return; }
    // 在光标位置插入图片
    const s = ta.selectionStart, e2 = ta.selectionEnd;
    const imgBlock = `\n![图片](${dataUrl})\n\n`;
    ta.value = ta.value.slice(0, s) + imgBlock + ta.value.slice(e2);
    // 将光标定位到图片后面，方便继续输入或添加总结
    ta.selectionStart = ta.selectionEnd = s + imgBlock.length;
    refreshPreview();
    markDirty();
    saveContent();
    toast("已插入图片，需要总结时点工具栏 📝 或按 Ctrl+J", "ok");
  });

  // 标题自动保存
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
    summary: () => insertSummary(ta),
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

/* 插入总结块（引用样式，光标定位到内容区） */
function insertSummary(ta) {
  const s = ta.selectionStart, e2 = ta.selectionEnd;
  const sel = ta.value.slice(s, e2);
  // 确保前面有空行
  const needPrefix = s > 0 && ta.value[s - 1] !== "\n";
  const summaryBlock = `${needPrefix ? "\n" : ""}> 📝 **总结：**\n> \n> ${sel || ""}\n\n`;
  ta.value = ta.value.slice(0, s) + summaryBlock + ta.value.slice(e2);
  // 光标定位到总结内容行（"> " 后面）
  const contentStart = s + (needPrefix ? 1 : 0) + "> 📝 **总结：**\n> \n> ".length;
  ta.selectionStart = ta.selectionEnd = contentStart + (sel ? sel.length : 0);
  ta.dispatchEvent(new Event("input"));
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
    const dataUrl = await fileToCompressedDataUrl(file, 1800, 0.88);
    if (!dataUrl) { toast("图片处理失败", "err"); return; }
    // 插入图片
    const s = ta.selectionStart, e2 = ta.selectionEnd;
    const imgBlock = `\n![图片](${dataUrl})\n\n`;
    ta.value = ta.value.slice(0, s) + imgBlock + ta.value.slice(e2);
    ta.selectionStart = ta.selectionEnd = s + imgBlock.length;
    refreshPreview(); markDirty(); saveContent();
    toast("已插入图片，需要总结时点 📝 或按 Ctrl+J", "ok");
  };
  input.click();
}

/* ---------- 图片查看器（灯箱）：支持缩放、拖拽 ---------- */
let imageViewerState = null;

function openImageViewer(src, alt) {
  // 移除已存在的查看器
  closeImageViewer();

  const viewer = document.createElement("div");
  viewer.className = "kb-image-viewer";
  viewer.id = "kbImageViewer";
  viewer.innerHTML = `
    <div class="kb-image-viewer-toolbar">
      <span class="kb-image-viewer-title">${esc(alt || "图片预览")}</span>
      <div class="kb-image-viewer-actions">
        <button class="kb-iv-btn" data-action="zoom-out" title="缩小 (-)">−</button>
        <span class="kb-iv-zoom" id="kbIvZoom">100%</span>
        <button class="kb-iv-btn" data-action="zoom-in" title="放大 (+)">+</button>
        <button class="kb-iv-btn" data-action="reset" title="重置 (0)">⟲</button>
        <button class="kb-iv-btn kb-iv-close" data-action="close" title="关闭 (ESC)">✕</button>
      </div>
    </div>
    <div class="kb-image-viewer-stage" id="kbIvStage">
      <img class="kb-image-viewer-img" id="kbIvImg" src="${src}" alt="${esc(alt || "")}" draggable="false" />
    </div>
    <div class="kb-image-viewer-hint">滚轮缩放 · 拖拽移动 · ESC 关闭</div>
  `;
  document.body.appendChild(viewer);

  // 状态
  imageViewerState = {
    scale: 1,
    translateX: 0,
    translateY: 0,
    isDragging: false,
    startX: 0,
    startY: 0,
    viewer,
    img: viewer.querySelector("#kbIvImg"),
    stage: viewer.querySelector("#kbIvStage"),
    zoomLabel: viewer.querySelector("#kbIvZoom"),
  };

  const st = imageViewerState;

  // 更新变换
  function updateTransform() {
    st.img.style.transform = `translate(${st.translateX}px, ${st.translateY}px) scale(${st.scale})`;
    st.zoomLabel.textContent = Math.round(st.scale * 100) + "%";
  }

  // 缩放
  function zoom(delta, centerX, centerY) {
    const oldScale = st.scale;
    const newScale = Math.max(0.1, Math.min(8, st.scale + delta));
    if (centerX !== undefined) {
      // 以鼠标位置为中心缩放
      const rect = st.stage.getBoundingClientRect();
      const cx = centerX - rect.left - rect.width / 2;
      const cy = centerY - rect.top - rect.height / 2;
      st.translateX = cx - (cx - st.translateX) * (newScale / oldScale);
      st.translateY = cy - (cy - st.translateY) * (newScale / oldScale);
    }
    st.scale = newScale;
    updateTransform();
  }

  // 重置
  function resetView() {
    st.scale = 1;
    st.translateX = 0;
    st.translateY = 0;
    updateTransform();
  }

  // 工具栏按钮
  viewer.querySelectorAll("[data-action]").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const action = btn.dataset.action;
      if (action === "zoom-in") zoom(0.2);
      else if (action === "zoom-out") zoom(-0.2);
      else if (action === "reset") resetView();
      else if (action === "close") closeImageViewer();
    };
  });

  // 滚轮缩放
  st.stage.addEventListener("wheel", (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    zoom(delta, e.clientX, e.clientY);
  }, { passive: false });

  // 拖拽移动
  st.stage.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    st.isDragging = true;
    st.startX = e.clientX - st.translateX;
    st.startY = e.clientY - st.translateY;
    st.stage.style.cursor = "grabbing";
  });
  document.addEventListener("mousemove", (e) => {
    if (!st || !st.isDragging) return;
    st.translateX = e.clientX - st.startX;
    st.translateY = e.clientY - st.startY;
    updateTransform();
  });
  document.addEventListener("mouseup", () => {
    if (!st) return;
    st.isDragging = false;
    if (st.stage) st.stage.style.cursor = "grab";
  });

  // 点击背景关闭
  viewer.addEventListener("click", (e) => {
    if (e.target === viewer || e.target === st.stage) closeImageViewer();
  });

  // 键盘快捷键
  st._keyHandler = (e) => {
    if (e.key === "Escape") closeImageViewer();
    else if (e.key === "+" || e.key === "=") zoom(0.2);
    else if (e.key === "-") zoom(-0.2);
    else if (e.key === "0") resetView();
  };
  document.addEventListener("keydown", st._keyHandler);

  // 图片加载完成后自适应大小
  st.img.onload = () => {
    const maxW = window.innerWidth * 0.85;
    const maxH = window.innerHeight * 0.75;
    const imgW = st.img.naturalWidth;
    const imgH = st.img.naturalHeight;
    if (imgW > maxW || imgH > maxH) {
      const scale = Math.min(maxW / imgW, maxH / imgH);
      st.scale = scale;
      updateTransform();
    }
  };
}

function closeImageViewer() {
  const viewer = document.getElementById("kbImageViewer");
  if (viewer) viewer.remove();
  if (imageViewerState) {
    if (imageViewerState._keyHandler) {
      document.removeEventListener("keydown", imageViewerState._keyHandler);
    }
    imageViewerState = null;
  }
}
