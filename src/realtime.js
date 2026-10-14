/* 实时推送：直连 Supabase Realtime（原生 WebSocket，零依赖）
 * 作用：数据库有变化时立刻通知前端刷新，做到「你加了任务/发了弹幕，别人马上看到」。
 * 安全性：连不上/被墙/协议不符时**静默失败**，轮询照常兜底，页面永远不会因此出错。
 */
window.App = window.App || {};

App.realtime = (function () {
  "use strict";
  var ws = null;
  var reconnectTimer = null;
  var heartbeatTimer = null;
  var refCounter = 0;
  var connected = false;
  var stopped = true;
  var cb = null;
  var backoff = 2000;
  var TABLES = ["tasks", "activities", "comments"];
  var TOPIC = "realtime:db";

  function wsUrl() {
    var base = String(App.CONFIG.supabaseUrl || "").replace(/\/+$/, "");
    base = base.replace(/^https:/i, "wss:").replace(/^http:/i, "ws:");
    return base + "/realtime/v1/websocket?apikey=" + encodeURIComponent(App.CONFIG.supabaseAnonKey) + "&vsn=1.0.0";
  }

  function send(obj) {
    if (!ws || ws.readyState !== 1) return;
    try { ws.send(JSON.stringify(obj)); } catch (e) { /* 忽略 */ }
  }
  function nextRef() { refCounter += 1; return String(refCounter); }

  function join() {
    var bindings = [];
    TABLES.forEach(function (t) {
      bindings.push({ event: "INSERT", schema: "public", table: t });
      bindings.push({ event: "UPDATE", schema: "public", table: t });
      bindings.push({ event: "DELETE", schema: "public", table: t });
    });
    send({
      topic: TOPIC,
      event: "phx_join",
      payload: { config: { postgres_changes: bindings } },
      ref: nextRef()
    });
    /* 作者登录后带上令牌（公开数据其实不需要，加上更稳妥） */
    var token = App.auth && App.auth.accessToken && App.auth.accessToken();
    if (token) {
      send({ topic: TOPIC, event: "access_token", payload: { access_token: token }, ref: nextRef() });
    }
  }

  function onMessage(ev) {
    var msg;
    try { msg = JSON.parse(ev.data); } catch (e) { return; }
    if (!msg || !msg.event) return;

    if (msg.event === "phx_reply") {
      var status = msg.payload && msg.payload.status;
      if (status === "ok") { connected = true; backoff = 2000; }
      else if (status === "error") { connected = false; }
      return;
    }
    if (msg.event === "postgres_changes" || msg.event === "INSERT" || msg.event === "UPDATE" || msg.event === "DELETE") {
      if (cb) { try { cb(msg); } catch (e) { /* 忽略 */ } }
    }
  }

  function startHeartbeat() {
    stopHeartbeat();
    heartbeatTimer = setInterval(function () {
      send({ topic: "phoenix", event: "heartbeat", payload: {}, ref: nextRef() });
    }, 25000);
  }
  function stopHeartbeat() { if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; } }

  function scheduleReconnect() {
    if (stopped || reconnectTimer) return;
    reconnectTimer = setTimeout(function () {
      reconnectTimer = null;
      backoff = Math.min(backoff * 1.6, 60000);
      connect();
    }, backoff);
  }

  function connect() {
    if (stopped || !App.isCloudMode()) return;
    try { ws = new WebSocket(wsUrl()); } catch (e) { scheduleReconnect(); return; }

    ws.onopen = function () { join(); startHeartbeat(); };
    ws.onmessage = onMessage;
    ws.onerror = function () { /* 交给 onclose */ };
    ws.onclose = function () { connected = false; stopHeartbeat(); scheduleReconnect(); };
  }

  function start(onChange) {
    cb = onChange || null;
    stopped = false;
    backoff = 2000;
    if (!App.isCloudMode()) return;
    connect();
  }

  function stop() {
    stopped = true;
    stopHeartbeat();
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (ws) { try { ws.close(); } catch (e) {} ws = null; }
    connected = false;
  }

  return { start: start, stop: stop, isConnected: function () { return connected; } };
})();
