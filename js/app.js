/* ============================================================
 * app.js — 入口：导航、模态、Toast、仪表盘、设置、渲染编排
 * ============================================================ */
import * as store from "./storage.js";
import * as auth from "./auth.js";
import * as features from "./features.js";
import { renderPapers, openPaperForm, resetPapersFilter } from "./papers.js";
import { renderKnowledge, resetKnowledgeFilter } from "./knowledge.js";
import { renderKnowledgeBase } from "./kb.js";
import { renderAnalysis } from "./analysis.js";
import { renderDiary } from "./diary.js";
import { renderMiniTrend, resizeAll } from "./charts.js";

/* ---------- 工具导出（供其他模块使用） ---------- */
export function esc(s) {
  s = s == null ? "" : String(s);
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------- Toast ---------- */
let toastTimer = null;
export function toast(msg, type = "ok") {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = msg;
  el.className = "toast " + type;
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add("show"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => (el.hidden = true), 260);
  }, 2200);
}

/* ---------- 模态 ---------- */
let _onClose = null;
const maskEl = () => document.getElementById("modalMask");
const modalEl = () => document.getElementById("modal");

export function openModal({ title, body, footer, onMount, onClose }) {
  _onClose = onClose || null;
  document.getElementById("modalTitle").textContent = title || "";
  document.getElementById("modalBody").innerHTML = body || "";
  document.getElementById("modalFoot").innerHTML = footer || "";
  maskEl().hidden = false;
  if (onMount) onMount(modalEl());
}
export function closeModal() {
  const cb = _onClose;
  _onClose = null;
  maskEl().hidden = true;
  if (cb) { try { cb(); } catch (e) { console.error(e); } }
}

export function confirmBox(title, msg) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      closeModal();
      resolve(v);
    };
    openModal({
      title,
      body: `<p style="font-size:14px;line-height:1.7;color:var(--ink-2);margin:0">${esc(msg)}</p>`,
      footer: `<button class="btn btn-ghost" id="cf_cancel">取消</button><button class="btn btn-primary" id="cf_ok">确认</button>`,
      onMount: (root) => {
        root.querySelector("#cf_cancel").onclick = () => finish(false);
        root.querySelector("#cf_ok").onclick = () => finish(true);
      },
      onClose: () => { if (!done) { done = true; resolve(false); } },
    });
  });
}

/* ---------- 视图表 ---------- */
const VIEWS = {
  dashboard: { title: "仪表盘", render: renderDashboard },
  papers: { title: "刷题记录", render: (c) => renderPapers(c) },
  knowledge: { title: "错题与知识点", render: (c) => renderKnowledge(c) },
  kb: { title: "知识库", render: (c) => renderKnowledgeBase(c) },
  analysis: { title: "学情分析", render: (c) => renderAnalysis(c) },
  diary: { title: "小窝", render: (c) => renderDiary(c) },
  settings: { title: "数据与设置", render: renderSettings },
};
let currentView = "dashboard";

export function switchView(name) {
  if (!VIEWS[name]) name = "dashboard";
  currentView = name;
  document.querySelectorAll(".view").forEach((v) => {
    const active = v.id === "view-" + name;
    v.classList.toggle("active", active);
    v.hidden = !active;
  });
  document.querySelectorAll(".nav-item, .tab-item").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === name);
  });
  document.getElementById("viewTitle").textContent = VIEWS[name].title;
  // 顶部快捷按钮仅仪表盘可见（"录入试卷/添加目标院校"只在首页提供）
  const qb = document.getElementById("quickAddBtn");
  qb.style.display = name === "dashboard" ? "" : "none";

  const container = document.getElementById("view-" + name);
  container.scrollTop = 0;
  VIEWS[name].render(container);
  window.scrollTo({ top: 0, behavior: "auto" });
}

function refreshCurrent() {
  const c = document.getElementById("view-" + currentView);
  if (c) VIEWS[currentView].render(c);
}

