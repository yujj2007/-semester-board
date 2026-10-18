/* 学期任务站 · 站点配置
 * ------------------------------------------------------------------
 * 部署前把 supabaseUrl / supabaseAnonKey 填上，即进入「云端模式」；
 * 留空则以「本地演示模式」运行（数据只存在本机浏览器，刷新不丢失）。
 *
 * 安全说明：anonKey 是公开密钥，本来就设计为可公开。
 * 真正的写权限由 Supabase 的 RLS（行级安全）在数据库层拦截，
 * 只有你登录后的账号才能增删改任务，别人改了前端代码也写不进数据。
 * ------------------------------------------------------------------ */
window.App = window.App || {};

App.CONFIG = {
  // ① 形如 https://xxxxxxxx.supabase.co（带不带 /rest/v1 都能识别）
  supabaseUrl: "https://qdpwebkslgyvbnmnhbwn.supabase.co",
  // ② Supabase 项目里的 anon public key
  supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFkcHdlYmtzbGd5dmJubW5oYnduIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE5ODM4MjIsImV4cCI6MjEwNzU1OTgyMn0.DvmANQH2b3NZIk8ttmqKuDEEnff9qLwEUVyrpng0VjE",

  // 本地演示模式下进入「作者模式」的密码（仅供预览，不影响云端权限）
  demoAdminPassword: "admin",

  site: {
    className: "名不虚传播学班",
    title: "本学期学习任务",
    semester: "2026 春",
    announcement: "任务由作者实时维护；任何人可浏览全部内容，并在下方发弹幕互动。",
    danmakuReplay: 24,        // 刷新后回放最近多少条弹幕
    pollIntervalMs: 15000,    // 云端轮询间隔（实时推送掉线时的兜底）
    overdueKeepDays: 4        // 逾期多少天后，从任务清单移入「已逾期」折叠区
  },

  // 预留功能开关：以后加需求时，改这里即可，不用动其它代码
  featureFlags: {
    danmaku: true,
    calendar: false,
    exportIcs: false
  }
};

App.isCloudMode = function () {
  return !!(App.CONFIG.supabaseUrl && App.CONFIG.supabaseAnonKey);
};

/* 容错归一化：不管粘贴的是
 *   https://xxx.supabase.co
 *   https://xxx.supabase.co/
 *   https://xxx.supabase.co/rest/v1
 *   https://xxx.supabase.co/rest/v1/
 * 都能正确识别。*/
App.CONFIG.supabaseUrl = String(App.CONFIG.supabaseUrl || "")
  .trim()
  .replace(/\/+$/, "")
  .replace(/\/rest\/v1$/i, "")
  .replace(/\/+$/, "");
App.CONFIG.supabaseAnonKey = String(App.CONFIG.supabaseAnonKey || "").trim();
