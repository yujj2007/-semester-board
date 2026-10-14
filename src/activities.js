/* 班会活动模块：与学习任务完全独立的第三块内容 */
window.App = window.App || {};

App.activities = (function () {
  "use strict";
  var u = App.util;
  var filter = { q: "" };
  var currentId = null;
  var wired = false;

  function init() {
    if (wired) return; wired = true;
    u.qs("#activitySearch").addEventListener("input", u.debounce(function (e) {
      filter.q = e.target.value.trim();
      render();
    }, 150));
    u.qs("#addActivityBtn").addEventListener("click", function () { openEditor(null); });
    u.qs("#activityForm").addEventListener("submit", onSave);
    u.qs("#deleteActivityBtn").addEventListener("click", onDelete);
    u.qs("#activityList").addEventListener("click", onListClick);
  }

  function findActivity(id) {
    var list = App.store.state.activities || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function fail(err) { App.toast(err && err.message ? err.message : "操作失败", "danger", 5000); }

  function matches(a) {
    if (!filter.q) return true;
    var hay = ((a.title || "") + " " + (a.category || "") + " " + (a.location || "") + " " + (a.tags || []).join(" ") + " " + (a.detail || "")).toLowerCase();
    return hay.indexOf(filter.q.toLowerCase()) >= 0;
  }

  /* 未结束的按时间正序在前，已结束的按时间倒序沉底 */
  function sortActivities(list) {
    var now = Date.now();
    function ts(a) { return a.activity_at ? new Date(a.activity_at).getTime() : Infinity; }
    var future = [], past = [];
    list.forEach(function (a) { (ts(a) >= now ? future : past).push(a); });
    future.sort(function (a, b) { return ts(a) - ts(b); });
    past.sort(function (a, b) { return ts(b) - ts(a); });
    return future.concat(past);
  }

  function whenInfo(iso) {
    var d = iso ? new Date(iso) : null;
    if (!d || isNaN(d.getTime())) return { text: "时间待定", tone: "muted", date: "" };
    var diff = d.getTime() - Date.now();
    var days = Math.ceil(diff / 86400000);
    var date = u.fmtDateTime(iso);
    if (diff < 0) return { text: "已结束", tone: "done", date: date };
    if (days <= 0) return { text: "今天", tone: "warn", date: date };
    if (days <= 3) return { text: "还有 " + days + " 天", tone: "warn", date: date };
    if (days <= 7) return { text: "还有 " + days + " 天", tone: "info", date: date };
    return { text: "还有 " + days + " 天", tone: "muted", date: date };
  }

  function render() {
    var ul = u.qs("#activityList"), emptyEl = u.qs("#activityEmpty"), countEl = u.qs("#activityCount");
    if (!ul) return;
    var all = App.store.state.activities || [];
    var list = sortActivities(all.filter(matches));
    var admin = App.store.isAuthor();
    if (countEl) countEl.textContent = all.length ? "共 " + all.length + " 项" : "";
    ul.innerHTML = list.map(function (a) { return row(a, admin); }).join("");
    emptyEl.hidden = list.length > 0;
    emptyEl.textContent = all.length === 0
      ? (admin ? "还没有活动，点上方「＋ 添加活动」开始吧。" : "暂时还没有班会活动，稍后再来看看～")
      : "没有符合条件的活动。";
  }

  function row(a, admin) {
    var when = whenInfo(a.activity_at);
    var past = !!a.activity_at && new Date(a.activity_at).getTime() < Date.now();
    var tags = (a.tags || []).map(function (x) { return '<span class="tag">' + u.esc(x) + "</span>"; }).join("");
    return '<li class="task' + (past ? " is-past" : "") + '" data-id="' + u.esc(a.id) + '">' +
      '<div class="task-main">' +
        '<div class="task-title">' + u.esc(a.title) + "</div>" +
        '<div class="task-meta">' +
          (a.category ? '<span class="cat-chip">' + u.esc(a.category) + "</span>" : "") +
          (a.location ? '<span class="loc-chip">📍 ' + u.esc(a.location) + "</span>" : "") +
          tags +
        "</div>" +
        (a.detail ? '<div class="task-detail">' + u.esc(a.detail) + "</div>" : "") +
      "</div>" +
      '<div class="task-ddl tone-' + u.esc(when.tone) + '">' +
        '<span class="ddl-text">' + u.esc(when.text) + "</span>" +
        (when.date ? '<span class="ddl-date">' + u.esc(when.date) + "</span>" : "") +
      "</div>" +
      (admin ? '<div class="task-ops"><button class="btn tiny ghost" data-action="edit" type="button">编辑</button></div>' : "") +
    "</li>";
  }

  function onListClick(e) {
    var li = e.target.closest(".task");
    if (!li) return;
    var a = findActivity(li.dataset.id);
    if (!a) return;
    var action = e.target.closest("[data-action]");
    if (action && action.dataset.action === "edit") { openEditor(a); return; }
    if (App.store.isAuthor() && !e.target.closest("button")) openEditor(a);
  }

  function openEditor(a) {
    currentId = a ? a.id : null;
    u.qs("#activityModalTitle").textContent = a ? "编辑活动" : "添加活动";
    u.qs("#a_title").value = a ? a.title : "";
    u.qs("#a_category").value = a ? a.category : "";
    u.qs("#a_location").value = a ? a.location : "";
    u.qs("#a_time").value = a ? u.toLocalInput(a.activity_at) : "";
    u.qs("#a_tags").value = a ? (a.tags || []).join(", ") : "";
    u.qs("#a_detail").value = a ? a.detail : "";
    u.qs("#deleteActivityBtn").hidden = !a;
    App.modal.open("#activityModal");
  }

  function onSave(e) {
    e.preventDefault();
    var data = {
      title: u.qs("#a_title").value.trim(),
      category: u.qs("#a_category").value.trim(),
      location: u.qs("#a_location").value.trim(),
      activity_at: u.fromLocalInput(u.qs("#a_time").value),
      tags: u.qs("#a_tags").value.split(/[,，]/).map(function (s) { return s.trim(); }).filter(Boolean).slice(0, 12),
      detail: u.qs("#a_detail").value.trim()
    };
    if (!data.title) { App.toast("活动名称不能为空", "warn"); return; }
    var isNew = !currentId;
    var p = isNew ? App.store.createActivity(data) : App.store.updateActivity(currentId, data);
    p.then(function () {
      App.modal.close("#activityModal");
      App.toast(isNew ? "活动已添加" : "已保存", "ok", 1800);
      currentId = null;
      return App.store.refresh();
    }).catch(fail);
  }

  function onDelete() {
    if (!currentId) return;
    if (!window.confirm("确定删除这个活动吗？此操作不可撤销。")) return;
    var id = currentId;
    App.store.deleteActivity(id).then(function () {
      App.modal.close("#activityModal");
      App.toast("已删除", "ok", 1800);
      currentId = null;
      return App.store.refresh();
    }).catch(fail);
  }

  return { init: init, render: render };
})();
