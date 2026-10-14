# 学期任务站

一个**公开只读 + 作者可写 + 弹幕评论**的学期学习任务看板。

- 任何人打开网址即可浏览本学期任务与 DDL，并在底部发弹幕互动。
- 只有作者登录后能增 / 删 / 改任务、隐藏评论。
- 零构建、零外部依赖；断网/后端异常时显示缓存，刷新永不白屏。

## 快速开始

| 想做什么 | 看这里 |
|---|---|
| 先看看长什么样 | 双击 `index.html`（本地演示模式，作者密码 `admin`） |
| 让作者能实时改、别人能共享 | `docs/部署指南.md` 的 **B. 接入 Supabase** |
| 发布公开网址 | `docs/部署指南.md` 的 **C. 发布到 GitHub Pages** |

## 结构

```
index.html            页面
assets/styles.css     样式
src/                  配置 / 数据 / 认证 / 弹幕 / 任务 / 评论
supabase/schema.sql   数据库初始化（建表 + 权限）
docs/                 设计文档 & 部署指南
```

## 配置入口

- `src/config.js` —— 填 Supabase 地址与 anon key、站点文案、功能开关。
- `supabase/schema.sql` —— 把 `is_admin()` 里的 `you@example.com` 改成你的登录邮箱。

详细说明见 `docs/设计文档.md`。