/* ---------- 仪表盘 ---------- */
function renderDashboard(container) {
  const data = store.getData();
  const papers = data.papers;
  const totalScore = papers.reduce((a, p) => a + store.num(p.score), 0);
  const totalMax = papers.reduce((a, p) => a + store.num(p.totalScore, 100), 0) || 1;
  const overall = Math.round((totalScore / totalMax) * 1000) / 10;

  // 目标院校
  const target = store.getActiveTarget();
  const gap = store.targetGap();
  const est = store.estimateTotal();
  const targetTotalScore = est.totalTarget;
  // 当前估算总分（按目标满分折算后相加，未刷卷科目按 0 计入，与目标同量纲）
  const estTotalScore = est.estimated;
  const totalDiff = est.diff;
  const urgentSubjects = gap.rows.filter((r) => r.priority === "高");

  // 薄弱科目（按知识点掌握度，回退到得分率）
  const subjStat = data.subjects.map((s) => {
    const ks = data.knowledge.filter((k) => data.papers.find((p) => p.id === k.paperId)?.subject === s);
    const ps = papers.filter((p) => p.subject === s);
    const mastery = ks.length ? Math.round(ks.reduce((a, k) => a + store.num(k.mastery), 0) / ks.length) : null;
    const pct = ps.length ? Math.round(ps.reduce((a, p) => a + store.scorePercent(p), 0) / ps.length) : null;
    return { s, mastery, pct };
  }).filter((x) => x.mastery != null || x.pct != null);
  const weakest = [...subjStat].sort((a, b) => (a.mastery ?? a.pct ?? 999) - (b.mastery ?? b.pct ?? 999))[0];

  const recent = [...papers].filter((p) => p.date).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);

  container.innerHTML = `
    <div class="section-head">
      <div><h2>学习概览</h2><div class="hint">${greeting()} · 今天是 ${new Date().getMonth() + 1} 月 ${new Date().getDate()} 日</div></div>
    </div>

    ${target ? `
      <div class="card" style="border-top:3px solid var(--accent);background:linear-gradient(180deg,rgba(211,164,82,.07),transparent)">
        <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:flex-start;justify-content:space-between">
          <div style="min-width:280px;flex:1">
            <div class="card-title" style="margin-bottom:6px">🎯 当前目标 <span class="count">${esc(target.year || "—")} 考研</span></div>
            <div style="font-family:var(--ff-display);font-size:24px;color:var(--ink);line-height:1.25">${esc(target.name)}</div>
            ${target.major ? `<div class="muted" style="margin-top:4px;font-size:13px">${esc(target.major)}</div>` : ""}
            ${target.note ? `<div class="muted" style="margin-top:6px;font-size:12.5px">${esc(target.note)}</div>` : ""}
          </div>
          <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;justify-content:flex-end">
            <div style="min-width:130px;padding:10px 14px;background:var(--surface-2);border:1px solid var(--line);border-radius:var(--r-sm)">
              <div class="muted" style="font-size:11.5px">目标总分</div>
              <div style="font-family:var(--ff-display);font-size:22px;color:var(--accent)">${targetTotalScore}</div>
            </div>
            <div style="min-width:130px;padding:10px 14px;background:var(--surface-2);border:1px solid var(--line);border-radius:var(--r-sm)">
              <div class="muted" style="font-size:11.5px">当前估算</div>
              <div style="font-family:var(--ff-display);font-size:22px;color:var(--ink)">${estTotalScore || "—"}</div>
            </div>
            <div style="min-width:130px;padding:10px 14px;background:var(--surface-2);border:1px solid var(--line);border-radius:var(--r-sm)">
              <div class="muted" style="font-size:11.5px">${totalDiff > 0 ? "还差" : "已超出"}</div>
              <div style="font-family:var(--ff-display);font-size:22px;color:${totalDiff > 0 ? "var(--danger)" : "var(--ok)"}">${totalDiff > 0 ? "+" : ""}${totalDiff}</div>
            </div>
          </div>
        </div>
        <div style="margin-top:14px;display:flex;flex-wrap:wrap;gap:8px 14px">
          ${gap.rows.map((r) => {
            const curStr = r.count ? `${r.curScore} 分` : "—";
            const tgtStr = `${r.targetScore}/${r.targetTotal}`;
            const diffDisplay = r.diffScore > 0 ? `差 ${r.diffScore} 分` : "—";
            const priorityText = r.priority === "高" ? " · 重点提升" : r.priority === "中" ? " · 保持" : "";
            return `
            <div style="font-size:13px;padding:7px 12px;background:var(--surface-2);border:1px solid var(--line-soft);border-radius:var(--r-sm)">
              <span class="tag tag-ink" style="margin-right:6px;padding:2px 8px">${esc(r.subject)}</span>
              当前 <b>${curStr}</b> → 目标 <b>${tgtStr}</b>
              ${r.diffPct > 0
                ? `<span style="color:var(--danger);margin-left:4px">${diffDisplay}${priorityText}</span>`
                : `<span style="color:var(--ok);margin-left:4px">已达标 ✓</span>`}
            </div>`;
          }).join("")}
        </div>
        ${urgentSubjects.length
          ? `<div style="margin-top:12px;padding:10px 14px;border-left:3px solid var(--danger);background:rgba(174,88,88,.05);border-radius:0 var(--r-sm) var(--r-sm) 0;font-size:13px;color:var(--ink-2)">
              <b>需要提升重视：</b>${urgentSubjects.map((r) => `${esc(r.subject)}（${r.count ? "已刷" + r.count + "张卷，" : "尚未做卷，"}还差 ${r.diffScore} 分）`).join("；")}
            </div>`
          : `<div style="margin-top:12px;padding:10px 14px;border-left:3px solid var(--ok);background:rgba(126,164,120,.05);border-radius:0 var(--r-sm) var(--r-sm) 0;font-size:13px;color:var(--ink-2)">
              所有科目均已达标或只差临门一脚，请保持节奏，冲线即可。
            </div>`}
      </div>` : `
      <div class="card" style="border-top:3px solid var(--line);display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between">
        <div>
          <div class="card-title" style="margin-bottom:4px">🎯 还未设定目标院校</div>
          <p class="muted" style="font-size:13px">在「数据与设置」添加心仪院校的各科目标分，以后每次打开这里都能直接看到差距。</p>
        </div>
        <button class="btn btn-primary" id="dashAddTarget">+ 设定目标院校</button>
      </div>`}

    <div class="stat-grid" style="margin-top:16px">
      <div class="card stat-card tone-ink">
        <div class="stat-label">试卷总数</div>
        <div class="stat-value">${papers.length}<span class="unit">张</span></div>
        <div class="stat-sub">含 ${papers.filter((p) => p.type === "真题").length} 真题</div>
      </div>
      <div class="card stat-card ${overall >= 90 ? "tone-excellent" : overall >= 70 ? "tone-good" : overall >= 60 ? "" : "tone-fail"}">
        <div class="stat-label">加权平均得分率</div>
        <div class="stat-value">${overall}<span class="unit">%</span></div>
        <div class="stat-sub">总体目标 ${data.targetScore}%</div>
      </div>
      <div class="card stat-card tone-fail">
        <div class="stat-label">错题总数</div>
        <div class="stat-value">${data.errors.length}<span class="unit">道</span></div>
        <div class="stat-sub">知识点 ${data.knowledge.length} 条</div>
      </div>
      <div class="card stat-card ${weakest && (weakest.mastery ?? weakest.pct) < 60 ? "tone-fail" : "tone-good"}">
        <div class="stat-label">薄弱科目</div>
        <div class="stat-value" style="font-size:24px">${esc(weakest ? weakest.s : "—")}</div>
        <div class="stat-sub">${weakest ? `掌握 ${weakest.mastery ?? "—"}% · 得分 ${weakest.pct ?? "—"}%` : "暂无数据"}</div>
      </div>
    </div>

    ${data.errors.length ? `
    <div class="card review-card" style="margin-top:16px;border-top:3px solid var(--accent)">
      <div id="reviewPanel"></div>
    </div>` : ""}

    <div class="grid dash-grid">
      <div class="card chart-card">
        <div class="card-title">成绩趋势<span class="count">近 ${Math.min(10, papers.length)} 次</span></div>
        ${papers.length
          ? `<div id="chart-mini" style="width:100%;height:220px"></div>`
          : `<div class="chart-empty">暂无数据，先录入一张试卷吧</div>`}
      </div>
      <div class="card">
        <div class="card-title">最近试卷<span class="count">${recent.length}</span></div>
        ${recent.length
          ? `<div style="display:flex;flex-direction:column;gap:8px">
              ${recent.map((p) => {
                const t = store.getTier(p);
                return `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--line-soft)">
                  <span class="tier tier-${t.key}" style="flex-shrink:0"><span class="dot-sm"></span>${store.num(p.score)}</span>
                  <div style="flex:1;min-width:0">
                    <div style="font-weight:500;font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.name)}</div>
                    <div class="muted" style="font-size:11.5px">${esc(p.subject)} · ${store.formatDate(p.date)}</div>
                  </div>
                  <span class="muted" style="font-family:var(--ff-mono);font-size:12px">${t.pct}%</span>
                </div>`;
              }).join("")}
            </div>`
          : `<div class="empty" style="padding:20px 0"><div class="empty-ico">▤</div><p>暂无试卷</p></div>`}
      </div>
    </div>

    ${papers.length === 0 ? `
      <div class="card" style="margin-top:20px">
        <div class="empty">
          <div class="empty-ico">砚</div>
          <h3>欢迎使用砚台</h3>
          <p>从录入第一张试卷开始建立你的成绩档案；也可先加载示例数据体验全部功能。</p>
          <div class="empty-actions">
            <button class="btn btn-primary" id="dashAdd">+ 录入第一张试卷</button>
            <button class="btn btn-ghost" id="dashSample">加载示例数据</button>
          </div>
        </div>
      </div>` : ""}

    <div class="nav-grid" style="margin-top:20px">
      ${quickNavCard("刷题记录", "▤", "录入与管理试卷", "papers")}
      ${quickNavCard("错题与知识点", "✎", "记录错因与薄弱环节", "knowledge")}
      ${quickNavCard("学情分析", "◈", "图表与个性化报告", "analysis")}
    </div>
  `;

  const dashAdd = container.querySelector("#dashAdd");
  if (dashAdd) dashAdd.onclick = () => openPaperForm();
  const dashSample = container.querySelector("#dashSample");
  if (dashSample) dashSample.onclick = async () => {
    const ok = await confirmBox("加载示例数据", "将用示例数据替换当前数据（含目标院校示例：北大计算机，建议先导出备份）。是否继续？");
    if (ok) { store.loadSample(); toast("已加载示例数据", "ok"); }
  };
  const dashAddTarget = container.querySelector("#dashAddTarget");
  if (dashAddTarget) dashAddTarget.onclick = () => openTargetForm();
  container.querySelectorAll("[data-goto]").forEach((b) => b.onclick = () => switchView(b.dataset.goto));

  // 艾宾浩斯复习面板
  const reviewPanel = container.querySelector("#reviewPanel");
  if (reviewPanel) features.renderReviewPanel(reviewPanel);

  if (papers.length) requestAnimationFrame(() => renderMiniTrend(container));
}

