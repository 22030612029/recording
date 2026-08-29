/* ============================================================
 * charts.js — 数据可视化（ECharts，按需动态加载）
 * 趋势折线 / 分数分布 / 掌握雷达 / 错题类型
 * ============================================================ */
import * as store from "./storage.js";

const CHARTS = new Map(); // id -> echarts instance

/* ---------- ECharts 按需加载 ---------- */
let echartsPromise = null;
export function ensureEcharts() {
  if (window.echarts) return Promise.resolve(true);
  if (echartsPromise) return echartsPromise;
  echartsPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "../lib/echarts.min.js";
    s.onload = () => resolve(true);
    s.onerror = () => { echartsPromise = null; reject(new Error("ECharts 加载失败")); };
    document.head.appendChild(s);
  });
  return echartsPromise;
}

const PALETTE = {
  ink: "#1b2a4e",
  ink2: "#3a4a6b",
  accent: "#b8860b",
  accent2: "#c8924a",
  excellent: "#1e7a5c",
  good: "#c8924a",
  pass: "#c7621f",
  fail: "#b23a3a",
  series: ["#1b2a4e", "#b8860b", "#1e7a5c", "#c7621f", "#7b5ea7", "#3a8fb7"],
};

const TIER_META = [
  { key: "excellent", label: "优秀(≥90%)", color: PALETTE.excellent },
  { key: "good", label: "良好(70-89%)", color: PALETTE.good },
  { key: "pass", label: "及格(60-69%)", color: PALETTE.pass },
  { key: "fail", label: "待提升(<60%)", color: PALETTE.fail },
];

