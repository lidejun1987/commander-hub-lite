const obsidian = require('obsidian');

// ==================== 常量与默认配置 ====================
const VIEW_TYPE = "commander-hub-view";
const PLUGIN_VERSION = "3.4.3";
const ALL_PROJECTS = "__all__";

const DEFAULT_SETTINGS = {
    todos: [],
    memos: [],
    projects: [], // [{ id, name, color }]
    activeProject: ALL_PROJECTS,
    counters: { todo: 0, memo: 0 }, // 累计计数器：永不回滚
    config: {
        exportDir: "Logs/Commander Hub",
        exportFileName: "工作指挥官笔记.md",
        dailyTemplate: "0. 周期笔记/{yyyy}/Daily/{MM}/{yyyy}-{MM}-{dd}.md",
        backupDays: 7,
        showCompleted: true,
        compactMode: false,
        defaultPriority: "P2",
        smartParse: true
    }
};

const PRIORITY_META = {
    P0: { label: "P0 紧急", color: "#ff3333", weight: 0 },
    P1: { label: "P1 高",   color: "#ff8800", weight: 1 },
    P2: { label: "P2 中",   color: "#888888", weight: 2 },
    P3: { label: "P3 低",   color: "#bbbbbb", weight: 3 }
};

const PROJECT_COLORS = ["#1976d2", "#2e7d32", "#c2185b", "#f57c00", "#6a1b9a", "#00838f", "#5d4037", "#455a64"];

// ==================== 工具函数 ====================
function todayStr() {
    return new Date().toISOString().split('T')[0];
}
function nowStr() {
    return new Date().toLocaleString();
}
function pad(n) { return String(n).padStart(2, '0'); }
function isoDate(d) { return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }

// 从 memo.time（toLocaleString 输出）解析出 yyyy-mm-dd 日期键
function memoDateKey(m) {
    if (!m || !m.time) return todayStr();
    const head = String(m.time).split(/[\s,]+/)[0];
    const parts = head.split(/[\/\-]/).map(Number);
    if (parts.length !== 3 || parts.some(Number.isNaN)) return todayStr();
    let y, mo, d;
    if (parts[0] > 31) { [y, mo, d] = parts; }   // YYYY/M/D 或 YYYY-M-D
    else { [mo, d, y] = parts; }                 // M/D/YYYY (en-US)
    if (!y || !mo || !d) return todayStr();
    return `${y}-${pad(mo)}-${pad(d)}`;
}

// 把 yyyy-mm-dd 渲染为友好标签，标识今天/昨天 + 星期
function formatDateLabel(dateKey) {
    const today = todayStr();
    const d = new Date(dateKey + "T00:00:00");
    if (Number.isNaN(d.getTime())) return dateKey;
    const weekDay = ["周日","周一","周二","周三","周四","周五","周六"][d.getDay()];
    if (dateKey === today) return `今天 ${dateKey} ${weekDay}`;
    const yest = new Date();
    yest.setDate(yest.getDate() - 1);
    if (dateKey === isoDate(yest)) return `昨天 ${dateKey} ${weekDay}`;
    return `${dateKey} ${weekDay}`;
}

// 让 textarea 根据内容自动撑高（min~max 之间），超过 max 出滚动条
// component 参数可选，传入则用 registerDomEvent 让 Obsidian 自动清理事件监听
function autoGrowTextarea(el, opts = {}, component = null) {
    const min = opts.min || 40;
    const max = opts.max || 320;
    // 强制覆盖外部 CSS（防 resize/height 被主题压住）
    el.style.setProperty("resize", "none", "important");
    el.style.setProperty("box-sizing", "border-box", "important");
    el.style.setProperty("flex-shrink", "0", "important");
    el.style.setProperty("display", "block", "important");
    el.style.setProperty("min-height", min + "px", "important");
    el.style.setProperty("max-height", max + "px", "important");

    const fit = () => {
        // 关键：先解除 min-height 约束 + 设 height auto，让 scrollHeight 反映真实内容高度
        // （否则删除内容后 scrollHeight 会被 min-height 兜住，无法缩回）
        el.style.setProperty("min-height", "0", "important");
        el.style.setProperty("height", "auto", "important");
        const sh = el.scrollHeight;
        const target = Math.min(Math.max(sh, min), max);
        el.style.setProperty("min-height", min + "px", "important");
        el.style.setProperty("height", target + "px", "important");
        el.style.setProperty("overflow-y", sh > max ? "auto" : "hidden", "important");
    };
    const onPaste = () => requestAnimationFrame(fit);
    if (component && typeof component.registerDomEvent === "function") {
        component.registerDomEvent(el, "input", fit);
        component.registerDomEvent(el, "change", fit);
        component.registerDomEvent(el, "focus", fit);
        component.registerDomEvent(el, "paste", onPaste);
    } else {
        // Fallback：textarea 销毁时 listener 会随 DOM 一起 GC
        el.addEventListener("input", fit);
        el.addEventListener("change", fit);
        el.addEventListener("focus", fit);
        el.addEventListener("paste", onPaste);
    }
    // 初始执行 + 下一帧再执行一次（确保 DOM/CSS 稳定后量得到准确高度）
    fit();
    if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(() => { fit(); requestAnimationFrame(fit); });
    } else {
        setTimeout(fit, 16);
    }
    el._cmdFit = fit;
    return fit;
}

function resolveDailyPath(template, date) {
    const d = date instanceof Date ? date : new Date(date);
    return template
        .replace(/\{yyyy\}/g, d.getFullYear())
        .replace(/\{MM\}/g, pad(d.getMonth() + 1))
        .replace(/\{dd\}/g, pad(d.getDate()));
}

function extractTags(text) {
    // 真标签：必须前面是空白/字符串开头/中文标点（避免误把工程编号 "1#"、"5#墩台" 当成标签）
    // 标签终止符：空白、#、中英文标点
    const result = [];
    const re = /(^|[\s，。；、！？：（）【】「」""''《》,.;!?:()\[\]<>])#([^\s#，。；、！？：（）【】「」""''《》,.;!?:()\[\]<>]+)/g;
    let m;
    while ((m = re.exec(text)) !== null) {
        if (m[2] && m[2].length > 0) result.push(m[2]);
    }
    return result;
}

