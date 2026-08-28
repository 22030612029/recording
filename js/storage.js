/* ============================================================
 * storage.js — 数据层（localStorage 单一数据源，按登录用户隔离）
 * 提供 schema、CRUD、导入/导出、示例数据、分数区间、事件订阅
 * ============================================================ */
import { getSessionUserId, userKey } from "./auth.js";

const LEGACY_KEY = "kaoyan_study_data";

/* 当前登录用户的数据 key（未登录返回 null，仅读默认数据不落库） */
export function dataKey() {
  const uid = getSessionUserId();
  return uid ? userKey(uid) : null;
}

/* 默认 schema */
function defaultData() {
  return {
    version: 2,
    subjects: ["政治", "英语", "数学", "408"],
    paperTypes: ["真题", "模拟卷", "专项练习"],
    errorReasons: ["概念混淆", "计算错误", "审题失误", "记忆偏差", "时间不足", "其他"],
    kpTypes: ["关键知识点", "薄弱环节", "复习建议"],
    tags: [], // 用户自定义标签
    kb: [], // 知识库（多级目录 + Markdown 笔记）
    diaries: [], // 小窝日记
    targetScore: 90, // 总体目标百分比（保留，向后兼容）
    activeTargetId: "",
    targets: [], // 目标院校数组
    papers: [],
    errors: [],
    knowledge: [],
  };
}

/* 目标院校结构：
 {
   id, name, major, note,
   subjectTargets: { [subject]: number }   // 各科目目标分数（满分参考对应科目常考满分，自动适配百分比）
   subjectTotals:  { [subject]: number }   // 各科目对应的满分（默认 100，数学可 150 等）
   year,                                   // 目标年份，默认 2027
   createdAt, updatedAt,
 }
*/

let _data = null;
const _listeners = new Set();

/* ---------- 读取/保存 ---------- */
export function load() {
  const key = dataKey();
  try {
    const raw = key ? localStorage.getItem(key) : null;
    if (!raw) {
      _data = defaultData();
    } else {
      const parsed = JSON.parse(raw);
      const base = defaultData();
      _data = Object.assign(base, parsed);
      if (!Array.isArray(_data.papers)) _data.papers = [];
      if (!Array.isArray(_data.errors)) _data.errors = [];
      if (!Array.isArray(_data.knowledge)) _data.knowledge = [];
      if (!Array.isArray(_data.targets)) _data.targets = [];
      if (!Array.isArray(_data.kb)) _data.kb = [];
      if (!Array.isArray(_data.diaries)) _data.diaries = [];
      if (!_data.activeTargetId && _data.targets.length) _data.activeTargetId = _data.targets[0].id;

      // —— 2026-08-22 迁移：科目键「专业课」统一改名为「408」 ——
      let migrated = false;
      const renameSubject = (obj) => {
        if (!obj || typeof obj !== "object") return;
        if (Array.isArray(obj)) { obj.forEach(renameSubject); return; }
        if ("专业课" in obj && !("408" in obj)) {
          obj["408"] = obj["专业课"];
          delete obj["专业课"];
          migrated = true;
        }
        Object.values(obj).forEach(renameSubject);
      };
      const renameArrayField = (arr, field) => {
        arr.forEach((it) => {
          if (it?.[field] === "专业课") { it[field] = "408"; migrated = true; }
        });
      };
      _data.subjects = _data.subjects.map((s) => { if (s === "专业课") { migrated = true; return "408"; } return s; });
      if (!_data.subjects.includes("408")) _data.subjects.push("408");
      renameArrayField(_data.papers, "subject");
      renameArrayField(_data.errors, "subject");
      renameArrayField(_data.knowledge, "subject");
      renameSubject(_data.targets);
      if (migrated) save();
    }
  } catch (e) {
    console.warn("数据读取失败，重置为默认。", e);
    _data = defaultData();
  }
  return _data;
}

export function save() {
  const key = dataKey();
  if (!key) return false; // 未登录不写库
  try {
    localStorage.setItem(key, JSON.stringify(_data));
    emit();
    return true;
  } catch (e) {
    console.error("保存失败", e);
    return false;
  }
}

export function getData() {
  if (!_data) load();
  return _data;
}

/* ---------- 事件 ---------- */
export function subscribe(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}
function emit() {
  _listeners.forEach((fn) => {
    try { fn(_data); } catch (e) { console.error(e); }
  });
}