function quickNavCard(title, glyph, desc, view) {
  return `
    <button class="card" data-goto="${view}" style="cursor:pointer;text-align:left;transition:transform .16s ease,box-shadow .16s ease">
      <div style="font-family:var(--ff-display);font-size:26px;color:var(--accent)">${glyph}</div>
      <div style="font-weight:600;margin-top:6px">${title}</div>
      <div class="muted" style="font-size:12.5px;margin-top:2px">${desc}</div>
    </button>`;
}

function greeting() {
  const h = new Date().getHours();
  if (h < 6) return "深夜辛苦";
  if (h < 11) return "早安";
  if (h < 13) return "午安";
  if (h < 18) return "下午好";
  if (h < 23) return "晚上好";
  return "深夜辛苦";
}

/* ---------- 设置：目标院校 + 其他 ---------- */
function renderSettings(container) {
  const data = store.getData();
  const usage = estimateUsage();
  const storeStat = store.storageUsage();
  const targets = store.listTargets();
  const activeId = data.activeTargetId;
  const user = auth.currentUser();

  container.innerHTML = `
    <div class="section-head"><div><h2>数据与设置</h2><div class="hint">全部数据存于本机浏览器</div></div></div>

    <div class="card" style="border-top:3px solid var(--accent)">
      <div class="card-title">目标院校<span class="count">${targets.length}</span></div>
      <p class="muted" style="font-size:12.5px;margin-bottom:12px">为心仪院校设定各科目标分，学情分析将自动计算「当前差距」并标出需要重点提升的科目。</p>

      <div class="item-list" id="targetList">
        ${targets.length ? targets.map((t) => targetCardHTML(t, activeId)).join("") : `
          <div class="empty" style="padding:24px 0">
            <div class="empty-ico">🎯</div>
            <h3>还没有目标院校</h3>
            <p>请回到「仪表盘」添加你的第一所目标院校。</p>
          </div>`}
      </div>
      <p class="muted" style="font-size:12.5px;margin-top:10px">如需新增目标院校，请回到「仪表盘」顶部操作；此处可切换当前目标、编辑或删除。</p>
    </div>

    <div class="split-2" style="margin-top:16px">
      <div class="card">
        <div class="card-title">总体目标百分比 <span class="count">作为报告进度基准</span></div>
        <div class="field">
          <label>期望达成的总体得分率</label>
          <div class="range-wrap">
            <input type="range" id="setTarget" min="50" max="100" value="${store.num(data.targetScore, 90)}" />
            <span class="range-val" id="setTargetVal">${store.num(data.targetScore, 90)}%</span>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-title">存储状态</div>
        <div class="stat-sub" style="margin-bottom:6px">本地占用约 <span class="score-num">${usage}</span>（约 ${storeStat.pct}% / 5MB）</div>
        <div class="stat-sub">试卷 ${data.papers.length} · 错题 ${data.errors.length} · 知识点 ${data.knowledge.length} · 目标院校 ${targets.length}</div>
        ${storeStat.pct > 85
          ? `<div class="stat-sub" style="margin-top:8px;color:var(--danger);font-weight:600">⚠ 存储已用 ${storeStat.pct}%，建议立即导出备份并清理多余的错题/知识点图片，避免保存失败。</div>`
          : storeStat.pct > 60
            ? `<div class="stat-sub" style="margin-top:8px;color:#a06a00">存储占用已达 ${storeStat.pct}%，上传图片较多时请注意，建议定期导出备份。</div>`
            : `<div class="stat-sub" style="margin-top:8px;color:var(--ink-mute)">数据仅存于本浏览器，清缓存将丢失，请定期导出备份。</div>`}
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-title">科目管理</div>
      <div class="row" id="subjRow">
        ${data.subjects.map((s) => `<span class="tag tag-ink" style="padding:6px 12px;font-size:13px">${esc(s)} <button class="btn-ghost" data-rmsub="${esc(s)}" style="margin-left:6px;padding:0;color:var(--danger)">✕</button></span>`).join("")}
      </div>
      <div class="row" style="margin-top:12px">
        <input class="input" id="newSubj" placeholder="新增科目，如 408、数学二" style="max-width:220px" />
        <button class="btn btn-primary btn-sm" id="addSubj">添加</button>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-title">数据管理</div>
      <div class="row">
        <button class="btn" id="expBtn">导出 JSON 备份</button>
        <button class="btn" id="impBtn">导入 JSON</button>
        <button class="btn btn-ghost" id="sampleBtn">加载示例数据</button>
        <button class="btn btn-danger" id="clearBtn">清空全部数据</button>
      </div>
      <p class="muted" style="font-size:12px;margin-top:10px">导出的 JSON 可保存到云盘或换设备迁移；导入会覆盖当前数据。</p>
    </div>

    <div class="card" style="margin-top:16px;border-top:3px solid var(--accent)">
      <div class="card-title">当前账号</div>
      <div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:10px;align-items:center">
        <div>
          <div style="font-size:15px;font-weight:600;font-family:var(--ff-mono)">${user ? esc(user.id) : "—"}</div>
          <div class="muted" style="font-size:12px;margin-top:2px">${user ? `注册于 ${new Date(user.createdAt).toLocaleDateString("zh-CN")}` : "未登录"}</div>
        </div>
        <button class="btn btn-ghost" id="accountChangePw" type="button">修改密码</button>
        <button class="btn btn-ghost" id="accountLogout" type="button">退出登录</button>
      </div>
    </div>

    <div class="card" style="margin-top:16px;border-top:3px solid var(--ink)">
      <div class="card-title">关于砚台</div>
      <p style="font-size:13.5px;color:var(--ink-2);line-height:1.7">面向 2027 考研备考的本地学习管理台：目标院校与差距分析、刷题记录、错题与知识点、可视化与学情报告。纯静态、无后端，数据不离本机。</p>
      <p class="muted" style="font-size:12px;margin-top:6px">HTML5 · CSS3 · 原生 JS · ECharts · localStorage</p>
    </div>
  `;

  // 目标院校（新增入口仅在仪表盘；此处保留切换/编辑/删除）
  container.querySelectorAll("[data-tid]").forEach((b) => {
    if (b.dataset.act === "active") {
      b.onclick = () => { store.setActiveTarget(b.dataset.tid); toast("已切换当前目标", "ok"); };
    } else if (b.dataset.act === "edit") {
      b.onclick = () => openTargetForm(store.listTargets().find((t) => t.id === b.dataset.tid));
    } else if (b.dataset.act === "del") {
      b.onclick = async () => {
        const t = store.listTargets().find((x) => x.id === b.dataset.tid);
        const ok = await confirmBox("删除目标院校", `确认删除「${esc(t?.name || "")}」？`);
        if (ok) { store.deleteTarget(b.dataset.tid); toast("已删除", "ok"); }
      };
    }
  });

  // 总体目标百分比
  const t = container.querySelector("#setTarget");
  const tv = container.querySelector("#setTargetVal");
  t.oninput = () => (tv.textContent = t.value + "%");
  t.onchange = () => { const d = store.getData(); d.targetScore = parseInt(t.value, 10); store.save(); toast("目标已更新", "ok"); };

  // 科目
  container.querySelectorAll("[data-rmsub]").forEach((b) => b.onclick = async () => {
    const s = b.dataset.rmsub;
    const used = store.getData().papers.some((p) => p.subject === s);
    if (used) { toast(`科目「${s}」已被试卷使用，无法删除`, "warn"); return; }
    store.removeSubject(s); toast("已移除科目", "ok");
  });
  container.querySelector("#addSubj").onclick = () => {
    const v = container.querySelector("#newSubj").value.trim();
    if (!v) return;
    if (!store.addSubject(v)) { toast("科目已存在", "warn"); return; }
    toast("已添加科目", "ok");
  };
  container.querySelector("#newSubj").onkeydown = (e) => { if (e.key === "Enter") container.querySelector("#addSubj").click(); };

  // 数据
  container.querySelector("#expBtn").onclick = () => { store.exportJSON(); toast("已导出备份", "ok"); };
  container.querySelector("#impBtn").onclick = () => document.getElementById("importFile").click();
  container.querySelector("#sampleBtn").onclick = async () => {
    const ok = await confirmBox("加载示例数据", "将覆盖当前数据（含目标院校示例：北大计算机），建议先导出备份。是否继续？");
    if (ok) { store.loadSample(); toast("已加载示例数据", "ok"); }
  };
  container.querySelector("#clearBtn").onclick = async () => {
    const ok = await confirmBox("清空数据", "此操作不可恢复，将删除全部试卷、错题、知识点与目标院校。确认清空？");
    if (ok) { store.clearAll(); toast("已清空", "ok"); }
  };

  // 退出登录
  const accLogout = container.querySelector("#accountLogout");
  if (accLogout) accLogout.onclick = doLogout;

  // 修改密码
  const accChangePw = container.querySelector("#accountChangePw");
  if (accChangePw) accChangePw.onclick = openChangePassword;
}