/* hex 颜色 → rgba（面积渐变用） */
function hexToRgba(hex, a) {
  const n = parseInt(hex.replace("#", ""), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/* 基础主题样式注入到每个 option */
function baseExtra() {
  return {
    textStyle: { fontFamily: '"Noto Sans SC", "IBM Plex Sans", sans-serif', color: "#3a4a6b" },
    tooltip: {
      backgroundColor: "rgba(255,253,247,0.97)",
      borderColor: "#e3d9c4",
      borderWidth: 1,
      textStyle: { color: "#1b2a4e", fontSize: 12 },
      extraCssText: "box-shadow:0 6px 20px rgba(27,42,78,0.12);border-radius:10px;padding:8px 12px;",
    },
  };
}

function getChart(domId) {
  const dom = document.getElementById(domId);
  if (!dom) return null;
  if (typeof echarts === "undefined") {
    dom.className = "chart-empty";
    dom.textContent = "图表库未加载（需联网加载 ECharts）";
    return null;
  }
  if (CHARTS.has(domId)) {
    try { CHARTS.get(domId).dispose(); } catch (e) {}
    CHARTS.delete(domId);
  }
  const inst = echarts.init(dom, null, { renderer: "canvas" });
  CHARTS.set(domId, inst);
  return inst;
}

function disposeStale() {
  // dispose instances whose dom is gone
  for (const [id, inst] of CHARTS) {
    if (!document.getElementById(id)) {
      try { inst.dispose(); } catch (e) {}
      CHARTS.delete(id);
    }
  }
}

export function resizeAll() {
  CHARTS.forEach((inst) => {
    try { if (!inst.isDisposed()) inst.resize(); } catch (e) {}
  });
}

/* ---------- 成绩趋势折线 ---------- */
function renderTrend(domId) {
  const data = store.getData();
  const inst = getChart(domId);
  if (!inst) return;

  // 按日期升序
  const papers = [...data.papers].filter((p) => p.date).sort((a, b) => a.date.localeCompare(b.date));
  const dates = [...new Set(papers.map((p) => p.date))].sort();
  const subjects = [...data.subjects];

  // 目标线：各科目标百分比（来自激活目标院校），供 markLine 使用
  const gap = store.targetGap();
  const targetBySubject = {};
  if (gap.target && gap.rows.length) {
    gap.rows.forEach((r) => { targetBySubject[r.subject] = r.targetPct; });
  }

  const series = subjects
    .map((subj, idx) => {
      const color = PALETTE.series[idx % PALETTE.series.length];
      const pts = dates.map((d) => {
        const p = papers.find((x) => x.date === d && x.subject === subj);
        if (!p) return null;
        const pct = store.scorePercent(p);
        return { value: pct, rawScore: store.num(p.score), rawTotal: store.num(p.totalScore, 100) };
      });
      const targetPct = targetBySubject[subj];
      return {
        name: subj,
        type: "line",
        smooth: true,
        symbol: "circle",
        symbolSize: 7,
        connectNulls: true,
        lineStyle: { width: 2.5, color },
        itemStyle: { color },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: hexToRgba(color, 0.16) },
            { offset: 1, color: hexToRgba(color, 0.02) },
          ]),
        },
        markLine: targetPct != null ? {
          silent: true,
          symbol: "none",
          lineStyle: { color: "#c89e3f", type: "dashed", width: 1.2 },
          label: {
            show: true, position: "insideEndTop",
            color: "#a9822b", fontSize: 10, formatter: "目标 {c}%",
          },
          data: [{ yAxis: targetPct }],
        } : undefined,
        data: pts,
      };
    })
    .filter((s) => s.data.some((v) => v !== null));

  inst.setOption({
    ...baseExtra(),
    color: PALETTE.series,
    legend: { top: 4, right: 8, textStyle: { color: "#5b6a86", fontSize: 11 }, itemWidth: 14, itemHeight: 8 },
    grid: { left: 38, right: 16, top: 40, bottom: 30 },
    xAxis: {
      type: "category", data: dates.map(store.formatDate),
      axisLine: { lineStyle: { color: "#d6cbb3" } },
      axisLabel: { color: "#8a93a6", fontSize: 11 },
      axisTick: { show: false },
    },
    yAxis: {
      type: "value", min: 0, max: 100, interval: 20,
      axisLabel: { color: "#8a93a6", fontSize: 11, formatter: "{value}%" },
      splitLine: { lineStyle: { color: "rgba(27,42,78,0.06)" } },
    },
    tooltip: { ...baseExtra().tooltip, trigger: "axis", formatter: (p) => {
      let s = `<b>${p[0].axisValue}</b><br/>`;
      p.forEach((it) => {
        const v = it.value;
        if (v == null) return;
        if (typeof v === "object") {
          s += `${it.marker}${it.seriesName}：<b>${v.value}%</b> <span style="color:#8a93a6;font-size:11px">（${v.rawScore}/${v.rawTotal} 分）</span><br/>`;
        } else {
          s += `${it.marker}${it.seriesName}：<b>${v}%</b><br/>`;
        }
      });
      return s;
    }},
    series,
  });
}

/* ---------- 分数分布（柱状） ---------- */
function renderDistribution(domId) {
  const data = store.getData();
  const inst = getChart(domId);
  if (!inst) return;
  const counts = { excellent: 0, good: 0, pass: 0, fail: 0 };
  data.papers.forEach((p) => { counts[store.getTier(p).key]++; });

  inst.setOption({
    ...baseExtra(),
    tooltip: { ...baseExtra().tooltip, trigger: "item", formatter: "{b}<br/>{c} 张 ({d}%)" },
    legend: { bottom: 0, textStyle: { color: "#5b6a86", fontSize: 11 }, itemWidth: 12, itemHeight: 8 },
    grid: { left: 40, right: 16, top: 24, bottom: 40 },
    xAxis: { type: "category", data: TIER_META.map((t) => t.label.split("(")[0]),
      axisLine: { lineStyle: { color: "#d6cbb3" } }, axisLabel: { color: "#5b6a86", fontSize: 11 }, axisTick: { show: false } },
    yAxis: { type: "value", minInterval: 1, axisLabel: { color: "#8a93a6", fontSize: 11 }, splitLine: { lineStyle: { color: "rgba(27,42,78,0.06)" } } },
    series: [{
      type: "bar",
      barWidth: "48%",
      itemStyle: {
        borderRadius: [6, 6, 0, 0],
        color: (p) => new echarts.graphic.LinearGradient(0, 0, 0, 1, [
          { offset: 0, color: hexToRgba(TIER_META[p.dataIndex].color, 0.95) },
          { offset: 1, color: hexToRgba(TIER_META[p.dataIndex].color, 0.55) },
        ]),
      },
      data: TIER_META.map((t) => ({ value: counts[t.key], itemStyle: { color: t.color } })),
      label: { show: true, position: "top", color: "#3a4a6b", fontSize: 12, fontWeight: 600, formatter: "{c} 张" },
    }],
  });
}