// ==================== 智能解析 ====================
// 输入："明天 19:00 公司例会 P0 #会议 @长河一号桥"
// 输出：{ text, date, priority, tags, projectId? }
function smartParse(raw, settings) {
    const result = { text: raw, date: null, priority: null, tags: [], projectId: null, hits: [] };
    let s = raw;
    const today = new Date(); today.setHours(0,0,0,0);

    // 优先级 P0~P3
    const priM = s.match(/\b(P[0-3])\b/i);
    if (priM) {
        result.priority = priM[1].toUpperCase();
        result.hits.push(`优先级=${result.priority}`);
        s = s.replace(priM[0], "").trim();
    }

    // 项目 @项目名
    const projM = s.match(/@([^\s@]+)/);
    if (projM) {
        const name = projM[1];
        const proj = (settings.projects || []).find(p => p.name === name || p.id === name);
        if (proj) {
            result.projectId = proj.id;
            result.hits.push(`项目=${proj.name}`);
            s = s.replace(projM[0], "").trim();
        }
    }

    // 日期：YYYY-MM-DD
    const isoM = s.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    if (isoM) {
        result.date = isoM[1];
        result.hits.push(`日期=${result.date}`);
        s = s.replace(isoM[0], "").trim();
    }

    // 自然语言日期
    if (!result.date) {
        const dayMap = { "周日": 0, "周一": 1, "周二": 2, "周三": 3, "周四": 4, "周五": 5, "周六": 6 };
        const wkM = s.match(/(下下?周|本周|周)([日一二三四五六])/);
        if (wkM) {
            const target = dayMap["周" + wkM[2]];
            const d = new Date(today);
            const cur = d.getDay();
            let diff = (target + 7 - cur) % 7;
            if (wkM[1] === "下周") diff = diff === 0 ? 7 : diff + 7;
            else if (wkM[1] === "下下周") diff = (diff === 0 ? 7 : diff) + 14;
            else if (diff === 0) diff = 7; // 默认未来
            d.setDate(d.getDate() + diff);
            result.date = isoDate(d);
            result.hits.push(`日期=${result.date}(${wkM[0]})`);
            s = s.replace(wkM[0], "").trim();
        } else {
            const rel = [
                { re: /今天|今日/, days: 0 },
                { re: /明天|明日/, days: 1 },
                { re: /后天/, days: 2 },
                { re: /大后天/, days: 3 }
            ];
            for (const r of rel) {
                const m = s.match(r.re);
                if (m) {
                    const d = new Date(today);
                    d.setDate(d.getDate() + r.days);
                    result.date = isoDate(d);
                    result.hits.push(`日期=${result.date}(${m[0]})`);
                    s = s.replace(m[0], "").trim();
                    break;
                }
            }
        }
        // N天后
        if (!result.date) {
            const nM = s.match(/(\d+)\s*天[后之]后?/);
            if (nM) {
                const d = new Date(today);
                d.setDate(d.getDate() + parseInt(nM[1]));
                result.date = isoDate(d);
                result.hits.push(`日期=${result.date}(${nM[0]})`);
                s = s.replace(nM[0], "").trim();
            }
        }
        // M月D日 / M-D
        if (!result.date) {
            const mdM = s.match(/(\d{1,2})[月\-\/](\d{1,2})[日号]?/);
            if (mdM) {
                const m = parseInt(mdM[1]); const d = parseInt(mdM[2]);
                const dt = new Date(today.getFullYear(), m - 1, d);
                if (dt < today) dt.setFullYear(dt.getFullYear() + 1);
                result.date = isoDate(dt);
                result.hits.push(`日期=${result.date}(${mdM[0]})`);
                s = s.replace(mdM[0], "").trim();
            }
        }
    }

    // 标签 #xxx 保留在文本里，但同时收集
    result.tags = extractTags(s);
    if (result.tags.length) result.hits.push(`标签=${result.tags.map(x => "#"+x).join(",")}`);

    // 清理多余空格
    result.text = s.replace(/\s+/g, " ").trim();
    return result;
}

// 备忘录智能解析：只提取 @项目 和 #标签，不修改文本
function smartParseMemo(raw, settings) {
    const result = { content: raw, projectId: null, tags: [], hits: [] };
    // 标签
    result.tags = extractTags(raw);
    if (result.tags.length) result.hits.push(`标签=${result.tags.map(x => "#"+x).join(",")}`);
    // 项目（取第一个匹配的存在项目名）
    const projMatches = raw.match(/@([^\s@]+)/g) || [];
    for (const m of projMatches) {
        const name = m.slice(1);
        const proj = (settings.projects || []).find(p => p.name === name || p.id === name);
        if (proj) {
            result.projectId = proj.id;
            result.hits.push(`项目=${proj.name}`);
            break;
        }
    }
    return result;
}

// 任务对象统一字段
function ensureTodoShape(t) {
    return {
        id: t.id || `t_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        seq: typeof t.seq === "number" ? t.seq : null,
        text: t.text || "",
        date: t.date || todayStr(),
        done: !!t.done,
        priority: t.priority || "P2",
        tags: Array.isArray(t.tags) ? t.tags : extractTags(t.text || ""),
        projectId: t.projectId || null,
        createdAt: t.createdAt || nowStr(),
        completedAt: t.completedAt || null
    };
}

function ensureMemoShape(m) {
    return {
        id: m.id || `m_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        seq: typeof m.seq === "number" ? m.seq : null,
        content: m.content || "",
        time: m.time || nowStr(),
        tags: Array.isArray(m.tags) ? m.tags : extractTags(m.content || ""),
        projectId: m.projectId || null
    };
}

