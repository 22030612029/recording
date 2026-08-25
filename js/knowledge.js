/* ============================================================
 * knowledge.js — 错题与知识点管理
 * 双子标签、多维筛选、关联展示
 * ============================================================ */
import { openModal, closeModal, toast, esc, confirmBox } from "./app.js";
import * as store from "./storage.js";

let activeSub = "errors";
let filter = { q: "", subject: "", module: "", reason: "", type: "" };

export function renderKnowledge(container) {
  const data = store.getData();
  const modules = uniqueModules(data);

  container.innerHTML = `
    <div class="section-head">
      <div>
        <h2>错题与知识点</h2>
        <div class="hint">错题 ${data.errors.length} · 知识点 ${data.knowledge.length} · 模块 ${modules.length}</div>
      </div>
    </div>

    <div class="subtabs">
      <button class="subtab ${activeSub === "errors" ? "active" : ""}" data-sub="errors">
        错题本 <span class="count">${data.errors.length}</span>
      </button>
      <button class="subtab ${activeSub === "knowledge" ? "active" : ""}" data-sub="knowledge">
        知识点 <span class="count">${data.knowledge.length}</span>
      </button>
    </div>

    <div class="toolbar">
      <div class="filters">
        <select class="select filter" id="kSubject">
          <option value="">全部科目</option>
          ${data.subjects.map((s) => `<option ${filter.subject === s ? "selected" : ""}>${s}</option>`).join("")}
        </select>
        <select class="select filter" id="kModule">
          <option value="">全部模块</option>
          ${modules.map((m) => `<option ${filter.module === m ? "selected" : ""}>${esc(m)}</option>`).join("")}
        </select>
        ${activeSub === "errors"
          ? `<select class="select filter" id="kReason">
              <option value="">全部错因</option>
              ${data.errorReasons.map((r) => `<option ${filter.reason === r ? "selected" : ""}>${r}</option>`).join("")}
            </select>`
          : `<select class="select filter" id="kType">
              <option value="">全部类型</option>
              ${data.kpTypes.map((t) => `<option ${filter.type === t ? "selected" : ""}>${t}</option>`).join("")}
            </select>`}
      </div>
      <div class="search"><input class="input" id="kQ" type="search" placeholder="搜索内容" value="${esc(filter.q)}" /></div>
      <button class="btn btn-primary" id="kAdd">${activeSub === "errors" ? "+ 错题" : "+ 知识点"}</button>
    </div>

    <div id="kListWrap"></div>
  `;

  container.querySelectorAll(".subtab").forEach((b) => {
    b.onclick = () => {
      activeSub = b.dataset.sub;
      filter.type = ""; filter.reason = "";
      renderKnowledge(container);
    };
  });
  container.querySelector("#kAdd").onclick = () =>
    activeSub === "errors" ? openErrorForm() : openKnowledgeForm();
  const q = container.querySelector("#kQ");
  q.oninput = (e) => { filter.q = e.target.value; rerender(container); };
  const sSel = container.querySelector("#kSubject");
  sSel.onchange = (e) => { filter.subject = e.target.value; rerender(container); };
  const mSel = container.querySelector("#kModule");
  mSel.onchange = (e) => { filter.module = e.target.value; rerender(container); };
  const reasonSel = container.querySelector("#kReason");
  if (reasonSel) reasonSel.onchange = (e) => { filter.reason = e.target.value; rerender(container); };
  const typeSel = container.querySelector("#kType");
  if (typeSel) typeSel.onchange = (e) => { filter.type = e.target.value; rerender(container); };

  rerender(container);
}

function rerender(container) {
  const data = store.getData();
  const wrap = container.querySelector("#kListWrap");
  if (activeSub === "errors") renderErrors(data, wrap);
  else renderKnowledgeList(data, wrap);
}

function paperOf(id) {
  return store.getData().papers.find((p) => p.id === id);
}

function renderErrors(data, wrap) {
  let list = data.errors.filter((e) => {
    const p = paperOf(e.paperId);
    if (filter.subject && p?.subject !== filter.subject) return false;
    if (filter.module && e.module !== filter.module) return false;
    if (filter.reason && e.reason !== filter.reason) return false;
    if (filter.q.trim()) {
      const q = filter.q.toLowerCase();
      if (!String(e.question).toLowerCase().includes(q) && !String(e.module).toLowerCase().includes(q)) return false;
    }
    return true;
  }).sort((a, b) => (b.createdAt - a.createdAt));

  if (!list.length) {
    wrap.innerHTML = emptyHTML("错题", "尚未记录错题", "先从「仪表盘」录入一张试卷，再回来记录这里面做错的题（带错因分析印象更牢）。");
    return;
  }
  wrap.innerHTML = `<div class="item-list">${list.map((e) => errorItemHTML(e, data)).join("")}</div>`;
  list.forEach((e) => bindErrorItem(wrap, e));
}