/* ---------- 知识点掌握雷达 ---------- */
function renderRadar(domId) {
  const data = store.getData();
  const inst = getChart(domId);
  if (!inst) return;

  // 维度：科目（取有知识点/试卷的科目）
  const subjects = data.subjects.filter((s) =>
    data.knowledge.some((k) => data.papers.find((p) => p.id === k.paperId)?.subject === s) ||
    data.papers.some((p) => p.subject === s)
  );
  const indicators = subjects.map((s) => ({ name: s, max: 100 }));

  // 掌握度：科目下知识点的平均掌握度；若该科目无知识点，用试卷平均百分比
  const values = subjects.map((s) => {
    const kps = data.knowledge.filter((k) => data.papers.find((p) => p.id === k.paperId)?.subject === s);
    if (kps.length) return Math.round(kps.reduce((a, k) => a + store.num(k.mastery), 0) / kps.length);
    const papers = data.papers.filter((p) => p.subject === s);
    if (papers.length) return Math.round(papers.reduce((a, p) => a + store.scorePercent(p), 0) / papers.length);
    return 0;
  });

  inst.setOption({
    ...baseExtra(),
    tooltip: { ...baseExtra().tooltip, trigger: "item", formatter: (p) => `${p.name}<br/>掌握度：<b style="color:#7a5a12">${p.value}%</b>` },
    radar: {
      indicator: indicators.length ? indicators : [{ name: "暂无", max: 100 }],
      radius: "64%",
      center: ["50%", "52%"],
      axisName: { color: "#3a4a6b", fontSize: 12, fontWeight: 500 },
      splitLine: { lineStyle: { color: "rgba(27,42,78,0.08)" } },
      splitArea: { areaStyle: { color: ["rgba(255,253,247,0.4)", "rgba(243,236,223,0.4)"] } },
      axisLine: { lineStyle: { color: "rgba(27,42,78,0.1)" } },
    },
    series: [{
      type: "radar",
      symbol: "circle",
      symbolSize: 6,
      lineStyle: { color: PALETTE.accent, width: 2.5 },
      itemStyle: { color: PALETTE.accent },
      areaStyle: { color: "rgba(184,134,11,0.18)" },
      data: [{ value: indicators.length ? values : [0], name: "掌握度" }],
    }],
  });
}