/* 修改密码模态 */
function openChangePassword() {
  const user = auth.currentUser();
  if (!user) { toast("请先登录", "err"); return; }
  openModal({
    title: "修改密码",
    body: `
      <div class="form-grid">
        <div class="field span-2">
          <label>用户 ID</label>
          <input class="input" id="cpw_id" value="${esc(user.id)}" disabled />
        </div>
        <div class="field span-2">
          <label>原密码<span class="req">*</span></label>
          <input class="input" id="cpw_old" type="password" autocomplete="current-password" placeholder="输入当前密码" />
        </div>
        <div class="field span-2">
          <label>新密码<span class="req">*</span></label>
          <input class="input" id="cpw_new" type="password" autocomplete="new-password" placeholder="6 位以上，英文/数字/符号任选" />
        </div>
        <div class="field span-2">
          <label>确认新密码<span class="req">*</span></label>
          <input class="input" id="cpw_new2" type="password" autocomplete="new-password" placeholder="再次输入新密码" />
        </div>
      </div>
    `,
    footer: `<button class="btn btn-ghost" id="cpw_cancel">取消</button><button class="btn btn-primary" id="cpw_save">保存新密码</button>`,
    onMount: (root) => {
      root.querySelector("#cpw_cancel").onclick = () => closeModal();
      root.querySelector("#cpw_save").onclick = async () => {
        const oldP = root.querySelector("#cpw_old").value;
        const newP = root.querySelector("#cpw_new").value;
        const new2 = root.querySelector("#cpw_new2").value;
        if (!oldP || !newP) { toast("请填写原密码与新密码", "err"); return; }
        if (newP !== new2) { toast("两次输入的新密码不一致", "err"); return; }
        const r = await auth.changePassword(user.id, oldP, newP);
        if (!r.ok) { toast(r.msg, "err"); return; }
        toast(r.msg, "ok");
        closeModal();
      };
    },
  });
}

