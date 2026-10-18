/* 数据层：统一「云端(Supabase REST)」与「本地演示(localStorage)」两套后端。
 * 对外暴露同一组 Promise 接口；断网/后端异常时回落到只读缓存，保证刷新不白屏。 */
window.App = window.App || {};

App.store = (function () {
  "use strict";
  var C = App.CONFIG;

  var LS = {
    TASKS: "sb.tasks.v1",
    ACTIVITIES: "sb.activities.v1",
    COMMENTS: "sb.comments.v1",
    CONFIG: "sb.config.v1",
    ADMIN: "sb.demoAdmin",
    CACHE_T: "sb.cache.tasks.v1",
    CACHE_A: "sb.cache.activities.v1",
    CACHE_C: "sb.cache.comments.v1"
  };

  var state = {
    mode: App.isCloudMode() ? "cloud" : "local",
    online: true,
    loading: true,
    error: null,
    tasks: [],
    activities: [],
    comments: [],
    config: {},
    lastSync: null
  };

  var listeners = [];
  var timers = { poll: null, backoff: C.site.pollIntervalMs };

  /* ---------- 事件 ---------- */
  function on(fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (f) { return f !== fn; }); }; }
  function emit(reason) {
    listeners.forEach(function (fn) { try { fn(reason, state); } catch (e) { console.error("[store] 监听器异常:", e); } });
  }
  function patch(p, reason) { Object.keys(p).forEach(function (k) { state[k] = p[k]; }); emit(reason || "patch"); }

  /* ---------- localStorage ---------- */
  function lsGet(k, d) { try { var r = localStorage.getItem(k); return r == null ? d : JSON.parse(r); } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 隐私模式/超配额：忽略 */ } }

  /* ---------- 归一化：老数据、脏数据都不会让页面崩 ---------- */
  function normalizeTask(t) {
    t = t || {};
    return {
      id: t.id || App.uid(),
      title: t.title != null ? String(t.title) : "(未命名)",
      course: t.course != null ? String(t.course) : "",
      detail: t.detail != null ? String(t.detail) : "",
      ddl: t.ddl || null,
      priority: (t.priority === "high" || t.priority === "low") ? t.priority : "mid",
      status: (t.status === "doing" || t.status === "done") ? t.status : "todo",
      repeat_rule: t.repeat_rule === "weekly" ? "weekly" : "",
      weekday: (typeof t.weekday === "number" && t.weekday >= 1 && t.weekday <= 7) ? t.weekday : null,
      tags: Array.isArray(t.tags) ? t.tags.filter(function (x) { return x != null && x !== ""; }).map(String).slice(0, 12) : [],
      sort_order: typeof t.sort_order === "number" ? t.sort_order : 0,
      created_at: t.created_at || new Date().toISOString(),
      updated_at: t.updated_at || t.created_at || new Date().toISOString()
    };
  }
  function normalizeComment(c) {
    c = c || {};
    return {
      id: c.id || App.uid(),
      nickname: c.nickname != null ? String(c.nickname).slice(0, 24) : "访客",
      content: c.content != null ? String(c.content).slice(0, 200) : "",
      color: /^#[0-9a-fA-F]{6}$/.test(c.color || "") ? c.color : "#7cc4ff",
      is_hidden: !!c.is_hidden,
      created_at: c.created_at || new Date().toISOString()
    };
  }
  /* 班会活动：与学习任务完全独立的另一类数据 */
  function normalizeActivity(a) {
    a = a || {};
    return {
      id: a.id || App.uid(),
      title: a.title != null ? String(a.title) : "(未命名活动)",
      activity_at: a.activity_at || null,
      location: a.location != null ? String(a.location) : "",
      category: a.category != null ? String(a.category) : "",
      detail: a.detail != null ? String(a.detail) : "",
      tags: Array.isArray(a.tags) ? a.tags.filter(function (x) { return x != null && x !== ""; }).map(String).slice(0, 12) : [],
      created_at: a.created_at || new Date().toISOString(),
      updated_at: a.updated_at || a.created_at || new Date().toISOString()
    };
  }

  /* ---------- 本地演示后端 ---------- */
  function seedTasks() {
    var day = 86400000;
    function iso(d) { return new Date(Date.now() + d * day).toISOString(); }
    return [
      normalizeTask({ title: "（示例）数据结构 · 课程设计报告", course: "数据结构", priority: "high", status: "doing", ddl: iso(3), tags: ["报告", "小组"], detail: "提交 PDF + 源码压缩包，命名：学号_姓名。" }),
      normalizeTask({ title: "（示例）英语 · 期末演讲", course: "英语", priority: "mid", status: "todo", ddl: iso(9), tags: ["演讲"] }),
      normalizeTask({ title: "（示例）高等数学 · 第 8 章作业", course: "高等数学", priority: "mid", status: "todo", ddl: iso(1), tags: ["作业"] }),
      normalizeTask({ title: "（示例）体育 · 体测登记", course: "体育", priority: "low", status: "done", ddl: iso(-2), tags: [] }),
      normalizeTask({ title: "（示例）每周英语单词背诵", course: "英语", priority: "mid", repeat_rule: "weekly", weekday: 3, tags: ["长期"], detail: "每周三前完成当周单词，持续整个学期。" }),
      normalizeTask({ title: "（示例）每周整理课程笔记", course: "", priority: "low", repeat_rule: "weekly", tags: ["长期"] })
    ];
  }
  function seedActivities() {
    var day = 86400000;
    function iso(d) { return new Date(Date.now() + d * day).toISOString(); }
    return [
      normalizeActivity({ title: "（示例）主题班会 · 学风建设", category: "班会", location: "教学楼 A203", activity_at: iso(2), tags: ["全班"], detail: "请提前准备一条发言。" }),
      normalizeActivity({ title: "（示例）班级团建 · 秋游", category: "团建", location: "近郊公园", activity_at: iso(12), tags: ["自愿"] }),
      normalizeActivity({ title: "（示例）志愿服务 · 社区清洁", category: "志愿", location: "社区服务中心", activity_at: iso(-5), tags: [] })
    ];
  }
  function defaultConfig() {
    return {
      title: C.site.title,
      semester: C.site.semester,
      announcement: C.site.announcement,
      class_name: C.site.className || "名不虚传播学班"
    };
  }

  var local = {
    loadConfig: function () { return Promise.resolve(lsGet(LS.CONFIG, null) || defaultConfig()); },
    loadTasks: function () {
      var t = lsGet(LS.TASKS, null);
      if (!t) { t = seedTasks(); lsSet(LS.TASKS, t); }
      return Promise.resolve(t.map(normalizeTask));
    },
    loadComments: function () {
      return Promise.resolve((lsGet(LS.COMMENTS, []) || []).map(normalizeComment));
    },
    createTask: function (data) {
      var all = (lsGet(LS.TASKS, []) || []);
      var t = normalizeTask(data); t.updated_at = new Date().toISOString();
      all.push(t); lsSet(LS.TASKS, all);
      return Promise.resolve(t);
    },
    updateTask: function (id, p) {
      var all = (lsGet(LS.TASKS, []) || []);
      var hit = null;
      all = all.map(function (t) {
        if (t.id !== id) return t;
        hit = normalizeTask(Object.assign({}, t, p, { updated_at: new Date().toISOString() }));
        return hit;
      });
      lsSet(LS.TASKS, all);
      return hit ? Promise.resolve(hit) : Promise.reject(new Error("任务不存在"));
    },
    deleteTask: function (id) {
      var all = (lsGet(LS.TASKS, []) || []).filter(function (t) { return t.id !== id; });
      lsSet(LS.TASKS, all);
      return Promise.resolve(true);
    },
    createComment: function (data) {
      var all = (lsGet(LS.COMMENTS, []) || []);
      var c = normalizeComment(data);
      if (!c.content) return Promise.reject(new Error("内容不能为空"));
      all.unshift(c); lsSet(LS.COMMENTS, all);
      return Promise.resolve(c);
    },
    hideComment: function (id) {
      var all = (lsGet(LS.COMMENTS, []) || []).map(function (c) { return c.id === id ? Object.assign({}, c, { is_hidden: true }) : c; });
      lsSet(LS.COMMENTS, all);
      return Promise.resolve(true);
    },
    saveConfig: function (obj) {
      lsSet(LS.CONFIG, Object.assign({}, defaultConfig(), obj || {}));
      return Promise.resolve(lsGet(LS.CONFIG, defaultConfig()));
    },
    loadActivities: function () {
      var a = lsGet(LS.ACTIVITIES, null);
      if (!a) { a = seedActivities(); lsSet(LS.ACTIVITIES, a); }
      return Promise.resolve(a.map(normalizeActivity));
    },
    createActivity: function (data) {
      var all = (lsGet(LS.ACTIVITIES, []) || []);
      var a = normalizeActivity(data); a.updated_at = new Date().toISOString();
      all.push(a); lsSet(LS.ACTIVITIES, all);
      return Promise.resolve(a);
    },
    updateActivity: function (id, p) {
      var all = (lsGet(LS.ACTIVITIES, []) || []);
      var hit = null;
      all = all.map(function (a) {
        if (a.id !== id) return a;
        hit = normalizeActivity(Object.assign({}, a, p, { updated_at: new Date().toISOString() }));
        return hit;
      });
      lsSet(LS.ACTIVITIES, all);
      return hit ? Promise.resolve(hit) : Promise.reject(new Error("活动不存在"));
    },
    deleteActivity: function (id) {
      var all = (lsGet(LS.ACTIVITIES, []) || []).filter(function (a) { return a.id !== id; });
      lsSet(LS.ACTIVITIES, all);
      return Promise.resolve(true);
    }
  };

  /* ---------- 云端后端（Supabase REST / PostgREST） ---------- */
  function rest(path, opt) {
    opt = opt || {};
    var base = C.supabaseUrl.replace(/\/+$/, "");
    var token = (App.auth && App.auth.accessToken && App.auth.accessToken()) || C.supabaseAnonKey;
    var headers = { "apikey": C.supabaseAnonKey, "Authorization": "Bearer " + token, "Accept": "application/json" };
    if (opt.body !== undefined) headers["Content-Type"] = "application/json";
    if (opt.prefer) headers["Prefer"] = opt.prefer;

    return fetch(base + "/rest/v1" + path, {
      method: opt.method || "GET",
      headers: headers,
      body: opt.body !== undefined ? JSON.stringify(opt.body) : undefined
    }).then(function (res) {
      return res.text().then(function (text) {
        if (!res.ok) {
          var msg = text;
          try { var j = JSON.parse(text); msg = j.message || j.hint || j.error_description || text; } catch (e) {}
          var err = new Error("请求失败(" + res.status + ")：" + String(msg).slice(0, 240));
          err.status = res.status;
          throw err;
        }
        if (!text) return null;
        try { return JSON.parse(text); } catch (e) { return null; }
      });
    });
  }

  var cloud = {
    loadConfig: function () {
      return rest("/site_config?select=key,value").then(function (rows) {
        var cfg = defaultConfig();
        (rows || []).forEach(function (r) { if (r && r.key) cfg[r.key] = r.value; });
        return cfg;
      });
    },
    loadTasks: function () {
      return rest("/tasks?select=*&order=ddl.asc.nullslast,created_at.asc").then(function (rows) {
        return (rows || []).map(normalizeTask);
      });
    },
    loadComments: function () {
      return rest("/comments?select=id,nickname,content,color,is_hidden,created_at&is_hidden=eq.false&order=created_at.desc&limit=200").then(function (rows) {
        return (rows || []).map(normalizeComment);
      });
    },
    createTask: function (data) {
      var body = {
        title: data.title, course: data.course || "", detail: data.detail || "",
        ddl: data.ddl || null, priority: data.priority || "mid", status: data.status || "todo",
        tags: data.tags || [], sort_order: data.sort_order || 0,
        repeat_rule: data.repeat_rule || "", weekday: data.weekday || null
      };
      return rest("/tasks", { method: "POST", body: body, prefer: "return=representation" })
        .then(function (rows) { if (!rows || !rows[0]) throw new Error("创建失败：无返回数据"); return normalizeTask(rows[0]); });
    },
    updateTask: function (id, p) {
      var body = {};
      ["title", "course", "detail", "ddl", "priority", "status", "tags", "sort_order", "repeat_rule", "weekday"].forEach(function (k) {
        if (p[k] !== undefined) body[k] = p[k];
      });
      return rest("/tasks?id=eq." + encodeURIComponent(id), { method: "PATCH", body: body, prefer: "return=representation" })
        .then(function (rows) { if (!rows || !rows[0]) throw new Error("更新失败：任务不存在或无权限"); return normalizeTask(rows[0]); });
    },
    deleteTask: function (id) {
      return rest("/tasks?id=eq." + encodeURIComponent(id), { method: "DELETE" }).then(function () { return true; });
    },
    createComment: function (data) {
      var body = { nickname: data.nickname || "访客", content: data.content, color: data.color || "#7cc4ff" };
      return rest("/comments", { method: "POST", body: body, prefer: "return=representation" })
        .then(function (rows) { if (!rows || !rows[0]) throw new Error("发送失败：无返回数据"); return normalizeComment(rows[0]); });
    },
    hideComment: function (id) {
      return rest("/comments?id=eq." + encodeURIComponent(id), { method: "PATCH", body: { is_hidden: true }, prefer: "return=representation" })
        .then(function () { return true; });
    },
    saveConfig: function (obj) {
      var rows = Object.keys(obj || {}).map(function (k) { return { key: k, value: obj[k] }; });
      if (!rows.length) return Promise.resolve({});
      return rest("/site_config", { method: "POST", body: rows, prefer: "resolution=merge-duplicates,return=representation" })
        .then(function () { return obj; });
    },
    loadActivities: function () {
      return rest("/activities?select=*&order=activity_at.asc.nullslast,created_at.asc").then(function (rows) {
        return (rows || []).map(normalizeActivity);
      });
    },
    createActivity: function (data) {
      var body = {
        title: data.title, category: data.category || "", location: data.location || "",
        detail: data.detail || "", activity_at: data.activity_at || null, tags: data.tags || []
      };
      return rest("/activities", { method: "POST", body: body, prefer: "return=representation" })
        .then(function (rows) { if (!rows || !rows[0]) throw new Error("创建失败：无返回数据"); return normalizeActivity(rows[0]); });
    },
    updateActivity: function (id, p) {
      var body = {};
      ["title", "category", "location", "detail", "activity_at", "tags"].forEach(function (k) {
        if (p[k] !== undefined) body[k] = p[k];
      });
      return rest("/activities?id=eq." + encodeURIComponent(id), { method: "PATCH", body: body, prefer: "return=representation" })
        .then(function (rows) { if (!rows || !rows[0]) throw new Error("更新失败：活动不存在或无权限"); return normalizeActivity(rows[0]); });
    },
    deleteActivity: function (id) {
      return rest("/activities?id=eq." + encodeURIComponent(id), { method: "DELETE" }).then(function () { return true; });
    }
  };

  var backend = state.mode === "cloud" ? cloud : local;

  /* ---------- 同步 ---------- */
  function applyData(tasks, activities, comments) {
    state.tasks = tasks;
    state.activities = activities;
    state.comments = comments;
    state.loading = false;
    state.online = true;
    state.error = null;
    state.lastSync = Date.now();
    lsSet(LS.CACHE_T, tasks);
    lsSet(LS.CACHE_A, activities);
    lsSet(LS.CACHE_C, comments);
  }

  function syncOnce() {
    return Promise.all([backend.loadTasks(), backend.loadActivities(), backend.loadComments()]).then(function (res) {
      applyData(res[0], res[1], res[2]);
      emit("sync");
      return true;
    }).catch(function (e) {
      state.online = false;
      state.error = e.message || String(e);
      emit("error");
      throw e;
    });
  }

  function init() {
    /* 先把上次缓存喂进去，刷新立即可见（即使此刻断网） */
    var ct = lsGet(LS.CACHE_T, null);
    var ca = lsGet(LS.CACHE_A, null);
    var cc = lsGet(LS.CACHE_C, null);
    if (ct) state.tasks = ct.map(normalizeTask);
    if (ca) state.activities = ca.map(normalizeActivity);
    if (cc) state.comments = cc.map(normalizeComment);

    var load = Promise.all([backend.loadConfig(), backend.loadTasks(), backend.loadActivities(), backend.loadComments()])
      .then(function (res) {
        state.config = res[0] || defaultConfig();
        applyData(res[1], res[2], res[3]);
        emit("sync");
        return state;
      })
      .catch(function (e) {
        state.loading = false;
        state.online = false;
        state.error = e.message || String(e);
        emit("error");
        throw e;
      });

    if (state.mode === "cloud") { startPolling(); startRealtime(); }
    else {
      /* 本地演示：如果之前进过作者模式，恢复作者权限 */
      if (lsGet(LS.ADMIN, false) === true) {
        App.auth.setCaps({ author: true, email: "local@demo" });
      }
      setupLocalSync();
    }
    return load;
  }

  /* ---------- 轮询（云端实时性兜底，带指数退避） ---------- */
  function schedule() {
    clearTimeout(timers.poll);
    timers.poll = setTimeout(tick, timers.backoff);
  }
  function tick() {
    if (document.hidden) { schedule(); return; }
    syncOnce().then(function () {
      timers.backoff = C.site.pollIntervalMs;
    }).catch(function () {
      timers.backoff = Math.min(Math.max(timers.backoff, 1000) * 1.6, 120000);
    }).then(schedule);
  }
  function startPolling() { schedule(); }
  function stopPolling() { clearTimeout(timers.poll); timers.poll = null; }

  /* ---------- 实时推送（Supabase Realtime 变更）→ 触发一次重新同步 ---------- */
  var realtimePending = null;
  function startRealtime() {
    if (!App.realtime || !App.realtime.start) return;
    App.realtime.start(function () {
      if (realtimePending) return;              // 合并短时间内的多次变更
      realtimePending = setTimeout(function () {
        realtimePending = null;
        syncOnce().catch(function () {});
      }, 350);
    });
  }

  /* 多标签页/窗口同步（本地模式） */
  function setupLocalSync() {
    window.addEventListener("storage", function (e) {
      if (!e.key) return;
      if (e.key === LS.TASKS || e.key === LS.ACTIVITIES || e.key === LS.COMMENTS || e.key === LS.CONFIG) {
        Promise.all([backend.loadTasks(), backend.loadActivities(), backend.loadComments(), backend.loadConfig()]).then(function (res) {
          state.config = res[3] || defaultConfig();
          applyData(res[0], res[1], res[2]);
          emit("sync");
        }).catch(function () {});
      }
    });
  }

  /* ---------- 对外接口 ---------- */
  function guardAdmin() {
    return state.mode === "cloud" && !(App.auth && App.auth.isSignedIn());
  }

  /* ---------- 权限（本版本：所有作者权限相同） ---------- */
  function caps() {
    return (App.auth && App.auth.getCaps) ? App.auth.getCaps() : { author: false, email: "" };
  }
  function isAuthor() { return !!caps().author; }

  return {
    state: state,
    on: on,
    init: init,
    refresh: syncOnce,
    startPolling: startPolling,
    stopPolling: stopPolling,

    isCloud: function () { return state.mode === "cloud"; },
    caps: caps,
    isAuthor: isAuthor,

    createTask: function (data) {
      if (guardAdmin()) return Promise.reject(new Error("请先登录作者账号"));
      return backend.createTask(data);
    },
    updateTask: function (id, p) {
      if (guardAdmin()) return Promise.reject(new Error("请先登录作者账号"));
      return backend.updateTask(id, p);
    },
    deleteTask: function (id) {
      if (guardAdmin()) return Promise.reject(new Error("请先登录作者账号"));
      return backend.deleteTask(id);
    },
    createActivity: function (data) {
      if (guardAdmin()) return Promise.reject(new Error("请先登录作者账号"));
      return backend.createActivity(data);
    },
    updateActivity: function (id, p) {
      if (guardAdmin()) return Promise.reject(new Error("请先登录作者账号"));
      return backend.updateActivity(id, p);
    },
    deleteActivity: function (id) {
      if (guardAdmin()) return Promise.reject(new Error("请先登录作者账号"));
      return backend.deleteActivity(id);
    },
    createComment: function (data) { return backend.createComment(data); },
    hideComment: function (id) {
      if (guardAdmin()) return Promise.reject(new Error("请先登录作者账号"));
      return backend.hideComment(id);
    },
    saveConfig: function (obj) {
      if (guardAdmin()) return Promise.reject(new Error("请先登录作者账号"));
      return backend.saveConfig(obj).then(function () {
        Object.keys(obj || {}).forEach(function (k) { state.config[k] = obj[k]; });
        emit("config");
        return true;
      });
    },

    isAdmin: function () { return isAuthor(); },
    setLocalAdmin: function (on) {
      lsSet(LS.ADMIN, !!on);
      App.auth.setCaps(on ? { author: true, email: "local@demo" } : null);
      emit("auth");
    }
  };
})();
