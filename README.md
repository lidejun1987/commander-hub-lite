# Commander Hub Lite

> A central command panel for Obsidian: project tabs, smart parsing, priority, search filter, Daily-note integration, auto-backup, and stats.

[English](#english) | [中文](#中文)

---

## English

A lightweight task & memo hub for people who juggle multiple projects in a single vault. Originally built to manage on-site engineering work across many parallel projects, but the data model is generic — works just as well for personal projects, study, freelance, etc.

### Features

- 🗂️ **Project tabs** — Group tasks/memos by project; switch with one click. Each project gets its own color
- ✨ **Smart parsing** — Type `Tomorrow 19:00 team standup P0 #meeting` and the plugin extracts date, time, priority, and tags
- 🆔 **Permanent sequence numbers** — `T1`, `T2`, `M1`, `M2`… numbers never reuse, even after deletion. Reference items by ID in conversation
- 🎚️ **Priority levels** — P0 / P1 / P2 / P3, color-coded
- 🔎 **Search & filter** — Full-text search + filter by status / priority / project
- 📅 **Daily note integration** — Pull `- [ ]` checkboxes from today's Daily note into the hub
- 📤 **Markdown export** — One-click export to a timeline note
- 💾 **Triple-layer backup** — Daily snapshot + monthly archive + auto-backup before each destructive op
- 📊 **Stats** — See completion rates per project, distribution by priority, etc.
- 🌓 **Compact mode** — Toggle dense layout for power users

### Installation

#### Manual install

1. Download `main.js`, `manifest.json`, `styles.css` from the latest release
2. Place them under `<your-vault>/.obsidian/plugins/commander-hub/`
3. Reload Obsidian → enable in **Settings → Community plugins**

### Commands

Available in the command palette (`Ctrl+P` / `Cmd+P`):

| Command | Action |
|---------|--------|
| Open Commander Hub | Activate the main view |
| Export Commander Hub to Markdown | Save current state as a timeline note |
| Import todos from today's Daily | Pull `- [ ]` items into the hub |
| Backup now | Force-trigger a snapshot |

There is also a ribbon icon in the left sidebar for quick access.

### Settings

| Setting | Description |
|---------|-------------|
| Export directory | Where Markdown exports are written |
| Timeline note filename | Filename pattern for exports |
| Daily path template | Path pattern matching your Daily-notes folder |
| Default priority | Used when smart-parse can't detect one |
| Backup retention days | How long to keep backup snapshots |
| Show completed tasks | Toggle for visibility |
| Compact mode | Dense list layout |
| Enable smart parsing | Toggle the natural-language input parser |

### Smart parsing examples

```
Tomorrow 9am client call P0 #external
Friday submit weekly report
Next Mon 14:30 design review @site-A P1
```

Recognized:
- Dates: today / tomorrow / next Mon / 5/30 / 2026-06-01
- Times: 9am / 14:30 / 19:00
- Priority: P0 / P1 / P2 / P3
- Tags: `#tag-name`
- Project: `@project-name`

### Data & privacy

- All data lives in your vault under `.obsidian/plugins/commander-hub/data.json`
- The plugin does **not** make any network requests
- Backups are written under `.obsidian/plugins/commander-hub/backup/`
- `data.json` and `backup/` are listed in `.gitignore` and never get committed when you fork this repo

### License

MIT — see [LICENSE](LICENSE)

### Support / 支持作者

If this plugin helps you, consider [sponsoring development](SPONSORS.md) — WeChat / Afdian (爱发电) / GitHub Sponsors all welcome.

如果觉得有用，欢迎到 [SPONSORS.md](SPONSORS.md) 通过微信赞赏 / 爱发电 / GitHub Sponsors 支持作者。

### Contributing

Issues and PRs welcome. Please don't include your real `data.json` or any personal task content when filing bug reports — strip or redact it first.

---

## 中文

一个轻量的「任务 / 备忘」中枢插件，为同时管理多个项目的人设计。最早是为现场工程管理打造的，但数据模型完全通用 —— 个人项目、学习、副业都能用。

### 核心能力

- 🗂️ **项目 Tab**：按项目分组，一键切换，每个项目独立颜色
- ✨ **智能解析**：输入「明天 19:00 团队例会 P0 #会议」，自动提取日期、时间、优先级、标签
- 🆔 **永久序号**：`T1`/`T2`/`M1`/`M2`… 删除不缩水，沟通时直接报序号
- 🎚️ **优先级**：P0–P3，颜色区分
- 🔎 **搜索过滤**：全文搜索 + 状态/优先级/项目过滤
- 📅 **Daily 联动**：把今日 Daily 笔记里的 `- [ ]` 吸进枢纽
- 📤 **导出 Markdown**：一键生成时间线笔记
- 💾 **三重备份**：每日快照 + 月度归档 + 操作前自动备份
- 📊 **统计图表**：项目完成率、优先级分布
- 🌓 **紧凑模式**：高密度列表

### 安装

下载 release 中的 `main.js`、`manifest.json`、`styles.css`，放到 `<你的vault>/.obsidian/plugins/commander-hub/`，然后在 Obsidian 设置 → 第三方插件中启用。

### 隐私

- 所有数据存在 `.obsidian/plugins/commander-hub/data.json`
- 插件**完全不联网**
- 备份在 `.obsidian/plugins/commander-hub/backup/`
- `data.json` 和 `backup/` 已加入 `.gitignore`，fork 仓库时不会被带走

### License

MIT