/* ---------- 错题类型统计 ---------- */
function renderErrorType(domId) {
  const data = store.getData();
  const inst = getChart(domId);
  if (!inst) return;
  const reasons = data.errorReasons;
  const counts = reasons.map((r) => data.errors.filter((e) => e.reason === r).length);
  const total = counts.reduce((a, c) => a + c, 0);

  inst.setOption({
    ...baseExtra(),
    tooltip: { ...baseExtra().tooltip, trigger: "axis", axisPointer: { type: "shadow" }, formatter: (ps) => {
      const c = ps[0].value;
      const pct = total ? Math.round((c / total) * 100) : 0;
      return `${ps[0].marker}<b>${ps[0].name}</b><br/>${c} 题 · 占错题总数 <b>${pct}%</b>`;
    } },
    grid: { left: 90, right: 20, top: 16, bottom: 24 },
    xAxis: { type: "value", minInterval: 1, axisLabel: { color: "#8a93a6", fontSize: 11 }, splitLine: { lineStyle: { color: "rgba(27,42,78,0.06)" } } },
    yAxis: { type: "category", data: reasons, axisLine: { lineStyle: { color: "#d6cbb3" } }, axisLabel: { color: "#5b6a86", fontSize: 11 }, axisTick: { show: false } },
    series: [{
      type: "bar",
      barWidth: "55%",
      itemStyle: {
        borderRadius: [0, 6, 6, 0],
        color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
          { offset: 0, color: "#1b2a4e" }, { offset: 1, color: "#b8860b" },
        ]),
      },
      label: {
        show: true, position: "right", color: "#3a4a6b", fontSize: 11, fontWeight: 600,
        formatter: (p) => `${p.value} 题${total ? ` · ${Math.round((p.value / total) * 100)}%` : ""}`,
      },
      data: counts,
    }],
  });
}

/* ---------- 目标差距柱状图 ---------- */
/* 科目显示名兜底：避免老数据残留键或用户自定义名显示成「专业课」 */
function subjectLabel(s) {
  if (s === "专业课") return "408";
  return s;
}

