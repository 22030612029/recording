/* ============================================================
 * features.js — 增强功能：全局搜索 / 键盘快捷键 / 暗色模式 /
 *               备份提醒 / 艾宾浩斯复习面板
 * ============================================================ */
import * as store from "./storage.js";

/* ============================================================
 * 1. 全局搜索
 * ============================================================ */
export function globalSearch(query) {
  query = (query || "").trim().toLowerCase();
  if (!query) return [];
  const data = store.getData();
  const results = [];
  const q = query;

  // 错题
  data.errors.forEach((e) => {
    const text = [e.question, e.wrongOption, e.correctAnswer, e.module, e.reason, ...(e.tags || [])].join(" ").toLowerCase();
    if (text.includes(q)) {
      results.push({ type: "错题", view: "knowledge", id: e.id, title: e.question.slice(0, 60) || "(无题干)", sub: e.module + " · " + e.reason });
    }
  });

  // 知识点
  data.knowledge.forEach((k) => {
    const text = [k.content, k.module, k.type, ...(k.tags || [])].join(" ").toLowerCase();
    if (text.includes(q)) {
      results.push({ type: "知识点", view: "knowledge", id: k.id, title: k.content.slice(0, 60) || "(无内容)", sub: k.module + " · " + k.type });
    }
  });

  // 试卷
  data.papers.forEach((p) => {
    const text = [p.name, p.type, p.subject, p.note].join(" ").toLowerCase();
    if (text.includes(q)) {
      results.push({ type: "试卷", view: "papers", id: p.id, title: p.name, sub: p.subject + " · " + p.type + " · " + p.score + "/" + p.totalScore });
    }
  });

  // 知识库笔记
  if (Array.isArray(data.kb)) {
    data.kb.forEach((n) => {
      if (n.type !== "note") return;
      const text = [n.title, n.content].join(" ").toLowerCase();
      if (text.includes(q)) {
        results.push({ type: "笔记", view: "kb", id: n.id, title: n.title, sub: "知识库" });
      }
    });
  }

  return results.slice(0, 50);
}

/* ============================================================
 * 2. 键盘快捷键
 * ============================================================ */
export function initShortcuts({ onSwitchView, onOpenSearch, onSave }) {
  const VIEW_KEYS = { "1": "dashboard", "2": "papers", "3": "knowledge", "4": "kb", "5": "analysis", "6": "settings" };

  document.addEventListener("keydown", (e) => {
    // Ctrl/Cmd+K → 全局搜索
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      onOpenSearch?.();
      return;
    }
    // Ctrl/Cmd+S → 保存
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      onSave?.();
      return;
    }
    // Alt+1~6 → 切换页面
    if (e.altKey && VIEW_KEYS[e.key]) {
      e.preventDefault();
      onSwitchView?.(VIEW_KEYS[e.key]);
      return;
    }
  });
}

/* ============================================================
 * 3. 主题配色
 * ============================================================ */
const THEME_KEY = "kaoyan_theme";

// 可用配色方案列表
export const THEMES = [
  { id: "warm", name: "暖纸金", desc: "默认暖色调，学院金" },
  { id: "blue", name: "科技蓝", desc: "清爽蓝灰，科技感" },
  { id: "green", name: "清新绿", desc: "自然绿意，护眼" },
  { id: "purple", name: "优雅紫", desc: "神秘紫色，优雅" },
  { id: "pink", name: "温柔粉", desc: "柔和粉色，温馨" },
  { id: "dark", name: "深色模式", desc: "暗色护眼，夜间" },
];

export function getTheme() {
  const theme = localStorage.getItem(THEME_KEY);
  // 兼容旧版本：旧版本默认 "light"，现在改为 "warm"
  if (theme === "light") return "warm";
  return theme || "warm";
}

export function setTheme(theme) {
  // 移除所有主题类
  document.documentElement.classList.remove("dark");
  // 设置 data-theme 属性
  document.documentElement.setAttribute("data-theme", theme);
  // 深色模式额外添加 dark 类（兼容旧代码）
  if (theme === "dark") {
    document.documentElement.classList.add("dark");
  }
  localStorage.setItem(THEME_KEY, theme);
}

export function toggleTheme() {
  const current = getTheme();
  const currentIndex = THEMES.findIndex(t => t.id === current);
  const nextIndex = (currentIndex + 1) % THEMES.length;
  const next = THEMES[nextIndex].id;
  setTheme(next);
  return next;
}

export function initTheme() {
  setTheme(getTheme());
}

/* ============================================================
 * 4. 备份提醒
 * ============================================================ */
const BACKUP_KEY = "kaoyan_last_backup";
const BACKUP_INTERVAL = 7 * 24 * 3600 * 1000; // 7天

export function shouldRemindBackup() {
  const last = parseInt(localStorage.getItem(BACKUP_KEY) || "0", 10);
  if (!last) return true; // 从未备份
  return Date.now() - last > BACKUP_INTERVAL;
}

export function markBackedUp() {
  localStorage.setItem(BACKUP_KEY, String(Date.now()));
}

/* ============================================================
 * 5. 艾宾浩斯复习面板
 * ============================================================ */
export function renderReviewPanel(container) {
  const stats = store.getReviewStats();
  const due = store.getDueReviews();

  if (due.length === 0) {
    container.innerHTML = `
      <div class="review-empty">
        <div class="review-empty-ico">✓</div>
        <h3>今日复习已完成</h3>
        <p>共 ${stats.total} 道错题，已完成 ${stats.completed} 道全部轮次</p>
      </div>`;
    return;
  }

  container.innerHTML = `
    <div class="review-head">
      <div class="review-title">今日待复习 <span class="review-count">${due.length}</span></div>
      <div class="review-stats">已完成 ${stats.completed} / ${stats.total} · 今日已复习 ${stats.todayReviewed}</div>
    </div>
    <div class="review-list">
      ${due.map((e, i) => `
        <div class="review-item" data-id="${e.id}">
          <div class="review-item-num">${i + 1}</div>
          <div class="review-item-body">
            <div class="review-item-q">${escHtml(e.question.slice(0, 80) || "(无题干)")}</div>
            <div class="review-item-meta">
              <span class="review-tag">${escHtml(e.module || "未分类")}</span>
              <span class="review-reason">${escHtml(e.reason || "")}</span>
              <span class="review-stage">第 ${(e.reviewStage || 0) + 1} 轮</span>
            </div>
            ${e.correctAnswer ? `<div class="review-item-answer">正确答案：${escHtml(e.correctAnswer)}</div>` : ""}
          </div>
          <div class="review-item-actions">
            <button class="btn btn-primary btn-sm review-done" data-id="${e.id}">已掌握</button>
            <button class="btn btn-ghost btn-sm review-snooze" data-id="${e.id}">稍后</button>
          </div>
        </div>
      `).join("")}
    </div>`;

  // 绑定事件
  container.querySelectorAll(".review-done").forEach((btn) => {
    btn.onclick = () => {
      store.markReviewed(btn.dataset.id);
      renderReviewPanel(container);
    };
  });
  container.querySelectorAll(".review-snooze").forEach((btn) => {
    btn.onclick = () => {
      store.snoozeReview(btn.dataset.id);
      renderReviewPanel(container);
    };
  });
}

function escHtml(s) {
  s = s == null ? "" : String(s);
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
