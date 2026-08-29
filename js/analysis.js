/* ============================================================
 * analysis.js — 学情分析视图（图表 + 报告）
 * 规则驱动，自动生成结构化学习报告
 * ============================================================ */
import * as store from "./storage.js";
import { renderCharts } from "./charts.js";
import { toast, esc } from "./app.js";

const REASON_TIPS = {
  概念混淆: "重做基础概念题，整理易混点对比表",
  计算错误: "每日安排 10 道计算专练，提升运算准确率",
  审题失误: "读题时圈画关键词，养成标注习惯",
  记忆偏差: "制作记忆卡片，利用间隔重复法巩固",
  时间不足: "限时训练，先易后难合理分配时间",
  其他: "针对性复盘，逐题追根溯源",
};

export function renderAnalysis(container) {
  renderCharts(container);
  const report = computeReport();
  const wrap = document.createElement("div");
  wrap.style.marginTop = "20px";
  wrap.innerHTML = reportHTML(report);
  container.appendChild(wrap);
  const copyBtn = wrap.querySelector("#copyReport");
  if (copyBtn) {
    copyBtn.onclick = async () => {
      const text = reportText(report);
      try {
        await navigator.clipboard.writeText(text);
        toast("报告已复制到剪贴板", "ok");
      } catch (e) {
        const ta = document.createElement("textarea");
        ta.value = text; document.body.appendChild(ta); ta.select();
        try { document.execCommand("copy"); toast("报告已复制", "ok"); } catch (_) { toast("复制失败，请手动选择", "err"); }
        ta.remove();
      }
    };
  }
}

function reportText(r) {
  const sugg = buildSuggestions(r);
  const targetLines = r.activeTarget ? [
    `目标院校：${r.activeTarget.year || "—"} · ${r.activeTarget.name}${r.activeTarget.major ? " · " + r.activeTarget.major : ""}`,
    `目标总分 ${r.totalTarget}，当前估算 ${r.totalEstimated || "—"}，${r.totalDiff > 0 ? "还差 " + r.totalDiff + " 分" : "已超出 " + (-r.totalDiff) + " 分"}；高优先级科目 ${r.urgentCount} 个，中优先级 ${r.midCount} 个`,
    r.gapInfo.rows.map((x) =>
      `  [${x.priority}] ${x.subject} 当前 ${x.curPct || "—"}% → 目标 ${x.targetPct}%（差 ${x.diffPct > 0 ? x.diffPct : 0}pp）`
    ).join("\n"),
  ] : [];
  return [
    "【学情分析报告】",
    ...targetLines,
    `总览：累计 ${r.total} 张试卷，加权平均 ${r.overall}%（目标 ${r.target}%${r.gap > 0 ? `，差 ${r.gap} 个百分点` : "，已达成"}）；错题 ${r.errorTotal} 道，知识点 ${r.kpTotal} 条；趋势 ${r.trend}。`,
    r.best ? `优势领域：${r.best.subject}（掌握 ${r.best.mastery ?? "-"}%、得分 ${r.best.pct ?? "-"}%）。` : "优势领域：暂无。",
    r.weakModule ? `薄弱环节：模块「${r.weakModule.module}」掌握 ${r.weakModule.mastery}%。` : "薄弱环节：暂无。",
    `进步空间：${r.gap > 0 ? `距目标差 ${r.gap} 个百分点` : "已达目标，建议上调"}；分布 优${r.tierDist.excellent}/良${r.tierDist.good}/及${r.tierDist.pass}/弱${r.tierDist.fail}。`,
    "个性化建议：",
    ...sugg.map((s) => "  · " + s),
  ].join("\n");
}

