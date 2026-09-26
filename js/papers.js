/* ============================================================
 * papers.js — 刷题记录管理
 * 统计概览 + 卡片式列表、分数步进、区间色徽章、筛选排序
 * ============================================================ */
import { openModal, closeModal, toast, esc, confirmBox } from "./app.js";
import * as store from "./storage.js";

let filterState = { subject: "", type: "", sort: "date-desc", q: "" };
let qTimer = null;

/* 账号切换时重置筛选（由 app.js 在进入应用时调用） */
export function resetPapersFilter() {
  filterState = { subject: "", type: "", sort: "date-desc", q: "" };
}

export function renderPapers(container) {
  const data = store.getData();
  const papers = [...data.papers];

  container.innerHTML = `
    <div class="section-head">
      <div>
        <h2>刷题记录</h2>
        <div class="hint">点击卡片可编辑 · 新增入口位于「仪表盘」</div>
      </div>
    </div>

    <div class="paper-summary-wrap">${statsHTML(papers)}</div>

    <div class="toolbar">
      <div class="filters">
        <select class="select filter" id="fSubject">
          <option value="">全部科目</option>
          ${data.subjects.map((s) => `<option ${filterState.subject === s ? "selected" : ""}>${s}</option>`).join("")}
        </select>
        <select class="select filter" id="fType">
          <option value="">全部类型</option>
          ${data.paperTypes.map((t) => `<option ${filterState.type === t ? "selected" : ""}>${t}</option>`).join("")}
        </select>
        <select class="select filter" id="fSort">
          <option value="date-desc" ${filterState.sort === "date-desc" ? "selected" : ""}>最近完成</option>
          <option value="date-asc" ${filterState.sort === "date-asc" ? "selected" : ""}>最早完成</option>
          <option value="score-desc" ${filterState.sort === "score-desc" ? "selected" : ""}>分数从高</option>
          <option value="score-asc" ${filterState.sort === "score-asc" ? "selected" : ""}>分数从低</option>
        </select>
      </div>
      <div class="search"><input class="input" id="fQ" type="search" placeholder="搜索试卷名称" value="${esc(filterState.q)}" /></div>
    </div>

    <div id="paperListWrap"></div>
  `;

  // 事件（新增入口仅在仪表盘）
  container.querySelector("#fSubject").onchange = (e) => { filterState.subject = e.target.value; rerenderList(container); };
  container.querySelector("#fType").onchange = (e) => { filterState.type = e.target.value; rerenderList(container); };
  container.querySelector("#fSort").onchange = (e) => { filterState.sort = e.target.value; rerenderList(container); };
  container.querySelector("#fQ").oninput = (e) => {
    filterState.q = e.target.value;
    clearTimeout(qTimer);
    qTimer = setTimeout(() => rerenderList(container), 250); // 防抖
  };

  rerenderList(container);
}

/* ---------- 顶部统计（一行文字） ---------- */
function statsHTML(papers) {
  if (!papers.length) return "";
  const n = papers.length;
  const avg = Math.round((papers.reduce((s, p) => s + store.scorePercent(p), 0) / n) * 10) / 10;
  let bestPct = -1;
  const tiers = { excellent: 0, good: 0, pass: 0, fail: 0 };
  const tLabels = { excellent: "优秀", good: "良好", pass: "及格", fail: "待提升" };
  papers.forEach((p) => {
    const pct = store.scorePercent(p);
    if (pct > bestPct) bestPct = pct;
    tiers[store.getTier(p).key]++;
  });
  const tierStr = ["excellent", "good", "pass", "fail"]
    .map((k) => (tiers[k] ? `${tLabels[k]} ${tiers[k]}` : ""))
    .filter(Boolean)
    .join(" · ");
  return `
    <div class="paper-summary">
      <span>共 <strong>${n}</strong> 张</span>
      <span>平均 <strong>${avg}%</strong></span>
      <span>最高 <strong>${bestPct}%</strong></span>
      <span class="paper-summary-tiers">${tierStr}</span>
    </div>
  `;
}