function ensureProjectShape(p, idx = 0) {
    return {
        id: p.id || `p_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: p.name || "未命名项目",
        color: p.color || PROJECT_COLORS[idx % PROJECT_COLORS.length]
    };
}

module.exports = class CommanderHubPlugin extends obsidian.Plugin {

    async onload() {
        const data = await this.loadData();
        this.settings = Object.assign({}, DEFAULT_SETTINGS, data || {});
        this.settings.config = Object.assign({}, DEFAULT_SETTINGS.config, (data && data.config) || {});
        this.settings.counters = Object.assign({ todo: 0, memo: 0 }, (data && data.counters) || {});
        this.settings.projects = ((data && data.projects) || []).map((p, i) => ensureProjectShape(p, i));
        this.settings.activeProject = (data && data.activeProject) || ALL_PROJECTS;
        this.settings.todos = (this.settings.todos || []).map(ensureTodoShape).map(t => {
            t.tags = extractTags(t.text || "");
            return t;
        });
        this.settings.memos = (this.settings.memos || []).map(ensureMemoShape).map(m => {
            m.tags = extractTags(m.content || "");
            return m;
        });

        // 回填历史序号：当前列表"最新在前"，从数组末尾（最早）开始分配 1, 2, 3...
        this.backfillSeq();

        await this.saveSettings(false);

        // 注册 CP 图标
        obsidian.addIcon("commander-hub-cp",
            `<text x="50" y="62" text-anchor="middle" font-size="56" font-weight="700" font-family="Arial, sans-serif" fill="currentColor" stroke="currentColor" stroke-width="1">CP</text>`
        );

        this.registerView(VIEW_TYPE, (leaf) => new CommanderHubView(leaf, this));
        this.addRibbonIcon("commander-hub-cp", "指挥官枢纽", () => this.activateView());

        // 命令面板
        this.addCommand({ id: "open", name: "打开指挥官枢纽", callback: () => this.activateView() });
        this.addCommand({ id: "export", name: "导出指挥官枢纽到 Markdown", callback: () => this.exportToMarkdown() });
        this.addCommand({ id: "import-from-daily", name: "从今日 Daily 导入待办", callback: () => this.importFromDaily() });
        this.addCommand({ id: "backup", name: "立即备份数据", callback: () => this.backupNow(true) });

        // 添加设置面板
        this.addSettingTab(new CommanderHubSettingTab(this.app, this));
    }

    async saveSettings(refresh = true) {
        await this.saveData(this.settings);
        if (refresh) this.refreshViews();
    }

    // 回填历史序号：列表"最新在前"，从末尾（最早项）开始倒序分配
    backfillSeq() {
        const c = this.settings.counters;
        // todos：从数组末尾开始 = 最早 = seq 1
        const todos = this.settings.todos;
        for (let i = todos.length - 1; i >= 0; i--) {
            if (typeof todos[i].seq !== "number" || todos[i].seq <= 0) {
                c.todo += 1;
                todos[i].seq = c.todo;
            } else if (todos[i].seq > c.todo) {
                c.todo = todos[i].seq;
            }
        }
        const memos = this.settings.memos;
        for (let i = memos.length - 1; i >= 0; i--) {
            if (typeof memos[i].seq !== "number" || memos[i].seq <= 0) {
                c.memo += 1;
                memos[i].seq = c.memo;
            } else if (memos[i].seq > c.memo) {
                c.memo = memos[i].seq;
            }
        }
    }

    nextSeq(type) {
        this.settings.counters[type] = (this.settings.counters[type] || 0) + 1;
        return this.settings.counters[type];
    }

    refreshViews() {
        this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach(leaf => {
            if (leaf.view && typeof leaf.view.renderAll === "function") leaf.view.renderAll();
        });
    }

    async activateView() {
        const { workspace } = this.app;
        let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0] || workspace.getRightLeaf(false);
        await leaf.setViewState({ type: VIEW_TYPE, active: true });
        workspace.revealLeaf(leaf);
    }

    // ==================== 备份 ====================
    async backupNow(showNotice = false) {
        try {
            const adapter = this.app.vault.adapter;
            const dir = `${this.manifest.dir}/backup`;
            if (!(await adapter.exists(dir))) await adapter.mkdir(dir);
            const today = todayStr();
            const file = `${dir}/data-${today}.json`;
            await adapter.write(file, JSON.stringify(this.settings, null, 2));
            // 清理过期
            const list = await adapter.list(dir);
            const files = (list.files || []).filter(f => /data-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
            const keep = this.settings.config.backupDays || 7;
            while (files.length > keep) {
                const old = files.shift();
                await adapter.remove(old);
            }
            if (showNotice) new obsidian.Notice(`✅ 已备份到 ${file}`, 3000);
        } catch (e) {
            console.error("[Commander Hub] backup failed", e);
            if (showNotice) new obsidian.Notice(`❌ 备份失败：${e.message}`, 4000);
        }
    }

    // ==================== Daily 联动 ====================
    async importFromDaily() {
        const path = resolveDailyPath(this.settings.config.dailyTemplate, new Date());
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof obsidian.TFile)) {
            new obsidian.Notice(`❌ 未找到 Daily：${path}`, 4000);
            return;
        }
        const text = await this.app.vault.read(file);
        const lines = text.split("\n");
        let imported = 0;
        const existing = new Set(this.settings.todos.map(t => t.text));
        for (const line of lines) {
            const m = line.match(/^\s*-\s*\[\s*(x|X|\s)\s*\]\s+(.+)$/);
            if (!m) continue;
            const done = m[1].toLowerCase() === "x";
            let content = m[2].trim();
            // 解析 📅 YYYY-MM-DD
            const dateMatch = content.match(/📅\s*(\d{4}-\d{2}-\d{2})/);
            const date = dateMatch ? dateMatch[1] : todayStr();
            content = content.replace(/📅\s*\d{4}-\d{2}-\d{2}/g, "").trim();
            if (!content || existing.has(content)) continue;
            this.settings.todos.unshift(ensureTodoShape({
                seq: this.nextSeq("todo"),
                text: content, date, done, priority: this.settings.config.defaultPriority
            }));
            existing.add(content);
            imported++;
        }
        if (imported > 0) await this.saveSettings();
        new obsidian.Notice(`📥 从 Daily 导入 ${imported} 条任务`, 3000);
    }

    async appendMemoToDaily(memo) {
        const path = resolveDailyPath(this.settings.config.dailyTemplate, new Date());
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof obsidian.TFile)) {
            new obsidian.Notice(`❌ 未找到 Daily：${path}`, 4000);
            return;
        }
        const old = await this.app.vault.read(file);
        const block = `\n\n> [!note] 🕒 ${memo.time}\n${memo.content.split("\n").map(l => "> " + l).join("\n")}\n`;
        await this.app.vault.modify(file, old.trimEnd() + block);
        new obsidian.Notice(`📤 已追加备忘到 ${path}`, 3000);
    }

    // ==================== 导出 Markdown（按天聚合） ====================
    async exportToMarkdown() {
        const today = todayStr();
        const now = nowStr();
        const timeOnly = new Date().toLocaleTimeString();
        const cfg = this.settings.config;
        const exportDir = cfg.exportDir;
        const fileName = cfg.exportFileName;

        const folder = this.app.vault.getAbstractFileByPath(exportDir);
        if (!folder) {
            try { await this.app.vault.createFolder(exportDir); } catch (e) {}
        }

        const todos = this.settings.todos || [];
        const memos = this.settings.memos || [];
        const overdue = todos.filter(t => !t.done && t.date < today);
        const upcoming = todos.filter(t => !t.done && t.date >= today);
        const completed = todos.filter(t => t.done);

        const fmtTodo = (t) => {
            const overdueMark = (!t.done && t.date < today) ? " ⚠️ **严重超时**" : "";
            const pri = t.priority && t.priority !== "P2" ? ` \`${t.priority}\`` : "";
            const tagStr = (t.tags && t.tags.length) ? " " + t.tags.map(x => `#${x}`).join(" ") : "";
            const proj = this.settings.projects.find(p => p.id === t.projectId);
            const projStr = proj ? ` \`@${proj.name}\`` : "";
            const seqStr = typeof t.seq === "number" ? ` \`T${t.seq}\`` : "";
            return `- [${t.done ? 'x' : ' '}]${seqStr}${pri}${projStr} ${t.text} 📅 ${t.date}${tagStr}${overdueMark}`;
        };

        const day = [];
        day.push(`## 📅 ${today}`, "");
        day.push(`*最近更新：${timeOnly}*`, "");
        day.push(`> 📊 概览：⚠️ 逾期 ${overdue.length} · 🟢 待办 ${upcoming.length} · ✅ 已完成 ${completed.length} · 📝 备忘 ${memos.length}`, "");

        if (overdue.length) { day.push("### ⚠️ 逾期任务"); overdue.forEach(t => day.push(fmtTodo(t))); day.push(""); }
        if (upcoming.length) { day.push("### 🟢 待办任务"); upcoming.forEach(t => day.push(fmtTodo(t))); day.push(""); }
        if (completed.length) { day.push("### ✅ 已完成任务"); completed.forEach(t => day.push(fmtTodo(t))); day.push(""); }
        if (memos.length) {
            day.push("### 📝 备忘录");
            memos.forEach(m => {
                const seqStr = typeof m.seq === "number" ? `M${m.seq} · ` : "";
                day.push(`> [!note] ${seqStr}🕒 ${m.time}`);
                m.content.split("\n").forEach(l => day.push(`> ${l}`));
                day.push("");
            });
        }
        day.push("---", "");

        const newDay = day.join("\n");
        const filePath = `${exportDir}/${fileName}`;
        const existing = this.app.vault.getAbstractFileByPath(filePath);
        const marker = "<!-- TIMELINE_INSERT_HERE -->";

        let actionMsg;
        let archivedCount = 0;
        if (existing instanceof obsidian.TFile) {
            const old = await this.app.vault.read(existing);
            const dayRegex = new RegExp(`^## 📅 ${today}[\\s\\S]*?(?=^## |\\Z)`, "m");
            let updated;
            if (dayRegex.test(old)) {
                updated = old.replace(dayRegex, newDay);
                actionMsg = `已更新 ${today} 章节`;
            } else if (old.includes(marker)) {
                updated = old.replace(marker, `${marker}\n\n${newDay}`);
                actionMsg = `已新增 ${today} 章节`;
            } else {
                updated = old.trimEnd() + "\n\n" + newDay;
                actionMsg = `已追加 ${today} 章节`;
            }
            updated = updated.replace(/^updated:.*$/m, `updated: ${now}`);

            // ===== 修剪：仅保留最近 2 个不同日期的章节，更早的归档 =====
            const trimmed = await this.trimAndArchive(updated, 2);
            archivedCount = trimmed.archivedCount;
            updated = trimmed.content;

            await this.app.vault.modify(existing, updated);
        } else {
            const header = [
                "---",
                "tags: [指挥官枢纽, 任务导出, 时间线]",
                `created: ${now}`,
                `updated: ${now}`,
                "---", "",
                "# 📋 指挥官枢纽 · 时间线", "",
                "> 本笔记由 Commander Hub Lite 自动维护，按天聚合。仅保留最近 2 个日期，更早章节归档至 backup/archive/。", "",
                marker, ""
            ].join("\n");
            await this.app.vault.create(filePath, header + "\n" + newDay);
            actionMsg = `已创建并写入 ${today} 章节`;
        }

        const tail = archivedCount > 0 ? `（归档 ${archivedCount} 期旧章节）` : "";
        new obsidian.Notice(`✅ ${actionMsg}${tail}`, 4000);
        const f = this.app.vault.getAbstractFileByPath(filePath);
        if (f instanceof obsidian.TFile) this.app.workspace.getLeaf(false).openFile(f);
    }

    // 仅保留最近 keep 个不同日期的章节，更早的归档到 backup/archive/
    async trimAndArchive(content, keep = 2) {
        // 找到所有 ## 📅 YYYY-MM-DD 章节及其结束位置
        const lines = content.split("\n");
        const sections = []; // { date, startLine, endLine, raw }
        let cur = null;
        for (let i = 0; i < lines.length; i++) {
            const m = lines[i].match(/^## 📅 (\d{4}-\d{2}-\d{2})/);
            if (m) {
                if (cur) { cur.endLine = i - 1; sections.push(cur); }
                cur = { date: m[1], startLine: i, endLine: lines.length - 1 };
            } else if (cur && /^## /.test(lines[i])) {
                // 遇到其他二级标题，当前章节结束
                cur.endLine = i - 1;
                sections.push(cur);
                cur = null;
            }
        }
        if (cur) sections.push(cur);

        if (sections.length === 0) return { content, archivedCount: 0 };

        // 按出现顺序保留前 keep 个不同日期（最新在上方）
        const seenDates = new Set();
        const keepIdx = new Set();
        for (let i = 0; i < sections.length; i++) {
            seenDates.add(sections[i].date);
            keepIdx.add(i);
            if (seenDates.size >= keep) {
                // 后续仍保留同日期的（同一期），不同日期的则归档
                for (let j = i + 1; j < sections.length; j++) {
                    if (seenDates.has(sections[j].date)) keepIdx.add(j);
                }
                break;
            }
        }

        const toArchive = sections.filter((_, i) => !keepIdx.has(i));
        if (!toArchive.length) return { content, archivedCount: 0 };

        // 抽取归档内容
        const archiveBlocks = toArchive.map(s => lines.slice(s.startLine, s.endLine + 1).join("\n"));

        // 按月分组归档
        const byMonth = {};
        toArchive.forEach((s, i) => {
            const ym = s.date.slice(0, 7); // YYYY-MM
            if (!byMonth[ym]) byMonth[ym] = [];
            byMonth[ym].push(archiveBlocks[i]);
        });

        try {
            const adapter = this.app.vault.adapter;
            const dir = `${this.manifest.dir}/backup/archive`;
            if (!(await adapter.exists(dir))) await adapter.mkdir(dir);
            for (const ym of Object.keys(byMonth)) {
                const f = `${dir}/${ym}.md`;
                const blob = byMonth[ym].join("\n\n") + "\n";
                if (await adapter.exists(f)) {
                    const old = await adapter.read(f);
                    await adapter.write(f, old.trimEnd() + "\n\n" + blob);
                } else {
                    await adapter.write(f, `# 归档 · ${ym}\n\n${blob}`);
                }
            }
        } catch (e) {
            console.error("[Commander Hub] archive failed", e);
            new obsidian.Notice(`⚠️ 归档失败：${e.message}`, 4000);
            return { content, archivedCount: 0 };
        }

        // 从原内容中删除已归档章节
        const removeLines = new Set();
        toArchive.forEach(s => {
            for (let i = s.startLine; i <= s.endLine; i++) removeLines.add(i);
        });
        const kept = lines.filter((_, i) => !removeLines.has(i)).join("\n");
        // 清理多余空行（连续 3+ 空行压成 2 个）
        const cleaned = kept.replace(/\n{3,}/g, "\n\n");
        return { content: cleaned, archivedCount: toArchive.length };
    }
};