function errorItemHTML(e, data) {
  const p = paperOf(e.paperId);
  const linked = e.linkedKpId ? data.knowledge.find((k) => k.id === e.linkedKpId) : null;
  return `
    <article class="item" data-id="${e.id}">
      <div class="item-head">
        <span class="tag tag-danger">${esc(e.reason)}</span>
        <span class="tag tag-ink">${esc(p?.subject || "—")}</span>
        <span class="tag tag-accent">${esc(e.module)}</span>
        ${p ? `<span class="muted" style="font-size:12px">来自「${esc(p.name)}」</span>` : ""}
      </div>
      <div class="item-title">${esc(e.question)}</div>
      ${e.image ? `<img class="item-img" src="${e.image}" alt="题目图片" data-view-img />` : ""}
      <div class="item-body" style="margin-top:6px">
        <div><span class="muted">误选：</span><span style="color:var(--tier-fail)">${esc(e.wrongOption) || "—"}</span></div>
        <div><span class="muted">正解：</span><span style="color:var(--tier-excellent)">${esc(e.correctAnswer) || "—"}</span></div>
        ${linked ? `<div class="muted" style="margin-top:4px">关联知识点：${esc(linked.content)}</div>` : ""}
      </div>
      <div class="item-actions">
        <button class="btn btn-ghost btn-sm" data-edit>编辑</button>
        <button class="btn btn-ghost btn-sm" data-link>${linked ? "改关联" : "关联知识点"}</button>
        <button class="btn btn-danger btn-sm" data-del>删除</button>
      </div>
    </article>`;
}

function bindErrorItem(wrap, e) {
  const el = wrap.querySelector(`.item[data-id="${e.id}"]`);
  el.querySelector("[data-edit]").onclick = () => openErrorForm(e);
  el.querySelector("[data-link]").onclick = () => openLinkPicker(e);
  el.querySelector("[data-del]").onclick = async () => {
    const ok = await confirmBox("删除错题", "确认删除该错题？");
    if (ok) { store.deleteError(e.id); toast("已删除", "ok"); rerender(el.closest("#view-knowledge")); }
  };
  const img = el.querySelector("[data-view-img]");
  if (img) img.onclick = () => openImageViewer(img.src);
}

function renderKnowledgeList(data, wrap) {
  let list = data.knowledge.filter((k) => {
    const p = paperOf(k.paperId);
    if (filter.subject && p?.subject !== filter.subject) return false;
    if (filter.module && k.module !== filter.module) return false;
    if (filter.type && k.type !== filter.type) return false;
    if (filter.q.trim()) {
      const q = filter.q.toLowerCase();
      if (!String(k.content).toLowerCase().includes(q) && !String(k.module).toLowerCase().includes(q)) return false;
    }
    return true;
  }).sort((a, b) => (b.createdAt - a.createdAt));

  if (!list.length) {
    wrap.innerHTML = emptyHTML("知识点", "尚未记录知识点", "先录入试卷，再记录对应的关键/薄弱/复习建议，系统会自动关联到试卷。");
    return;
  }
  wrap.innerHTML = `<div class="item-list">${list.map((k) => knowledgeItemHTML(k, data)).join("")}</div>`;
  list.forEach((k) => bindKnowledgeItem(wrap, k));
}

function knowledgeItemHTML(k, data) {
  const p = paperOf(k.paperId);
  const relatedErrors = data.errors.filter((e) => e.module === k.module || e.linkedKpId === k.id);
  const toneClass = k.type === "薄弱环节" ? "tag-danger" : k.type === "复习建议" ? "tag-warn" : "tag-accent";
  const masteryTone = k.mastery >= 80 ? "tier-excellent" : k.mastery >= 60 ? "tier-good" : k.mastery >= 40 ? "tier-pass" : "tier-fail";
  return `
    <article class="item" data-id="${k.id}">
      <div class="item-head">
        <span class="tag ${toneClass}">${esc(k.type)}</span>
        <span class="tag tag-ink">${esc(p?.subject || "—")}</span>
        <span class="tag tag-accent">${esc(k.module)}</span>
        <span class="tier ${masteryTone}"><span class="dot-sm"></span>掌握 ${store.num(k.mastery)}%</span>
        ${p ? `<span class="muted" style="font-size:12px">来自「${esc(p.name)}」</span>` : ""}
      </div>
      <div class="item-body">${esc(k.content)}</div>
      ${k.image ? `<img class="item-img" src="${k.image}" alt="知识点配图" data-view-img />` : ""}
      ${relatedErrors.length ? `<div class="muted" style="font-size:12px;margin-top:6px">关联错题 ${relatedErrors.length} 道 · 同模块「${esc(k.module)}」</div>` : ""}
      <div class="item-actions">
        <button class="btn btn-ghost btn-sm" data-edit>编辑</button>
        <button class="btn btn-ghost btn-sm" data-finderr>查看关联错题</button>
        <button class="btn btn-danger btn-sm" data-del>删除</button>
      </div>
    </article>`;
}