/* 目标院校卡片（设置页） */
function targetCardHTML(t, activeId) {
  const isActive = t.id === activeId;
  const total = Object.values(t.subjectTargets || {}).reduce((a, b) => a + store.num(b), 0);
  const rows = Object.keys(t.subjectTargets || {}).map((s) =>
    `${s} <span class="score-num">${store.num(t.subjectTargets[s])}</span>/${store.num(t.subjectTotals[s], 100)}`
  ).join(" · ");
  return `
    <div class="item" style="border-left:${isActive ? "3px solid var(--accent)" : "3px solid var(--line)"}">
      <div class="item-head">
        ${isActive ? `<span class="tag tag-accent">● 当前</span>` : `<span class="tag">备选</span>`}
        <span class="tag tag-ink">${esc(t.year || "—")} 考研</span>
        <div class="item-title" style="flex:1">${esc(t.name)}${t.major ? ` <span class="muted" style="font-weight:400">· ${esc(t.major)}</span>` : ""}</div>
        <span class="muted" style="font-family:var(--ff-mono);font-size:13px">目标总分 <b style="color:var(--accent)">${total}</b></span>
      </div>
      <div class="item-body" style="font-size:13px">${rows}</div>
      ${t.note ? `<div class="muted" style="font-size:12px;margin-top:4px">${esc(t.note)}</div>` : ""}
      <div class="item-actions">
        ${isActive ? `<button class="btn btn-ghost btn-sm" disabled>已设为当前</button>` : `<button class="btn btn-ghost btn-sm" data-tid="${t.id}" data-act="active">设为当前</button>`}
        <button class="btn btn-ghost btn-sm" data-tid="${t.id}" data-act="edit">编辑</button>
        <button class="btn btn-danger btn-sm" data-tid="${t.id}" data-act="del">删除</button>
      </div>
    </div>`;
}