// ==================== 主视图 ====================
class CommanderHubView extends obsidian.ItemView {
    constructor(leaf, plugin) {
        super(leaf);
        this.plugin = plugin;
        this.filter = { keyword: "", priority: "all", tag: "all", status: "all" };
        // 备忘按日折叠：保存被折叠的日期键（yyyy-mm-dd）
        this.collapsedMemoDays = new Set();
    }
    getViewType() { return VIEW_TYPE; }
    getDisplayText() { return "指挥官枢纽 全能版"; }
    getIcon() { return "commander-hub-cp"; }
    async onOpen() { this.renderAll(); }

    renderAll() {
        const root = this.containerEl.children[1];
        root.empty();
        root.addClass("commander-hub-view");
        if (this.plugin.settings.config.compactMode) root.addClass("compact-mode");

        // 工具栏
        const toolbar = root.createDiv({ cls: "commander-toolbar" });
        const exportBtn = toolbar.createEl("button", { text: "📤 导出", cls: "tb-btn", title: "导出当天到时间线笔记" });
        exportBtn.onclick = () => this.plugin.exportToMarkdown();
        const importBtn = toolbar.createEl("button", { text: "📥 Daily", cls: "tb-btn", title: "从今日 Daily 导入待办" });
        importBtn.onclick = async () => { await this.plugin.importFromDaily(); };
        const statBtn = toolbar.createEl("button", { text: "📊 统计", cls: "tb-btn", title: "查看统计图表" });
        statBtn.onclick = () => new StatModal(this.app, this.plugin).open();

        // 项目 Tab 栏
        this.renderProjectTabs(root);

        // 搜索栏
        const searchBar = root.createDiv({ cls: "search-bar" });
        const searchInput = searchBar.createEl("input", { type: "text", placeholder: "🔍 搜索关键字 / #标签", cls: "search-input" });
        searchInput.value = this.filter.keyword;
        searchInput.oninput = () => { this.filter.keyword = searchInput.value.trim().toLowerCase(); this.refreshLists(); };

        // 过滤栏
        const filterBar = root.createDiv({ cls: "filter-bar" });
        const mkChip = (label, key, val) => {
            const chip = filterBar.createEl("button", { text: label, cls: `chip ${this.filter[key] === val ? 'active' : ''}` });
            chip.onclick = () => { this.filter[key] = val; this.renderAll(); };
            return chip;
        };
        filterBar.createEl("span", { text: "状态:", cls: "filter-label" });
        mkChip("全部", "status", "all");
        mkChip("逾期", "status", "overdue");
        mkChip("今日", "status", "today");
        mkChip("待办", "status", "pending");
        mkChip("完成", "status", "done");
        filterBar.createEl("span", { text: "优先级:", cls: "filter-label" });
        mkChip("全部", "priority", "all");
        ["P0","P1","P2","P3"].forEach(p => mkChip(p, "priority", p));

        // 标签快速过滤
        const allTags = new Set();
        this.plugin.settings.todos.forEach(t => (t.tags || []).forEach(x => allTags.add(x)));
        if (allTags.size) {
            const tagBar = root.createDiv({ cls: "filter-bar tag-bar" });
            tagBar.createEl("span", { text: "标签:", cls: "filter-label" });
            const all = tagBar.createEl("button", { text: "全部", cls: `chip ${this.filter.tag === 'all' ? 'active' : ''}` });
            all.onclick = () => { this.filter.tag = "all"; this.renderAll(); };
            [...allTags].sort().forEach(name => {
                const chip = tagBar.createEl("button", { text: `#${name}`, cls: `chip ${this.filter.tag === name ? 'active' : ''}` });
                chip.onclick = () => { this.filter.tag = name; this.renderAll(); };
            });
        }

        // 录入面板
        root.createDiv({ text: "✅ 任务指派", cls: "commander-section-title" });
        const smartHint = this.plugin.settings.config.smartParse
            ? "支持智能解析：明天 19:00 公司例会 P0 #会议 @项目名"
            : "输入任务（支持 #标签）";
        const tInput = root.createEl("textarea", { cls: "commander-input auto-grow", attr: { placeholder: smartHint, rows: "2" } });
        const tFit = autoGrowTextarea(tInput, { min: 60, max: 320 }, this);

        // 智能解析预览
        const previewBox = root.createDiv({ cls: "smart-preview" });
        previewBox.style.display = "none";

        const row = root.createDiv({ cls: "input-row" });
        const dInput = row.createEl("input", { type: "date", cls: "commander-input row-input" });
        dInput.value = todayStr();
        const pInput = row.createEl("select", { cls: "commander-input row-input pri-select" });
        ["P0","P1","P2","P3"].forEach(p => {
            const opt = pInput.createEl("option", { text: PRIORITY_META[p].label, value: p });
            if (p === this.plugin.settings.config.defaultPriority) opt.selected = true;
        });
        // 项目下拉
        const projInput = row.createEl("select", { cls: "commander-input row-input proj-select" });
        const noneOpt = projInput.createEl("option", { text: "—无项目—", value: "" });
        this.plugin.settings.projects.forEach(p => projInput.createEl("option", { text: p.name, value: p.id }));
        if (this.plugin.settings.activeProject !== ALL_PROJECTS) {
            projInput.value = this.plugin.settings.activeProject;
        }

        // 实时智能解析
        const updatePreview = () => {
            if (!this.plugin.settings.config.smartParse || !tInput.value.trim()) {
                previewBox.style.display = "none"; return;
            }
            const parsed = smartParse(tInput.value, this.plugin.settings);
            if (!parsed.hits.length) { previewBox.style.display = "none"; return; }
            previewBox.style.display = "block";
            previewBox.empty();
            previewBox.createEl("span", { text: "🔮 智能识别：", cls: "smart-label" });
            parsed.hits.forEach(h => previewBox.createEl("span", { text: h, cls: "smart-hit" }));
            previewBox.createEl("span", { text: ` → "${parsed.text || "(空)"}"`, cls: "smart-final" });
        };
        tInput.oninput = updatePreview;

        const addTBtn = root.createEl("button", { text: "发布任务", cls: "primary-btn" });
        addTBtn.onclick = async () => {
            if (!tInput.value.trim()) return;
            let text = tInput.value.trim();
            let date = dInput.value || todayStr();
            let priority = pInput.value;
            let projectId = projInput.value || null;
            let tags = extractTags(text);

            if (this.plugin.settings.config.smartParse) {
                const parsed = smartParse(text, this.plugin.settings);
                if (parsed.text) text = parsed.text;
                if (parsed.date) date = parsed.date;
                if (parsed.priority) priority = parsed.priority;
                if (parsed.projectId) projectId = parsed.projectId;
                if (parsed.tags.length) tags = parsed.tags;
            }
            // 当前激活的项目作为默认归属（如果没有显式指定）
            if (!projectId && this.plugin.settings.activeProject !== ALL_PROJECTS) {
                projectId = this.plugin.settings.activeProject;
            }

            this.plugin.settings.todos.unshift(ensureTodoShape({
                seq: this.plugin.nextSeq("todo"),
                text, date, priority, tags, projectId
            }));
            await this.plugin.saveSettings();
            tInput.value = "";
            tFit();
            previewBox.style.display = "none";
        };

        root.createDiv({ text: "📝 灵感备忘", cls: "commander-section-title" });
        const memoHint = this.plugin.settings.config.smartParse
            ? "支持智能解析：@项目名 #标签 自动归类（原文保留）"
            : "输入备忘内容...";
        const mInput = root.createEl("textarea", { cls: "commander-input auto-grow", attr: { placeholder: memoHint, rows: "2" } });
        const mFit = autoGrowTextarea(mInput, { min: 60, max: 400 }, this);

        // 备忘智能解析预览
        const memoPreview = root.createDiv({ cls: "smart-preview" });
        memoPreview.style.display = "none";
        const updateMemoPreview = () => {
            if (!this.plugin.settings.config.smartParse || !mInput.value.trim()) {
                memoPreview.style.display = "none"; return;
            }
            const parsed = smartParseMemo(mInput.value, this.plugin.settings);
            if (!parsed.hits.length) { memoPreview.style.display = "none"; return; }
            memoPreview.style.display = "block";
            memoPreview.empty();
            memoPreview.createEl("span", { text: "🔮 智能识别：", cls: "smart-label" });
            parsed.hits.forEach(h => memoPreview.createEl("span", { text: h, cls: "smart-hit" }));
        };
        mInput.oninput = updateMemoPreview;

        const addMBtn = root.createEl("button", { text: "存入备忘", cls: "primary-btn memo-btn" });
        addMBtn.onclick = async () => {
            if (!mInput.value.trim()) return;
            const content = mInput.value.trim();
            let projectId = this.plugin.settings.activeProject !== ALL_PROJECTS
                ? this.plugin.settings.activeProject : null;
            let tags = extractTags(content);

            if (this.plugin.settings.config.smartParse) {
                const parsed = smartParseMemo(content, this.plugin.settings);
                if (parsed.projectId) projectId = parsed.projectId;
                if (parsed.tags.length) tags = parsed.tags;
            }

            this.plugin.settings.memos.unshift(ensureMemoShape({
                seq: this.plugin.nextSeq("memo"),
                content, tags, projectId
            }));
            await this.plugin.saveSettings();
            mInput.value = "";
            mFit();
            memoPreview.style.display = "none";
        };

        // 列表区
        this.scrollArea = root.createDiv({ cls: "main-scroll-area" });
        this.refreshLists();
    }