function rerenderList(container) {
  const wrap = container.querySelector("#paperListWrap");
  if (!wrap) return;
  const data = store.getData();
  let list = [...data.papers];

  if (filterState.subject) list = list.filter((p) => p.subject === filterState.subject);
  if (filterState.type) list = list.filter((p) => p.type === filterState.type);
  if (filterState.q.trim()) {
    const q = filterState.q.trim().toLowerCase();
    list = list.filter((p) => String(p.name).toLowerCase().includes(q));
  }

  const pct = (p) => store.scorePercent(p);
  list.sort((a, b) => {
    switch (filterState.sort) {
      case "date-asc": return (a.date || "").localeCompare(b.date || "");
      case "score-desc": return pct(b) - pct(a);
      case "score-asc": return pct(a) - pct(b);
      default: return (b.date || "").localeCompare(a.date || "");
    }
  });

  if (!list.length) {
    wrap.innerHTML = emptyHTML(data.papers.length === 0);
    wrap.querySelector("#empAdd")?.addEventListener("click", () => openPaperForm());
    return;
  }

  wrap.innerHTML = `<div class="paper-grid">${list.map(cardHTML).join("")}</div>`;

  // 绑定步进 / 编辑 / 删除
  list.forEach((p) => bindCard(wrap, p));
}

function cardHTML(p) {
  const tier = store.getTier(p);
  const total = store.num(p.totalScore, 100);
  const score = store.num(p.score);
  return `
    <div class="paper-card" data-id="${p.id}" title="点击编辑">
      <div class="paper-card-main">
        <div class="paper-card-info">
          <div class="paper-name" title="${esc(p.name)}">${esc(p.name)}</div>
          ${p.note ? `<div class="paper-note">${esc(p.note)}</div>` : ""}
          <div class="paper-meta">
            <span class="tag tag-ink">${esc(p.subject)}</span>
            <span class="tag">${esc(p.type)}</span>
            <span class="paper-date">${store.formatDate(p.date)}</span>
          </div>
        </div>
        <div class="paper-card-right">
          <div class="paper-score-compact">
            <span class="score-num">${score}</span><span class="score-total">/${total}</span>
          </div>
          <span class="tier tier-${tier.key}"><span class="dot-sm"></span>${tier.label} ${tier.pct}%</span>
        </div>
      </div>
    </div>`;
}

function bindCard(wrap, p) {
  const card = wrap.querySelector(`.paper-card[data-id="${p.id}"]`);
  if (!card) return;
  card.onclick = () => openPaperForm(store.getData().papers.find((x) => x.id === p.id));
}

function emptyHTML(noData) {
  return `
    <div class="card">
      <div class="empty">
        <div class="empty-ico">▤</div>
        <h3>${noData ? "还没有刷题记录" : "没有符合条件的试卷"}</h3>
        <p>${noData ? "请回到「仪表盘」点击「+ 录入第一张试卷」开始建立你的成绩档案。" : "尝试调整筛选条件或清空搜索。"}</p>
      </div>
    </div>`;
}

