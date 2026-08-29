/* ============================================================
 * diary.js — 小窝（日记总结 · 趣味暖心）
 * 每日心情打卡、暖心语录、连续打卡、历史回顾
 * ============================================================ */
import { toast, esc, confirmBox } from "./app.js";
import * as store from "./storage.js";

/* ---------- 暖心语录库 ---------- */
const QUOTES = [
  "你现在的努力，是在为未来的自己铺路。",
  "星光不问赶路人，时光不负有心人。",
  "考研这条路，走得慢但从未停下。",
  "今天的汗水，是明天的笑容。",
  "你已经坚持了这么久，别在终点前放弃。",
  "所有的努力，都会在某个时刻给你答案。",
  "累了就休息一下，但别忘了继续前行。",
  "你比自己想象的更强大。",
  "每一道错题，都是通往成功的阶梯。",
  "那些看似不起波澜的日复一日，会突然在某一天让人看到坚持的意义。",
  "你要悄悄拔尖，然后惊艳所有人。",
  "半山腰太挤了，你要去山顶看看。",
  "愿你合上笔盖的那一刻，有战士收刀入鞘的骄傲。",
  "现在的你，是过去的你用努力换来的；未来的你，是现在的你用努力成就的。",
  "别怕前路漫漫，进一寸有进一寸的欢喜。",
  "你所做的事情，也许暂时看不到成果，但不要灰心或焦虑，你不是没有成长，而是在扎根。",
  "生活不会辜负每一个努力的人。",
  "再坚持一下，一切美好正在慢慢奔向你。",
  "你要相信，你所期待的，都会如约而至。",
  "每一个优秀的人，都有一段沉默的时光，那段时光，是付出了很多努力却得不到结果的日子，我们把它叫做扎根。",
];

/* 里程碑阈值 */
const MILESTONES = [3, 7, 14, 30, 60, 100, 200, 365];

/* ---------- 模块状态 ---------- */
let todayDiary = null;

/* ---------- 主渲染 ---------- */
export function renderDiary(container) {
  const stats = store.getDiaryStats();
  const today = store.todayISO ? store.todayISO() : todayStr();
  todayDiary = store.getDiaryByDate(today) || { date: today, content: "", mood: "😌" };
  const quote = QUOTES[Math.floor(Math.random() * QUOTES.length)];
  const milestone = MILESTONES.find((m) => stats.totalDays === m);

  container.innerHTML = `
    <div class="diary-wrap">
      <!-- 顶部暖心区 -->
      <div class="diary-hero">
        <div class="diary-hero-bg"></div>
        <div class="diary-hero-content">
          <div class="diary-greeting">
            <span class="diary-date">${formatDateCN(today)}</span>
            <h2 class="diary-title">小窝 · 今日记</h2>
          </div>
          <div class="diary-quote">
            <span class="diary-quote-mark">"</span>
            <span class="diary-quote-text">${quote}</span>
            <span class="diary-quote-mark">"</span>
          </div>
          ${milestone ? `<div class="diary-milestone">🎉 恭喜达成「连续/累计 ${milestone} 天」里程碑！继续加油！</div>` : ""}
        </div>
      </div>

      <!-- 统计卡片 -->
      <div class="diary-stats">
        <div class="diary-stat-card">
          <div class="diary-stat-icon">📖</div>
          <div class="diary-stat-value">${stats.totalDays}</div>
          <div class="diary-stat-label">记录天数</div>
        </div>
        <div class="diary-stat-card">
          <div class="diary-stat-icon">🔥</div>
          <div class="diary-stat-value">${stats.streak}</div>
          <div class="diary-stat-label">连续打卡</div>
        </div>
        <div class="diary-stat-card">
          <div class="diary-stat-icon">✍️</div>
          <div class="diary-stat-value">${stats.totalWords}</div>
          <div class="diary-stat-label">累计字数</div>
        </div>
      </div>

      <!-- 今日编辑区 -->
      <div class="card diary-editor-card">
        <div class="diary-editor-head">
          <h3>今日心情与总结</h3>
          <span class="diary-save-state" id="diarySaveState">已保存</span>
        </div>
        <div class="diary-mood-picker" id="diaryMoodPicker">
          ${store.MOODS.map((m) => `
            <button class="diary-mood-btn ${todayDiary.mood === m.emoji ? "active" : ""}" data-mood="${m.emoji}" title="${m.label}">
              <span class="diary-mood-emoji">${m.emoji}</span>
              <span class="diary-mood-label">${m.label}</span>
            </button>
          `).join("")}
        </div>
        <textarea class="diary-textarea" id="diaryText" placeholder="今天学得怎么样？有什么收获、困惑或想对自己说的话？写下来吧～">${esc(todayDiary.content || "")}</textarea>
        <div class="diary-editor-foot">
          <span class="diary-char-count" id="diaryCharCount">${(todayDiary.content || "").length} 字</span>
          <div class="diary-editor-actions">
            <button class="btn btn-ghost btn-sm" id="diaryClearBtn">清空</button>
            <button class="btn btn-primary btn-sm" id="diarySaveBtn">💾 保存</button>
          </div>
        </div>
      </div>

      <!-- 最近7天心情 -->
      <div class="card diary-mood-timeline">
        <div class="diary-section-head">
          <h3>最近 7 天心情</h3>
        </div>
        <div class="diary-mood-week">
          ${stats.recentMoods.map((d) => `
            <div class="diary-mood-day ${d.hasDiary ? "has" : "empty"}" title="${d.date}${d.hasDiary ? " · 已记录" : " · 未记录"}">
              <div class="diary-mood-day-emoji">${d.mood || "·"}</div>
              <div class="diary-mood-day-date">${d.date.slice(5)}</div>
            </div>
          `).join("")}
        </div>
      </div>

      <!-- 历史日记 -->
      <div class="card diary-history">
        <div class="diary-section-head">
          <h3>历史日记</h3>
          <span class="diary-history-count">共 ${stats.totalDays} 篇</span>
        </div>
        <div class="diary-history-list" id="diaryHistoryList">
          ${renderHistoryList()}
        </div>
      </div>
    </div>
  `;

  bindEvents(container);
}

