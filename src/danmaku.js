/* 弹幕引擎：多轨道调度 + Web Animations API；尊重「减少动态效果」偏好 */
window.App = window.App || {};

App.danmaku = (function () {
  "use strict";

  var stage = null, fallback = null;
  var reduced = false;
  var trackReady = [];      // 每条轨道「下一个弹幕可以入场」的时间戳
  var SPEED = 95;           // 像素/秒，越小越慢
  var MAX_ITEMS = 80;       // 同屏上限，防止极端情况卡顿

  function init(stageEl, fallbackEl) {
    stage = stageEl || null;
    fallback = fallbackEl || null;
    try {
      reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch (e) { reduced = false; }
    if (stage && reduced) stage.hidden = true;
    if (fallback && reduced) fallback.hidden = false;
    window.addEventListener("resize", layout);
    layout();
  }

  function layout() {
    if (!stage) return;
    var h = stage.clientHeight || 220;
    var n = Math.max(1, Math.floor(h / 34));
    trackReady = new Array(n).fill(0);
  }

  function pickTrack(width, now) {
    var best = 0, bestTime = Infinity;
    for (var i = 0; i < trackReady.length; i++) {
      if (trackReady[i] <= now) { best = i; bestTime = trackReady[i]; break; }
      if (trackReady[i] < bestTime) { bestTime = trackReady[i]; best = i; }
    }
    /* 该轨道的尾部完全进入可视区所需时间 */
    trackReady[best] = Math.max(now, trackReady[best]) + (width / SPEED) * 1000 + 220;
    return best;
  }

  function pushChip(text, color) {
    if (!fallback) return;
    var chip = App.util.el("span", { class: "dm-chip", text: text });
    if (color) chip.style.color = color;
    fallback.appendChild(chip);
    while (fallback.children.length > MAX_ITEMS) fallback.removeChild(fallback.firstChild);
  }

  function push(text, color, delayMs) {
    text = String(text == null ? "" : text).slice(0, 120);
    if (!text) return;

    function fire() {
      if (reduced || !stage) { pushChip(text, color); return; }
      if (!stage.isConnected) return;
      if (stage.children.length >= MAX_ITEMS) {
        var first = stage.firstChild;
        if (first && first.parentNode) first.parentNode.removeChild(first);
      }
      var now = (window.performance && performance.now) ? performance.now() : Date.now();
      var item = document.createElement("div");
      item.className = "danmaku-item";
      item.textContent = text;
      if (color) item.style.color = color;
      item.style.transform = "translateX(" + (stage.clientWidth || 800) + "px)";
      stage.appendChild(item);

      var w = (item.offsetWidth || 80) + 28;
      var track = pickTrack(w, now);
      var trackH = (stage.clientHeight || 220) / trackReady.length;
      item.style.top = Math.round(track * trackH + Math.max(0, (trackH - (item.offsetHeight || 22)) / 2)) + "px";

      var startX = stage.clientWidth || 800;
      var endX = -w;
      var dist = startX - endX;
      var dur = Math.max(3500, (dist / SPEED) * 1000);

      if (item.animate) {
        var anim = item.animate(
          [{ transform: "translateX(" + startX + "px)" }, { transform: "translateX(" + endX + "px)" }],
          { duration: dur, easing: "linear", fill: "forwards" }
        );
        anim.onfinish = function () { if (item.parentNode) item.parentNode.removeChild(item); };
      } else {
        item.style.transition = "transform " + dur + "ms linear";
        requestAnimationFrame(function () { item.style.transform = "translateX(" + endX + "px)"; });
        setTimeout(function () { if (item.parentNode) item.parentNode.removeChild(item); }, dur + 120);
      }
    }

    if (delayMs && delayMs > 0) setTimeout(fire, delayMs);
    else fire();
  }

  /* 回放一批历史弹幕（带轻微错峰，避免一次性涌入） */
  function replay(items) {
    (items || []).forEach(function (it, i) {
      push(it.content || it.text, it.color, i * 120);
    });
  }

  function clear() {
    if (stage) stage.innerHTML = "";
    if (fallback) fallback.innerHTML = "";
  }

  return { init: init, push: push, replay: replay, clear: clear, layout: layout,
    get reduced() { return reduced; } };
})();