function renderTargetGap(domId) {
  const gap = store.targetGap();
  const inst = getChart(domId);
  if (!inst || !gap.target || !gap.rows.length) return;

  const categories = gap.rows.map((r) => subjectLabel(r.subject));
  // 当前分：按目标满分同比缩放，直接和"目标分"在同一纵轴可直观看差距
  const curScaled = gap.rows.map((r) =>
    r.count ? Math.round((r.curPct / 100) * r.targetTotal * 10) / 10 : null);
  const targetScores = gap.rows.map((r) => r.targetScore);
  // 每条线的 Y 轴 max：取 max(targetTotal) 留 15% 空间给标签
  const maxY = Math.max(...gap.rows.map((r) => r.targetTotal)) * 1.2;
  // 达标状态色（用于当前柱顶小标签）
  const colorFor = (r) => {
    if (!r.count) return "#a8b0c0";                  // 未做卷：灰
    if (r.diffPct <= 0) return PALETTE.excellent;     // 达标
    if (r.diffPct <= 5) return PALETTE.good;
    if (r.diffPct <= 15) return PALETTE.pass;
    return PALETTE.fail;
  };
  const labelCur = (p) => {
    const r = gap.rows[p.dataIndex];
    if (!r.count) return "未做卷";
    const d = r.targetScore - curScaled[p.dataIndex];
    return `${curScaled[p.dataIndex]}分${d > 0 ? ` / −${d.toFixed(1)}` : d < 0 ? ` / ✓超${(-d).toFixed(1)}` : " / 达标"}`;
  };
  const labelTgt = (p) => {
    const r = gap.rows[p.dataIndex];
    return `目标 ${r.targetScore}/${r.targetTotal}`;
  };

  inst.setOption({
    ...baseExtra(),
    tooltip: {
      ...baseExtra().tooltip,
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter: (ps) => {
        const sub = ps[0]?.axisValue;
        const row = gap.rows.find((r) => subjectLabel(r.subject) === sub);
        if (!row) return "";
        const cur = curScaled[gap.rows.indexOf(row)];
        const diff = row.targetScore - (cur || 0);
        return [
          `<b style="font-size:14px">${sub}</b> <span class="muted" style="font-size:12px">（满分 ${row.targetTotal}）</span>`,
          `当前卷均分：<b>${row.curScore || "—"}</b> 分${row.count ? `（${row.count} 张卷平均）` : ""}`,
          `按目标满分折算：<b>${cur || "—"}</b> 分`,
          `目标分：<b style="color:#7a5a12">${row.targetScore}</b> / ${row.targetTotal}`,
          `差距：<b style="color:${diff > 0 ? "#ae5858" : "#7ea478"}">${diff > 0 ? "还差 " + diff.toFixed(1) + " 分" : "超出 " + (-diff).toFixed(1) + " 分 ✓"}</b>`,
          `优先级：${row.priority === "达标" ? "✓ 达标" : row.priority}`,
        ].join("<br/>");
      },
    },
    legend: {
      top: 0, right: 12, textStyle: { color: "#3a4a6b", fontSize: 13, fontWeight: 500 },
      itemWidth: 16, itemHeight: 10, itemGap: 18,
    },
    grid: { left: 46, right: 24, top: 46, bottom: 44 },
    xAxis: {
      type: "category",
      data: categories,
      axisLine: { lineStyle: { color: "#b7a98b", width: 2 } },
      axisLabel: { color: "#1b2a4e", fontSize: 15, fontWeight: 600 },
      axisTick: { show: false },
    },
    yAxis: {
      type: "value", min: 0, max: maxY,
      name: "分数", nameLocation: "end",
      nameTextStyle: { color: "#5b6a86", fontSize: 13, fontWeight: 500, padding: [0, 0, 0, -10] },
      axisLabel: { color: "#5b6a86", fontSize: 12, fontWeight: 500 },
      splitLine: { lineStyle: { color: "rgba(27,42,78,0.08)", type: "dashed" } },
    },
    series: [
      {
        name: "当前（折算至目标满分）",
        type: "bar",
        barWidth: "36%",
        barGap: "20%",
        itemStyle: {
          borderRadius: [8, 8, 0, 0],
          color: (p) => colorFor(gap.rows[p.dataIndex]),
          shadowBlur: 6, shadowColor: "rgba(27,42,78,0.12)", shadowOffsetY: 2,
        },
        data: curScaled,
        label: {
          show: true, position: "top",
          color: "#1b2a4e", fontSize: 13, fontWeight: 700,
          backgroundColor: "rgba(255,255,255,0.86)", borderColor: "rgba(27,42,78,0.12)",
          borderWidth: 1, borderRadius: 6, padding: [4, 7], distance: 4,
          formatter: labelCur,
        },
      },
      {
        name: "目标分",
        type: "bar",
        barWidth: "36%",
        itemStyle: {
          borderRadius: [8, 8, 0, 0],
          color: { type: "linear", x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: "rgba(211,164,82,0.55)" },
              { offset: 1, color: "rgba(211,164,82,0.18)" },
            ] },
          borderColor: "#c89e3f", borderWidth: 2,
        },
        data: targetScores,
        label: {
          show: true, position: "top",
          color: "#7a5a12", fontSize: 13, fontWeight: 700,
          backgroundColor: "rgba(255,249,236,0.9)", borderColor: "rgba(184,134,11,0.3)",
          borderWidth: 1, borderRadius: 6, padding: [4, 7], distance: 4,
          formatter: labelTgt,
        },
      },
      // 未做卷标记：散点，在 0 基线处放一颗灰圆点，便于识别"这科还没开始"
      {
        name: "未做卷",
        type: "scatter",
        symbolSize: 10,
        itemStyle: { color: "#a8b0c0", borderColor: "#ffffff", borderWidth: 2 },
        tooltip: { show: false },
        label: { show: false },
        data: gap.rows.map((r, i) => r.count ? null : [categories[i], 2.5]).filter(Boolean),
      },
    ],
  });
}

