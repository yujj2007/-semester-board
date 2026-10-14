/* 任务列表：一次性任务 + 每周持续任务（分区渲染）、筛选、增删改 */
window.App = window.App || {};

App.tasks = (function () {
  "use strict";
  var u = App.util;
  var filter = { status: "all", q: "" };
  var currentId = null;
  var wired = false;
  var WEEK_CN = ["一", "二", "三", "四", "五", "六", "日"];

  function isWeekly(t) { return t.repeat_rule === "weekly"; }

  function init() {
    if (wired) return; wired = true;
    u.qs("#search").addEventListener("input", u.debounce(function (e) {
      filter.q = e.target.value.trim();
      render();
    }, 150));
    u.qs("#statusFilter").addEventListener("click", function (e) {
      var b = e.target.closest("[data-status]");
      if (!b) return;
      filter.status = b.dataset.status;
      u.qsa(".chip", u.qs("#statusFilter")).forEach(function (c) {
        var on = c === b;
        c.classList.toggle("is-on", on);
        c.setAttribute("aria-pressed", String(on));
      });
      render();
    });
    u.qs("#taskList").addEventListener("click", onListClick);
    u.qs("#weeklyList").addEventListener("click", onListClick);
    u.qs("#addTaskBtn").addEventListener("click", function () { openEditor(null); });
    u.qs("#taskForm").addEventListener("submit", onSave);
    u.qs("#deleteTaskBtn").addEventListener("click", onDelete);
    u.qs("#f_type").addEventListener("change", applyTypeUI);
  }

  function findTask(id) {
    var list = App.store.state.tasks || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function fail(err) { App.toast(err && err.message ? err.message : "操作失败", "danger", 5000); }

  /* ---------------- 排序 ---------------- */
  function sortOnce(list) {
    return list.slice().sort(function (a, b) {
      var ad = a.status === "done" ? 1 : 0, bd = b.status === "done" ? 1 : 0;
      if (ad !== bd) return ad - bd;
      var at = a.ddl ? new Date(a.ddl).getTime() : Infinity;
      var bt = b.ddl ? new Date(b.ddl).getTime() : Infinity;
      if (at !== bt) return at - bt;
      return (a.sort_order || 0) - (b.sort_order || 0);
    });
  }
  function sortWeekly(list) {
    return list.slice().sort(function (a, b) {
      var aw = a.weekday || 8, bw = b.weekday || 8;   // 未指定星期的排最后
      if (aw !== bw) return aw - bw;
      return (a.sort_order || 0) - (b.sort_order || 0);
    });
  }

  function matchesQuery(t) {
    if (!filter.q) return true;
    var hay = ((t.title || "") + " " + (t.course || "") + " " + (t.tags || []).join(" ") + " " + (t.detail || "")).toLowerCase();
    return hay.indexOf(filter.q.toLowerCase()) >= 0;
  }

  /* ---------------- 渲染 ---------------- */
  function render() {
    var all = App.store.state.tasks || [];
    var admin = App.store.isAuthor();
    renderWeekly(all.filter(isWeekly).filter(matchesQuery), admin);
    renderOnce(all.filter(function (t) { return !isWeekly(t); }), admin);
  }

  function renderOnce(allOnce, admin) {
    var listEl = u.qs("#taskList"), emptyEl = u.qs("#emptyState");
    if (!listEl) return;
    var list = sortOnce(allOnce.filter(function (t) {
      if (filter.status !== "all" && (t.status || "todo") !== filter.status) return false;
      return matchesQuery(t);
    }));
    listEl.innerHTML = list.map(function (t) { return rowOnce(t, admin); }).join("");
    emptyEl.hidden = list.length > 0;
    emptyEl.textContent = allOnce.length === 0
      ? (admin ? "还没有一次性任务，点上方「＋ 添加任务」开始吧。" : "暂时还没有一次性任务，稍后再来看看～")
      : "没有符合筛选条件的任务。";
  }

  function renderWeekly(list, admin) {
    var section = u.qs("#weekly-section");
    var ul = u.qs("#weeklyList"), emptyEl = u.qs("#weeklyEmpty");
    if (!section || !ul) return;
    var sorted = sortWeekly(list);

    /* 没有每周任务时：作者看到引导，访客整块隐藏 */
    section.hidden = sorted.length === 0 && !admin;
    var countEl = u.qs("#weeklyCount");
    if (countEl) countEl.textContent = sorted.length ? "共 " + sorted.length + " 项" : "";

    ul.innerHTML = sorted.map(function (t) { return rowWeekly(t, admin); }).join("");
    emptyEl.hidden = sorted.length > 0;
    emptyEl.textContent = allWeeklyMessage();
  }
  function allWeeklyMessage() {
    return filter.q ? "没有匹配的每周任务。" : "还没有每周任务。编辑任务时把「任务类型」选为「每周持续任务」即可。";
  }

  function weeklyLabel(n) {
    return n ? "每周" + WEEK_CN[n - 1] : "每周 · 不限具体日";
  }
  function nextOccurrence(n) {
    if (!n) return "";
    var d = new Date(); d.setHours(0, 0, 0, 0);
    var cur = ((d.getDay() + 6) % 7) + 1;          // 1=周一 … 7=周日
    var delta = (n - cur + 7) % 7;
    if (delta === 0) return "今天";
    d.setDate(d.getDate() + delta);
    return u.fmtDate(d.toISOString());
  }

  function rowOnce(t, admin) {
    var ddl = u.ddlInfo(t.ddl, t.status === "done");
    var statusLabel = { todo: "待办", doing: "进行中", done: "已完成" }[t.status || "todo"];
    var priLabel = { high: "高", mid: "中", low: "低" }[t.priority || "mid"];
    var tags = (t.tags || []).map(function (x) { return '<span class="tag">' + u.esc(x) + "</span>"; }).join("");
    return '<li class="task' + (t.status === "done" ? " is-done" : "") + " pri-" + u.esc(t.priority || "mid") + '" data-id="' + u.esc(t.id) + '">' +
      '<button class="check" type="button" data-action="toggle" aria-label="切换完成状态" ' + (admin ? "" : "disabled") + '>' + (t.status === "done" ? "✓" : "") + "</button>" +
      '<div class="task-main">' +
        '<div class="task-title">' + u.esc(t.title) + "</div>" +
        '<div class="task-meta">' +
          (t.course ? '<span class="course">' + u.esc(t.course) + "</span>" : "") +
          '<span class="status s-' + u.esc(t.status || "todo") + '">' + statusLabel + "</span>" +
          '<span class="pri p-' + u.esc(t.priority || "mid") + '">优先级 ' + priLabel + "</span>" +
          tags +
        "</div>" +
        (t.detail ? '<div class="task-detail">' + u.esc(t.detail) + "</div>" : "") +
      "</div>" +
      '<div class="task-ddl tone-' + u.esc(ddl.tone) + '">' +
        '<span class="ddl-text">' + u.esc(ddl.text) + "</span>" +
        (ddl.date ? '<span class="ddl-date">' + u.esc(ddl.date) + "</span>" : "") +
      "</div>" +
      (admin ? '<div class="task-ops"><button class="btn tiny ghost" data-action="edit" type="button">编辑</button></div>' : "") +
    "</li>";
  }

  function rowWeekly(t, admin) {
    var when = weeklyLabel(t.weekday);
    var next = nextOccurrence(t.weekday);
    var priLabel = { high: "高", mid: "中", low: "低" }[t.priority || "mid"];
    var tags = (t.tags || []).map(function (x) { return '<span class="tag">' + u.esc(x) + "</span>"; }).join("");
    return '<li class="task task--weekly" data-id="' + u.esc(t.id) + '">' +
      '<div class="task-main">' +
        '<div class="task-title">' + u.esc(t.title) + "</div>" +
        '<div class="task-meta">' +
          (t.course ? '<span class="course">' + u.esc(t.course) + "</span>" : "") +
          '<span class="when-chip">' + u.esc(when) + "</span>" +
          '<span class="pri p-' + u.esc(t.priority || "mid") + '">优先级 ' + priLabel + "</span>" +
          tags +
        "</div>" +
        (t.detail ? '<div class="task-detail">' + u.esc(t.detail) + "</div>" : "") +
      "</div>" +
      '<div class="task-ddl">' +
        (next ? '<span class="ddl-text">下次 ' + u.esc(next) + "</span>" : '<span class="ddl-text">长期</span>') +
        '<span class="ddl-date">重复出现</span>' +
      "</div>" +
      (admin ? '<div class="task-ops"><button class="btn tiny ghost" data-action="edit" type="button">编辑</button></div>' : "") +
    "</li>";
  }

  /* ---------------- 交互 ---------------- */
  function onListClick(e) {
    var li = e.target.closest(".task");
    if (!li) return;
    var task = findTask(li.dataset.id);
    if (!task) return;
    var action = e.target.closest("[data-action]");
    if (action && action.dataset.action === "toggle") {
      if (!App.store.isAuthor() || isWeekly(task)) return;
      var next = task.status === "done" ? "todo" : "done";
      App.store.updateTask(task.id, { status: next }).then(function () { return App.store.refresh(); }).catch(fail);
      return;
    }
    if (action && action.dataset.action === "edit") { openEditor(task); return; }
    if (App.store.isAuthor() && !e.target.closest("button")) openEditor(task);
  }

  /* 按任务类型切换表单字段的显示 */
  function applyTypeUI() {
    var weekly = u.qs("#f_type").value === "weekly";
    u.qs("#f_ddl_label").hidden = weekly;
    u.qs("#f_weekday_label").hidden = !weekly;
    u.qs("#f_status_label").hidden = weekly;
  }

  function openEditor(task) {
    currentId = task ? task.id : null;
    u.qs("#taskModalTitle").textContent = task ? "编辑任务" : "添加任务";
    u.qs("#f_title").value = task ? task.title : "";
    u.qs("#f_type").value = task && isWeekly(task) ? "weekly" : "";
    u.qs("#f_course").value = task ? task.course : "";
    u.qs("#f_priority").value = task ? (task.priority || "mid") : "mid";
    u.qs("#f_status").value = task ? (task.status || "todo") : "todo";
    u.qs("#f_ddl").value = task ? u.toLocalInput(task.ddl) : "";
    u.qs("#f_weekday").value = task && task.weekday ? String(task.weekday) : "";
    u.qs("#f_tags").value = task ? (task.tags || []).join(", ") : "";
    u.qs("#f_detail").value = task ? task.detail : "";
    u.qs("#deleteTaskBtn").hidden = !task;
    applyTypeUI();
    App.modal.open("#taskModal");
  }

  function onSave(e) {
    e.preventDefault();
    var weekly = u.qs("#f_type").value === "weekly";
    var data = {
      title: u.qs("#f_title").value.trim(),
      course: u.qs("#f_course").value.trim(),
      priority: u.qs("#f_priority").value,
      status: weekly ? "todo" : u.qs("#f_status").value,
      repeat_rule: weekly ? "weekly" : "",
      weekday: weekly ? (parseInt(u.qs("#f_weekday").value, 10) || null) : null,
      ddl: weekly ? null : u.fromLocalInput(u.qs("#f_ddl").value),
      tags: u.qs("#f_tags").value.split(/[,，]/).map(function (s) { return s.trim(); }).filter(Boolean).slice(0, 12),
      detail: u.qs("#f_detail").value.trim()
    };
    if (!data.title) { App.toast("标题不能为空", "warn"); return; }
    var isNew = !currentId;
    var p = isNew ? App.store.createTask(data) : App.store.updateTask(currentId, data);
    p.then(function () {
      App.modal.close("#taskModal");
      App.toast(isNew ? "任务已添加" : "已保存", "ok", 1800);
      currentId = null;
      return App.store.refresh();
    }).catch(fail);
  }

  function onDelete() {
    if (!currentId) return;
    if (!window.confirm("确定删除这个任务吗？此操作不可撤销。")) return;
    var id = currentId;
    App.store.deleteTask(id).then(function () {
      App.modal.close("#taskModal");
      App.toast("已删除", "ok", 1800);
      currentId = null;
      return App.store.refresh();
    }).catch(fail);
  }

  return { init: init, render: render };
})();