/* ---------- ID ---------- */
export function uid(prefix = "id") {
  return prefix + "_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7);
}

/* ---------- 试卷 CRUD ---------- */
export function addPaper(p) {
  const now = Date.now();
  const paper = {
    id: uid("p"),
    name: p.name?.trim() || "未命名试卷",
    type: p.type || "真题",
    subject: p.subject || _data.subjects[0] || "数学",
    date: p.date || todayISO(),
    score: num(p.score),
    totalScore: num(p.totalScore, 100),
    note: p.note?.trim() || "",
    createdAt: now,
    updatedAt: now,
  };
  _data.papers.push(paper);
  save();
  return paper;
}

export function updatePaper(id, patch) {
  const p = _data.papers.find((x) => x.id === id);
  if (!p) return null;
  Object.assign(p, patch, { updatedAt: Date.now() });
  save();
  return p;
}

export function adjustScore(id, delta) {
  const p = _data.papers.find((x) => x.id === id);
  if (!p) return null;
  p.score = clamp(num(p.score) + delta, 0, num(p.totalScore, 100));
  p.updatedAt = Date.now();
  save();
  return p;
}

export function setScore(id, value) {
  const p = _data.papers.find((x) => x.id === id);
  if (!p) return null;
  p.score = clamp(num(value), 0, num(p.totalScore, 100));
  p.updatedAt = Date.now();
  save();
  return p;
}

export function deletePaper(id) {
  _data.papers = _data.papers.filter((x) => x.id !== id);
  _data.errors = _data.errors.filter((x) => x.paperId !== id);
  _data.knowledge = _data.knowledge.filter((x) => x.paperId !== id);
  save();
}

/* ---------- 错题 CRUD ---------- */
export function addError(e) {
  const now = Date.now();
  const item = {
    id: uid("e"),
    paperId: e.paperId || "",
    question: e.question?.trim() || "",
    wrongOption: e.wrongOption?.trim() || "",
    correctAnswer: e.correctAnswer?.trim() || "",
    reason: e.reason || "其他",
    module: e.module?.trim() || "未分类",
    linkedKpId: e.linkedKpId || "",
    image: e.image || "", // 题目图片（dataURL）
    tags: Array.isArray(e.tags) ? e.tags.filter(Boolean) : [],
    // 艾宾浩斯复习
    reviewStage: 0,       // 0=未开始, 1~5=第N轮
    nextReview: now + 24 * 3600 * 1000, // 下次复习时间（默认1天后）
    lastReview: 0,
    reviewCount: 0,
    createdAt: now,
  };
  _data.errors.push(item);
  save();
  return item;
}
export function updateError(id, patch) {
  const it = _data.errors.find((x) => x.id === id);
  if (!it) return null;
  Object.assign(it, patch);
  save();
  return it;
}
export function deleteError(id) {
  _data.errors = _data.errors.filter((x) => x.id !== id);
  save();
}

/* ---------- 知识点 CRUD ---------- */
export function addKnowledge(k) {
  const item = {
    id: uid("k"),
    paperId: k.paperId || "",
    type: k.type || "关键知识点",
    module: k.module?.trim() || "未分类",
    content: k.content?.trim() || "",
    mastery: clamp(num(k.mastery, 0), 0, 100),
    image: k.image || "", // 知识点配图（dataURL）
    tags: Array.isArray(k.tags) ? k.tags.filter(Boolean) : [],
    createdAt: Date.now(),
  };
  _data.knowledge.push(item);
  save();
  return item;
}
export function updateKnowledge(id, patch) {
  const it = _data.knowledge.find((x) => x.id === id);
  if (!it) return null;
  Object.assign(it, patch);
  save();
  return it;
}
export function deleteKnowledge(id) {
  _data.knowledge = _data.knowledge.filter((x) => x.id !== id);
  save();
}

/* ---------- 科目/类型管理 ---------- */
export function addSubject(name) {
  name = name.trim();
  if (!name || _data.subjects.includes(name)) return false;
  _data.subjects.push(name);
  save();
  return true;
}
export function removeSubject(name) {
  _data.subjects = _data.subjects.filter((s) => s !== name);
  save();
}