function bindKnowledgeItem(wrap, k) {
  const el = wrap.querySelector(`.item[data-id="${k.id}"]`);
  el.querySelector("[data-edit]").onclick = () => openKnowledgeForm(k);
  el.querySelector("[data-finderr]").onclick = () => {
    filter.q = ""; filter.module = k.module;
    activeSub = "errors";
    renderKnowledge(el.closest("#view-knowledge"));
    toast(`已按模块「${k.module}」筛选错题`, "ok");
  };
  el.querySelector("[data-del]").onclick = async () => {
    const ok = await confirmBox("删除知识点", "确认删除该知识点？");
    if (ok) { store.deleteKnowledge(k.id); toast("已删除", "ok"); rerender(el.closest("#view-knowledge")); }
  };
  const img = el.querySelector("[data-view-img]");
  if (img) img.onclick = () => openImageViewer(img.src);
}

/* ---------- 错题表单 ---------- */
export function openErrorForm(item = null) {
  const data = store.getData();
  const isEdit = !!item;
  const e = item || { paperId: data.papers[0]?.id || "", question: "", wrongOption: "", correctAnswer: "", reason: data.errorReasons[0], module: "", linkedKpId: "" };
  if (!data.papers.length) { toast("请先录入至少一张试卷", "warn"); return; }

  openModal({
    title: isEdit ? "编辑错题" : "添加错题",
    body: `
      <div class="form-grid">
        <div class="field span-2">
          <label>关联试卷<span class="req">*</span></label>
          <select class="select" id="ef_paper">
            ${data.papers.map((p) => `<option value="${p.id}" ${p.id === e.paperId ? "selected" : ""}>${esc(p.name)}（${esc(p.subject)}）</option>`).join("")}
          </select>
        </div>
        <div class="field span-2">
          <label>题目<span class="req">*</span></label>
          <textarea class="textarea" id="ef_question" placeholder="录入题干">${esc(e.question)}</textarea>
        </div>
        <div class="field">
          <label>误选</label>
          <input class="input" id="ef_wrong" value="${esc(e.wrongOption)}" placeholder="如 B" />
        </div>
        <div class="field">
          <label>正解</label>
          <input class="input" id="ef_correct" value="${esc(e.correctAnswer)}" placeholder="如 D" />
        </div>
        <div class="field">
          <label>错因</label>
          <select class="select" id="ef_reason">${data.errorReasons.map((r) => `<option ${r === e.reason ? "selected" : ""}>${r}</option>`).join("")}</select>
        </div>
        <div class="field">
          <label>知识模块</label>
          <input class="input" id="ef_module" value="${esc(e.module)}" placeholder="如 极限 / 毛中特" />
        </div>
        <div class="field span-2">
          <label>题目图片</label>
          <div class="img-pick">
            ${e.image ? `<img class="img-prev" id="ef_imgPrev" src="${e.image}" alt="题目图片" data-view-img />` : ""}
            <div class="img-pick-btns">
              <button class="btn btn-ghost btn-sm" id="ef_imgBtn">${e.image ? "更换图片" : "上传图片"}</button>
              ${e.image ? `<button class="btn btn-danger btn-sm" id="ef_imgDel">移除</button>` : ""}
            </div>
          </div>
        </div>
      </div>
    `,
    footer: `<button class="btn btn-ghost" id="ef_cancel">取消</button><button class="btn btn-primary" id="ef_save">${isEdit ? "保存" : "添加"}</button>`,
    onMount: (root) => {
      root.querySelector("#ef_cancel").onclick = () => closeModal();
      let imgVal = e.image || "";
      const imgWrap = root.querySelector(".img-pick");
      const refreshImg = () => {
        imgWrap.innerHTML = `
          ${imgVal ? `<img class="img-prev" src="${imgVal}" alt="题目图片" data-view-img />` : ""}
          <div class="img-pick-btns">
            <button class="btn btn-ghost btn-sm" data-pick>${imgVal ? "更换图片" : "上传图片"}</button>
            ${imgVal ? `<button class="btn btn-danger btn-sm" data-del>移除</button>` : ""}
          </div>`;
        imgWrap.querySelector("[data-pick]").onclick = onPick;
        const del = imgWrap.querySelector("[data-del]");
        if (del) del.onclick = () => { imgVal = ""; refreshImg(); };
        const img = imgWrap.querySelector("[data-view-img]");
        if (img) img.onclick = () => openImageViewer(img.src);
      };
      const onPick = async () => {
        const dataUrl = await pickImage();
        if (dataUrl) { imgVal = dataUrl; refreshImg(); }
      };
      refreshImg();
      root.querySelector("#ef_save").onclick = () => {
        const question = root.querySelector("#ef_question").value.trim();
        if (!question) { toast("请录入题目", "err"); return; }
        const payload = {
          paperId: root.querySelector("#ef_paper").value,
          question,
          wrongOption: root.querySelector("#ef_wrong").value.trim(),
          correctAnswer: root.querySelector("#ef_correct").value.trim(),
          reason: root.querySelector("#ef_reason").value,
          module: root.querySelector("#ef_module").value.trim() || "未分类",
          image: imgVal,
        };
        if (isEdit) store.updateError(item.id, payload);
        else store.addError(payload);
        toast(isEdit ? "已保存" : "已添加错题", "ok");
        closeModal();
      };
    },
  });
}