function computeReport() {
  const data = store.getData();
  const papers = data.papers;
  const errors = data.errors;
  const kps = data.knowledge;

  // 总览
  const totalScore = papers.reduce((a, p) => a + store.num(p.score), 0);
  const totalMax = papers.reduce((a, p) => a + store.num(p.totalScore, 100), 0) || 1;
  const overall = Math.round((totalScore / totalMax) * 1000) / 10;
  const target = store.num(data.targetScore, 90);
  const gap = Math.round((target - overall) * 10) / 10;

  // 目标院校 & 差距（统一口径：按目标满分折算估算，与目标同量纲）
  const activeTarget = store.getActiveTarget();
  const gapInfo = store.targetGap();
  const est = store.estimateTotal();
  const totalTarget = est.totalTarget;
  const totalEstimated = est.estimated;
  const totalDiff = est.diff;
  const urgentCount = gapInfo.rows.filter((r) => r.priority === "高").length;
  const midCount = gapInfo.rows.filter((r) => r.priority === "中").length;

  // 趋势
  const sorted = [...papers].filter((p) => p.date).sort((a, b) => a.date.localeCompare(b.date));
  const avg = (arr) => arr.length ? arr.reduce((a, p) => a + store.scorePercent(p), 0) / arr.length : 0;
  const recent = sorted.slice(-5);
  const prev = sorted.slice(Math.max(0, sorted.length - 10), Math.max(0, sorted.length - 5));
  const recentAvg = avg(recent);
  const prevAvg = avg(prev);
  let trend = "平";
  let trendDelta = Math.round((recentAvg - prevAvg) * 10) / 10;
  if (recentAvg - prevAvg > 2) trend = "升";
  else if (recentAvg - prevAvg < -2) trend = "降";

  // 分科目统计
  const bySubject = data.subjects.map((s) => {
    const ps = papers.filter((p) => p.subject === s);
    const ks = kps.filter((k) => papers.find((p) => p.id === k.paperId)?.subject === s);
    const pct = ps.length ? Math.round(ps.reduce((a, p) => a + store.scorePercent(p), 0) / ps.length * 10) / 10 : null;
    const mastery = ks.length ? Math.round(ks.reduce((a, k) => a + store.num(k.mastery), 0) / ks.length) : null;
    return { subject: s, count: ps.length, pct, mastery };
  }).filter((x) => x.count || x.mastery != null);

  const best = [...bySubject].filter((x) => x.pct != null || x.mastery != null)
    .sort((a, b) => (b.mastery ?? b.pct ?? 0) - (a.mastery ?? a.pct ?? 0))[0];
  const weakest = [...bySubject].filter((x) => x.pct != null || x.mastery != null)
    .sort((a, b) => (a.mastery ?? a.pct ?? 999) - (b.mastery ?? b.pct ?? 999))[0];

  // 模块掌握度（知识点）
  const moduleMap = {};
  kps.forEach((k) => {
    if (!moduleMap[k.module]) moduleMap[k.module] = { sum: 0, n: 0 };
    moduleMap[k.module].sum += store.num(k.mastery);
    moduleMap[k.module].n++;
  });
  const modules = Object.entries(moduleMap).map(([m, v]) => ({ module: m, mastery: Math.round(v.sum / v.n) }))
    .sort((a, b) => a.mastery - b.mastery);
  const weakModule = modules[0];

  // 错因统计
  const reasonMap = {};
  errors.forEach((e) => { reasonMap[e.reason] = (reasonMap[e.reason] || 0) + 1; });
  const reasons = Object.entries(reasonMap).map(([r, n]) => ({ reason: r, count: n })).sort((a, b) => b.count - a.count);
  const topReason = reasons[0];

  // 薄弱知识点推荐（掌握度低 + 错题多 = 高优先级）
  const weakKps = kps
    .map((k) => {
      const relatedErrors = errors.filter((e) => e.linkedKpId === k.id).length;
      const paper = papers.find((p) => p.id === k.paperId);
      return {
        id: k.id,
        title: k.title || k.content?.substring(0, 30) || "未命名知识点",
        module: k.module,
        subject: paper?.subject || "—",
        mastery: store.num(k.mastery),
        errorCount: relatedErrors,
        priority: (100 - store.num(k.mastery)) + relatedErrors * 10, // 优先级评分
      };
    })
    .filter((k) => k.mastery < 70) // 只显示掌握度低于70%的
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 5); // 取前5个

  // 学习计划生成（基于薄弱环节和剩余时间）
  const examDate = new Date("2026-12-19");
  const daysLeft = Math.max(1, Math.ceil((examDate - new Date()) / (1000 * 60 * 60 * 24)));

  // 评级分布
  const tierDist = { excellent: 0, good: 0, pass: 0, fail: 0 };
  papers.forEach((p) => tierDist[store.getTier(p).key]++);

  const report = {
    total: papers.length, errorTotal: errors.length, kpTotal: kps.length,
    overall, target, gap, trend, trendDelta, recentAvg: Math.round(recentAvg * 10) / 10,
    bySubject, best, weakest, weakModule, topReason, reasons, modules, tierDist,
    activeTarget, gapInfo, totalTarget, totalEstimated, totalDiff, urgentCount, midCount,
    weakKps, daysLeft,
  };
  report.studyPlan = generateStudyPlan(report, weakKps, daysLeft);
  return report;
}