    renderProjectTabs(root) {
        const tabBar = root.createDiv({ cls: "project-tab-bar" });
        const active = this.plugin.settings.activeProject;

        const mkTab = (id, name, color) => {
            const tab = tabBar.createEl("button", {
                text: name,
                cls: `project-tab ${active === id ? 'active' : ''}`
            });
            if (color && active === id) tab.style.borderBottomColor = color;
            tab.onclick = async () => {
                this.plugin.settings.activeProject = id;
                await this.plugin.saveSettings(false);
                this.renderAll();
            };
            // 右键菜单
            if (id !== ALL_PROJECTS) {
                tab.oncontextmenu = (e) => {
                    e.preventDefault();
                    const menu = new obsidian.Menu();
                    menu.addItem(i => i.setTitle("重命名").setIcon("pencil").onClick(() => this.renameProject(id)));
                    menu.addItem(i => i.setTitle("更换颜色").setIcon("palette").onClick(() => this.recolorProject(id)));
                    menu.addItem(i => i.setTitle("删除项目").setIcon("trash").onClick(() => this.deleteProject(id)));
                    menu.showAtMouseEvent(e);
                };
            }
        };

        mkTab(ALL_PROJECTS, "🌐 全部", null);
        this.plugin.settings.projects.forEach(p => mkTab(p.id, p.name, p.color));
        const addBtn = tabBar.createEl("button", { text: "＋", cls: "project-tab add-tab", title: "新建项目" });
        addBtn.onclick = () => this.createProject();
    }

    async createProject() {
        const name = await promptInput(this.app, "新建项目", "项目名称");
        if (!name) return;
        const idx = this.plugin.settings.projects.length;
        const proj = ensureProjectShape({ name }, idx);
        this.plugin.settings.projects.push(proj);
        this.plugin.settings.activeProject = proj.id;
        await this.plugin.saveSettings();
    }

    async renameProject(id) {
        const proj = this.plugin.settings.projects.find(p => p.id === id);
        if (!proj) return;
        const name = await promptInput(this.app, "重命名项目", "新名称", proj.name);
        if (!name) return;
        proj.name = name;
        await this.plugin.saveSettings();
    }

    async recolorProject(id) {
        const proj = this.plugin.settings.projects.find(p => p.id === id);
        if (!proj) return;
        const idx = PROJECT_COLORS.indexOf(proj.color);
        proj.color = PROJECT_COLORS[(idx + 1) % PROJECT_COLORS.length];
        await this.plugin.saveSettings();
    }

    async deleteProject(id) {
        const proj = this.plugin.settings.projects.find(p => p.id === id);
        if (!proj) return;
        const cnt = this.plugin.settings.todos.filter(t => t.projectId === id).length
                  + this.plugin.settings.memos.filter(m => m.projectId === id).length;
        new ConfirmModal(this.app, `删除项目 "${proj.name}"？关联 ${cnt} 项将变为无项目（不删除）。`, async () => {
            await this.plugin.backupNow(false);
            this.plugin.settings.projects = this.plugin.settings.projects.filter(p => p.id !== id);
            this.plugin.settings.todos.forEach(t => { if (t.projectId === id) t.projectId = null; });
            this.plugin.settings.memos.forEach(m => { if (m.projectId === id) m.projectId = null; });
            if (this.plugin.settings.activeProject === id) this.plugin.settings.activeProject = ALL_PROJECTS;
            await this.plugin.saveSettings();
        }).open();
    }

    refreshLists() {
        if (!this.scrollArea) return;
        this.scrollArea.empty();
        this.renderTodos(this.scrollArea);
        this.renderMemos(this.scrollArea);
    }