function openLinkPicker(err) {
  const data = store.getData();
  const kps = data.knowledge.filter((k) => paperOf(k.paperId)?.id === err.paperId || k.module === err.module);
  const pool = kps.length ? kps : data.knowledge;
  openModal({
    title: "关联知识点",
    body: `
      <p class="muted" style="font-size:13px;margin-bottom:12px">为该错题选择一个知识点（优先同试卷/同模块）：</p>
      <div class="item-list">
        ${pool.length ? pool.map((k) => `
          <button class="item" data-kp="${k.id}" style="cursor:pointer;text-align:left;width:100%">
            <div class="item-head"><span class="tag tag-accent">${esc(k.module)}</span><span class="tag">${esc(k.type)}</span></div>
            <div class="item-body">${esc(k.content)}</div>
          </button>`).join("") : `<div class="muted">暂无知识点可关联，请先添加。</div>`}
        ${err.linkedKpId ? `<button class="item" data-kp="" style="cursor:pointer;text-align:left;width:100%;color:var(--tier-fail)">取消关联</button>` : ""}
      </div>
    `,
    footer: `<button class="btn btn-ghost" id="lp_cancel">关闭</button>`,
    onMount: (root) => {
      root.querySelector("#lp_cancel").onclick = () => closeModal();
      root.querySelectorAll("[data-kp]").forEach((b) => {
        b.onclick = () => {
          store.updateError(err.id, { linkedKpId: b.dataset.kp || "" });
          toast(b.dataset.kp ? "已关联" : "已取消关联", "ok");
          closeModal();
        };
      });
    },
  });
}

