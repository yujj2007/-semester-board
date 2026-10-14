/* 认证：云端走 Supabase Auth（密码登录 + 刷新令牌）；本地演示模式走一个密码开关 */
window.App = window.App || {};

App.auth = (function () {
  "use strict";
  var C = App.CONFIG;
  var LS_SESSION = "sb.session.v1";
  var session = null;

  var caps = { author: false, email: "" };

  function getCaps() { return caps; }
  function setCaps(c) {
    caps = { author: !!(c && c.author), email: (c && c.email) || "" };
    return caps;
  }
  /* 从数据库读取当前账号的权限（后端 my_caps 函数） */
  function fetchCaps() {
    if (!isSignedIn()) { setCaps(null); return Promise.resolve(caps); }
    var base = C.supabaseUrl.replace(/\/+$/, "");
    return fetch(base + "/rest/v1/rpc/my_caps", {
      method: "POST",
      headers: { "apikey": C.supabaseAnonKey, "Authorization": "Bearer " + accessToken(), "Content-Type": "application/json" },
      body: "{}"
    }).then(function (res) {
      return res.text().then(function (t) {
        if (!res.ok) { setCaps(null); return caps; }
        var data = null;
        try { data = t ? JSON.parse(t) : null; } catch (e) {}
        return setCaps(data);
      });
    }).catch(function () { setCaps(null); return caps; });
  }

  function lsGet(k, d) { try { var r = localStorage.getItem(k); return r == null ? d : JSON.parse(r); } catch (e) { return d; } }
  function lsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  function accessToken() { return session && session.access_token ? session.access_token : null; }
  function user() { return session && session.user ? session.user : null; }
  function isSignedIn() { return !!accessToken(); }
  function expiringSoon() {
    if (!session || !session.expires_at) return false;
    return Date.now() > (session.expires_at - 60000);
  }

  function saveSession(data) {
    if (!data || !data.access_token) { session = null; lsSet(LS_SESSION, null); return null; }
    session = {
      access_token: data.access_token,
      refresh_token: data.refresh_token || (session && session.refresh_token) || null,
      expires_at: Date.now() + ((data.expires_in || 3600) * 1000),
      user: data.user || (session && session.user) || null
    };
    lsSet(LS_SESSION, session);
    return session;
  }

  function authFetch(path, body) {
    var base = C.supabaseUrl.replace(/\/+$/, "");
    return fetch(base + "/auth/v1" + path, {
      method: "POST",
      headers: { "apikey": C.supabaseAnonKey, "Content-Type": "application/json" },
      body: JSON.stringify(body || {})
    }).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) {}
        if (!res.ok) {
          var msg = (data && (data.error_description || data.msg || data.error || data.message)) || ("登录失败(" + res.status + ")");
          throw new Error(msg);
        }
        return data;
      });
    });
  }

  function signIn(email, password) {
    return authFetch("/token?grant_type=password", { email: email, password: password })
      .then(function (data) { var s = saveSession(data); return fetchCaps().then(function () { return s; }); });
  }

  function refresh() {
    if (!session || !session.refresh_token) { setCaps(null); return Promise.resolve(null); }
    return authFetch("/token?grant_type=refresh_token", { refresh_token: session.refresh_token })
      .then(function (data) { var s = saveSession(data); return fetchCaps().then(function () { return s; }); })
      .catch(function () { saveSession(null); setCaps(null); return null; });
  }

  function signOut() {
    var token = accessToken();
    session = null; lsSet(LS_SESSION, null); setCaps(null);
    if (token && C.supabaseUrl) {
      var base = C.supabaseUrl.replace(/\/+$/, "");
      try {
        fetch(base + "/auth/v1/logout", { method: "POST", headers: { "apikey": C.supabaseAnonKey, "Authorization": "Bearer " + token } })
          .catch(function () {});
      } catch (e) {}
    }
  }

  /* 启动时恢复会话；令牌过期则自动刷新；随后拉取权限 */
  function restore() {
    session = lsGet(LS_SESSION, null);
    if (!session) { setCaps(null); return Promise.resolve(null); }
    var p = expiringSoon() ? refresh() : Promise.resolve(session);
    return p.then(function (s) { return fetchCaps().then(function () { return s; }); });
  }

  return {
    accessToken: accessToken, user: user, isSignedIn: isSignedIn,
    signIn: signIn, signOut: signOut, refresh: refresh, restore: restore,
    getCaps: getCaps, setCaps: setCaps, fetchCaps: fetchCaps
  };
})();