function trendArrow(trend) {
  if (trend === "升") return "↗";
  if (trend === "降") return "↘";
  return "→";
}

function reportHTML(r) {
  const noData = r.total === 0 && !r.activeTarget;
  if (noData) {
    return `
      <div class="card"><div class="empty">
        <div class="empty-ico">◈</div>
        <h3>暂无数据可生成报告</h3>
        <p>录入试卷与错题后，此处将自动生成你的学情分析报告。</p>
      </div></div>`;
  }

  const sugg = buildSuggestions(r);

  return `
    <div class="card elev">
      <div class="card-title">学情分析报告 <span class="count">自动生成</span></div>
      <div class="report">

        ${r.activeTarget ? `
          <div class="report-block tone-accent">
            <h3><span class="glyph">🎯</span>目标院校：${esc(r.activeTarget.name)}<span class="muted" style="font-weight:400;font-size:14px">${r.activeTarget.major ? " · " + esc(r.activeTarget.major) : ""} · ${r.activeTarget.year || "—"} 考研</span></h3>
            <p>
              目标总分 <span class="num-hi">${r.totalTarget}</span> ·
              当前估算 <span class="num-hi">${r.totalEstimated || "—"}</span> ·
              ${r.totalDiff > 0 ? `还差 <b style="color:var(--danger)">+${r.totalDiff}</b> 分` : `已超出 <b style="color:var(--ok)">${-r.totalDiff}</b> 分`}
              · 高优先级 <b>${r.urgentCount}</b> 项，中优先级 <b>${r.midCount}</b> 项。
            </p>
            <table class="gap-table">
              <thead><tr>
                <th style="text-align:left">科目</th>
                <th>优先级</th>
                <th>当前</th>
                <th>目标</th>
                <th style="text-align:right">差距</th>
              </tr></thead>
              <tbody>
                ${r.gapInfo.rows.map((x) => `
                  <tr>
                    <td style="text-align:left">${esc(x.subject)}<span class="muted" style="font-size:12px;margin-left:4px">（${x.count ? "已刷" + x.count + "卷" : "尚未做卷"}）</span></td>
                    <td><span class="tier tier-${x.priority === "达标" ? "excellent" : x.priority === "高" ? "fail" : x.priority === "中" ? "pass" : "good"}"><span class="dot-sm"></span>${x.priority === "达标" ? "达标" : x.priority === "高" ? "高" : x.priority === "中" ? "中" : "低"}</span></td>
                    <td>${x.curPct ? x.curPct + "%" : "—"} <span class="muted">(${x.curScore || "—"}分)</span></td>
                    <td>${x.targetPct}% <span class="muted">(${x.targetScore}/${x.targetTotal})</span></td>
                    <td style="text-align:right">${x.diffPct > 0 ? `<span style="color:var(--danger)">+${x.diffPct}pp / +${x.diffScore}分</span>` : `<span style="color:var(--ok)">✓ 已超</span>`}</td>
                  </tr>`).join("")}
              </tbody>
            </table>
            ${r.activeTarget.note ? `<p class="muted" style="font-size:12.5px;margin-top:6px">📝 ${esc(r.activeTarget.note)}</p>` : ""}
          </div>` : ""}

        <div class="report-block tone-ink">
          <h3><span class="glyph">一</span>总览</h3>
          <p>累计完成 <span class="num-hi">${r.total}</span> 张试卷，加权平均得分率 <span class="num-hi">${r.overall}%</span>
          （总体目标 ${r.target}%${r.gap > 0 ? `，距目标还差 <span class="num-hi">${r.gap}</span> 个百分点` : `，已达成目标 🎉`}）。
          共记录错题 <span class="num-hi">${r.errorTotal}</span> 道、知识点 <span class="num-hi">${r.kpTotal}</span> 条。</p>
          <p>近 ${r.recentAvg ? "5" : "0"} 次平均 <span class="num-hi">${r.recentAvg}%</span>，
          趋势 <span class="num-hi">${trendArrow(r.trend)} ${r.trend === "升" ? "上升" : r.trend === "降" ? "下降" : "持平"}${r.trendDelta ? `（${r.trendDelta > 0 ? "+" : ""}${r.trendDelta}）` : ""}</span>。</p>
        </div>

        ${r.best ? `
        <div class="report-block tone-good">
          <h3><span class="glyph">二</span>优势领域</h3>
          <p>表现最优的是 <span class="num-hi">${r.best.subject}</span>${r.best.mastery != null ? `，知识点掌握度 <span class="num-hi">${r.best.mastery}%</span>` : ""}${r.best.pct != null ? `，平均得分率 <span class="num-hi">${r.best.pct}%</span>` : ""}。
          建议保持稳定并适当提速，将节省的时间转入薄弱科目。</p>
        </div>` : ""}

        ${r.weakModule ? `
        <div class="report-block tone-warn">
          <h3><span class="glyph">三</span>薄弱环节</h3>
          <p>知识模块中掌握度最低的是「<span class="num-hi">${r.weakModule.module}</span>」，仅 <span class="num-hi">${r.weakModule.mastery}%</span>，建议优先专项突破。</p>
          ${r.weakest ? `<p>科目层面，<span class="num-hi">${r.weakest.subject}</span> 相对薄弱${r.weakest.pct != null ? `（平均 ${r.weakest.pct}%）` : ""}${r.weakest.mastery != null ? `、掌握度 ${r.weakest.mastery}%` : ""}，需重点投入。</p>` : ""}
          ${r.topReason ? `<p>错因高频项：<span class="num-hi">${r.topReason.reason}</span>（${r.topReason.count} 道），${REASON_TIPS[r.topReason.reason] || "针对性复盘"}。</p>` : ""}
        </div>` : `
        <div class="report-block tone-warn">
          <h3><span class="glyph">三</span>薄弱环节</h3>
          <p>${r.weakest ? `科目层面，<span class="num-hi">${r.weakest.subject}</span> 相对薄弱${r.weakest.pct != null ? `（平均 ${r.weakest.pct}%）` : ""}，需重点投入。` : "暂无知识点掌握度数据，建议为试卷补充知识点记录以精确定位薄弱环节。"}</p>
        </div>`}

        <div class="report-block tone-bad">
          <h3><span class="glyph">四</span>进步空间</h3>
          <p>${r.gap > 0
            ? `当前距目标 ${r.target}% 尚差 <span class="num-hi">${r.gap}</span> 个百分点。按当前节奏，预计还需系统强化薄弱模块 2–3 周可接近目标。`
            : `已达到/超过目标，建议上调目标 ${Math.min(98, r.target + 5)}% 并转向难题与提速训练。`}</p>
          <p>评级分布：优秀 ${r.tierDist.excellent} / 良好 ${r.tierDist.good} / 及格 ${r.tierDist.pass} / 待提升 ${r.tierDist.fail}。</p>
        </div>

        <div class="report-block tone-ink">
          <h3><span class="glyph">五</span>个性化建议</h3>
          <ul>
            ${sugg.map((s) => `<li>${s}</li>`).join("")}
          </ul>
          <div class="item-actions" style="margin-top:12px">
            <button class="btn btn-ghost btn-sm" id="copyReport">复制报告</button>
          </div>
        </div>

        ${r.weakKps && r.weakKps.length > 0 ? `
        <div class="report-block tone-warn">
          <h3><span class="glyph">六</span>薄弱知识点推荐 <span class="muted" style="font-weight:400;font-size:13px">（按优先级排序，优先攻克）</span></h3>
          <div class="weak-kp-list">
            ${r.weakKps.map((k, i) => `
              <div class="weak-kp-item">
                <div class="weak-kp-rank">${i + 1}</div>
                <div class="weak-kp-info">
                  <div class="weak-kp-title">${esc(k.title)}</div>
                  <div class="weak-kp-meta">
                    <span class="tag tag-ink">${esc(k.subject)}</span>
                    <span class="tag tag-accent">${esc(k.module)}</span>
                    <span class="muted">掌握度 <b style="color:${k.mastery < 40 ? 'var(--danger)' : k.mastery < 60 ? 'var(--tier-pass)' : 'var(--tier-good)'}">${k.mastery}%</b></span>
                    ${k.errorCount > 0 ? `<span class="muted">相关错题 <b>${k.errorCount}</b> 道</span>` : ""}
                  </div>
                </div>
                <div class="weak-kp-bar">
                  <div class="weak-kp-bar-fill" style="width:${k.mastery}%;background:${k.mastery < 40 ? 'var(--danger)' : k.mastery < 60 ? 'var(--tier-pass)' : 'var(--tier-good)'}"></div>
                </div>
              </div>
            `).join("")}
          </div>
        </div>` : ""}

        ${r.studyPlan && r.studyPlan.length > 0 ? `
        <div class="report-block tone-accent">
          <h3><span class="glyph">七</span>学习计划 <span class="muted" style="font-weight:400;font-size:13px">（距考研 ${r.daysLeft} 天）</span></h3>
          <div class="study-plan-list">
            ${r.studyPlan.map((p) => `
              <div class="study-plan-item">
                <div class="study-plan-header">
                  <span class="study-plan-phase">${esc(p.phase)}</span>
                  <span class="study-plan-time">${esc(p.time)}</span>
                </div>
                <div class="study-plan-focus">${esc(p.focus)}</div>
                <ul class="study-plan-tasks">
                  ${p.tasks.map((t) => `<li>${esc(t)}</li>`).join("")}
                </ul>
              </div>
            `).join("")}
          </div>
        </div>` : ""}
      </div>
    </div>`;
}