/* ---------- 目标院校 CRUD ---------- */
export function listTargets() { return _data.targets; }
export function getActiveTarget() {
  if (_data.activeTargetId) {
    const t = _data.targets.find((x) => x.id === _data.activeTargetId);
    if (t) return t;
  }
  return _data.targets[0] || null;
}
export function setActiveTarget(id) {
  const t = _data.targets.find((x) => x.id === id);
  if (!t) return null;
  _data.activeTargetId = t.id;
  save();
  return t;
}
export function addTarget(raw) {
  const now = Date.now();
  const subjectTargets = {};
  const subjectTotals = {};
  (_data.subjects || []).forEach((s) => {
    subjectTargets[s] = num(raw?.subjectTargets?.[s], 0);
    const fallback = s === "数学" ? 150 : (s === "408" ? 150 : 100);
    subjectTotals[s] = num(raw?.subjectTotals?.[s], fallback);
  });
  const t = {
    id: uid("t"),
    name: (raw.name || "").trim() || "未命名目标院校",
    major: (raw.major || "").trim(),
    note: (raw.note || "").trim(),
    year: num(raw.year, new Date().getFullYear()),
    subjectTargets,
    subjectTotals,
    createdAt: now,
    updatedAt: now,
  };
  _data.targets.push(t);
  if (!_data.activeTargetId) _data.activeTargetId = t.id;
  save();
  return t;
}
export function updateTarget(id, raw) {
  const t = _data.targets.find((x) => x.id === id);
  if (!t) return null;
  if (raw.name != null) t.name = (raw.name || "").trim() || t.name;
  if (raw.major != null) t.major = (raw.major || "").trim();
  if (raw.note != null) t.note = (raw.note || "").trim();
  if (raw.year != null) t.year = num(raw.year, t.year);
  if (raw.subjectTargets) {
    Object.keys(raw.subjectTargets).forEach((s) => {
      t.subjectTargets[s] = num(raw.subjectTargets[s], t.subjectTargets[s] || 0);
    });
  }
  if (raw.subjectTotals) {
    Object.keys(raw.subjectTotals).forEach((s) => {
      t.subjectTotals[s] = num(raw.subjectTotals[s], t.subjectTotals[s] || 100);
    });
  }
  t.updatedAt = Date.now();
  save();
  return t;
}
export function deleteTarget(id) {
  _data.targets = _data.targets.filter((x) => x.id !== id);
  if (_data.activeTargetId === id) _data.activeTargetId = _data.targets[0]?.id || "";
  save();
}

/* 科目当前平均（百分比 & 原始分）：按该科目所有试卷 */
export function subjectAverage(subject) {
  const papers = _data.papers.filter((p) => p.subject === subject);
  if (!papers.length) return { avgScore: 0, avgPct: 0, count: 0 };
  const total = papers.reduce((a, p) => a + num(p.totalScore, 100), 0) || 1;
  const score = papers.reduce((a, p) => a + num(p.score), 0);
  return {
    avgScore: Math.round((score / papers.length) * 10) / 10,
    avgPct: Math.round((score / total) * 1000) / 10,
    count: papers.length,
  };
}

/* 与当前激活目标的科目差距分析
   返回 [{ subject, targetScore, targetTotal, targetPct, curScore, curPct,
            diffScore, diffPct, priority }]
   priority: 高/中/低，按 diffPct 与 未达标综合评估
*/
export function targetGap() {
  const target = getActiveTarget();
  if (!target) return { target: null, rows: [] };
  const rows = Object.keys(target.subjectTargets).map((subject) => {
    const targetScore = num(target.subjectTargets[subject]);
    const targetTotal = num(target.subjectTotals[subject], 100);
    const targetPct = targetTotal ? Math.round((targetScore / targetTotal) * 1000) / 10 : 0;
    const avg = subjectAverage(subject);
    const diffScore = Math.round((targetScore - avg.avgScore) * 10) / 10;
    const diffPct = Math.round((targetPct - avg.avgPct) * 10) / 10;
    // priority：未做卷的科目始终最高优先（先摸底），再按差距分级；达标仅对"有卷且达到"成立
    let priority = "低";
    if (avg.count === 0) priority = "高";
    else if (diffPct > 15) priority = "高";
    else if (diffPct > 5) priority = "中";
    else if (diffPct <= 0) priority = "达标";
    return {
      subject,
      targetScore, targetTotal, targetPct,
      curScore: avg.avgScore, curPct: avg.avgPct, count: avg.count,
      diffScore, diffPct, priority,
    };
  }).sort((a, b) => b.diffPct - a.diffPct);
  return { target, rows };
}