/* 目标院校表单模态 */
export function openTargetForm(target = null) {
  const data = store.getData();
  const subjects = data.subjects;
  const isEdit = !!target;
  const t = target || {
    name: "", major: "", note: "", year: (new Date().getFullYear() + (new Date().getMonth() >= 9 ? 1 : 0)),
    subjectTargets: Object.fromEntries(subjects.map((s) => [s, s === "数学" || s === "408" ? 100 : 60])),
    subjectTotals:  Object.fromEntries(subjects.map((s) => [s, s === "数学" || s === "408" ? 150 : 100])),
  };

  const body = `
    <div class="form-grid">
      <div class="field span-2">
        <label>目标院校<span class="req">*</span></label>
        <input class="input" id="tf_name" value="${esc(t.name)}" placeholder="如：北京大学" />
      </div>
      <div class="field">
        <label>目标专业</label>
        <input class="input" id="tf_major" value="${esc(t.major)}" placeholder="如：计算机科学与技术" />
      </div>
      <div class="field">
        <label>目标年份</label>
        <input class="input" id="tf_year" type="number" min="2024" max="2040" value="${store.num(t.year, 2027)}" />
      </div>
      <div class="field span-2"><label>各科目标分 / 满分</label>
        <div class="grid" style="grid-template-columns:repeat(${Math.min(2, subjects.length)},1fr);gap:12px;margin-top:4px">
          ${subjects.map((s) => `
            <div class="row" style="align-items:center;gap:8px;padding:10px 12px;background:var(--surface-2);border:1px solid var(--line);border-radius:var(--r-sm)">
              <span class="tag tag-ink" style="flex-shrink:0">${esc(s)}</span>
              <input class="input" data-subscore="${esc(s)}" type="number" min="0" value="${store.num(t.subjectTargets?.[s], 0)}" placeholder="目标分" style="flex:1;min-width:0" />
              <span class="muted" style="font-size:12px">/</span>
              <input class="input" data-subtotal="${esc(s)}" type="number" min="1" value="${store.num(t.subjectTotals?.[s], 100)}" placeholder="满分" style="width:84px;flex-shrink:0" />
            </div>`).join("")}
        </div>
      </div>
      <div class="field span-2">
        <label>备注</label>
        <textarea class="textarea" id="tf_note" placeholder="如：初试总分线参考、历年录取情况、研究方向偏好等">${esc(t.note)}</textarea>
      </div>
    </div>
  `;

  openModal({
    title: isEdit ? "编辑目标院校" : "新增目标院校",
    body,
    footer: `<button class="btn btn-ghost" id="tf_cancel">取消</button><button class="btn btn-primary" id="tf_save">${isEdit ? "保存" : "添加"}</button>`,
    onMount: (root) => {
      root.querySelector("#tf_cancel").onclick = () => closeModal();
      root.querySelector("#tf_save").onclick = () => {
        const name = root.querySelector("#tf_name").value.trim();
        if (!name) { toast("请填写目标院校", "err"); return; }
        const payload = {
          name,
          major: root.querySelector("#tf_major").value.trim(),
          year: parseInt(root.querySelector("#tf_year").value, 10) || (new Date().getFullYear() + 1),
          note: root.querySelector("#tf_note").value.trim(),
          subjectTargets: {},
          subjectTotals: {},
        };
        subjects.forEach((s) => {
          const sc = root.querySelector(`[data-subscore="${CSS.escape(s)}"]`);
          const to = root.querySelector(`[data-subtotal="${CSS.escape(s)}"]`);
          payload.subjectTargets[s] = parseFloat(sc?.value || 0);
          payload.subjectTotals[s] = parseFloat(to?.value || 100) || 100;
        });
        if (isEdit) store.updateTarget(target.id, payload);
        else store.addTarget(payload);
        toast(isEdit ? "已保存目标" : "已添加目标院校", "ok");
        closeModal();
      };
    },
  });
}

function estimateUsage() {
  try {
    const key = store.dataKey();
    const raw = key ? localStorage.getItem(key) || "" : "";
    const bytes = new Blob([raw]).size;
    if (bytes < 1024) return bytes + " B";
    return (bytes / 1024).toFixed(1) + " KB";
  } catch (e) { return "—"; }
}