/* ---------- 表单（模态） ---------- */
export function openPaperForm(paper = null) {
  const data = store.getData();
  const isEdit = !!paper;
  const p = paper || { name: "", type: data.paperTypes[0], subject: data.subjects[0], date: store.todayISO(), score: 0, totalScore: 100, note: "" };

  openModal({
    title: isEdit ? "编辑试卷" : "录入试卷",
    body: `
      <div class="form-grid">
        <div class="field span-2">
          <label>试卷名称<span class="req">*</span></label>
          <input class="input" id="pf_name" value="${esc(p.name)}" placeholder="如：2024 数学一真题" />
        </div>
        <div class="field">
          <label>类型</label>
          <select class="select" id="pf_type">${data.paperTypes.map((t) => `<option ${t === p.type ? "selected" : ""}>${t}</option>`).join("")}</select>
        </div>
        <div class="field">
          <label>科目</label>
          <select class="select" id="pf_subject">${data.subjects.map((s) => `<option ${s === p.subject ? "selected" : ""}>${s}</option>`).join("")}</select>
        </div>
        <div class="field">
          <label>完成日期</label>
          <input class="input" id="pf_date" type="date" value="${esc(p.date)}" />
        </div>
        <div class="field">
          <label>满分</label>
          <input class="input" id="pf_total" type="number" min="1" value="${store.num(p.totalScore, 100)}" />
        </div>
        <div class="field">
          <label>得分</label>
          <input class="input" id="pf_score" type="number" min="0" value="${store.num(p.score)}" />
        </div>
        <div class="field span-2">
          <label>备注</label>
          <textarea class="textarea" id="pf_note" placeholder="可记录用时、难度感受等">${esc(p.note)}</textarea>
        </div>
      </div>
      <div id="pf_tierPreview" style="margin-top:12px"></div>
    `,
    footer: `
      ${isEdit ? `<button class="btn btn-danger" id="pf_del">删除</button>` : ""}
      <button class="btn btn-ghost" id="pf_cancel">取消</button>
      <button class="btn btn-primary" id="pf_save">${isEdit ? "保存修改" : "录入"}</button>
    `,
    onMount: (root) => {
      const preview = () => {
        const s = parseFloat(root.querySelector("#pf_score").value) || 0;
        const t = parseFloat(root.querySelector("#pf_total").value) || 100;
        const tier = store.getTier({ score: s, totalScore: t });
        root.querySelector("#pf_tierPreview").innerHTML =
          `<span class="tier tier-${tier.key}"><span class="dot-sm"></span>当前评级：${tier.label}（${tier.pct}%）</span>`;
      };
      ["#pf_score", "#pf_total"].forEach((sel) => root.querySelector(sel).addEventListener("input", preview));
      preview();

      // 满分随科目联动：数学/408 自动 150，政治/英语 自动 100
      const totalInput = root.querySelector("#pf_total");
      const subjectSel = root.querySelector("#pf_subject");
      const defaultTotalFor = (s) =>
        (s === "数学" || s === "408") ? 150 : (s === "政治" || s === "英语" ? 100 : null);
      if (!isEdit) {
        const dt = defaultTotalFor(subjectSel.value);
        if (dt != null) totalInput.value = dt;
      }
      subjectSel.addEventListener("change", () => {
        const dt = defaultTotalFor(subjectSel.value);
        if (dt != null) totalInput.value = dt;
        preview();
      });

      root.querySelector("#pf_cancel").onclick = () => closeModal();
      const delBtn = root.querySelector("#pf_del");
      if (delBtn) {
        delBtn.onclick = async () => {
          const ok = await confirmBox("删除试卷", `确认删除「${esc(p.name)}」？其关联错题与知识点也将一并删除。`);
          if (ok) {
            store.deletePaper(paper.id);
            toast("已删除", "ok");
            closeModal();
          }
        };
      }
      root.querySelector("#pf_save").onclick = () => {
        const name = root.querySelector("#pf_name").value.trim();
        if (!name) { toast("请填写试卷名称", "err"); return; }
        const payload = {
          name,
          type: root.querySelector("#pf_type").value,
          subject: root.querySelector("#pf_subject").value,
          date: root.querySelector("#pf_date").value || store.todayISO(),
          score: parseFloat(root.querySelector("#pf_score").value) || 0,
          totalScore: parseFloat(root.querySelector("#pf_total").value) || 100,
          note: root.querySelector("#pf_note").value.trim(),
        };
        if (isEdit) store.updatePaper(paper.id, payload);
        else store.addPaper(payload);
        toast(isEdit ? "已保存修改" : "已录入试卷", "ok");
        closeModal();
      };
    },
  });
}
