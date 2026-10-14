/* 启动与串联：顶栏、概览、登录、错误兜底 */
(function () {
  "use strict";
  var u = App.util;
  var LS_TAB = "sb.activeTab";
  var activeModule = "study";
  try {
    var saved = localStorage.getItem(LS_TAB);
    if (saved === "study" || saved === "activity") activeModule = saved;
  } catch (e) {}

  function showBanner(msg, type) {
    var b = u.qs("#banner");
    if (!b) return;
    if (!msg) { b.hidden = true; b.textContent = ""; return; }
    b.hidden = false;
    b.className = "banner " + (type || "info");
    b.textContent = msg;
  }

  function renderHeader() {
    var cfg = App.store.state.config || {};
    var title = cfg.title || App.CONFIG.site.title;
    u.qs("#siteTitle").textContent = title;
    u.qs("#siteSemester").textContent = cfg.semester || App.CONFIG.site.semester || "";
    document.title = title;
    var ann = u.qs("#announcement");
    var text = cfg.announcement || App.CONFIG.site.announcement || "";
    ann.textContent = text;
    ann.hidden = !text;
  }

  function stat(label, value, tone) {
    return '<div class="stat' + (tone ? " tone-" + tone : "") + '"><b>' + u.esc(String(value)) + "</b><span>" + u.esc(label) + "</span></div>";
  }

  function renderStats() {
    if (activeModule === "activity") renderActivityStats();
    else renderStudyStats();
  }

  /* 概览（学习任务）：只统计「一次性任务」，每周任务在它自己的分区里 */
  function renderStudyStats() {
    var tasks = (App.store.state.tasks || []).filter(function (t) { return t.repeat_rule !== "weekly"; });
    var now = Date.now();
    var done = tasks.filter(function (t) { return t.status === "done"; }).length;
    var overdue = tasks.filter(function (t) {
      return t.status !== "done" && t.ddl && new Date(t.ddl).getTime() < now;
    }).length;
    var soon = tasks.filter(function (t) {
      var d = t.ddl && new Date(t.ddl).getTime();
      return t.status !== "done" && d && d >= now && (d - now) <= 3 * 86400000;
    }).length;
    var box = u.qs("#stats");
    if (!box) return;
    box.innerHTML =
      stat("一次性任务", tasks.length, "") +
      stat("已完成", done, done ? "ok" : "") +
      stat("临近（≤3 天）", soon, soon ? "warn" : "") +
      stat("已逾期", overdue, overdue ? "danger" : "");
  }

  /* 概览（班会活动） */
  function renderActivityStats() {
    var acts = App.store.state.activities || [];
    var now = Date.now();
    function ts(a) { return a.activity_at ? new Date(a.activity_at).getTime() : Infinity; }
    var upcoming = acts.filter(function (a) { return ts(a) >= now; }).length;
    var soon = acts.filter(function (a) { var t = ts(a); return t >= now && t <= now + 7 * 86400000; }).length;
    var past = acts.filter(function (a) { return ts(a) < now; }).length;
    var box = u.qs("#stats");
    if (!box) return;
    box.innerHTML =
      stat("活动总数", acts.length, "") +
      stat("即将开始", upcoming, upcoming ? "info" : "") +
      stat("7 天内", soon, soon ? "warn" : "") +
      stat("已结束", past, "");
  }

  /* 模块切换（标签页） */
  function setActiveModule(m) {
    activeModule = m;
    try { localStorage.setItem(LS_TAB, m); } catch (e) {}
    u.qsa(".tab").forEach(function (b) {
      var on = b.dataset.tab === m;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-selected", String(on));
    });
    var study = u.qs("#panel-study"), act = u.qs("#panel-activity");
    if (study) study.hidden = m !== "study";
    if (act) act.hidden = m !== "activity";
    renderStats();
  }

  function renderSync() {
    var s = App.store.state;
    var badge = u.qs("#syncBadge");
    if (!badge) return;
    var base = s.mode === "cloud" ? "云端" : "本地演示";
    badge.textContent = base + (s.online ? " · 已同步" : " · 离线");
    badge.classList.toggle("online", !!s.online);
    badge.classList.toggle("offline", !s.online);
    badge.title = s.lastSync ? "上次同步：" + u.fmtDateTime(new Date(s.lastSync).toISOString()) : "尚未同步";
  }

  function updateAdminUI() {
    var isAuthor = App.store.isAuthor();
    var addBtn = u.qs("#addTaskBtn");
    if (addBtn) addBtn.hidden = !isAuthor;
    var addAct = u.qs("#addActivityBtn");
    if (addAct) addAct.hidden = !isAuthor;
    var btn = u.qs("#adminBtn");
    if (btn) btn.textContent = isAuthor ? "退出作者模式" : "作者登录";
  }

  function renderAll() {
    [renderHeader, renderStats, function () { App.tasks.render(); }, function () { App.activities.render(); }, function () { App.comments.render(); }, renderSync, updateAdminUI]
      .forEach(function (fn) { try { fn(); } catch (e) { console.error("[render] 出错:", e); } });
  }

  function onChange(reason) {
    renderAll();
    if (reason === "sync" || reason === "cache") {
      try { App.comments.feed(); } catch (e) { console.error(e); }
    }
    if (reason === "error") {
      showBanner("暂时无法连接数据服务：" + (App.store.state.error || "") +
        "　当前显示的是本地缓存，网络恢复后会自动更新。", "warn");
    } else if (App.store.state.online) {
      showBanner(null);
    }
  }

  function openAuth() {
    var cloud = App.store.isCloud();
    u.qs("#authHint").textContent = cloud
      ? "输入你的作者邮箱与密码。作者都可编辑全部内容。"
      : "本地演示模式：输入演示密码（默认 admin）进入作者模式。";
    var emailLabel = u.qs("#authEmail").closest("label");
    if (emailLabel) emailLabel.hidden = !cloud;
  }

  function onAuthSubmit(e) {
    e.preventDefault();
    var cloud = App.store.isCloud();
    var btn = u.qs("#authSubmit");
    btn.disabled = true;

    if (cloud) {
      App.auth.signIn(u.qs("#authEmail").value.trim(), u.qs("#authPassword").value)
        .then(function () {
          var caps = App.store.caps();
          if (!caps.author) {
            App.auth.signOut();
            App.modal.close("#authModal");
            renderAll();
            App.toast("该账号还没有作者权限，请联系管理员在 authors 表里添加", "warn", 6000);
            return null;
          }
          App.modal.close("#authModal");
          App.toast("已登录，进入作者模式", "ok", 2200);
          renderAll();
          return App.store.refresh().catch(function () {});
        })
        .catch(function (err) { App.toast("登录失败：" + err.message, "danger", 5000); })
        .then(function () { btn.disabled = false; });
    } else {
      if (u.qs("#authPassword").value === App.CONFIG.demoAdminPassword) {
        App.store.setLocalAdmin(true);
        App.modal.close("#authModal");
        App.toast("已进入作者模式（本地演示）", "ok", 1800);
        renderAll();
      } else {
        App.toast("密码不正确（本地演示默认 admin）", "danger");
      }
      btn.disabled = false;
    }
  }

  function wireGlobals() {
    u.qs("#adminBtn").addEventListener("click", function () {
      if (App.store.caps().author) {
        if (App.store.isCloud()) App.auth.signOut();
        else App.store.setLocalAdmin(false);
        App.toast("已退出作者模式", "info", 1600);
        renderAll();
      } else {
        var f = u.qs("#authForm");
        if (f) f.reset();
        openAuth();
        App.modal.open("#authModal");
      }
    });

    u.qs("#authForm").addEventListener("submit", onAuthSubmit);

    u.qsa(".tab").forEach(function (b) {
      b.addEventListener("click", function () { setActiveModule(b.dataset.tab); });
    });

    var rl = u.qs("#refreshLink");
    if (rl) rl.addEventListener("click", function (e) {
      e.preventDefault();
      App.store.refresh().then(function () {
        App.toast("已刷新", "ok", 1500);
      }).catch(function (err) {
        App.toast("刷新失败：" + (err.message || "网络异常"), "danger", 4000);
      });
    });

    window.addEventListener("online", function () { App.store.refresh().catch(function () {}); });
    window.addEventListener("offline", function () { showBanner("网络已断开，正在显示缓存内容。", "warn"); });
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden && App.store.isCloud()) App.store.refresh().catch(function () {});
    });
  }

  function boot() {
    try {
      App.tasks.init();
      App.activities.init();
      App.comments.init();
      App.danmaku.init(document.getElementById("danmakuStage"), document.getElementById("danmakuFallback"));
      wireGlobals();
      setActiveModule(activeModule);
      App.store.on(onChange);

      App.store.init().catch(function (err) {
        showBanner("数据加载失败：" + (err.message || "网络异常") +
          "　当前显示本地缓存/示例内容，网络恢复后会自动重试。", "warn");
      });

      renderAll();   // init() 已同步读入缓存，先渲染一次

      if (App.store.isCloud()) {
        App.auth.restore().then(function () { renderAll(); }).catch(function () {});
      }
    } catch (e) {
      console.error("[boot] 初始化异常:", e);
      showBanner("页面初始化出现异常：" + e.message + "　请刷新重试。", "danger");
    }
  }

  window.addEventListener("error", function (e) { console.error("未捕获错误:", e.error || e.message); });
  window.addEventListener("unhandledrejection", function (e) { console.error("未处理的 Promise 拒绝:", e.reason); });

  /* 暴露给其它模块/调试用（例如切换权限后重绘） */
  App.main = { renderAll: renderAll, setActiveModule: setActiveModule };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