/* 统一口径：当前估算总分（各科按「目标满分折算」后相加，未刷卷科目按 0）
   与 targetTotal（目标总分）同一量纲，三处页面（仪表盘/学情分析/差距面板）共用 */
export function estimateTotal() {
  const gap = targetGap();
  const target = gap.target;
  if (!target) return { target: null, rows: [], totalTarget: 0, estimated: 0, diff: 0 };
  const rows = gap.rows.map((r) => ({
    ...r,
    scaled: r.count ? Math.round((r.curPct / 100) * r.targetTotal * 10) / 10 : 0,
  }));
  const totalTarget = rows.reduce((a, r) => a + r.targetScore, 0);
  const estimated = Math.round(rows.reduce((a, r) => a + r.scaled, 0) * 10) / 10;
  const diff = Math.round((totalTarget - estimated) * 10) / 10;
  return { target, rows, totalTarget, estimated, diff };
}

/* ---------- 导入/导出 ---------- */
export function exportJSON() {
  const uid = getSessionUserId();
  const safe = (uid || "default").replace(/[\\/:*?"<>|]/g, "_");
  const blob = new Blob([JSON.stringify(_data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `kaoyan_study_${safe}_${todayISO()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* 存储用量统计：返回 { used, quota, pct }（字节），供设置页预警 */
export function storageUsage() {
  try {
    const key = dataKey();
    const used = key ? new Blob([localStorage.getItem(key) || ""]).size : 0;
    const quota = 5 * 1024 * 1024; // 约 5MB
    return { used, quota, pct: quota ? Math.round((used / quota) * 1000) / 10 : 0 };
  } catch (e) {
    return { used: 0, quota: 0, pct: 0 };
  }
}

export function importJSON(text) {
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object") throw new Error("文件格式不正确");
  _data = Object.assign(defaultData(), parsed);
  if (!Array.isArray(_data.papers)) _data.papers = [];
  if (!Array.isArray(_data.errors)) _data.errors = [];
  if (!Array.isArray(_data.knowledge)) _data.knowledge = [];
  if (!Array.isArray(_data.targets)) _data.targets = [];
  if (!_data.activeTargetId && _data.targets.length) _data.activeTargetId = _data.targets[0].id;
  save();
  return _data;
}

export function clearAll() {
  _data = defaultData();
  save();
}

export function loadSample() {
  _data = defaultData();
  _data.papers = samplePapers();
  _data.errors = sampleErrors(_data.papers);
  _data.knowledge = sampleKnowledge(_data.papers);
  const t = sampleTarget();
  _data.targets = [t];
  _data.activeTargetId = t.id;
  save();
}

/* ---------- 示例目标院校 ---------- */
function sampleTarget() {
  const now = Date.now();
  return {
    id: uid("t"),
    name: "北京大学",
    major: "计算机学院 · 计算机科学与技术",
    note: "学硕 · 近3年初试总分线 360-370",
    year: 2027,
    subjectTargets: { 政治: 70, 英语: 70, 数学: 120, "408": 110 },
    subjectTotals:  { 政治: 100, 英语: 100, 数学: 150, "408": 150 },
    createdAt: now, updatedAt: now,
  };
}

/* ---------- 分数区间 ---------- */
export function scorePercent(paper) {
  if (!paper) return 0;
  const total = num(paper.totalScore, 100) || 100;
  return Math.round((num(paper.score) / total) * 1000) / 10;
}
export function getTier(paper) {
  const pct = scorePercent(paper);
  if (pct >= 90) return { key: "excellent", label: "优秀", color: "#1e7a5c", pct };
  if (pct >= 70) return { key: "good", label: "良好", color: "#c8924a", pct };
  if (pct >= 60) return { key: "pass", label: "及格", color: "#c7621f", pct };
  return { key: "fail", label: "待提升", color: "#b23a3a", pct };
}

/* ---------- 工具 ---------- */
export function num(v, d = 0) {
  v = Number(v);
  return Number.isFinite(v) ? v : d;
}
export function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
export function todayISO() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}
export function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d)) return iso;
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/* ---------- 示例数据 ---------- */
function samplePapers() {
  const base = Date.now();
  const mk = (n, type, subj, daysAgo, score, total) => ({
    id: uid("p"),
    name: n, type, subject: subj,
    date: daysAgoISO(daysAgo),
    score, totalScore: total, note: "",
    createdAt: base - daysAgo * 86400000,
    updatedAt: base - daysAgo * 86400000,
  });
  return [
    mk("2024 数学一真题", "真题", "数学", 38, 78, 150),
    mk("肖八 第一套", "模拟卷", "政治", 32, 36, 50),
    mk("英语一 2023 真题", "真题", "英语", 25, 52, 100),
    mk("专项·极限与连续", "专项练习", "数学", 18, 86, 100),
    mk("2024 数学一真题（二刷）", "真题", "数学", 12, 95, 150),
    mk("徐涛强化题集", "专项练习", "政治", 8, 42, 50),
    mk("英语一阅读专项", "专项练习", "英语", 5, 68, 100),
    mk("408 数据结构期末真题", "真题", "408", 2, 88, 100),
    mk("肖四 第三套", "模拟卷", "政治", 1, 44, 50),
  ];
}
function daysAgoISO(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}
function sampleErrors(papers) {
  const find = (subj, n = 0) => papers.filter((p) => p.subject === subj)[n] || papers[0];
  const list = [
    { paper: find("数学"), question: "设 f(x)=x·sin(1/x)，求 x→0 时极限", wrongOption: "B 极限为 0", correctAnswer: "D 不存在", reason: "概念混淆", module: "极限" },
    { paper: find("数学"), question: "求 ∫₀^1 x·e^x dx", wrongOption: "A 1", correctAnswer: "C 1", reason: "计算错误", module: "积分" },
    { paper: find("数学"), question: "判断函数 y=x^3 的凹凸区间", wrongOption: "B 全凹", correctAnswer: "A 全凸", reason: "审题失误", module: "导数应用" },
    { paper: find("政治"), question: "马克思主义中国化的最新理论成果是？", wrongOption: "C 毛泽东思想", correctAnswer: "D 新时代中特思想", reason: "记忆偏差", module: "毛中特" },
    { paper: find("英语"), question: "The word 'manifest' in paragraph 2 closest to:", wrongOption: "A hide", correctAnswer: "C show", reason: "词汇不足", module: "阅读理解" },
    { paper: find("408 数据结构期末真题"), question: "时间复杂度 O(n log n) 的排序算法是？", wrongOption: "A 冒泡", correctAnswer: "C 快排", reason: "概念混淆", module: "排序算法" },
  ];
  const reasons = _data.errorReasons || ["概念混淆", "计算错误", "审题失误", "记忆偏差", "时间不足", "其他"];
  void reasons;
  return list.map((e) => ({
    id: uid("e"),
    paperId: e.paper.id,
    question: e.question,
    wrongOption: e.wrongOption,
    correctAnswer: e.correctAnswer,
    reason: e.reason,
    module: e.module,
    linkedKpId: "",
    createdAt: Date.now(),
  }));
}
function sampleKnowledge(papers) {
  const find = (subj, n = 0) => papers.filter((p) => p.subject === subj)[n] || papers[0];
  const list = [
    { paper: find("数学"), type: "关键知识点", module: "极限", content: "等价无穷小替换：x→0 时 sinx~x，1-cosx~x²/2", mastery: 72 },
    { paper: find("数学"), type: "薄弱环节", module: "积分", content: "分部积分法的 u/v 选取仍易错，需专项练习", mastery: 55 },
    { paper: find("数学"), type: "复习建议", module: "导数应用", content: "凹凸区间判断需结合二阶导数符号，重做 5 道经典题", mastery: 68 },
    { paper: find("政治"), type: "关键知识点", module: "毛中特", content: "新时代主要矛盾：人民日益增长的美好生活需要与不平衡不充分的发展", mastery: 80 },
    { paper: find("政治"), type: "薄弱环节", module: "马原", content: "辩证法三大规律易混淆，需画框架图记忆", mastery: 58 },
    { paper: find("英语"), type: "关键知识点", module: "阅读理解", content: "作者态度题优先排除中立词（neutral/objective）", mastery: 70 },
    { paper: find("英语"), type: "复习建议", module: "写作", content: "背熟 3 套作文模板，每周写 1 篇", mastery: 62 },
    { paper: find("408 数据结构期末真题"), type: "关键知识点", module: "排序算法", content: "快排平均 O(n log n)，最坏 O(n²)；归并稳定", mastery: 85 },
    { paper: find("408 数据结构期末真题"), type: "薄弱环节", module: "图算法", content: "最短路径 Dijkstra 与 Floyd 适用场景易混", mastery: 50 },
  ];
  return list.map((k) => ({
    id: uid("k"),
    paperId: k.paper.id,
    type: k.type,
    module: k.module,
    content: k.content,
    mastery: k.mastery,
    createdAt: Date.now(),
  }));
}

/* ---------- 知识库（多级目录 + Markdown 笔记） ----------
 * 节点结构：
 * { id, title, type: "folder" | "note", parentId: string | null,
 *   content: "", sort, createdAt, updatedAt }
 * parentId = null 表示根节点；folder 可嵌套任意层级（多级目录）
 */
export function listKb() {
  if (!Array.isArray(_data.kb)) _data.kb = [];
  return _data.kb;
}
export function getKbNode(id) {
  return listKb().find((n) => n.id === id) || null;
}
export function addKbNode(raw) {
  const now = Date.now();
  const nodes = listKb();
  const parentId = raw.parentId || null;
  const sibs = nodes.filter((n) => (n.parentId || null) === parentId);
  const node = {
    id: uid("n"),
    title: (raw.title || "").trim() || "未命名",
    type: raw.type === "folder" ? "folder" : "note",
    parentId,
    content: raw.content || "",
    sort: sibs.length ? Math.max(...sibs.map((x) => x.sort || 0)) + 1 : 0,
    createdAt: now,
    updatedAt: now,
  };
  nodes.push(node);
  save();
  return node;
}
export function updateKbNode(id, patch) {
  const n = getKbNode(id);
  if (!n) return null;
  if (patch.title != null) n.title = (patch.title || "").trim() || n.title;
  if (patch.content != null) n.content = patch.content;
  if (patch.parentId !== undefined) n.parentId = patch.parentId || null;
  if (patch.sort != null) n.sort = patch.sort;
  n.updatedAt = Date.now();
  save();
  return n;
}
/* 删除节点及其全部后代（级联） */
export function deleteKbNode(id) {
  const nodes = listKb();
  if (!nodes.find((n) => n.id === id)) return false;
  const toDelete = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    nodes.forEach((n) => {
      if (n.parentId && toDelete.has(n.parentId) && !toDelete.has(n.id)) { toDelete.add(n.id); changed = true; }
    });
  }
  _data.kb = nodes.filter((n) => !toDelete.has(n.id));
  save();
  return true;
}
/* 把节点移动到指定文件夹下；禁止移到自己或自己的后代 */
export function moveKbNode(id, newParentId) {
  if (id === newParentId) return null;
  const target = getKbNode(id);
  if (!target) return null;
  if (!newParentId) { target.parentId = null; target.updatedAt = Date.now(); save(); return target; }
  const parent = getKbNode(newParentId);
  if (!parent || parent.type !== "folder") return null;
  let cur = newParentId;
  while (cur) {
    if (cur === id) return null;
    const p = getKbNode(cur);
    cur = p ? p.parentId : null;
  }
  target.parentId = newParentId;
  target.updatedAt = Date.now();
  save();
  return target;
}

/* ---------- 标签管理 ---------- */
export function getAllTags() {
  if (!Array.isArray(_data.tags)) _data.tags = [];
  return _data.tags;
}
export function addTag(name) {
  name = (name || "").trim();
  if (!name) return false;
  if (!Array.isArray(_data.tags)) _data.tags = [];
  if (_data.tags.includes(name)) return false;
  _data.tags.push(name);
  save();
  return true;
}
export function removeTag(name) {
  if (!Array.isArray(_data.tags)) return;
  _data.tags = _data.tags.filter((t) => t !== name);
  // 同时从错题和知识点中移除该标签
  _data.errors.forEach((e) => { if (Array.isArray(e.tags)) e.tags = e.tags.filter((t) => t !== name); });
  _data.knowledge.forEach((k) => { if (Array.isArray(k.tags)) k.tags = k.tags.filter((t) => t !== name); });
  save();
}

/* ---------- 艾宾浩斯复习 ---------- */
const REVIEW_INTERVALS = [1, 2, 4, 7, 15]; // 第1~5轮间隔（天）
const DAY = 24 * 3600 * 1000;

/* 返回到期需要复习的错题（nextReview <= now，且未完成全部轮次） */
export function getDueReviews() {
  const now = Date.now();
  return _data.errors.filter((e) => {
    if (e.reviewStage >= REVIEW_INTERVALS.length) return false; // 已完成全部轮次
    return (e.nextReview || 0) <= now;
  });
}

/* 标记某道错题已复习，推进到下一阶段 */
export function markReviewed(id) {
  const e = _data.errors.find((x) => x.id === id);
  if (!e) return null;
  const now = Date.now();
  e.lastReview = now;
  e.reviewCount = (e.reviewCount || 0) + 1;
  if (e.reviewStage < REVIEW_INTERVALS.length) {
    const interval = REVIEW_INTERVALS[e.reviewStage];
    e.reviewStage += 1;
    e.nextReview = now + interval * DAY;
  }
  save();
  return e;
}

/* 跳过本次复习（推迟1天） */
export function snoozeReview(id) {
  const e = _data.errors.find((x) => x.id === id);
  if (!e) return null;
  e.nextReview = Date.now() + DAY;
  save();
  return e;
}

/* 复习统计：{ due, total, completed, todayReviewed } */
export function getReviewStats() {
  const now = Date.now();
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  let due = 0, completed = 0, todayReviewed = 0;
  _data.errors.forEach((e) => {
    if (e.reviewStage >= REVIEW_INTERVALS.length) { completed++; return; }
    if ((e.nextReview || 0) <= now) due++;
    if ((e.lastReview || 0) >= todayStart.getTime()) todayReviewed++;
  });
  return { due, total: _data.errors.length, completed, todayReviewed };
}

/* ---------- 小窝日记 ---------- */
export const MOODS = [
  { emoji: "😊", label: "开心" },
  { emoji: "😌", label: "平静" },
  { emoji: "🤔", label: "思考" },
  { emoji: "💪", label: "奋斗" },
  { emoji: "😴", label: "疲惫" },
  { emoji: "😔", label: "低落" },
  { emoji: "😤", label: "烦躁" },
  { emoji: "🎉", label: "兴奋" },
];

export function listDiaries() {
  if (!Array.isArray(_data.diaries)) _data.diaries = [];
  return [..._data.diaries].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
}

export function getDiaryByDate(date) {
  return _data.diaries.find((d) => d.date === date) || null;
}

export function getDiary(id) {
  return _data.diaries.find((d) => d.id === id) || null;
}

export function addDiary(data) {
  const now = Date.now();
  const date = data.date || todayISO();
  // 同一天只允许一篇，存在则更新
  const existing = getDiaryByDate(date);
  if (existing) {
    return updateDiary(existing.id, data);
  }
  const diary = {
    id: uid("d"),
    date,
    content: (data.content || "").trim(),
    mood: data.mood || "😌",
    createdAt: now,
    updatedAt: now,
  };
  _data.diaries.push(diary);
  save();
  return diary;
}

export function updateDiary(id, patch) {
  const d = getDiary(id);
  if (!d) return null;
  if (patch.content != null) d.content = patch.content;
  if (patch.mood != null) d.mood = patch.mood;
  if (patch.date != null) d.date = patch.date;
  d.updatedAt = Date.now();
  save();
  return d;
}

export function deleteDiary(id) {
  _data.diaries = _data.diaries.filter((d) => d.id !== id);
  save();
}

/* 日记统计：总天数、连续打卡、最近7天心情 */
export function getDiaryStats() {
  const diaries = listDiaries();
  if (!diaries.length) return { totalDays: 0, streak: 0, recentMoods: [], totalWords: 0 };
  const totalDays = diaries.length;
  const totalWords = diaries.reduce((s, d) => s + (d.content?.length || 0), 0);
  // 连续打卡：从今天或昨天开始往前数
  const today = todayISO();
  const dateSet = new Set(diaries.map((d) => d.date));
  let streak = 0;
  let cursor = new Date();
  // 如果今天没写，从昨天开始算
  if (!dateSet.has(today)) cursor.setDate(cursor.getDate() - 1);
  while (dateSet.has(formatDateISO(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  // 最近7天心情
  const recentMoods = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const diary = getDiaryByDate(formatDateISO(d));
    recentMoods.push({ date: formatDateISO(d), mood: diary?.mood || null, hasDiary: !!diary });
  }
  return { totalDays, streak, recentMoods, totalWords };
}

function formatDateISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// 初始化加载
load();