    matchFilter(t, isMemo = false) {
        const f = this.filter;
        const ap = this.plugin.settings.activeProject;
        // 项目过滤
        if (ap !== ALL_PROJECTS && t.projectId !== ap) return false;

        const text = isMemo ? t.content : t.text;
        if (f.keyword) {
            const k = f.keyword;
            const tagHit = (t.tags || []).some(x => `#${x}`.toLowerCase().includes(k));
            // 序号匹配：t3 / m5 / T3 / M5
            const seqLabel = isMemo ? `m${t.seq}` : `t${t.seq}`;
            const seqHit = typeof t.seq === "number" && seqLabel === k.replace(/\s+/g, "");
            if (!text.toLowerCase().includes(k) && !tagHit && !seqHit) return false;
        }
        if (!isMemo) {
            if (f.priority !== "all" && t.priority !== f.priority) return false;
            const today = todayStr();
            if (f.status === "overdue" && !(t.date < today && !t.done)) return false;
            if (f.status === "today" && t.date !== today) return false;
            if (f.status === "pending" && t.done) return false;
            if (f.status === "done" && !t.done) return false;
        }
        if (f.tag !== "all" && !(t.tags || []).includes(f.tag)) return false;
        return true;
    }

    renderTodos(parent) {
        parent.createDiv({ text: "待办清单", cls: "commander-section-title" });
        const today = todayStr();
        const list = this.plugin.settings.todos
            .map((item, idx) => ({ item, idx }))
            .filter(x => this.matchFilter(x.item, false))
            .filter(x => this.plugin.settings.config.showCompleted || !x.item.done)
            .sort((a, b) => {
                if (a.item.done !== b.item.done) return a.item.done ? 1 : -1;
                const pa = PRIORITY_META[a.item.priority]?.weight ?? 2;
                const pb = PRIORITY_META[b.item.priority]?.weight ?? 2;
                if (pa !== pb) return pa - pb;
                return a.item.date.localeCompare(b.item.date);
            });

        if (!list.length) {
            parent.createDiv({ text: "（无匹配任务）", cls: "empty-hint" });
            return;
        }

        list.forEach(({ item, idx }) => {
            const isOverdue = item.date < today && !item.done;
            const card = parent.createDiv({ cls: `commander-card ${isOverdue ? 'overdue-warning' : ''} pri-${item.priority}` });

            const cb = card.createEl("input", { type: "checkbox", cls: "task-checkbox" });
            cb.checked = item.done;
            cb.onclick = async () => {
                item.done = cb.checked;
                item.completedAt = cb.checked ? nowStr() : null;
                if (item.done) this.handleRecurring(item);
                await this.plugin.saveSettings();
            };

            const info = card.createDiv({ cls: "task-info-wrapper" });
            if (item.done) info.style.opacity = "0.4";

            // 优先级徽章
            const pmeta = PRIORITY_META[item.priority] || PRIORITY_META.P2;
            // 序号徽章
            if (typeof item.seq === "number") {
                info.createEl("span", { text: `T${item.seq}`, cls: "seq-badge", title: "添加序号（永久唯一）" });
            }
            const priBadge = info.createEl("span", { text: item.priority, cls: "pri-badge" });
            priBadge.style.backgroundColor = pmeta.color;
            priBadge.onclick = (e) => { e.stopPropagation(); this.cyclePriority(item); };

            const textDisplay = info.createEl("span", { cls: "content-text", text: " " + item.text });
            if (item.done) textDisplay.style.textDecoration = "line-through";
            this.setupEditable(textDisplay, info, item, "text", async () => {
                item.tags = extractTags(item.text);
                await this.plugin.saveSettings();
            });

            const meta = info.createDiv({ cls: "meta-row" });
            if (isOverdue) meta.createEl("span", { text: "⚠️ 严重超时", cls: "overdue-label" });
            meta.createEl("span", { cls: `meta-time ${isOverdue ? 'overdue-date-text' : ''}`, text: `📅 ${item.date}` });
            // 项目徽章
            const proj = item.projectId ? this.plugin.settings.projects.find(p => p.id === item.projectId) : null;
            if (proj) {
                const pBadge = meta.createEl("span", { text: `@${proj.name}`, cls: "proj-badge" });
                pBadge.style.backgroundColor = proj.color;
                pBadge.onclick = (e) => { e.stopPropagation(); this.cycleProject(item); };
            } else {
                const pBadge = meta.createEl("span", { text: "@无", cls: "proj-badge proj-empty" });
                pBadge.onclick = (e) => { e.stopPropagation(); this.cycleProject(item); };
            }
            (item.tags || []).forEach(tg => meta.createEl("span", { text: `#${tg}`, cls: "tag-chip" }));

            const del = card.createEl("button", { text: "✕", cls: "close-btn" });
            del.onclick = () => {
                new ConfirmModal(this.app, `任务："${item.text.slice(0,30)}${item.text.length>30?'...':''}"`, async () => {
                    await this.plugin.backupNow(false);
                    this.plugin.settings.todos.splice(idx, 1);
                    await this.plugin.saveSettings();
                }).open();
            };
        });
    }

    cyclePriority(item) {
        const order = ["P0", "P1", "P2", "P3"];
        const i = order.indexOf(item.priority);
        item.priority = order[(i + 1) % order.length];
        this.plugin.saveSettings();
    }

    cycleProject(item) {
        const projs = this.plugin.settings.projects;
        if (!projs.length) {
            new obsidian.Notice("还没有项目，请点击顶部 ＋ 新建", 2500);
            return;
        }
        // 顺序：null -> p[0] -> p[1] -> ... -> null
        const ids = [null, ...projs.map(p => p.id)];
        const cur = ids.indexOf(item.projectId);
        item.projectId = ids[(cur + 1) % ids.length];
        this.plugin.saveSettings();
    }

    renderMemos(parent) {
        parent.createDiv({ text: "备忘录", cls: "commander-section-title" });
        const list = this.plugin.settings.memos
            .map((item, idx) => ({ item, idx }))
            .filter(x => this.matchFilter(x.item, true));
        if (!list.length) { parent.createDiv({ text: "（无匹配备忘）", cls: "empty-hint" }); return; }

        // 按日期分组（保持原始顺序在组内）
        const groups = new Map();
        list.forEach(entry => {
            const key = memoDateKey(entry.item);
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(entry);
        });
        // 日期降序：今天在最上
        const sortedKeys = [...groups.keys()].sort((a, b) => b.localeCompare(a));

        sortedKeys.forEach(dateKey => {
            const entries = groups.get(dateKey);
            const isCollapsed = this.collapsedMemoDays.has(dateKey);

            const header = parent.createDiv({ cls: `memo-date-header${isCollapsed ? " collapsed" : ""}` });
            header.createEl("span", { text: isCollapsed ? "▶" : "▼", cls: "memo-fold-arrow" });
            header.createEl("span", { text: ` ${formatDateLabel(dateKey)} `, cls: "memo-date-label" });
            header.createEl("span", { text: `(${entries.length})`, cls: "memo-date-count" });
            header.onclick = () => {
                if (isCollapsed) this.collapsedMemoDays.delete(dateKey);
                else this.collapsedMemoDays.add(dateKey);
                this.refreshLists();
            };

            if (isCollapsed) return;

            entries.forEach(({ item, idx }) => {
                const card = parent.createDiv({ cls: "commander-card memo-card" });
                const info = card.createDiv({ cls: "task-info-wrapper" });
                if (typeof item.seq === "number") {
                    info.createEl("span", { text: `M${item.seq}`, cls: "seq-badge memo-seq", title: "添加序号（永久唯一）" });
                }
                const contentDisplay = info.createDiv({ cls: "content-text", text: item.content });
                this.setupEditable(contentDisplay, info, item, "content", async () => {
                    if (this.plugin.settings.config.smartParse) {
                        const parsed = smartParseMemo(item.content, this.plugin.settings);
                        if (parsed.projectId) item.projectId = parsed.projectId;
                        item.tags = parsed.tags.length ? parsed.tags : extractTags(item.content);
                    } else {
                        item.tags = extractTags(item.content);
                    }
                    await this.plugin.saveSettings();
                });
                const meta = info.createDiv({ cls: "meta-row" });
                meta.createEl("span", { cls: "meta-time", text: `🕒 ${item.time}` });
                const proj = item.projectId ? this.plugin.settings.projects.find(p => p.id === item.projectId) : null;
                if (proj) {
                    const pBadge = meta.createEl("span", { text: `@${proj.name}`, cls: "proj-badge" });
                    pBadge.style.backgroundColor = proj.color;
                    pBadge.onclick = (e) => { e.stopPropagation(); this.cycleProject(item); };
                } else {
                    const pBadge = meta.createEl("span", { text: "@无", cls: "proj-badge proj-empty" });
                    pBadge.onclick = (e) => { e.stopPropagation(); this.cycleProject(item); };
                }
                (item.tags || []).forEach(tg => meta.createEl("span", { text: `#${tg}`, cls: "tag-chip" }));
                const toDailyBtn = info.createEl("button", { text: "📤 → Daily", cls: "mini-btn" });
                toDailyBtn.onclick = () => this.plugin.appendMemoToDaily(item);
                const del = card.createEl("button", { text: "✕", cls: "close-btn" });
                del.onclick = () => {
                    new ConfirmModal(this.app, `备忘："${item.content.slice(0,30)}${item.content.length>30?'...':''}"`, async () => {
                        await this.plugin.backupNow(false);
                        this.plugin.settings.memos.splice(idx, 1);
                        await this.plugin.saveSettings();
                    }).open();
                };
            });
        });
    }