/* ---------- 侧边栏切换（桌面端隐藏/显示 + 移动端抽屉） ---------- */
function setupSidebar() {
  const sidebar = document.getElementById("sidebar");
  const appShell = document.getElementById("appShell");
  const toggle = document.getElementById("menuToggle");
  const scrim = document.createElement("div");
  scrim.className = "scrim";
  document.body.appendChild(scrim);

  // 默认隐藏侧边栏（桌面端沉浸模式）
  sidebar.classList.add("diary-sidebar-hidden");
  appShell.classList.add("diary-shell-full");

  const isMobile = () => window.innerWidth <= 768;

  const closeMobile = () => {
    sidebar.classList.remove("open");
    scrim.classList.remove("show");
  };

  const toggleDesktop = () => {
    const hidden = sidebar.classList.toggle("diary-sidebar-hidden");
    appShell.classList.toggle("diary-shell-full", hidden);
    toggle.querySelector("span").textContent = hidden ? "☰" : "✕";
    toggle.title = hidden ? "显示导航栏" : "隐藏导航栏";
  };

  toggle.onclick = () => {
    if (isMobile()) {
      // 移动端：抽屉式侧边栏
      sidebar.classList.toggle("open");
      scrim.classList.toggle("show", sidebar.classList.contains("open"));
    } else {
      // 桌面端：显示/隐藏侧边栏
      toggleDesktop();
    }
  };

  scrim.onclick = closeMobile;
  document.addEventListener("click", (e) => {
    if (sidebar.classList.contains("open") && !sidebar.contains(e.target) && e.target !== toggle) closeMobile();
  });

  // 窗口大小变化时，重置移动端状态
  window.addEventListener("resize", () => {
    if (!isMobile()) closeMobile();
  });
}

/* ---------- 认证：登录 / 注册 / 登出 ---------- */
function updateUserChip(user) {
  const chip = document.getElementById("userChip");
  const meta = document.getElementById("storageMeta");
  if (chip) chip.hidden = !user;
  if (meta) meta.textContent = user ? `${user.id} · 本地存储` : "本地存储";
}

function doLogout() {
  auth.logout();
  document.getElementById("appShell").hidden = true;
  document.getElementById("authScreen").hidden = false;
  const pass = document.getElementById("authPass");
  const pass2 = document.getElementById("authPass2");
  if (pass) pass.value = "";
  if (pass2) pass2.value = "";
  document.querySelectorAll(".auth-tab").forEach((b) => {
    b.classList.toggle("active", b.dataset.amode === "login");
  });
  document.getElementById("authPass2Wrap").hidden = true;
  document.getElementById("authSubmit").textContent = "登 录";
  document.getElementById("authTip").textContent = "数据按账号独立保存于本机浏览器，请牢记你的 ID 与密码。";
  updateUserChip(null);
  toast("已退出登录", "ok");
}

function enterApp(user) {
  document.getElementById("authScreen").hidden = true;
  document.getElementById("appShell").hidden = false;
  updateUserChip(user);
  // 账号切换时重置各模块筛选，避免上一账号的条件残留
  resetPapersFilter();
  resetKnowledgeFilter();
  store.load();
  switchView("dashboard");

  // 备份提醒：超过7天未备份或从未备份时提醒
  setTimeout(() => {
    if (features.shouldRemindBackup()) {
      openModal({
        title: "数据备份提醒",
        body: `
          <p style="font-size:14px;line-height:1.7;color:var(--ink-2);margin:0 0 12px">
            你的学习数据保存在本机浏览器中，清理缓存或更换设备会导致数据丢失。建议定期导出备份。
          </p>
          <p style="font-size:13px;color:var(--ink-mute);margin:0">也可随时按 <b>Ctrl+S</b> 快速导出备份。</p>
        `,
        footer: `<button class="btn btn-ghost" id="bk_later">稍后提醒</button><button class="btn btn-primary" id="bk_now">立即导出备份</button>`,
        onMount: (root) => {
          root.querySelector("#bk_later").onclick = closeModal;
          root.querySelector("#bk_now").onclick = () => {
            store.exportJSON();
            features.markBackedUp();
            closeModal();
            toast("已导出备份", "ok");
          };
        },
      });
    }
  }, 1500);
}

function setupAuth() {
  const screen = document.getElementById("authScreen");
  const form = document.getElementById("authForm");
  const tabs = document.querySelectorAll(".auth-tab");
  let mode = "login";

  // 记住上次登录 ID（仅便利输入，不存密码）
  const idInput = document.getElementById("authId");
  if (idInput && !idInput.value) idInput.value = auth.lastId() || "";

  const setMode = (m) => {
    mode = m;
    tabs.forEach((b) => b.classList.toggle("active", b.dataset.amode === m));
    document.getElementById("authPass2Wrap").hidden = m !== "register";
    document.getElementById("authSubmit").textContent = m === "register" ? "注 册" : "登 录";
    document.getElementById("authTip").textContent = m === "register"
      ? "ID 任意字符（1-20 位）；密码由英文字母、数字与符号任选（至少 6 位）。"
      : "数据按账号独立保存于本机浏览器，请牢记你的 ID 与密码。";
  };
  tabs.forEach((b) => (b.onclick = () => setMode(b.dataset.amode)));

  form.onsubmit = async (e) => {
    e.preventDefault();
    const id = document.getElementById("authId").value.trim();
    const pass = document.getElementById("authPass").value;
    if (!id) { toast("请输入用户 ID", "err"); return; }
    if (!pass) { toast("请输入密码", "err"); return; }
    if (mode === "register") {
      const pass2 = document.getElementById("authPass2").value;
      if (pass !== pass2) { toast("两次输入的密码不一致", "err"); return; }
      const r = await auth.register(id, pass);
      if (!r.ok) { toast(r.msg, "err"); return; }
      toast("注册成功，欢迎使用砚台", "ok");
      enterApp(r.user);
    } else {
      const r = await auth.login(id, pass);
      if (!r.ok) { toast(r.msg, "err"); return; }
      toast("登录成功", "ok");
      enterApp(r.user);
    }
  };

  document.getElementById("logoutBtn").onclick = doLogout;

  // 启动判定
  const user = auth.currentUser();
  if (user) {
    screen.hidden = true;
    enterApp(user);
  } else {
    screen.hidden = false;
    document.getElementById("appShell").hidden = true;
    updateUserChip(null);
  }
}