/* 生成学习计划 */
function generateStudyPlan(r, weakKps, daysLeft) {
  const plan = [];
  const weeksLeft = Math.ceil(daysLeft / 7);

  // 阶段划分
  if (daysLeft > 60) {
    plan.push({
      phase: "基础强化期",
      time: `未来 ${Math.min(4, Math.floor(weeksLeft / 2))} 周`,
      focus: "系统梳理知识点，重点突破薄弱模块",
      tasks: [
        `每周完成 2-3 套真题/模拟卷，认真订正`,
        weakKps.length > 0 ? `重点攻克 ${weakKps.slice(0, 3).map(k => `「${k.module}」`).join("、")} 等薄弱知识点` : "按章节系统过一遍基础知识",
        "每日整理错题，关联对应知识点",
      ],
    });
    plan.push({
      phase: "冲刺提升期",
      time: `考前 4-8 周`,
      focus: "限时训练 + 错题复盘 + 查漏补缺",
      tasks: [
        "每日一套限时训练，模拟真实考试节奏",
        "每周集中清理一次错题本",
        "针对高频错因进行专项训练",
      ],
    });
  } else if (daysLeft > 30) {
    plan.push({
      phase: "冲刺提升期",
      time: `未来 ${Math.min(4, weeksLeft)} 周`,
      focus: "限时训练 + 错题复盘",
      tasks: [
        "每日一套限时训练，保持手感",
        weakKps.length > 0 ? `优先复习 ${weakKps.slice(0, 2).map(k => `「${k.module}」`).join("、")}` : "重点复习高频考点",
        "每周清理错题本，标记已掌握",
      ],
    });
  }

  plan.push({
    phase: "考前冲刺期",
    time: "最后 2-4 周",
    focus: "回归基础 + 模拟考试 + 心态调整",
    tasks: [
      "回归课本和笔记，巩固基础概念",
      "每周 2 套全真模拟，严格限时",
      "保持作息规律，调整考试状态",
      "复习已标记的重点错题",
    ],
  });

  // 每日建议
  const dailyHours = r.gap > 10 ? 6 : r.gap > 5 ? 5 : 4;
  plan.push({
    phase: "每日学习建议",
    time: `每天约 ${dailyHours} 小时`,
    focus: "高效利用时间，均衡发展",
    tasks: [
      r.weakest ? `${r.weakest.subject} 分配 ${Math.ceil(dailyHours * 0.35)} 小时（薄弱科目重点突破）` : "各科均衡分配时间",
      r.best ? `${r.best.subject} 分配 ${Math.ceil(dailyHours * 0.2)} 小时（保持优势）` : "",
      "每日 30 分钟错题复盘",
      "每周日晚上做周总结和下周计划",
    ].filter(Boolean),
  });

  return plan;
}

