# ⟐ Memory Transplant

**Claude 记忆移植 — Your memory belongs to you.**

从旧 Claude 账号的导出数据中，用 AI 智能提炼你的记忆画像，一键注入新账号。

![Memory Transplant](https://img.shields.io/badge/version-1.0.0-22ffaa?style=flat-square) ![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square) ![Privacy](https://img.shields.io/badge/privacy-100%25_local-green?style=flat-square)

---

## 为什么需要这个？

Claude 的记忆让它越用越懂你——你的技术栈、沟通风格、项目状态、踩过的坑。但如果账号没了，这些积累全部归零。

**Memory Transplant** 解决这个问题：

1. 📦 **上传** Claude 导出的对话数据
2. 🧠 **AI 提炼** 从几十万字对话中提取结构化记忆画像
3. ✏️ **审核编辑** 确认 AI 提炼的结果
4. ⚡ **一键注入** 生成 Prompt，粘贴到新 Claude 即刻恢复

## 核心特性

- **AI 驱动提炼** — 不是简单复制粘贴，而是用 Claude Sonnet 从原始对话中提取你的画像
- **结构化输出** — 身份、沟通偏好、技术栈、项目状态、历史教训，分类整理
- **Memory Edits 适配** — 自动生成适合 Claude memory 系统的条目（30条 × 500字符）
- **100% 本地** — 数据不经过任何第三方服务器，API 调用直接从你的浏览器发出
- **可编辑** — AI 提炼结果完全可以手动调整

## 快速开始

### 方法一：直接使用（推荐）

访问在线版本：[memorytransplant.com](https://memorytransplant.com) *(部署后更新链接)*

### 方法二：本地运行

```bash
git clone https://github.com/neo-agent-lab/memory-transplant.git
cd memory-transplant
npm install
npm run dev
```

打开 `http://localhost:5173`

### 方法三：静态部署

```bash
npm run build
# 将 dist/ 目录部署到任何静态托管服务
```

## 使用流程

### Step 1: 导出 Claude 数据

1. 打开 [claude.ai](https://claude.ai)
2. Settings → Account → Export Data
3. 等待邮件，下载 ZIP
4. 解压得到 `conversations.json`

### Step 2: 上传到 Memory Transplant

将 JSON 文件拖入工具界面。工具会：
- 解析所有对话
- 显示统计信息
- 让你选择要提炼的对话

### Step 3: AI 提炼

点击「开始提炼」，工具会：
- 将对话分批发送给 Claude Sonnet API
- 从中提取你的用户画像
- 自动合并多批次结果

> **注意：** 这一步需要 Claude API 访问。工具使用 Anthropic 的 API，调用直接从你的浏览器发出。

### Step 4: 审核 & 注入

- 检查 AI 提炼的结果
- 编辑/添加/删除条目
- 生成注入 Prompt
- 复制，粘贴到新 Claude 的第一条消息

## 注入方式

| 方式 | 说明 | 持久性 |
|------|------|--------|
| **Prompt 注入** | 粘贴为第一条消息 | 仅当前对话 |
| **Memory 写入** | 手动添加到 Settings → Memory | 跨所有对话 |
| **组合使用** | Prompt 冷启动 + 让 Claude 帮你写 Memory | 最佳效果 |

## 记忆快照 Schema

```json
{
  "identity": { "name": "", "primary_language": "", "location_hint": "" },
  "communication_style": {
    "preferred_language": "",
    "response_expectations": ["..."],
    "dislikes": ["..."]
  },
  "technical_profile": {
    "primary_machine": "",
    "skill_level": "",
    "core_stack": ["..."],
    "familiar_tools": ["..."]
  },
  "active_projects": [{ "name": "", "status": "", "description": "" }],
  "interests": ["..."],
  "lessons_learned": ["..."],
  "priority_memory_edits": ["..."]
}
```

## 隐私

- ✅ 所有数据处理在你的浏览器本地完成
- ✅ 不存储任何用户数据
- ✅ API 调用直接从浏览器到 Anthropic，不经过中间服务器
- ✅ 开源，可审计

## 技术栈

- React 18 + Vite
- Claude Sonnet API (通过浏览器直接调用)
- 纯前端，无后端依赖
- 零数据库

## Roadmap

- [ ] 支持 ZIP 文件直接上传（自动解压）
- [ ] Chrome 扩展版本（自动导出 + 定期备份）
- [ ] 跨模型迁移（Claude → GPT / DeepSeek / Qwen）
- [ ] 记忆 diff 对比（新旧快照对比）
- [ ] 团队记忆模板（共享项目上下文）

## 贡献

欢迎 PR 和 Issue。

## License

MIT

---

**你的记忆属于你，不属于任何一个平台。**
