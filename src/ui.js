/* 通用工具：DOM、转义、时间、Toast、模态框 */
window.App = window.App || {};

App.util = (function () {
  "use strict";

  function qs(sel, root) { return (root || document).querySelector(sel); }
  function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null || v === false) return;
        if (k === "class") node.className = v;
        else if (k === "text") node.textContent = v;
        else if (k === "dataset") { Object.keys(v).forEach(function (d) { node.dataset[d] = v[d]; }); }
        else if (k.slice(0, 2) === "on" && typeof v === "function") node.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k in node && k !== "list" && k !== "form") { try { node[k] = v; } catch (e) { node.setAttribute(k, v); } }
        else node.setAttribute(k, v);
      });
    }
    (children || []).forEach(function (c) {
      if (c == null || c === false) return;
      node.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
    });
    return node;
  }

  /* 所有动态文本都必须经过 esc，杜绝 XSS */
  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function parse(iso) { if (!iso) return null; var d = new Date(iso); return isNaN(d.getTime()) ? null : d; }

  function fmtDate(iso) {
    var d = parse(iso); if (!d) return "—";
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function fmtDateTime(iso) {
    var d = parse(iso); if (!d) return "—";
    return fmtDate(iso) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  function toLocalInput(iso) {
    var d = parse(iso); if (!d) return "";
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  function fromLocalInput(v) {
    if (!v) return null;
    var d = new Date(v); return isNaN(d.getTime()) ? null : d.toISOString();
  }

  /* 返回 { text, tone, date }，tone ∈ muted|info|warn|danger|done */
  function ddlInfo(iso, done) {
    var d = parse(iso);
    if (!d) return { text: "未设 DDL", tone: "muted", date: "" };
    var diff = d.getTime() - Date.now();
    var days = Math.ceil(diff / 86400000);
    if (done) return { text: "已完成", tone: "done", date: fmtDate(iso) };
    if (diff < 0) return { text: "已逾期 " + Math.abs(days) + " 天", tone: "danger", date: fmtDate(iso) };
    if (days <= 0) return { text: "今天截止", tone: "danger", date: fmtDate(iso) };
    if (days <= 3) return { text: "还有 " + days + " 天", tone: "warn", date: fmtDate(iso) };
    if (days <= 7) return { text: "还有 " + days + " 天", tone: "info", date: fmtDate(iso) };
    return { text: "还有 " + days + " 天", tone: "muted", date: fmtDate(iso) };
  }

  function debounce(fn, ms) {
    var t = null;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  }

  function uid() {
    try {
      if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    } catch (e) {}
    return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  return {
    qs: qs, qsa: qsa, el: el, esc: esc, pad: pad, uid: uid,
    fmtDate: fmtDate, fmtDateTime: fmtDateTime,
    toLocalInput: toLocalInput, fromLocalInput: fromLocalInput,
    ddlInfo: ddlInfo, debounce: debounce
  };
})();

App.uid = App.util.uid;

/* Toast 提示 */
App.toast = function (msg, type, ms) {
  var box = document.getElementById("toasts");
  if (!box) { try { console.log("[toast]", msg); } catch (e) {} return; }
  var t = App.util.el("div", { class: "toast " + (type || "info"), text: msg });
  box.appendChild(t);
  setTimeout(function () {
    t.classList.add("out");
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 320);
  }, ms || 3200);
};

/* 模态框开关（支持 data-close、点击遮罩、Esc） */
App.modal = (function () {
  "use strict";
  var lastFocus = null;
  function open(sel) {
    var m = typeof sel === "string" ? App.util.qs(sel) : sel;
    if (!m) return;
    lastFocus = document.activeElement;
    m.hidden = false;
    var f = m.querySelector("input,select,textarea,button");
    if (f) setTimeout(function () { try { f.focus(); } catch (e) {} }, 0);
  }
  function close(sel) {
    var m = typeof sel === "string" ? App.util.qs(sel) : sel;
    if (!m) return;
    m.hidden = true;
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) {} }
  }
  function closeAll() { App.util.qsa(".modal").forEach(function (m) { m.hidden = true; }); }

  document.addEventListener("click", function (e) {
    var closer = e.target.closest("[data-close]");
    if (closer) { var m = closer.closest(".modal"); if (m) close(m); return; }
    if (e.target.classList && e.target.classList.contains("modal")) close(e.target);
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      var openModals = App.util.qsa(".modal").filter(function (m) { return !m.hidden; });
      if (openModals.length) close(openModals[openModals.length - 1]);
    }
  });

  return { open: open, close: close, closeAll: closeAll };
})();