function buildSuggestions(r) {
  const out = [];
  // 目标院校优先的建议
  if (r.activeTarget && r.urgentCount > 0) {
    const first = r.gapInfo.rows.find((x) => x.priority === "高");
    if (first) {
      const tail = r.gapInfo.rows.filter((x) => x.priority === "高").slice(1).map((x) => x.subject).join("、");
      out.push(
        `【目标】高优先级科目：先攻克「${first.subject}」（还差 ${first.diffScore} 分 / ${first.diffPct}pp）${tail ? "，其次 " + tail : ""}。` +
        `${first.count === 0 ? "先完成 2–3 套基础卷摸底，再按章节过一遍基础知识点。" : "建议每日 1.5 小时专项训练 + 每周末一套综合卷。"}`
      );
    }
  } else if (r.activeTarget && r.totalDiff > 0) {
    const mid = r.gapInfo.rows.find((x) => x.priority === "中");
    if (mid) out.push(`【目标】差距适中，优先补齐「${mid.subject}」的薄弱章节（还差 ${mid.diffScore} 分），其他科目按频率保持。`);
  } else if (r.activeTarget && r.totalDiff <= 0) {
    out.push(`【目标】已达目标院校预估线！建议：每周保持 2 套综合卷维持手感，同时开始为复试做前置准备（408/专业深度 / 项目经验等）。`);
  }
  if (r.gap > 0) out.push(`总体得分率距目标 ${r.target}% 还差 ${r.gap} 个百分点，建议保持每日精做一套真题/模拟卷的节奏并认真订正。`);
  if (r.weakModule) out.push(`本周专项强化「${r.weakModule.module}」（掌握度 ${r.weakModule.mastery}%），结合相关错题重做至少 5 道。`);
  if (r.weakest) out.push(`科目「${r.weakest.subject}」相对薄弱，建议在周计划中提高其时间占比。`);
  if (r.topReason) out.push(`错因集中于「${r.topReason.reason}」（${r.topReason.count} 道），${REASON_TIPS[r.topReason.reason] || "针对性复盘"}。`);
  if (r.trend === "降") out.push(`近期成绩有下滑趋势（${r.trendDelta}），复盘最近试卷的失分点，避免连续失误。`);
  else if (r.trend === "升") out.push(`近期呈上升趋势（${r.trendDelta}），保持势头，可逐步加入难题拔高。`);
  if (r.errorTotal > r.total * 2) out.push(`错题积累较多（${r.errorTotal} 道），建议每周固定一天集中清理错题本。`);
  out.push(`坚持错题—知识点双向关联，让每次订正都沉淀为可复用的复习资产。`);
  return out;
}