/* ---------- 分析视图整体 ---------- */
export async function renderCharts(container) {
  await ensureEcharts();
  disposeStale();
  const data = store.getData();
  const hasPapers = data.papers.length > 0;
  const hasErrors = data.errors.length > 0;
  const hasKnowledge = data.knowledge.length > 0;
  const gap = store.targetGap();
  const hasTarget = !!gap.target;
  const showGap = hasTarget && gap.rows.length;

    container.innerHTML = `
    <div class="section-head">
      <div>
        <h2>学情分析</h2>
        <div class="hint">${showGap ? `目标院校：${gap.target.year || "—"} · ${gap.target.name}${gap.target.major ? " · " + gap.target.major : ""}` : "四图联动 · 数据随记录实时更新"}</div>
      </div>
    </div>

    ${showGap ? `
      <div class="card chart-card" style="border-top:3px solid var(--accent)">
        <div class="card-title">🎯 科目目标差距 <span class="count">当前分（折算至目标满分） vs 目标分 · 分数越高越好，柱低的科目优先提升</span></div>
        <div id="chart-gap" class="chart-box tall"></div>
      </div>
      <div class="card" style="margin-top:16px;border-left:${gap.rows.some((r) => r.priority === "高") ? "3px solid var(--danger)" : "3px solid var(--ok)"}">
        ${renderUrgencyPanel(gap)}
      </div>` : `
      <div class="card" style="margin-top:0">
        <div>
          <div class="card-title" style="margin-bottom:4px">🎯 目标院校差距分析（暂未启用）</div>
          <p class="muted" style="font-size:13px">回到「仪表盘」添加目标院校的各科目标分，这里会自动出现「差距对比图」和「需重点提升科目」。</p>
        </div>
      </div>`}

    <div class="chart-grid" style="${showGap ? "margin-top:16px" : ""}">
      <div class="card chart-card">
        <div class="card-title">📈 成绩趋势 <span class="count">各科得分率变化 · 金色虚线为目标线</span></div>
        ${hasPapers
          ? `<div id="chart-trend" class="chart-box tall"></div>`
          : `<div class="chart-empty">暂无试卷数据，去「刷题记录」录入吧</div>`}
      </div>
      <div class="card chart-card">
        <div class="card-title">📊 分数分布 <span class="count">按得分率分档</span></div>
        ${hasPapers
          ? `<div id="chart-dist" class="chart-box"></div>`
          : `<div class="chart-empty">暂无试卷数据</div>`}
      </div>
      <div class="card chart-card">
        <div class="card-title">🕸️ 知识点掌握雷达 <span class="count">各科掌握度（知识点平均，无知识点则用卷面分）</span></div>
        ${(hasKnowledge || hasPapers)
          ? `<div id="chart-radar" class="chart-box"></div>`
          : `<div class="chart-empty">暂无知识点数据</div>`}
      </div>
      <div class="card chart-card">
        <div class="card-title">📋 错题类型分布 <span class="count">按错因统计</span></div>
        ${hasErrors
          ? `<div id="chart-err" class="chart-box"></div>`
          : `<div class="chart-empty">暂无错题数据，去「错题与知识点」记录</div>`}
      </div>
    </div>
  `;

  // 绑定差距区按钮（仅在"暂未启用"时渲染；通过事件桥接 app.js 的 openTargetForm）
  const addT = container.querySelector("#analysisAddTarget");
  if (addT) addT.onclick = () => document.dispatchEvent(new CustomEvent("analysis:addTarget"));

  // 下一帧渲染（确保 dom 尺寸就绪）；用 setTimeout 而非 rAF，避免后台/低功耗下 rAF 不触发
  // 单个图表失败不影响其他图表
  setTimeout(() => {
    const safe = (fn, name) => { try { fn(); } catch (e) { console.error("[chart]", name, e); } };
    if (showGap) safe(() => renderTargetGap("chart-gap"), "gap");
    if (hasPapers) safe(() => renderTrend("chart-trend"), "trend");
    if (hasPapers) safe(() => renderDistribution("chart-dist"), "dist");
    if (hasKnowledge || hasPapers) safe(() => renderRadar("chart-radar"), "radar");
    if (hasErrors) safe(() => renderErrorType("chart-err"), "err");
  }, 30);
}