/* ---------- 知识点表单 ---------- */
export function openKnowledgeForm(item = null) {
  const data = store.getData();
  const isEdit = !!item;
  const k = item || { paperId: data.papers[0]?.id || "", type: data.kpTypes[0], module: "", content: "", mastery: 60 };
  if (!data.papers.length) { toast("请先录入至少一张试卷", "warn"); return; }

  openModal({
    title: isEdit ? "编辑知识点" : "添加知识点",
    body: `
      <div class="form-grid">
        <div class="field span-2">
          <label>关联试卷<span class="req">*</span></label>
          <select class="select" id="kf_paper">
            ${data.papers.map((p) => `<option value="${p.id}" ${p.id === k.paperId ? "selected" : ""}>${esc(p.name)}（${esc(p.subject)}）</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label>类型</label>
          <select class="select" id="kf_type">${data.kpTypes.map((t) => `<option ${t === k.type ? "selected" : ""}>${t}</option>`).join("")}</select>
        </div>
        <div class="field">
          <label>知识模块</label>
          <input class="input" id="kf_module" value="${esc(k.module)}" placeholder="如 积分 / 阅读" />
        </div>
        <div class="field span-2">
          <label>内容<span class="req">*</span></label>
          <textarea class="textarea" id="kf_content" placeholder="记录要点、薄弱原因或复习建议">${esc(k.content)}</textarea>
        </div>
        <div class="field span-2">
          <label>掌握程度</label>
          <div class="range-wrap">
            <input type="range" id="kf_mastery" min="0" max="100" value="${store.num(k.mastery, 60)}" />
            <span class="range-val" id="kf_masteryVal">${store.num(k.mastery, 60)}%</span>
          </div>
        </div>
        <div class="field span-2">
          <label>配图</label>
          <div class="img-pick" id="kf_imgWrap"></div>
        </div>
      </div>
    `,
    footer: `<button class="btn btn-ghost" id="kf_cancel">取消</button><button class="btn btn-primary" id="kf_save">${isEdit ? "保存" : "添加"}</button>`,
    onMount: (root) => {
      const m = root.querySelector("#kf_mastery");
      const mv = root.querySelector("#kf_masteryVal");
      m.oninput = () => (mv.textContent = m.value + "%");
      root.querySelector("#kf_cancel").onclick = () => closeModal();
      let imgVal = k.image || "";
      const imgWrap = root.querySelector("#kf_imgWrap");
      const refreshImg = () => {
        imgWrap.innerHTML = `
          ${imgVal ? `<img class="img-prev" src="${imgVal}" alt="知识点配图" data-view-img />` : ""}
          <div class="img-pick-btns">
            <button class="btn btn-ghost btn-sm" data-pick>${imgVal ? "更换图片" : "上传图片"}</button>
            ${imgVal ? `<button class="btn btn-danger btn-sm" data-del>移除</button>` : ""}
          </div>`;
        imgWrap.querySelector("[data-pick]").onclick = onPick;
        const del = imgWrap.querySelector("[data-del]");
        if (del) del.onclick = () => { imgVal = ""; refreshImg(); };
        const img = imgWrap.querySelector("[data-view-img]");
        if (img) img.onclick = () => openImageViewer(img.src);
      };
      const onPick = async () => {
        const dataUrl = await pickImage();
        if (dataUrl) { imgVal = dataUrl; refreshImg(); }
      };
      refreshImg();
      root.querySelector("#kf_save").onclick = () => {
        const content = root.querySelector("#kf_content").value.trim();
        if (!content) { toast("请录入内容", "err"); return; }
        const payload = {
          paperId: root.querySelector("#kf_paper").value,
          type: root.querySelector("#kf_type").value,
          module: root.querySelector("#kf_module").value.trim() || "未分类",
          content,
          mastery: parseInt(m.value, 10) || 0,
          image: imgVal,
        };
        if (isEdit) store.updateKnowledge(item.id, payload);
        else store.addKnowledge(payload);
        toast(isEdit ? "已保存" : "已添加知识点", "ok");
        closeModal();
      };
    },
  });
}

/* ---------- 工具 ---------- */
function uniqueModules(data) {
  const set = new Set();
  data.errors.forEach((e) => e.module && set.add(e.module));
  data.knowledge.forEach((k) => k.module && set.add(k.module));
  return [...set].sort();
}

/* ---------- 图片工具 ---------- */
function fileToCompressedDataUrl(file, maxSize = 900, quality = 0.72) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        const scale = Math.min(1, maxSize / Math.max(width, height));
        width = Math.max(1, Math.round(width * scale));
        height = Math.max(1, Math.round(height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        try {
          resolve(canvas.toDataURL("image/jpeg", quality));
        } catch (err) {
          resolve(reader.result);
        }
      };
      img.onerror = () => resolve(reader.result);
      img.src = reader.result;
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

// 选择并压缩一张图片，返回 dataURL（取消则 resolve null）
function pickImage() {
  return new Promise((resolve) => {
    const input = document.getElementById("imageInput");
    if (!input) { resolve(null); return; }
    input.value = "";
    const onChange = async () => {
      const file = input.files && input.files[0];
      input.removeEventListener("change", onChange);
      if (!file) { resolve(null); return; }
      if (!file.type.startsWith("image/")) { toast("请选择图片文件", "err"); resolve(null); return; }
      if (file.size > 8 * 1024 * 1024) { toast("图片过大（限 8MB）", "err"); resolve(null); return; }
      const dataUrl = await fileToCompressedDataUrl(file);
      resolve(dataUrl);
    };
    input.addEventListener("change", onChange);
    input.click();
  });
}

function openImageViewer(src) {
  openModal({
    title: "图片预览",
    body: `<img src="${src}" alt="预览" style="max-width:100%;max-height:60vh;border-radius:8px;display:block" />`,
    footer: `<button class="btn btn-ghost" id="iv_close">关闭</button>`,
    onMount: (root) => {
      root.querySelector("#iv_close").onclick = () => closeModal();
    },
  });
}

function emptyHTML(ico, title, desc) {
  return `
    <div class="card"><div class="empty">
      <div class="empty-ico">${ico === "错题" ? "✎" : "◈"}</div>
      <h3>${title}</h3><p>${desc}</p>
    </div></div>`;
}
