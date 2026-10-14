/* 弹幕评论：输入、乐观发送、历史回放、作者隐藏 */
window.App = window.App || {};

App.comments = (function () {
  "use strict";
  var u = App.util;
  var COLORS = ["#7cc4ff", "#ffd479", "#8ef0b0", "#ff9ecb", "#c9b6ff", "#f0f0f0"];
  var chosen = COLORS[0];
  var seen = {};
  var bootstrapped = false;
  var wired = false;

  function init() {
    if (wired) return; wired = true;
    try { u.qs("#nickname").value = localStorage.getItem("sb.nickname") || ""; } catch (e) {}

    var box = u.qs("#colors");
    box.innerHTML = COLORS.map(function (c, i) {
      return '<button type="button" class="swatch' + (i === 0 ? " is-on" : "") + '" data-color="' + c +
        '" style="--c:' + c + '" role="radio" aria-checked="' + (i === 0) + '" aria-label="弹幕颜色 ' + c + '"></button>';
    }).join("");
    box.addEventListener("click", function (e) {
      var b = e.target.closest("[data-color]");
      if (!b) return;
      chosen = b.dataset.color;
      u.qsa(".swatch", box).forEach(function (s) {
        var on = s === b;
        s.classList.toggle("is-on", on);
        s.setAttribute("aria-checked", String(on));
      });
    });

    u.qs("#commentForm").addEventListener("submit", submit);
    u.qs("#commentList").addEventListener("click", onListClick);
  }

  function submit(e) {
    e.preventDefault();
    var input = u.qs("#commentInput");
    var text = (input.value || "").trim();
    if (!text) return;
    if (text.length > 120) text = text.slice(0, 120);
    var nickname = (u.qs("#nickname").value || "").trim().slice(0, 24) || "访客";
    try { localStorage.setItem("sb.nickname", nickname === "访客" ? "" : nickname); } catch (err) {}

    var btn = u.qs("#sendBtn");
    btn.disabled = true;

    App.danmaku.push(text, chosen);           // 乐观显示：先飞出去
    input.value = "";

    App.store.createComment({ nickname: nickname, content: text, color: chosen })
      .then(function (row) {
        if (row && row.id) seen[row.id] = true;
        return App.store.refresh().catch(function () {});
      })
      .catch(function (err) {
        App.toast("发送失败：" + (err.message || "未知错误"), "danger", 5000);
      })
      .then(function () {
        btn.disabled = false;
        try { input.focus(); } catch (e2) {}
      });
  }

  function onListClick(e) {
    var btn = e.target.closest('[data-action="hide"]');
    if (!btn) return;
    var li = btn.closest("li[data-id]");
    if (!li || !App.store.isAuthor()) return;
    App.store.hideComment(li.dataset.id)
      .then(function () { return App.store.refresh(); })
      .catch(function (err) { App.toast(err.message || "操作失败", "danger"); });
  }

  function render() {
    var list = App.store.state.comments || [];
    var countEl = u.qs("#commentCount");
    if (countEl) countEl.textContent = list.length ? "共 " + list.length + " 条" : "";
    var admin = App.store.isAuthor();
    var ul = u.qs("#commentList");
    if (!ul) return;
    ul.innerHTML = list.slice(0, 100).map(function (c) {
      return '<li data-id="' + u.esc(c.id) + '">' +
        '<span class="who" style="color:' + u.esc(c.color) + '">' + u.esc(c.nickname) + "</span>" +
        '<span class="what">' + u.esc(c.content) + "</span>" +
        "<time>" + u.esc(u.fmtDateTime(c.created_at)) + "</time>" +
        (admin ? '<button class="btn tiny danger" data-action="hide" type="button">隐藏</button>' : "") +
      "</li>";
    }).join("") || '<li class="muted">还没有评论，来发第一条吧。</li>';
  }

  /* 首次进入回放最近 N 条；之后只推「没见过的新弹幕」 */
  function feed() {
    var list = (App.store.state.comments || []).slice().sort(function (a, b) {
      return new Date(a.created_at) - new Date(b.created_at);
    });
    if (!bootstrapped) {
      bootstrapped = true;
      var recent = list.slice(-(App.CONFIG.site.danmakuReplay || 24));
      recent.forEach(function (c) { seen[c.id] = true; });
      App.danmaku.replay(recent);
      return;
    }
    list.forEach(function (c) {
      if (seen[c.id]) return;
      seen[c.id] = true;
      App.danmaku.push(c.content, c.color);
    });
  }

  return {
    init: init, render: render, feed: feed,
    reset: function () { seen = {}; bootstrapped = false; App.danmaku.clear(); }
  };
})();