    setupEditable(displayEl, parent, item, field, onSave) {
        displayEl.ondblclick = (e) => {
            e.stopPropagation();
            const orig = item[field];
            const editField = parent.createEl("textarea", { cls: "edit-textarea auto-grow" });
            editField.value = orig;
            autoGrowTextarea(editField, { min: 36, max: 480 }, this);
            displayEl.hide();
            editField.focus();
            editField.setSelectionRange(orig.length, orig.length);
            const save = async () => {
                const v = editField.value.trim();
                if (v) item[field] = v;
                await onSave();
            };
            editField.onblur = save;
            editField.onkeydown = (ev) => { if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); save(); } };
        };
    }

    handleRecurring(task) {
        let nextDate = new Date(task.date);
        let shouldRepeat = false;
        const text = task.text;
        const dayMap = { "周日": 0, "周一": 1, "周二": 2, "周三": 3, "周四": 4, "周五": 5, "周六": 6 };
        for (let key in dayMap) {
            if (text.includes(key)) {
                let diff = (dayMap[key] + 7 - nextDate.getDay()) % 7;
                nextDate.setDate(nextDate.getDate() + (diff === 0 ? 7 : diff));
                shouldRepeat = true; break;
            }
        }
        if (!shouldRepeat && (text.includes("每天") || text.includes("每周"))) {
            nextDate.setDate(nextDate.getDate() + (text.includes("每天") ? 1 : 7));
            shouldRepeat = true;
        }
        if (shouldRepeat) {
            this.plugin.settings.todos.unshift(ensureTodoShape({
                seq: this.plugin.nextSeq("todo"),
                text: task.text, date: nextDate.toISOString().split('T')[0],
                priority: task.priority, tags: task.tags, projectId: task.projectId
            }));
        }
    }
}

// ==================== 通用输入弹窗 ====================
function promptInput(app, title, placeholder, initial = "") {
    return new Promise(resolve => {
        const modal = new obsidian.Modal(app);
        modal.titleEl.setText(title);
        const input = modal.contentEl.createEl("input", {
            type: "text", cls: "commander-input",
            attr: { placeholder, value: initial }
        });
        input.style.width = "100%";
        input.style.padding = "8px";
        input.style.marginTop = "10px";
        const row = modal.contentEl.createDiv({ cls: "confirm-btn-row" });
        const cancel = row.createEl("button", { text: "取消" });
        const ok = row.createEl("button", { text: "确认", cls: "mod-cta" });
        let resolved = false;
        const finish = (val) => { if (!resolved) { resolved = true; resolve(val); modal.close(); } };
        cancel.onclick = () => finish(null);
        ok.onclick = () => finish(input.value.trim() || null);
        input.onkeydown = (e) => { if (e.key === "Enter") finish(input.value.trim() || null); };
        modal.onClose = () => finish(null);
        modal.open();
        setTimeout(() => { input.focus(); input.select(); }, 50);
    });
}

// ==================== 二次确认对话框 ====================
class ConfirmModal extends obsidian.Modal {
    constructor(app, desc, onConfirm) {
        super(app);
        this.desc = desc;
        this.onConfirm = onConfirm;
    }
    onOpen() {
        const { contentEl } = this;
        contentEl.createEl("h3", { text: "确认删除？" });
        contentEl.createEl("p", { text: this.desc, cls: "confirm-desc" });
        contentEl.createEl("p", { text: "操作前会自动备份。", cls: "confirm-warning" });
        const row = contentEl.createDiv({ cls: "confirm-btn-row" });
        const cancel = row.createEl("button", { text: "取消" });
        const ok = row.createEl("button", { text: "确认删除", cls: "mod-warning" });
        cancel.onclick = () => this.close();
        ok.onclick = async () => { await this.onConfirm(); this.close(); };
    }
    onClose() { this.contentEl.empty(); }
}

// ==================== 统计弹窗 ====================
class StatModal extends obsidian.Modal {
    constructor(app, plugin) { super(app); this.plugin = plugin; }
    onOpen() {
        const { contentEl } = this;
        contentEl.addClass("stat-modal");
        contentEl.createEl("h2", { text: "📊 指挥官枢纽 · 数据洞察" });

        const todos = this.plugin.settings.todos || [];
        const memos = this.plugin.settings.memos || [];
        const today = todayStr();
        const overdue = todos.filter(t => !t.done && t.date < today).length;
        const pending = todos.filter(t => !t.done && t.date >= today).length;
        const done = todos.filter(t => t.done).length;
        const total = todos.length;
        const completionRate = total ? Math.round(done / total * 100) : 0;

        // 概览卡片
        const overview = contentEl.createDiv({ cls: "stat-overview" });
        const mkCard = (label, val, cls) => {
            const c = overview.createDiv({ cls: `stat-card ${cls}` });
            c.createDiv({ text: val, cls: "stat-num" });
            c.createDiv({ text: label, cls: "stat-label" });
        };
        mkCard("逾期", overdue, "stat-overdue");
        mkCard("待办", pending, "stat-pending");
        mkCard("完成", done, "stat-done");
        mkCard("完成率", completionRate + "%", "stat-rate");
        mkCard("备忘", memos.length, "stat-memo");

        // 优先级分布（chart 饼图）
        contentEl.createEl("h3", { text: "🎯 优先级分布（未完成）" });
        const priCount = { P0: 0, P1: 0, P2: 0, P3: 0 };
        todos.filter(t => !t.done).forEach(t => { priCount[t.priority] = (priCount[t.priority] || 0) + 1; });
        const priLabels = ["P0", "P1", "P2", "P3"];
        const priValues = priLabels.map(p => priCount[p]);
        const priColors = priLabels.map(p => PRIORITY_META[p].color);
        const priBlock = "```chart\n" +
            "type: pie\n" +
            "labels: [" + priLabels.map(x => `"${x}"`).join(", ") + "]\n" +
            "series:\n" +
            "  - title: 数量\n" +
            "    data: [" + priValues.join(", ") + "]\n" +
            "tension: 0.2\n" +
            "width: 80%\n" +
            "labelColors: true\n" +
            "fill: true\n" +
            "beginAtZero: true\n" +
            "bestFit: false\n" +
            "bestFitTitle: undefined\n" +
            "bestFitNumber: 0\n" +
            "colors: [" + priColors.map(c => `"${c}"`).join(", ") + "]\n" +
            "```\n";

        // 标签 Top 5
        contentEl.createEl("h3", { text: "🏷️ 标签 Top 5" });
        const tagCount = {};
        todos.forEach(t => (t.tags || []).forEach(tg => tagCount[tg] = (tagCount[tg] || 0) + 1));
        const topTags = Object.entries(tagCount).sort((a, b) => b[1] - a[1]).slice(0, 5);
        if (!topTags.length) {
            contentEl.createDiv({ text: "（暂无标签）", cls: "empty-hint" });
        } else {
            const tagBlock = "```chart\n" +
                "type: bar\n" +
                "labels: [" + topTags.map(x => `"#${x[0]}"`).join(", ") + "]\n" +
                "series:\n" +
                "  - title: 任务数\n" +
                "    data: [" + topTags.map(x => x[1]).join(", ") + "]\n" +
                "tension: 0.2\n" +
                "width: 80%\n" +
                "fill: true\n" +
                "beginAtZero: true\n" +
                "```\n";
            const tagHost = contentEl.createDiv({ cls: "chart-host" });
            obsidian.MarkdownRenderer.renderMarkdown(tagBlock, tagHost, "", this.plugin);
        }

        // 优先级图表渲染
        const priHost = contentEl.createDiv({ cls: "chart-host" });
        obsidian.MarkdownRenderer.renderMarkdown(priBlock, priHost, "", this.plugin);

        // 提示信息
        const tip = contentEl.createDiv({ cls: "stat-tip" });
        tip.createEl("p", { text: "💡 图表由 obsidian-charts 插件渲染，需保持其启用。" });
    }
    onClose() { this.contentEl.empty(); }
}