/* ---------- 历史列表 ---------- */
function renderHistoryList() {
  const diaries = store.listDiaries().filter((d) => d.date !== todayStr());
  if (!diaries.length) {
    return `<div class="diary-empty">还没有历史日记，坚持每天记录吧～</div>`;
  }
  return diaries.slice(0, 30).map((d) => `
    <div class="diary-history-item" data-id="${d.id}">
      <div class="diary-history-head">
        <span class="diary-history-date">${formatDateCN(d.date)}</span>
        <span class="diary-history-mood">${d.mood || "😌"}</span>
      </div>
      <div class="diary-history-content">${esc((d.content || "").slice(0, 120))}${(d.content || "").length > 120 ? "…" : ""}</div>
      <div class="diary-history-actions">
        <button class="btn btn-ghost btn-sm" data-action="view">查看全文</button>
        <button class="btn btn-danger btn-sm" data-action="delete">删除</button>
      </div>
    </div>
  `).join("");
}

/* ---------- 事件绑定 ---------- */
function bindEvents(container) {
  const textarea = container.querySelector("#diaryText");
  const saveState = container.querySelector("#diarySaveState");
  const charCount = container.querySelector("#diaryCharCount");
  const moodPicker = container.querySelector("#diaryMoodPicker");

  // 心情选择（标记未保存）
  moodPicker.querySelectorAll(".diary-mood-btn").forEach((btn) => {
    btn.onclick = () => {
      moodPicker.querySelectorAll(".diary-mood-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      todayDiary.mood = btn.dataset.mood;
      markUnsaved(saveState);
    };
  });

  // 文本输入（标记未保存，不自动保存）
  textarea.addEventListener("input", () => {
    charCount.textContent = `${textarea.value.length} 字`;
    markUnsaved(saveState);
  });

  // 手动保存
  container.querySelector("#diarySaveBtn").onclick = () => {
    saveDiary(textarea, saveState);
    toast("已保存", "ok");
  };

  // 清空
  container.querySelector("#diaryClearBtn").onclick = async () => {
    const ok = await confirmBox("清空今日日记", "确认清空今日日记内容？心情保留。");
    if (ok) {
      textarea.value = "";
      charCount.textContent = "0 字";
      saveDiary(textarea, saveState);
      toast("已清空", "ok");
    }
  };

  // 历史列表事件
  const historyList = container.querySelector("#diaryHistoryList");
  historyList.onclick = (e) => {
    const item = e.target.closest(".diary-history-item");
    if (!item) return;
    const action = e.target.closest("[data-action]")?.dataset.action;
    const id = item.dataset.id;
    if (action === "view") {
      viewDiaryFull(id);
    } else if (action === "delete") {
      deleteDiaryItem(id, container);
    }
  };
}

/* ---------- 标记未保存 ---------- */
function markUnsaved(saveState) {
  if (saveState) {
    saveState.textContent = "未保存 ●";
    saveState.classList.add("dirty");
  }
}

/* ---------- 保存日记 ---------- */
function saveDiary(textarea, saveState) {
  const content = textarea.value.trim();
  const today = todayStr();
  const existing = store.getDiaryByDate(today);
  if (existing) {
    store.updateDiary(existing.id, { content, mood: todayDiary.mood });
  } else if (content || todayDiary.mood !== "😌") {
    store.addDiary({ date: today, content, mood: todayDiary.mood });
  }
  todayDiary = store.getDiaryByDate(today) || { date: today, content, mood: todayDiary.mood };
  if (saveState) {
    saveState.textContent = "已保存 ✓";
    saveState.classList.remove("dirty");
  }
}

/* ---------- 查看全文 ---------- */
function viewDiaryFull(id) {
  const d = store.getDiary(id);
  if (!d) return;
  import("./app.js").then(({ openModal, closeModal }) => {
    openModal({
      title: `${formatDateCN(d.date)} · ${d.mood || "😌"}`,
      body: `<div class="diary-full-content">${esc(d.content || "(无内容)").replace(/\n/g, "<br/>")}</div>`,
      footer: `<button class="btn btn-primary" id="diaryFullClose">关闭</button>`,
      onMount: (root) => {
        root.querySelector("#diaryFullClose").onclick = () => closeModal();
      },
    });
  });
}

/* ---------- 删除日记 ---------- */
async function deleteDiaryItem(id, container) {
  const ok = await confirmBox("删除日记", "确认删除这篇日记？此操作不可撤销。");
  if (!ok) return;
  store.deleteDiary(id);
  toast("已删除", "ok");
  // 刷新历史列表
  const list = container.querySelector("#diaryHistoryList");
  if (list) list.innerHTML = renderHistoryList();
}

/* ---------- 工具函数 ---------- */
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDateCN(dateStr) {
  const d = new Date(dateStr);
  const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${weekdays[d.getDay()]}`;
}
