/* ============================================================
   巅峰赛助手 - app.js
   ============================================================ */
(function () {
  "use strict";

  const LS_KEY = "cybr_fazuo_v1";

  /* ---------------- 工具函数 ---------------- */
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const DOW_NAME = ["日", "一", "二", "三", "四", "五", "六"];
  const DOW_FULL = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];

  // 返回 YYYY-MM-DD（本地时区）
  function dateStr(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  function parseDate(s) {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  function todayStr() { return dateStr(new Date()); }
  function dow(s) { return parseDate(s).getDay(); } // 0=Sun..6=Sat

  // 对局周期：周二(2) ~ 下周一(1)
  // 返回该日期所属周期内 7 个日期字符串（周二起）
  function periodDates(s) {
    const d = parseDate(s);
    const dowv = d.getDay();
    // 周二=2 作为周期起点。计算到本周二的偏移
    // 周期内顺序：[周二,三,四,五,六,日,一]
    // 对于给定日期，周期起点 = 最近的 <= 该日 的周二，但若今天是周一则属于"上周二"起的周期
    let offset; // 该日在周期中的下标 0..6
    if (dowv >= 2) offset = dowv - 2; // 周二..周六
    else offset = dowv + 5;            // 周日=5 周一=6
    const start = new Date(d);
    start.setDate(d.getDate() - offset); // 本周二
    const arr = [];
    for (let i = 0; i < 7; i++) {
      const x = new Date(start);
      x.setDate(start.getDate() + i);
      arr.push(dateStr(x));
    }
    return arr;
  }
  function periodIndex(s) {
    return periodDates(s).indexOf(s);
  }
  // 上/下周期（整周偏移）
  function shiftPeriod(s, weeks) {
    const d = parseDate(s);
    d.setDate(d.getDate() + weeks * 7);
    return dateStr(d);
  }

  function fmtSigned(n) {
    if (n > 0) return "+" + n;
    if (n < 0) return String(n);
    return "0";
  }
  function esc(str) {
    return String(str).replace(/[&<>"']/g, c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  /* ---------------- 数据层 ---------------- */
  const DEFAULT_CUSTOM_RULES = { maxLoss: 3, maxWin: 5 };
  let state = {
    profile: null,        // { nickname, baseScore, weekTarget }
    records: {},          // { "YYYY-MM-DD": { games:[w/l], group, totalChange, saved } }
    customRules: null     // { maxLoss, maxWin }（可选，非强制）
  };

  function load() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        state.profile = data.profile || null;
        state.records = data.records || {};
        state.customRules = data.customRules || null;
      }
    } catch (e) { console.warn("load fail", e); }
  }
  function save() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        profile: state.profile,
        records: state.records,
        customRules: state.customRules
      }));
    } catch (e) { console.warn("save fail", e); }
  }
  function hasProfile() { return !!(state.profile && state.profile.nickname); }

  function getRecord(s) { return state.records[s] || null; }
  function setRecord(s, rec) { state.records[s] = rec; save(); }
  function weekTotal(s) {
    let sum = 0;
    periodDates(s).forEach(d => {
      const r = getRecord(d);
      if (r && typeof r.totalChange === "number") sum += r.totalChange;
    });
    return sum;
  }

  /* ---------------- 规则引擎 ---------------- */
  // 前 4 把胜/负 -> 胜者组 / 败者组（'w'=win 'l'=loss）
  const SEQ_TABLE = {
    "wwww": "winner", "wwwl": "winner",
    "wwll": "loser",  "wlll": "loser",
    "wlwl": "loser",  "wwlw": "loser",
    "lwwl": "loser",  "lwlw": "loser",
    "llww": "loser",  "lllw": "loser",
    "ll":   "loser"   // 前两把连续失败提前判定
  };
  function judgeGroup(games) {
    const g = games.filter(x => x === "w" || x === "l");
    if (g.length === 0) return { state: "none", group: null };
    // 前两把连续失败
    if (g.length >= 2 && g[0] === "l" && g[1] === "l")
      return { state: "done", group: "loser", reason: "前两把连续失败" };
    if (g.length < 4)
      return { state: "wait", group: null };
    const key = g.slice(0, 4).join("");
    const grp = SEQ_TABLE[key] || "loser";
    return { state: "done", group: grp, reason: "打完 4 把" };
  }

  function isChallengeDay(dateStr) {
    const d = dow(dateStr);
    return d === 5 || d === 6; // 周五(5) + 周六(6)
  }

  // 根据组别给出"现在该怎么做"的建议
  function adviceForGroup(judgment, dateStr) {
    const isCh = isChallengeDay(dateStr);
    if (judgment.state === "none")
      return { cls: "wait", tag: isCh ? "挑战赛 · 尚未开始" : "尚未开始", main: "今日尚未开始",
        text: isCh
          ? "当日对局于 18:00 后开始。对局满 4 把判定分组；前 2 把连续失败直接判定为败者组。"
          : "上号后优先进行巅峰赛。对局满 4 把判定分组，前 2 把连续失败直接判定为败者组。" };
    if (judgment.state === "wait")
      return { cls: "wait", tag: "判定中", main: "继续至第 4 把",
        text: "对局满 4 把后判定胜者组或败者组。前 2 把连续失败直接判定为败者组。" };
    if (judgment.group === "winner")
      return { cls: "win" + (isCh ? " game-ch-verdict" : ""), tag: (isCh ? "挑战赛 · " : "") + "胜者组", main: "判定为胜者组，可继续对局",
        text: isCh
          ? "挑战赛胜者组：可继续记录第 5、6……把。建议控制对局场次，关注上分时段。"
          : "胜者组：建议控制对局场次，关注上分时段。可继续记录第 5、6……把。" };
    if (judgment.group === "loser")
      return { cls: "loss", tag: (isCh ? "挑战赛 · " : "") + "败者组", main: "判定为败者组，建议停止",
        text: "败者组当日难以获得分数，建议结束当前对局，可切换至排位模式。" };
    return { cls: "wait", tag: "—", main: "—", text: "" };
  }

  // 明日建议：今天上分->明天休息；没上分/掉分->明天可继续
  // 周五特殊：无论周四输赢，周五都能打（挑战赛）
  function tomorrowAdvice(today, todayRecord) {
    const tDow = dow(today);
    const tRec = todayRecord;
    const up = tRec && typeof tRec.totalChange === "number" && tRec.totalChange > 0;
    const tomorrow = new Date(parseDate(today));
    tomorrow.setDate(tomorrow.getDate() + 1);
    const mDow = tomorrow.getDay();

    // 周五特殊：周四无论输赢，周五都能打（挑战赛）
    if (tDow === 4 && mDow === 5)
      return { ico: "⚡", text: "明日为周五（挑战赛第 1 天）。无论当日输赢，次日均于 18:00 后开始对局。" };
    // 周六也是挑战赛：周五无论输赢，周六继续挑战赛
    if (tDow === 5 && mDow === 6)
      return { ico: "⚡", text: "明日为周六（挑战赛第 2 天）。无论当日输赢，次日均于 18:00 后继续挑战赛。" };

    if (up)
      return { ico: "💤", text: "当日上分，次日建议休息一天，可切换至排位模式。" };
    else
      return { ico: "→", text: "今日未上分或掉分，明日可正常继续对局。" };
  }

  /* ---------------- 自定义规则检测 ---------------- */
  // 检测当前对局序列尾部连续同结果的把数
  function trailingStreak(games) {
    if (!games || games.length === 0) return { type: null, count: 0 };
    const last = games[games.length - 1];
    let count = 0;
    for (let i = games.length - 1; i >= 0 && games[i] === last; i--) count++;
    return { type: last, count };
  }
  // 返回 { triggered, reason }：是否触发自定义规则提醒
  function checkCustomRule(games) {
    const rules = state.customRules;
    if (!rules) return { triggered: false, reason: null };
    const streak = trailingStreak(games);
    if (streak.type === "l" && rules.maxLoss > 0 && streak.count >= rules.maxLoss) {
      return { triggered: true, reason: `已连续失败 ${streak.count} 把，达到自定义规则阈值（${rules.maxLoss} 把），建议停止对局。` };
    }
    if (streak.type === "w" && rules.maxWin > 0 && streak.count >= rules.maxWin) {
      return { triggered: true, reason: `已连续获胜 ${streak.count} 把，达到自定义规则阈值（${rules.maxWin} 把），建议停止对局以保留分数。` };
    }
    return { triggered: false, reason: null };
  }

  /* ---------------- 周目标 ---------------- */
  function weekTarget() {
    if (!state.profile || state.profile.weekTarget == null) return null;
    return Number(state.profile.weekTarget);
  }

  /* ---------------- 周期提示文案 ---------------- */
  function periodHint(date) {
    const dw = dow(date);
    const idx = periodIndex(date);
    const target = weekTarget();
    const targetText = target != null ? `本周期望上分 ${target} 分` : "可在设置中配置本周期望上分";
    if (dw === 5)
      return { title: "周五 · 挑战赛第 1 天",
        desc: "当日对局于 18:00 后开始。对局满 4 把判定分组；前 2 把连续失败直接判定为败者组。胜者组可继续记录后续对局。" };
    if (dw === 6)
      return { title: "周六 · 挑战赛第 2 天",
        desc: "当日对局于 18:00 后开始。若周五未完成全部对局，今日继续；否则按常规流程记录。" };
    if (idx === 0)
      return { title: "周二 · 新周期开始",
        desc: `本周对局由此开始。上号优先进行巅峰赛，对局满 4 把判定分组。${targetText}。` };
    if (dw === 0)
      return { title: "周日 · 周期收尾日",
        desc: `核对本周（周二至周六）累计上分是否达成目标：达成则建议休息并切换至排位模式；未达成则可继续对局。当日上分则次日照常休息。` };
    if (dw === 1)
      return { title: "周一 · 周期最后一天",
        desc: "若周日已上分则休息；否则可再对局一天。完成后本周期结束，下周二重启。" };
    return { title: DOW_FULL[dw] + " · 对局进行中",
      desc: "当日上号优先进行巅峰赛，建议控制对局场次，关注上分时段。" };
  }

  /* ---------------- 页面切换 ---------------- */
  function showView(name) {
    $$(".view").forEach(v => v.classList.add("hidden"));
    $("#view-" + name).classList.remove("hidden");
    $$(".tab").forEach(t => t.classList.toggle("active", t.dataset.view === name));
    if (name === "home") renderHome();
    if (name === "calendar") renderCalendar();
    if (name === "settings") renderSettings();
  }

  /* ---------------- 首页渲染 ---------------- */
  let draft = { games: [], totalChange: "" };

  function renderHome() {
    const t = todayStr();
    const rec = getRecord(t);
    if (rec) {
      draft.games = rec.games ? rec.games.slice() : [];
      draft.totalChange = rec.totalChange != null ? String(rec.totalChange) : "";
      $("#total-change").value = draft.totalChange;
    } else if (draft.games.length || draft.totalChange !== "") {
      $("#total-change").value = draft.totalChange;
    }
    $("#home-nickname").textContent = state.profile.nickname;
    $("#home-score").textContent = state.profile.baseScore;
    const isCh = isChallengeDay(t);
    $("#game-day").textContent = DOW_FULL[dow(t)] + (isCh ? " ⚡" : "");
    const wt = weekTotal(t);
    const wv = $("#home-week-total");
    wv.textContent = fmtSigned(wt);
    wv.className = "week-val " + (wt > 0 ? "pos" : wt < 0 ? "neg" : "zero");
    // 周目标进度条
    const target = weekTarget();
    const goalEl = $("#home-week-goal");
    const barEl = $("#home-week-bar");
    const fillEl = $("#home-week-fill");
    if (target != null && target > 0) {
      goalEl.textContent = `目标 ${target}`;
      const pct = Math.max(0, Math.min(100, Math.round((wt / target) * 100)));
      fillEl.style.width = pct + "%";
      fillEl.classList.toggle("mid", pct < 100);
      barEl.classList.remove("hidden");
    } else {
      goalEl.textContent = "目标 —";
      fillEl.style.width = "0%";
      barEl.classList.add("hidden");
    }
    $("#home-day-badge").textContent = isCh ? "挑战赛" : DOW_FULL[dow(t)];
    $("#home-day-badge").className = "today-badge" + (isCh ? " badge-ch" : "");
    const hint = periodHint(t);
    $("#period-title").textContent = hint.title;
    $("#period-desc").textContent = hint.desc;
    $("#period-card").className = "card period-card" + (isCh ? " period-ch" : "");
    renderGames(draft.games, isCh);
    renderVerdict(judgeGroup(draft.games), t);
    renderTomorrow(tomorrowAdvice(t, rec));
    renderCustomRuleAlert(t);
  }

  /* 自定义规则提醒 + 软拦截 */
  let ruleAlertDismissed = false; // 当次进入首页后，用户是否已选择"忽略并继续"
  function renderCustomRuleAlert(dateStr) {
    const alertEl = $("#rule-alert");
    const skipBtn = $("#rule-skip-btn");
    const saveBtn = $("#save-today-btn");
    const check = checkCustomRule(draft.games);
    if (check.triggered && !ruleAlertDismissed) {
      alertEl.classList.remove("hidden");
      $("#rule-alert-text").textContent = check.reason;
      saveBtn.disabled = true;
      skipBtn.onclick = () => { ruleAlertDismissed = true; renderCustomRuleAlert(dateStr); };
    } else {
      alertEl.classList.add("hidden");
      saveBtn.disabled = false;
      if (check.triggered && ruleAlertDismissed) {
        // 已忽略，按钮恢复可用
      }
    }
  }

  function renderGames(games, isCh) {
    const area = $("#games-area");
    area.innerHTML = "";
    // 前 4 把始终显示（判定需要）；胜者组时可继续记录
    const judgment = judgeGroup(games);
    const canContinue = judgment.state === "done" && judgment.group === "winner";
    // 默认显示 4 把；如果已有记录则至少显示到已有把数+1（方便继续记录）
    let rows = games.length + 1; // 始终比已填写的多 1 行，无限扩展
    for (let i = 0; i < rows; i++) {
      const val = games[i] || null;
      const row = document.createElement("div");
      row.className = "game-row" + (isCh ? " game-ch" : "");
      row.innerHTML =
        `<div class="game-idx">第 ${i + 1} 把</div>` +
        `<div class="game-result">` +
        `<button class="game-btn win ${val === "w" ? "active" : ""}" data-i="${i}" data-v="w">赢</button>` +
        `<button class="game-btn loss ${val === "l" ? "active" : ""}" data-i="${i}" data-v="l">输</button>` +
        `</div>` +
        (val ? `<button class="game-clear" data-i="${i}" title="清除">✕</button>` : "");
      area.appendChild(row);
    }
    // 胜者组时，如果已显示的行已填满，追加一个"+ 继续记录"按钮
    if (canContinue && games.length >= rows) {
      const btn = document.createElement("button");
      btn.className = "btn-add-more";
      btn.textContent = "+ 继续记录一把";
      btn.addEventListener("click", () => renderGames(games, isCh)); // 会因 games.length 增长而多显示一行
      // 实际追加：直接加一行空的
      const row = document.createElement("div");
      row.className = "game-row" + (isCh ? " game-ch" : "");
      const i = games.length;
      row.innerHTML =
        `<div class="game-idx">第 ${i + 1} 把</div>` +
        `<div class="game-result">` +
        `<button class="game-btn win" data-i="${i}" data-v="w">赢</button>` +
        `<button class="game-btn loss" data-i="${i}" data-v="l">输</button>` +
        `</div>`;
      area.appendChild(row);
    }
    area.querySelectorAll(".game-btn").forEach(b =>
      b.addEventListener("click", () => {
        const i = Number(b.dataset.i), v = b.dataset.v;
        if (draft.games[i] === v) {
          draft.games = draft.games.slice(0, i);
        } else {
          draft.games[i] = v;
          draft.games = draft.games.slice(0, i + 1);
        }
        persistDraft(); renderHome();
      }));
    area.querySelectorAll(".game-clear").forEach(b =>
      b.addEventListener("click", () => {
        const i = Number(b.dataset.i);
        draft.games = draft.games.slice(0, i);
        persistDraft(); renderHome();
      }));
  }

  function persistDraft() {
    const t = todayStr();
    if (draft.games.length || draft.totalChange !== "") {
      setRecord(t, {
        games: draft.games,
        group: judgeGroup(draft.games).group,
        totalChange: draft.totalChange === "" ? null : Number(draft.totalChange),
        saved: false
      });
    }
  }

  function renderVerdict(judgment, dateStr) {
    const box = $("#verdict-box");
    const a = adviceForGroup(judgment, dateStr);
    if (judgment.state === "none") { box.classList.add("hidden"); return; }
    box.classList.remove("hidden");
    box.className = "verdict-box " + a.cls;
    box.innerHTML =
      `<div class="v-tag">${esc(a.tag)}</div>` +
      `<div class="v-main">${esc(a.main)}</div>` +
      `<div class="v-advice">${esc(a.text)}</div>`;
  }

  function renderTomorrow(advice) {
    $("#tomorrow-body").innerHTML =
      `<div class="t-line"><span class="t-ico">${advice.ico}</span><span>${esc(advice.text)}</span></div>`;
  }

  /* ---------------- 日历 ---------------- */
  let calAnchor = todayStr(); // 当前查看的周期锚点

  function renderCalendar() {
    const dates = periodDates(calAnchor);
    const t = todayStr();
    // 标题：用周期起始（周二）所在 ISO 周
    const startD = parseDate(dates[0]);
    const year = startD.getFullYear();
    const weekNo = isoWeek(startD);
    $("#cal-title").textContent = `${year} 第 ${weekNo} 周`;

    const grid = $("#cal-grid");
    grid.innerHTML = "";
    let total = 0;
    dates.forEach((ds, i) => {
      const rec = getRecord(ds);
      const dw = dow(ds);
      const isFuture = ds > t;
      const isToday = ds === t;
      const isCh = isChallengeDay(ds);
      let score = 0, hasScore = false, group = null;
      if (rec) {
        group = rec.group;
        if (typeof rec.totalChange === "number") { score = rec.totalChange; hasScore = true; total += score; }
      }
      const st = hasScore ? (score > 0 ? "st-up" : score < 0 ? "st-down" : "st-rest") : "";
      const grpHtml = group === "winner" ? `<div class="c-group c-gw">胜</div>`
        : group === "loser" ? `<div class="c-group c-gl">败</div>` : "";
      const scoreHtml = hasScore
        ? `<div class="c-score">${fmtSigned(score)}</div>`
        : (isFuture ? "" : `<div class="c-score" style="color:var(--text-dim)">休</div>`);
      const chHtml = isCh ? `<div class="c-ch">⚡</div>` : "";
      const cell = document.createElement("div");
      cell.className = `cal-cell ${st} ${isCh ? "cal-ch" : ""} ${isFuture ? "future" : ""} ${isToday ? "today" : ""}`;
      cell.innerHTML =
        `<div class="c-dow">${DOW_NAME[dw]}</div>` +
        `<div class="c-date">${parseDate(ds).getDate()}</div>` +
        scoreHtml + grpHtml + chHtml;
      grid.appendChild(cell);
    });

    // 列表
    const list = $("#cal-list");
    list.innerHTML = "";
    let any = false;
    dates.forEach(ds => {
      const rec = getRecord(ds);
      if (!rec) return;
      any = true;
      const dw = dow(ds);
      const isCh = isChallengeDay(ds);
      const rec2 = rec.games || [];
      const recStr = rec2.map(g => g === "w" ? "胜" : g === "l" ? "负" : "·").join(" ");
      const groupTxt = rec.group === "winner" ? "胜者组" : rec.group === "loser" ? "败者组" : "未判定";
      const chTag = isCh ? " <span class='li-ch-tag'>⚡挑战赛</span>" : "";
      const sc = typeof rec.totalChange === "number" ? rec.totalChange : null;
      const item = document.createElement("div");
      item.className = "list-item" + (isCh ? " list-ch" : "");
      item.innerHTML =
        `<div class="li-date"><div class="li-dow">${DOW_NAME[dw]}</div><div class="li-day">${parseDate(ds).getDate()}日</div></div>` +
        `<div class="li-mid"><div class="li-rec">${esc(recStr || "—")}</div><div class="li-grp">${groupTxt}${chTag}</div></div>` +
        (sc != null ? `<div class="li-score ${sc > 0 ? "pos" : sc < 0 ? "neg" : ""}">${fmtSigned(sc)}</div>` : "");
      list.appendChild(item);
    });
    if (!any) list.innerHTML = `<div class="list-empty">本周期暂无记录</div>`;
    const lt = $("#list-total");
    lt.textContent = total !== 0 ? `累计 ${fmtSigned(total)} 分` : "";
    lt.className = "list-total " + (total > 0 ? "pos" : total < 0 ? "neg" : "");
  }

  // ISO 周数
  function isoWeek(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  }

  /* ---------------- 设置 ---------------- */
  function renderSettings() {
    $("#set-nickname").value = state.profile.nickname;
    $("#set-score").value = state.profile.baseScore;
    $("#set-weektarget").value = (state.profile.weekTarget != null) ? state.profile.weekTarget : "";
    const rules = state.customRules || DEFAULT_CUSTOM_RULES;
    $("#set-maxloss").value = rules.maxLoss;
    $("#set-maxwin").value = rules.maxWin;
  }

  /* ---------------- Toast / Modal ---------------- */
  let toastTimer = null;
  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add("hidden"), 2200);
  }
  function modal({ title, body, actions }) {
    $("#modal-title").textContent = title;
    $("#modal-body").innerHTML = body;
    const acts = $("#modal-actions");
    acts.innerHTML = "";
    (actions || []).forEach(a => {
      const b = document.createElement("button");
      b.className = "btn " + (a.cls || "btn-ghost");
      b.textContent = a.label;
      b.addEventListener("click", () => {
        close();
        if (a.onClick) a.onClick();
      });
      acts.appendChild(b);
    });
    $("#modal").classList.remove("hidden");
    function close() { $("#modal").classList.add("hidden"); }
    $("#modal .modal-mask").onclick = close;
  }

  /* ---------------- 事件绑定 ---------------- */
  function bindEvents() {
    $$(".tab").forEach(t => t.addEventListener("click", () => showView(t.dataset.view)));

    $("#total-change").addEventListener("input", e => {
      draft.totalChange = e.target.value;
      persistDraft();
      const rec = getRecord(todayStr());
      renderTomorrow(tomorrowAdvice(todayStr(), rec));
      const wt = weekTotal(todayStr());
      const wv = $("#home-week-total");
      wv.textContent = fmtSigned(wt);
      wv.className = "week-val " + (wt > 0 ? "pos" : wt < 0 ? "neg" : "zero");
    });

    $("#save-today-btn").addEventListener("click", () => {
      const t = todayStr();
      const tc = $("#total-change").value.trim();
      if (tc === "" || isNaN(Number(tc))) { toast("请填写今日总上下分（如 48 或 -25）"); return; }
      draft.totalChange = tc;
      setRecord(t, { games: draft.games, group: judgeGroup(draft.games).group, totalChange: Number(tc), saved: true });
      toast("已保存今日战绩 ✅");
      renderHome();
    });

    $("#cal-prev").addEventListener("click", () => { calAnchor = shiftPeriod(calAnchor, -1); renderCalendar(); });
    $("#cal-next").addEventListener("click", () => { calAnchor = shiftPeriod(calAnchor, 1); renderCalendar(); });

    $("#set-save-btn").addEventListener("click", () => {
      const nick = $("#set-nickname").value.trim();
      const score = Number($("#set-score").value);
      if (!nick) { toast("昵称不能为空"); return; }
      if (isNaN(score)) { toast("分数必须是数字"); return; }
      state.profile.nickname = nick;
      state.profile.baseScore = score;
      save();
      toast("已保存");
      renderHome(); renderSettings();
    });

    // 周目标保存
    $("#set-weektarget-btn").addEventListener("click", () => {
      const val = $("#set-weektarget").value.trim();
      if (val === "") {
        delete state.profile.weekTarget;
        save();
        toast("已清除周期目标");
      } else {
        const n = Number(val);
        if (isNaN(n) || n <= 0) { toast("请输入有效的期望上分（正数）"); return; }
        state.profile.weekTarget = n;
        save();
        toast(`已保存周期目标：期望上 ${n} 分`);
      }
      renderHome(); renderSettings();
    });

    // 自定义规则保存
    $("#set-rules-btn").addEventListener("click", () => {
      const maxLoss = Number($("#set-maxloss").value);
      const maxWin = Number($("#set-maxwin").value);
      if (isNaN(maxLoss) || maxLoss < 1) { toast("连续失败阈值需为 ≥1 的整数"); return; }
      if (isNaN(maxWin) || maxWin < 1) { toast("连续获胜阈值需为 ≥1 的整数"); return; }
      state.customRules = { maxLoss: Math.floor(maxLoss), maxWin: Math.floor(maxWin) };
      save();
      toast("已保存自定义规则");
      renderSettings();
    });

    // 规则提醒"忽略并继续"
    $("#rule-skip-btn").addEventListener("click", () => {
      ruleAlertDismissed = true;
      renderCustomRuleAlert(todayStr());
    });

    $("#export-btn").addEventListener("click", () => {
      const blob = new Blob([JSON.stringify({ profile: state.profile, records: state.records, customRules: state.customRules }, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `fazuo-backup-${todayStr()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast("已导出备份文件");
    });

    $("#import-btn").addEventListener("click", () => $("#import-file").click());
    $("#import-file").addEventListener("change", e => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result);
          if (!data.profile || !data.profile.nickname) throw new Error("bad");
          modal({ title: "确认导入", body: "导入将覆盖当前数据，是否继续？", actions: [
            { label: "取消", cls: "btn-ghost" },
            { label: "覆盖", cls: "btn-primary", onClick: () => {
              state.profile = data.profile;
              state.records = data.records || {};
              state.customRules = data.customRules || null;
              save();
              toast("导入成功");
              draft = { games: [], totalChange: "" };
              renderHome(); renderSettings();
            } }
          ]});
        } catch (err) { toast("文件格式错误，无法导入"); }
        e.target.value = "";
      };
      reader.readAsText(file);
    });

    $("#clear-btn").addEventListener("click", () => {
      modal({ title: "清除全部数据", body: "将删除昵称、分数和所有战绩记录，且无法恢复。确定吗？", actions: [
        { label: "取消", cls: "btn-ghost" },
        { label: "全部清除", cls: "btn-danger", onClick: () => {
          state = { profile: null, records: {}, customRules: null };
          localStorage.removeItem(LS_KEY);
          draft = { games: [], totalChange: "" };
          location.reload();
        } }
      ]});
    });

    $("#onboard-btn").addEventListener("click", () => {
      const nick = $("#onboard-nickname").value.trim();
      const score = Number($("#onboard-score").value);
      const wtStr = $("#onboard-weektarget").value.trim();
      if (!nick) { toast("请输入昵称"); return; }
      if (isNaN(score)) { toast("请输入巅峰分（数字）"); return; }
      const profile = { nickname: nick, baseScore: score };
      if (wtStr !== "") {
        const wt = Number(wtStr);
        if (isNaN(wt) || wt <= 0) { toast("期望上分需为正数"); return; }
        profile.weekTarget = wt;
      }
      state.profile = profile;
      save();
      enterApp();
    });
    $("#onboard-score").addEventListener("keydown", e => { if (e.key === "Enter") $("#onboard-btn").click(); });
    $("#onboard-weektarget").addEventListener("keydown", e => { if (e.key === "Enter") $("#onboard-btn").click(); });
  }

  /* ---------------- 启动 ---------------- */
  function enterApp() {
    $("#page-onboard").classList.add("hidden");
    $("#app").classList.remove("hidden");
    calAnchor = todayStr();
    ruleAlertDismissed = false;
    showView("home");
  }
  function init() {
    load();
    bindEvents();
    if (hasProfile()) enterApp();
    else $("#page-onboard").classList.remove("hidden");
  }
  document.addEventListener("DOMContentLoaded", init);
})();