/* ---------- 全局搜索 ---------- */
let _searchTimer = null;
export function openGlobalSearch() {
  openModal({
    title: "全局搜索",
    body: `
      <div class="search-wrap">
        <div class="search global-search-box">
          <input class="input" id="gsInput" type="search" placeholder="搜索错题、知识点、试卷、知识库笔记…（Ctrl+K）" autofocus />
        </div>
        <div id="gsResults" class="gs-results">
          <div class="gs-empty">输入关键词开始搜索</div>
        </div>
      </div>
    `,
    footer: `<button class="btn btn-ghost" id="gs_close">关闭</button>`,
    onMount: (root) => {
      const input = root.querySelector("#gsInput");
      const results = root.querySelector("#gsResults");
      root.querySelector("#gs_close").onclick = closeModal;
      input.focus();
      input.oninput = () => {
        clearTimeout(_searchTimer);
        _searchTimer = setTimeout(() => {
          const q = input.value.trim();
          if (!q) { results.innerHTML = `<div class="gs-empty">输入关键词开始搜索</div>`; return; }
          const res = features.globalSearch(q);
          if (!res.length) { results.innerHTML = `<div class="gs-empty">未找到「${esc(q)}」相关内容</div>`; return; }
          results.innerHTML = res.map((r) => `
            <div class="gs-item" data-view="${r.view}" data-id="${r.id}">
              <span class="gs-type tag tag-soft">${esc(r.type)}</span>
              <div class="gs-item-body">
                <div class="gs-title">${esc(r.title)}</div>
                <div class="gs-sub">${esc(r.sub)}</div>
              </div>
            </div>
          `).join("");
          results.querySelectorAll(".gs-item").forEach((el) => {
            el.onclick = () => {
              switchView(el.dataset.view);
              closeModal();
              toast(`已跳转到${el.dataset.view === "knowledge" ? "错题与知识点" : el.dataset.view === "papers" ? "刷题记录" : el.dataset.view === "kb" ? "知识库" : el.dataset.view}`, "ok");
            };
          });
        }, 200);
      };
    },
  });
}

/* ---------- 初始化 ---------- */
function init() {
  // 主题初始化（暗色模式）
  features.initTheme();

  // 导航绑定
  document.querySelectorAll(".nav-item, .tab-item").forEach((b) => {
    b.onclick = () => { switchView(b.dataset.view); document.getElementById("sidebar")?.classList.remove("open"); };
  });
  // 顶部快捷
  document.getElementById("quickAddBtn").onclick = () => openPaperForm();
  // 模态关闭
  document.getElementById("modalClose").onclick = closeModal;
  maskEl().addEventListener("click", (e) => { if (e.target === maskEl()) closeModal(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !maskEl().hidden) closeModal();
  });

  // 键盘快捷键
  features.initShortcuts({
    onSwitchView: (v) => switchView(v),
    onOpenSearch: () => openGlobalSearch(),
    onSave: () => {
      // Ctrl+S：如果在知识库页面，触发保存；否则导出备份
      if (currentView === "kb") {
        const evt = new CustomEvent("kb:save");
        document.dispatchEvent(evt);
        toast("知识库已保存", "ok");
      } else {
        store.exportJSON();
        features.markBackedUp();
        toast("已导出备份", "ok");
      }
    },
  });

  // 全局搜索按钮
  const searchBtn = document.getElementById("globalSearchBtn");
  if (searchBtn) searchBtn.onclick = () => openGlobalSearch();

  // 暗色模式切换按钮
  const themeBtn = document.getElementById("themeToggleBtn");
  if (themeBtn) themeBtn.onclick = () => {
    const next = features.toggleTheme();
    toast(next === "dark" ? "已切换暗色模式" : "已切换亮色模式", "ok");
  };

  // 侧栏
  setupSidebar();
  // 数据变更 → 刷新当前视图
  store.subscribe(() => refreshCurrent());
  // 窗口尺寸 → 图表 resize
  let rT;
  window.addEventListener("resize", () => { clearTimeout(rT); rT = setTimeout(resizeAll, 150); });
  // 导入文件
  document.getElementById("importFile").onchange = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try { store.importJSON(reader.result); toast("导入成功", "ok"); }
      catch (err) { toast("导入失败：" + err.message, "err"); }
    };
    reader.readAsText(f);
    e.target.value = "";
  };

  // 分析页的"设定目标院校"按钮通过事件桥接（避免 charts↔app 循环 import）
  document.addEventListener("analysis:addTarget", () => openTargetForm());

  // 认证启动：已登录 → 进入应用；未登录 → 显示登录界面
  setupAuth();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
