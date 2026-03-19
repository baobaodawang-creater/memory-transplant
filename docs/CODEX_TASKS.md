# Memory Transplant — Codex 任务清单

## 项目概述
Claude 记忆移植工具。纯前端 React + Vite 项目，用 Claude API 从导出的对话数据中提炼用户画像。

## 项目位置
解压 `memory-transplant.zip` 到 `~/Desktop/memory-transplant/`

## GitHub 发布任务

### 1. 初始化 & 推送
```bash
cd ~/Desktop/memory-transplant
git init
git add .
git commit -m "feat: initial release v1.0.0 — Claude Memory Transplant"
gh repo create neo-agent-lab/memory-transplant --public --source=. --push
```

### 2. 验证本地运行
```bash
npm install
npm run dev
# 打开 http://localhost:5173 确认页面正常
```

### 3. 构建测试
```bash
npm run build
npm run preview
```

### 4. 可选：部署到 Vercel/Netlify
```bash
# Vercel
npx vercel --prod

# 或 Netlify
npx netlify deploy --prod --dir=dist
```

### 5. GitHub Release
```bash
gh release create v1.0.0 --title "v1.0.0 — Memory Transplant" --notes "Initial release. Claude 记忆移植工具。"
```

## 注意事项
- 不需要后端，纯静态部署
- API 调用从浏览器直接发到 Anthropic，无需 proxy
- README 里的在线链接部署后记得更新
- repo 名: `memory-transplant`，org: `neo-agent-lab`

## 架构说明（给 Codex 理解用）
- `src/App.jsx` — 主组件，包含全部逻辑（上传→解析→AI提炼→审核→注入）
- `src/main.jsx` — React 入口
- `index.html` — HTML 入口 + SEO meta
- `vite.config.js` — Vite 配置
- 无路由，单页应用，状态机驱动（landing→upload→processing→review→inject）