/* 差距分析的"需要重点提升"面板（图表下） */
function renderUrgencyPanel(gap) {
  const high = gap.rows.filter((r) => r.priority === "高");
  const mid = gap.rows.filter((r) => r.priority === "中");
  const ok = gap.rows.filter((r) => r.priority === "达标");
  // 统一口径：估算总分/差距用 estimateTotal()（各科按目标满分折算后相加）
  const est = store.estimateTotal();
  const targetTotal = est.totalTarget;
  const curEstimated = est.estimated;
  const diffTotal = est.diff;

  const rowItem = (r, tone) => {
    const scaled = r.count ? Math.round((r.curPct / 100) * r.targetTotal * 10) / 10 : null;
    const displayDiff = r.targetScore - (scaled || 0);
    const exceeded = displayDiff <= 0;
    const diffColor = exceeded ? "var(--ok)" : "var(--danger)";
    const subj = subjectLabel(r.subject);
    return `
    <div style="display:flex;align-items:flex-start;gap:14px;padding:12px 16px;background:var(--surface-2);border:1px solid var(--line-soft);border-radius:var(--r-sm);box-shadow:0 1px 0 rgba(27,42,78,0.03)">
      <span class="tier tier-${tone}" style="flex-shrink:0;margin-top:4px;width:26px;height:26px;display:flex;align-items:center;justify-content:center;border-radius:50%;font-weight:700;font-size:14px">${tone === "excellent" ? "✓" : tone === "fail" ? "!" : "·"}</span>
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:4px">
          <span class="tag tag-ink" style="font-size:13px;padding:3px 10px;font-weight:600">${subj}</span>
          <div style="font-size:15px;color:var(--ink)">
            <span style="font-family:var(--ff-mono);color:${tone === "excellent" ? "var(--ok)" : "var(--ink-2)"};font-weight:700">${scaled != null ? scaled : "—"}</span>
            <span class="muted" style="font-size:13px;margin:0 6px">分 →</span>
            <span style="font-family:var(--ff-mono);color:var(--accent);font-weight:700">${r.targetScore}</span>
            <span class="muted" style="font-size:13px;margin-left:3px">/ ${r.targetTotal} 分</span>
          </div>
          <div style="margin-left:auto;font-size:17px;font-weight:700;font-family:var(--ff-display);color:${diffColor}">
            ${exceeded ? `✓ +${(-displayDiff).toFixed(1)}` : `− ${displayDiff.toFixed(1)}`}
          </div>
        </div>
        <div class="muted" style="font-size:13px;margin-top:2px;line-height:1.75">
          ${r.count
            ? `卷均 <b>${r.curScore}</b> 分（折算为 ${r.targetTotal} 分制：<b>${scaled}</b>）· 已刷 <b>${r.count}</b> 张卷`
            : `尚未做卷，建议先完成 2–3 套基础卷摸底`}
        </div>
        <div style="margin-top:6px;font-size:12.5px;color:var(--ink-2);line-height:1.7">💡 ${adviceFor(r)}</div>
      </div>
    </div>`;
  };

  return `
    <div style="display:flex;flex-wrap:wrap;align-items:center;gap:12px;padding-bottom:14px;border-bottom:1px dashed var(--line-soft)">
      <div class="card-title" style="margin:0;font-size:17px">需要重点提升重视的部分</div>
      <div style="margin-left:auto;display:flex;flex-wrap:wrap;gap:12px;align-items:baseline">
        <div style="font-size:13px;color:var(--ink-2)">
          总目标 <b style="color:var(--accent);font-family:var(--ff-display);font-size:20px">${targetTotal}</b>
        </div>
        <div style="font-size:13px;color:var(--ink-2)">
          当前估算 <b style="font-family:var(--ff-display);font-size:20px">${curEstimated || "—"}</b>
        </div>
        <div style="font-size:13px;color:var(--ink-2);">
          ${diffTotal > 0 ? `还差 <b style="color:var(--danger);font-family:var(--ff-display);font-size:22px">+${diffTotal}</b> 分`
                         : `超出 <b style="color:var(--ok);font-family:var(--ff-display);font-size:22px">${-diffTotal}</b> 分 ✓`}
        </div>
      </div>
    </div>

    ${high.length ? `<div style="margin-top:18px"><div class="muted" style="font-size:12.5px;margin-bottom:10px;font-weight:600">🔴 高优先级（未做卷，或差距 > 15%）</div>
      <div style="display:flex;flex-direction:column;gap:12px">${high.map((r) => rowItem(r, "fail")).join("")}</div></div>` : ""}

    ${mid.length ? `<div style="margin-top:18px"><div class="muted" style="font-size:12.5px;margin-bottom:10px;font-weight:600">🟠 中优先级（差距 5–15%）</div>
      <div style="display:flex;flex-direction:column;gap:12px">${mid.map((r) => rowItem(r, "pass")).join("")}</div></div>` : ""}

    ${ok.length ? `<div style="margin-top:18px"><div class="muted" style="font-size:12.5px;margin-bottom:10px;font-weight:600">🟢 已达标（当前折算分 ≥ 目标分）</div>
      <div style="display:flex;flex-direction:column;gap:12px">${ok.map((r) => rowItem(r, "excellent")).join("")}</div></div>` : ""}

    ${!high.length && !mid.length ? `
      <div style="margin-top:14px;padding:14px 18px;background:rgba(126,164,120,.08);border-left:3px solid var(--ok);border-radius:var(--r-sm);font-size:14px;color:var(--ink-2);line-height:1.8">
        全部科目已达目标！接下来做两件事：① 保持已达标科目的练习频率，维持手感；② 把已达标科目里的错题二刷一遍，避免真实考场翻车。
      </div>` : `
      <div style="margin-top:18px;padding:14px 18px;background:rgba(184,134,11,.06);border-left:3px solid var(--accent);border-radius:var(--r-sm);font-size:14px;color:var(--ink-2);line-height:1.8">
        <b>学习建议：</b>按"高 → 中"的顺序安排时间，每天把最高优先级科目的专项题安排在前两小时（大脑最清醒的时间）。中优先级科目按"错题复盘 + 每周两套专项卷"保持节奏。
      </div>`}
  `;
}