// ==================== 设置面板 ====================
class CommanderHubSettingTab extends obsidian.PluginSettingTab {
    constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
    display() {
        const { containerEl } = this;
        containerEl.empty();
        const cfg = this.plugin.settings.config;

        new obsidian.Setting(containerEl)
            .setName("导出目录")
            .setDesc("时间线笔记保存的相对路径（vault 根开始）")
            .addText(t => t.setValue(cfg.exportDir).onChange(async v => { cfg.exportDir = v.trim() || "Logs/Commander Hub"; await this.plugin.saveSettings(false); }));

        new obsidian.Setting(containerEl)
            .setName("时间线笔记文件名")
            .setDesc("固定文件名，按天聚合更新")
            .addText(t => t.setValue(cfg.exportFileName).onChange(async v => { cfg.exportFileName = v.trim() || "工作指挥官笔记.md"; await this.plugin.saveSettings(false); }));

        new obsidian.Setting(containerEl)
            .setName("Daily 路径模板")
            .setDesc("支持 {yyyy} {MM} {dd} 占位符")
            .addText(t => t.setValue(cfg.dailyTemplate).onChange(async v => { cfg.dailyTemplate = v.trim(); await this.plugin.saveSettings(false); }));

        new obsidian.Setting(containerEl)
            .setName("默认优先级")
            .setDesc("新建任务时的默认优先级")
            .addDropdown(d => {
                ["P0","P1","P2","P3"].forEach(p => d.addOption(p, PRIORITY_META[p].label));
                d.setValue(cfg.defaultPriority).onChange(async v => { cfg.defaultPriority = v; await this.plugin.saveSettings(); });
            });

        new obsidian.Setting(containerEl)
            .setName("备份保留天数")
            .setDesc("自动备份至 .obsidian/plugins/Commander Hub/backup/")
            .addText(t => t.setValue(String(cfg.backupDays)).onChange(async v => { const n = parseInt(v); if (!isNaN(n) && n > 0) { cfg.backupDays = n; await this.plugin.saveSettings(false); } }));

        new obsidian.Setting(containerEl)
            .setName("显示已完成任务")
            .addToggle(t => t.setValue(cfg.showCompleted).onChange(async v => { cfg.showCompleted = v; await this.plugin.saveSettings(); }));

        new obsidian.Setting(containerEl)
            .setName("紧凑模式")
            .setDesc("减小卡片间距，单屏显示更多内容")
            .addToggle(t => t.setValue(cfg.compactMode).onChange(async v => { cfg.compactMode = v; await this.plugin.saveSettings(); }));

        new obsidian.Setting(containerEl)
            .setName("启用智能解析")
            .setDesc("发布任务时自动识别 \"明天 19:00 公司例会 P0 #会议 @项目名\"")
            .addToggle(t => t.setValue(cfg.smartParse).onChange(async v => { cfg.smartParse = v; await this.plugin.saveSettings(); }));

        // ============ 项目管理 ============
        new obsidian.Setting(containerEl).setName("📂 项目管理").setHeading();
        const projWrap = containerEl.createDiv({ cls: "project-mgmt" });
        if (!this.plugin.settings.projects.length) {
            projWrap.createEl("p", { text: "（暂无项目，点击下方按钮创建）", cls: "empty-hint" });
        }
        this.plugin.settings.projects.forEach((p, idx) => {
            const row = projWrap.createDiv({ cls: "project-row" });
            const dot = row.createEl("span", { cls: "project-dot" });
            dot.style.backgroundColor = p.color;
            row.createEl("span", { text: p.name, cls: "project-name-text" });
            const cnt = this.plugin.settings.todos.filter(t => t.projectId === p.id).length
                      + this.plugin.settings.memos.filter(m => m.projectId === p.id).length;
            row.createEl("span", { text: `${cnt} 项`, cls: "project-count" });
            const renameBtn = row.createEl("button", { text: "重命名", cls: "mini-btn" });
            renameBtn.onclick = async () => {
                const name = await promptInput(this.app, "重命名项目", "新名称", p.name);
                if (name) { p.name = name; await this.plugin.saveSettings(); this.display(); }
            };
            const colorBtn = row.createEl("button", { text: "换色", cls: "mini-btn" });
            colorBtn.onclick = async () => {
                const i = PROJECT_COLORS.indexOf(p.color);
                p.color = PROJECT_COLORS[(i + 1) % PROJECT_COLORS.length];
                await this.plugin.saveSettings();
                this.display();
            };
            const delBtn = row.createEl("button", { text: "删除", cls: "mini-btn danger" });
            delBtn.onclick = () => {
                new ConfirmModal(this.app, `删除项目 "${p.name}"？关联 ${cnt} 项变为无项目（不删除）。`, async () => {
                    await this.plugin.backupNow(false);
                    this.plugin.settings.projects = this.plugin.settings.projects.filter(x => x.id !== p.id);
                    this.plugin.settings.todos.forEach(t => { if (t.projectId === p.id) t.projectId = null; });
                    this.plugin.settings.memos.forEach(m => { if (m.projectId === p.id) m.projectId = null; });
                    if (this.plugin.settings.activeProject === p.id) this.plugin.settings.activeProject = ALL_PROJECTS;
                    await this.plugin.saveSettings();
                    this.display();
                }).open();
            };
        });
        new obsidian.Setting(containerEl)
            .setName("新建项目")
            .addButton(b => b.setButtonText("＋ 新建").setCta().onClick(async () => {
                const name = await promptInput(this.app, "新建项目", "项目名称");
                if (!name) return;
                const idx = this.plugin.settings.projects.length;
                this.plugin.settings.projects.push(ensureProjectShape({ name }, idx));
                await this.plugin.saveSettings();
                this.display();
            }));

        new obsidian.Setting(containerEl).setName("🔧 维护操作").setHeading();

        new obsidian.Setting(containerEl)
            .setName("立即备份")
            .setDesc("手动触发备份当前数据")
            .addButton(b => b.setButtonText("备份").onClick(async () => { await this.plugin.backupNow(true); }));

        new obsidian.Setting(containerEl)
            .setName("打开备份目录")
            .addButton(b => b.setButtonText("打开").onClick(async () => {
                const dir = `${this.plugin.manifest.dir}/backup`;
                new obsidian.Notice(`备份目录：${dir}`, 5000);
            }));

        new obsidian.Setting(containerEl)
            .setName("清空已完成任务")
            .setDesc("会先创建备份，再删除全部 done=true 的任务")
            .addButton(b => b.setButtonText("清空").setWarning().onClick(async () => {
                new ConfirmModal(this.app, `将清空 ${this.plugin.settings.todos.filter(t => t.done).length} 条已完成任务`, async () => {
                    await this.plugin.backupNow(false);
                    this.plugin.settings.todos = this.plugin.settings.todos.filter(t => !t.done);
                    await this.plugin.saveSettings();
                    this.display();
                }).open();
            }));

        containerEl.createEl("p", { text: `Commander Hub Lite v${PLUGIN_VERSION}`, cls: "setting-version" });
    }
}