/* 单科目针对性建议 */
function adviceFor(r) {
  if (r.priority === "达标") return "每周做1–2套保持手感，回看错题即可";
  if (r.count === 0) return "尚未刷该科目试卷，先完成 2–3 套基础卷摸底再分析";
  if (r.diffPct > 20) return "建议先从基础知识点扫盲，再进入真题阶段；必要时回看教材/课程一轮";
  if (r.diffPct > 15) return "建议每天 1.5h 专项，先攻克高频章节，每周做 1 套综合卷";
  if (r.diffPct > 5)  return "保持频率，重点复盘错题；每周 1 套专项/综合卷即可";
  return "已接近目标，刷题重点转向易失分与易忘点";
}

/* ---------- 仪表盘迷你趋势 ---------- */
export async function renderMiniTrend(container) {
  await ensureEcharts();
  const data = store.getData();
  const papers = [...data.papers].filter((p) => p.date).sort((a, b) => a.date.localeCompare(b.date));
  const inst = getChart("chart-mini");
  if (!inst) return;

  inst.setOption({
    ...baseExtra(),
    grid: { left: 30, right: 10, top: 10, bottom: 20 },
    xAxis: { type: "category", data: papers.map((p) => store.formatDate(p.date)), show: false, boundaryGap: false },
    yAxis: { type: "value", min: 0, max: 100, show: false },
    tooltip: { ...baseExtra().tooltip, trigger: "axis", formatter: (p) => `${p[0].axisValue}<br/>${p[0].marker}得分 <b>${p[0].value}%</b>` },
    series: [{
      type: "line", smooth: true, symbol: "none", data: papers.map((p) => store.scorePercent(p)),
      lineStyle: { color: PALETTE.accent, width: 2.5 }, areaStyle: {
        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
          { offset: 0, color: "rgba(184,134,11,0.30)" }, { offset: 1, color: "rgba(184,134,11,0.02)" },
        ]),
      },
    }],
  });
}
