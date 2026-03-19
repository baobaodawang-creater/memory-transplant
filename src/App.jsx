import { useState, useRef, useCallback, useEffect } from "react";

// ═══════════════════════════════════════════════════════
// CLAUDE MEMORY TRANSPLANT — v1.0
// "Your memory belongs to you."
// ═══════════════════════════════════════════════════════

const FONT_URL = "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;600&family=Noto+Sans+SC:wght@300;400;500;700;900&family=DM+Sans:wght@400;500;600;700&display=swap";

// ── Prompt for distillation ──
const DISTILL_SYSTEM = `You are a memory extraction engine. Given raw conversation logs between a user and Claude, extract a structured user profile in JSON format.

Rules:
1. Extract ONLY facts about the USER, not about Claude
2. Infer communication preferences from how the user writes
3. Identify active projects, technical skills, interests
4. Note any explicit preferences or corrections the user made
5. Keep entries concise — each memory_edit must be under 500 chars
6. Output ONLY valid JSON, no markdown fences, no preamble

Output this exact schema:
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
  "priority_memory_edits": ["... up to 20 most important items for Claude memory injection, each under 500 chars"]
}`;

const MAX_CHARS_PER_CALL = 80000; // conservative for Sonnet context

export default function MemoryTransplant() {
  const [phase, setPhase] = useState("landing"); // landing | upload | processing | review | inject
  const [files, setFiles] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [selectedConvos, setSelectedConvos] = useState(new Set());
  const [profile, setProfile] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, status: "" });
  const [error, setError] = useState("");
  const [copyState, setCopyState] = useState("");
  const [editMode, setEditMode] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [stats, setStats] = useState(null);
  const fileRef = useRef(null);

  // ── Parse Claude export ZIP ──
  const processUpload = useCallback(async (fileList) => {
    setError("");
    const allConvos = [];

    for (const file of fileList) {
      if (file.name.endsWith(".json")) {
        // Single conversation JSON
        try {
          const text = await file.text();
          const data = JSON.parse(text);
          if (Array.isArray(data)) {
            // Array of conversations
            data.forEach((c, i) => {
              allConvos.push({
                id: `${file.name}-${i}`,
                name: c.name || c.title || `Conversation ${i + 1}`,
                messages: c.chat_messages || c.messages || [],
                created: c.created_at || c.created || "",
                updated: c.updated_at || c.updated || "",
                raw: c,
              });
            });
          } else if (data.chat_messages || data.messages) {
            allConvos.push({
              id: file.name,
              name: data.name || data.title || file.name,
              messages: data.chat_messages || data.messages || [],
              created: data.created_at || "",
              updated: data.updated_at || "",
              raw: data,
            });
          }
        } catch (e) {
          console.error("Parse error:", e);
        }
      }
    }

    if (allConvos.length === 0) {
      setError("未找到有效的对话数据。请上传Claude导出的JSON文件。");
      return;
    }

    // Sort by date, newest first
    allConvos.sort((a, b) => (b.updated || b.created || "").localeCompare(a.updated || a.created || ""));
    setConversations(allConvos);
    setSelectedConvos(new Set(allConvos.slice(0, Math.min(50, allConvos.length)).map(c => c.id)));

    // Stats
    const totalMsgs = allConvos.reduce((s, c) => s + (c.messages?.length || 0), 0);
    const totalChars = allConvos.reduce((s, c) =>
      s + (c.messages || []).reduce((ms, m) => ms + (typeof m.text === "string" ? m.text.length : JSON.stringify(m.content || m.text || "").length), 0), 0);
    setStats({ convos: allConvos.length, messages: totalMsgs, chars: totalChars });
    setPhase("upload");
  }, []);

  // ── Flatten messages for API ──
  const flattenConversation = (convo) => {
    return (convo.messages || []).map(m => {
      const role = m.sender === "human" || m.role === "user" ? "USER" : "CLAUDE";
      const text = typeof m.text === "string" ? m.text
        : Array.isArray(m.content) ? m.content.map(c => c.text || "").join(" ")
        : typeof m.content === "string" ? m.content
        : JSON.stringify(m.text || m.content || "");
      return `[${role}]: ${text}`;
    }).join("\n");
  };

  // ── AI Distillation ──
  const distill = async () => {
    setProcessing(true);
    setError("");
    setPhase("processing");

    const selected = conversations.filter(c => selectedConvos.has(c.id));
    // Chunk conversations to fit context
    const chunks = [];
    let currentChunk = "";
    for (const convo of selected) {
      const flat = flattenConversation(convo);
      if (currentChunk.length + flat.length > MAX_CHARS_PER_CALL) {
        if (currentChunk) chunks.push(currentChunk);
        currentChunk = flat.slice(0, MAX_CHARS_PER_CALL);
      } else {
        currentChunk += `\n\n--- CONVERSATION: ${convo.name} ---\n${flat}`;
      }
    }
    if (currentChunk) chunks.push(currentChunk);

    setProgress({ current: 0, total: chunks.length, status: "开始提炼记忆..." });

    const partialProfiles = [];

    for (let i = 0; i < chunks.length; i++) {
      setProgress({
        current: i + 1,
        total: chunks.length,
        status: `正在分析第 ${i + 1}/${chunks.length} 批对话...`
      });

      try {
        const resp = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "claude-sonnet-4-20250514",
            max_tokens: 4000,
            system: DISTILL_SYSTEM,
            messages: [{
              role: "user",
              content: `Extract the user profile from these conversation logs:\n\n${chunks[i]}`
            }],
          }),
        });

        if (!resp.ok) {
          const errData = await resp.json().catch(() => ({}));
          throw new Error(errData.error?.message || `API error ${resp.status}`);
        }

        const data = await resp.json();
        const text = data.content?.map(c => c.text || "").join("") || "";
        const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
        const parsed = JSON.parse(cleaned);
        partialProfiles.push(parsed);
      } catch (e) {
        console.error(`Chunk ${i} failed:`, e);
        setError(prev => prev ? prev + `\n批次 ${i + 1} 失败: ${e.message}` : `批次 ${i + 1} 失败: ${e.message}`);
      }
    }

    if (partialProfiles.length === 0) {
      setError("所有批次均失败。请检查网络和API额度。");
      setProcessing(false);
      setPhase("upload");
      return;
    }

    // Merge profiles
    setProgress({ current: chunks.length, total: chunks.length, status: "正在合并记忆..." });

    if (partialProfiles.length === 1) {
      setProfile(partialProfiles[0]);
    } else {
      // Use Claude to merge
      try {
        const mergeResp = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "claude-sonnet-4-20250514",
            max_tokens: 4000,
            system: `You merge multiple partial user profiles into one unified profile. Deduplicate, resolve conflicts (prefer newer info), keep the same JSON schema. Output ONLY valid JSON, no preamble.\n\nSchema:\n${DISTILL_SYSTEM.split("Output this exact schema:")[1]}`,
            messages: [{
              role: "user",
              content: `Merge these partial profiles:\n\n${JSON.stringify(partialProfiles, null, 2)}`
            }],
          }),
        });

        const mergeData = await mergeResp.json();
        const mergeText = mergeData.content?.map(c => c.text || "").join("") || "";
        const mergeCleaned = mergeText.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
        setProfile(JSON.parse(mergeCleaned));
      } catch (e) {
        // Fallback: use first profile
        console.error("Merge failed, using first profile:", e);
        setProfile(partialProfiles[0]);
      }
    }

    setProcessing(false);
    setPhase("review");
  };

  // ── Generate injection prompt ──
  const generatePrompt = () => {
    if (!profile) return "";
    const p = profile;
    let out = `# 记忆迁移注入\n\n`;
    out += `这是我从上一个Claude账号通过AI提炼的记忆画像。请完整消化这些信息，以此为基础和我合作。之后请简要确认你对我的理解。\n\n`;

    if (p.identity?.name) out += `我叫 ${p.identity.name}`;
    if (p.identity?.primary_language) out += `，主要用 ${p.identity.primary_language} 交流`;
    if (p.identity?.location_hint) out += `，在 ${p.identity.location_hint}`;
    out += `。\n\n`;

    if (p.communication_style?.response_expectations?.length) {
      out += `## 和我沟通的要求\n`;
      p.communication_style.response_expectations.forEach(r => out += `- ${r}\n`);
      out += `\n`;
    }
    if (p.communication_style?.dislikes?.length) {
      out += `## 我不喜欢的方式\n`;
      p.communication_style.dislikes.forEach(d => out += `- ${d}\n`);
      out += `\n`;
    }
    if (p.technical_profile) {
      out += `## 技术背景\n`;
      if (p.technical_profile.primary_machine) out += `- 主力设备: ${p.technical_profile.primary_machine}\n`;
      if (p.technical_profile.skill_level) out += `- 水平: ${p.technical_profile.skill_level}\n`;
      if (p.technical_profile.core_stack?.length) out += `- 技术栈: ${p.technical_profile.core_stack.join(", ")}\n`;
      if (p.technical_profile.familiar_tools?.length) out += `- 工具: ${p.technical_profile.familiar_tools.join(", ")}\n`;
      out += `\n`;
    }
    if (p.active_projects?.length) {
      out += `## 我的项目\n`;
      p.active_projects.forEach(proj => {
        out += `- **${proj.name}** [${proj.status}]: ${proj.description}\n`;
      });
      out += `\n`;
    }
    if (p.interests?.length) {
      out += `## 兴趣领域\n${p.interests.map(i => `- ${i}`).join("\n")}\n\n`;
    }
    if (p.lessons_learned?.length) {
      out += `## 历史教训\n${p.lessons_learned.map(l => `- ${l}`).join("\n")}\n\n`;
    }
    if (p.priority_memory_edits?.length) {
      out += `## 请写入你的Memory的条目（按优先级）\n`;
      p.priority_memory_edits.forEach((m, i) => out += `${i + 1}. ${m}\n`);
      out += `\n`;
    }
    out += `---\n请确认你已理解，并简要复述你对我的认知。`;
    return out;
  };

  const copy = async (text, key) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyState(key);
      setTimeout(() => setCopyState(""), 2500);
    } catch { setCopyState("fail"); }
  };

  const exportJSON = () => {
    const blob = new Blob([JSON.stringify(profile, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `memory_profile_${profile?.identity?.name || "user"}_${new Date().toISOString().split("T")[0]}.json`;
    a.click();
  };

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragActive(false);
    processUpload(e.dataTransfer.files);
  }, [processUpload]);

  // ── Styles ──
  const css = `
    :root {
      --void: #060609;
      --abyss: #0c0c14;
      --surface: #13131e;
      --surface-up: #1a1a2a;
      --edge: #252540;
      --edge-bright: #3a3a5c;
      --text: #d8d8e8;
      --text-2: #8888a8;
      --text-3: #5c5c78;
      --mint: #22ffaa;
      --mint-dim: rgba(34,255,170,0.08);
      --mint-mid: rgba(34,255,170,0.2);
      --ember: #ff6b4a;
      --indigo: #6366f1;
    }
    * { margin:0; padding:0; box-sizing:border-box; }
    body { background:var(--void); color:var(--text); }

    @keyframes fadeUp { from{opacity:0;transform:translateY(24px)} to{opacity:1;transform:translateY(0)} }
    @keyframes fadeIn { from{opacity:0} to{opacity:1} }
    @keyframes breathe { 0%,100%{opacity:.3} 50%{opacity:.8} }
    @keyframes slideIn { from{opacity:0;transform:translateX(-12px)} to{opacity:1;transform:translateX(0)} }
    @keyframes progressPulse { 0%,100%{box-shadow:0 0 8px var(--mint-dim)} 50%{box-shadow:0 0 20px var(--mint-mid)} }
    @keyframes spin { to{transform:rotate(360deg)} }

    ::-webkit-scrollbar{width:5px}
    ::-webkit-scrollbar-track{background:transparent}
    ::-webkit-scrollbar-thumb{background:var(--edge);border-radius:3px}
    ::-webkit-scrollbar-thumb:hover{background:var(--edge-bright)}

    .container { max-width:880px; margin:0 auto; padding:40px 24px; min-height:100vh; }

    .glass {
      background: linear-gradient(135deg, rgba(19,19,30,0.9), rgba(13,13,20,0.95));
      border: 1px solid var(--edge);
      border-radius: 16px;
      backdrop-filter: blur(20px);
    }

    .btn {
      font-family: 'IBM Plex Mono', monospace;
      font-size: 13px;
      font-weight: 500;
      padding: 11px 24px;
      border-radius: 10px;
      cursor: pointer;
      transition: all 0.25s;
      border: none;
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    .btn-mint {
      background: var(--mint);
      color: var(--void);
    }
    .btn-mint:hover { box-shadow: 0 0 28px rgba(34,255,170,0.25); transform:translateY(-1px); }
    .btn-mint:disabled { opacity:0.4; cursor:not-allowed; transform:none; box-shadow:none; }
    .btn-ghost {
      background: transparent;
      color: var(--text-2);
      border: 1px solid var(--edge);
    }
    .btn-ghost:hover { border-color:var(--mint); color:var(--mint); }
    .btn-ember {
      background: transparent;
      color: var(--ember);
      border: 1px solid rgba(255,107,74,0.3);
    }
    .btn-ember:hover { border-color:var(--ember); background:rgba(255,107,74,0.08); }

    .drop-zone {
      border: 2px dashed var(--edge);
      border-radius: 20px;
      padding: 64px 40px;
      text-align: center;
      cursor: pointer;
      transition: all 0.3s;
    }
    .drop-zone:hover, .drop-zone.active {
      border-color: var(--mint);
      background: var(--mint-dim);
    }

    .convo-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      border-radius: 10px;
      cursor: pointer;
      transition: background 0.15s;
      border: 1px solid transparent;
    }
    .convo-item:hover { background: var(--surface-up); }
    .convo-item.selected { border-color: var(--mint-mid); background: var(--mint-dim); }

    .check {
      width: 20px; height: 20px;
      border-radius: 6px;
      border: 2px solid var(--edge);
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
      transition: all 0.2s;
      font-size: 12px;
    }
    .check.on { border-color: var(--mint); background: var(--mint); color: var(--void); }

    .tag {
      font-size: 11px;
      padding: 3px 10px;
      border-radius: 20px;
      font-family: 'IBM Plex Mono', monospace;
      border: 1px solid var(--edge);
      color: var(--text-3);
    }

    .progress-bar {
      height: 4px;
      background: var(--surface-up);
      border-radius: 2px;
      overflow: hidden;
    }
    .progress-fill {
      height: 100%;
      background: var(--mint);
      border-radius: 2px;
      transition: width 0.5s ease;
    }

    .preview-box {
      background: var(--abyss);
      border: 1px solid var(--edge);
      border-radius: 12px;
      padding: 24px;
      font-family: 'IBM Plex Mono', monospace;
      font-size: 12.5px;
      line-height: 2;
      max-height: 480px;
      overflow-y: auto;
      white-space: pre-wrap;
      color: var(--text-2);
    }

    .profile-card {
      padding: 20px 24px;
      border-radius: 12px;
      border: 1px solid var(--edge);
      background: var(--surface);
    }

    .edit-input {
      width: 100%;
      background: var(--abyss);
      border: 1px solid var(--edge);
      border-radius: 8px;
      padding: 10px 14px;
      color: var(--text);
      font-size: 13px;
      font-family: 'Noto Sans SC', 'IBM Plex Mono', sans-serif;
      outline: none;
      transition: border-color 0.2s;
    }
    .edit-input:focus { border-color: var(--mint); }

    .section-label {
      font-family: 'IBM Plex Mono', monospace;
      font-size: 11px;
      color: var(--text-3);
      text-transform: uppercase;
      letter-spacing: 0.1em;
      margin-bottom: 10px;
    }

    .step-indicator {
      display: flex;
      gap: 4px;
      align-items: center;
    }
    .step-dot {
      width: 28px;
      height: 3px;
      border-radius: 2px;
      background: var(--edge);
      transition: all 0.3s;
    }
    .step-dot.active { background: var(--mint); width: 40px; }
    .step-dot.done { background: var(--mint); opacity: 0.4; }

    .spinner {
      width: 16px; height: 16px;
      border: 2px solid var(--edge);
      border-top-color: var(--mint);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    .logo-glyph {
      width: 56px; height: 56px;
      border-radius: 14px;
      background: linear-gradient(135deg, var(--mint-dim), rgba(99,102,241,0.1));
      border: 1px solid var(--mint-mid);
      display: flex; align-items: center; justify-content: center;
      font-size: 26px;
    }
  `;

  const stepIndex = { landing: 0, upload: 1, processing: 2, review: 3, inject: 4 };
  const steps = ["landing", "upload", "processing", "review", "inject"];

  // ════════════════════════════════════
  // RENDER
  // ════════════════════════════════════

  return (
    <>
      <style>{css}</style>
      <link href={FONT_URL} rel="stylesheet" />

      <div className="container" style={{ fontFamily: "'Noto Sans SC', 'DM Sans', sans-serif" }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 48 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div className="logo-glyph">⟐</div>
            <div>
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600, fontSize: 16, letterSpacing: "-0.02em" }}>
                Memory Transplant
              </div>
              <div style={{ color: "var(--text-3)", fontSize: 12, fontFamily: "'IBM Plex Mono', monospace" }}>
                你的记忆属于你
              </div>
            </div>
          </div>
          <div className="step-indicator">
            {steps.map((s, i) => (
              <div key={s} className={`step-dot ${i === stepIndex[phase] ? "active" : i < stepIndex[phase] ? "done" : ""}`} />
            ))}
          </div>
        </div>

        {/* ── LANDING ── */}
        {phase === "landing" && (
          <div style={{ animation: "fadeUp 0.6s ease", textAlign: "center", paddingTop: 60 }}>
            <h1 style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 36,
              fontWeight: 600,
              letterSpacing: "-0.03em",
              marginBottom: 16,
              background: "linear-gradient(135deg, var(--text), var(--mint))",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}>
              Claude 记忆移植
            </h1>
            <p style={{ color: "var(--text-2)", fontSize: 16, maxWidth: 480, margin: "0 auto 48px", lineHeight: 1.8 }}>
              从旧账号的导出数据中提炼记忆，一键注入新的Claude。
              <br />AI驱动的智能提炼，不是简单复制粘贴。
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, maxWidth: 640, margin: "0 auto 48px" }}>
              {[
                { icon: "📦", title: "上传导出数据", desc: "Claude Settings → Export" },
                { icon: "🧠", title: "AI 智能提炼", desc: "从对话中提取你的画像" },
                { icon: "⚡", title: "一键注入", desc: "粘贴到新Claude即刻恢复" },
              ].map((step, i) => (
                <div key={i} className="glass" style={{ padding: 24, textAlign: "center" }}>
                  <div style={{ fontSize: 28, marginBottom: 12 }}>{step.icon}</div>
                  <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>{step.title}</div>
                  <div style={{ fontSize: 12, color: "var(--text-3)" }}>{step.desc}</div>
                </div>
              ))}
            </div>

            <button className="btn btn-mint" style={{ fontSize: 15, padding: "14px 36px" }}
              onClick={() => setPhase("upload")}>
              开始 →
            </button>

            <div style={{ marginTop: 56, color: "var(--text-3)", fontSize: 11, fontFamily: "'IBM Plex Mono', monospace" }}>
              数据完全本地处理 · 不上传任何服务器 · 开源
            </div>
          </div>
        )}

        {/* ── UPLOAD ── */}
        {phase === "upload" && (
          <div style={{ animation: "fadeUp 0.5s ease" }}>
            <h2 style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 22, fontWeight: 600, marginBottom: 8 }}>
              上传对话数据
            </h2>
            <p style={{ color: "var(--text-2)", fontSize: 14, marginBottom: 28 }}>
              去 Claude → Settings → Export Data，下载后将JSON文件拖入下方。
            </p>

            {conversations.length === 0 ? (
              <div
                className={`drop-zone ${dragActive ? "active" : ""}`}
                onDragOver={e => { e.preventDefault(); setDragActive(true); }}
                onDragLeave={() => setDragActive(false)}
                onDrop={handleDrop}
                onClick={() => fileRef.current?.click()}
              >
                <div style={{ fontSize: 40, marginBottom: 16, opacity: 0.6 }}>📂</div>
                <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 14, marginBottom: 8 }}>
                  拖入 JSON 文件 或 点击选择
                </div>
                <div style={{ color: "var(--text-3)", fontSize: 12 }}>
                  支持 conversations.json 或单个对话文件
                </div>
                <input ref={fileRef} type="file" accept=".json" multiple style={{ display: "none" }}
                  onChange={e => processUpload(e.target.files)} />
              </div>
            ) : (
              <>
                {/* Stats bar */}
                {stats && (
                  <div className="glass" style={{ padding: "14px 20px", marginBottom: 20, display: "flex", gap: 28 }}>
                    {[
                      { label: "对话", value: stats.convos },
                      { label: "消息", value: stats.messages.toLocaleString() },
                      { label: "字符", value: (stats.chars / 1000).toFixed(0) + "K" },
                    ].map(s => (
                      <div key={s.label}>
                        <span style={{ color: "var(--mint)", fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600, fontSize: 16 }}>{s.value}</span>
                        <span style={{ color: "var(--text-3)", fontSize: 12, marginLeft: 6 }}>{s.label}</span>
                      </div>
                    ))}
                    <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                      <button className="btn btn-ghost" style={{ fontSize: 11, padding: "6px 14px" }}
                        onClick={() => setSelectedConvos(new Set(conversations.map(c => c.id)))}>
                        全选
                      </button>
                      <button className="btn btn-ghost" style={{ fontSize: 11, padding: "6px 14px" }}
                        onClick={() => setSelectedConvos(new Set())}>
                        全不选
                      </button>
                    </div>
                  </div>
                )}

                {/* Conversation list */}
                <div style={{ maxHeight: 400, overflowY: "auto", marginBottom: 24 }}>
                  {conversations.map((c, i) => (
                    <div key={c.id}
                      className={`convo-item ${selectedConvos.has(c.id) ? "selected" : ""}`}
                      style={{ animation: `slideIn 0.3s ease ${Math.min(i * 0.03, 0.5)}s both` }}
                      onClick={() => {
                        const next = new Set(selectedConvos);
                        next.has(c.id) ? next.delete(c.id) : next.add(c.id);
                        setSelectedConvos(next);
                      }}
                    >
                      <div className={`check ${selectedConvos.has(c.id) ? "on" : ""}`}>
                        {selectedConvos.has(c.id) && "✓"}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: 13, fontWeight: 500,
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
                        }}>
                          {c.name}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>
                          {c.messages?.length || 0} 条消息
                          {c.updated && ` · ${c.updated.split("T")[0]}`}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {error && (
                  <div style={{ color: "var(--ember)", fontSize: 13, marginBottom: 16, padding: "12px 16px", background: "rgba(255,107,74,0.08)", borderRadius: 10, border: "1px solid rgba(255,107,74,0.2)" }}>
                    {error}
                  </div>
                )}

                <div style={{ display: "flex", gap: 12 }}>
                  <button className="btn btn-mint" onClick={distill}
                    disabled={selectedConvos.size === 0}>
                    🧠 开始提炼 ({selectedConvos.size} 个对话)
                  </button>
                  <button className="btn btn-ghost" onClick={() => { setConversations([]); setFiles([]); setStats(null); }}>
                    重新上传
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── PROCESSING ── */}
        {phase === "processing" && (
          <div style={{ animation: "fadeUp 0.5s ease", textAlign: "center", paddingTop: 80 }}>
            <div style={{ margin: "0 auto 32px", position: "relative" }}>
              <div className="logo-glyph" style={{ width: 80, height: 80, fontSize: 36, margin: "0 auto", animation: "breathe 2s ease-in-out infinite" }}>
                🧠
              </div>
            </div>
            <h2 style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 20, marginBottom: 12 }}>
              正在提炼你的记忆
            </h2>
            <p style={{ color: "var(--text-2)", fontSize: 14, marginBottom: 32 }}>
              {progress.status}
            </p>

            <div style={{ maxWidth: 400, margin: "0 auto" }}>
              <div className="progress-bar" style={{ marginBottom: 12 }}>
                <div className="progress-fill"
                  style={{ width: `${progress.total ? (progress.current / progress.total) * 100 : 0}%` }}
                />
              </div>
              <div style={{ color: "var(--text-3)", fontSize: 12, fontFamily: "'IBM Plex Mono', monospace" }}>
                {progress.current}/{progress.total} 批次
              </div>
            </div>

            {error && (
              <div style={{ color: "var(--ember)", fontSize: 12, marginTop: 20 }}>{error}</div>
            )}
          </div>
        )}

        {/* ── REVIEW ── */}
        {phase === "review" && profile && (
          <div style={{ animation: "fadeUp 0.5s ease" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 28 }}>
              <div>
                <h2 style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 22, fontWeight: 600, marginBottom: 4 }}>
                  记忆画像
                </h2>
                <p style={{ color: "var(--text-2)", fontSize: 13 }}>
                  AI 提炼完成。审核并编辑后生成注入Prompt。
                </p>
              </div>
              <button className="btn btn-ghost" onClick={() => setEditMode(!editMode)}>
                {editMode ? "完成编辑" : "✏️ 编辑"}
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Identity */}
              <div className="profile-card">
                <div className="section-label">身份</div>
                {editMode ? (
                  <div style={{ display: "grid", gap: 8 }}>
                    <input className="edit-input" value={profile.identity?.name || ""} placeholder="称呼"
                      onChange={e => setProfile(p => ({ ...p, identity: { ...p.identity, name: e.target.value } }))} />
                    <input className="edit-input" value={profile.identity?.primary_language || ""} placeholder="语言"
                      onChange={e => setProfile(p => ({ ...p, identity: { ...p.identity, primary_language: e.target.value } }))} />
                  </div>
                ) : (
                  <div style={{ fontSize: 15 }}>
                    <strong>{profile.identity?.name || "未知"}</strong>
                    {profile.identity?.primary_language && <span style={{ color: "var(--text-2)" }}> · {profile.identity.primary_language}</span>}
                    {profile.identity?.location_hint && <span style={{ color: "var(--text-2)" }}> · {profile.identity.location_hint}</span>}
                  </div>
                )}
              </div>

              {/* Communication */}
              {(profile.communication_style?.response_expectations?.length > 0 || profile.communication_style?.dislikes?.length > 0) && (
                <div className="profile-card">
                  <div className="section-label">沟通偏好</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {(profile.communication_style?.response_expectations || []).map((r, i) => (
                      <span key={i} className="tag" style={{ borderColor: "var(--mint-mid)", color: "var(--mint)" }}>{r}</span>
                    ))}
                    {(profile.communication_style?.dislikes || []).map((d, i) => (
                      <span key={`d-${i}`} className="tag" style={{ borderColor: "rgba(255,107,74,0.3)", color: "var(--ember)" }}>✕ {d}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Tech */}
              {profile.technical_profile && (
                <div className="profile-card">
                  <div className="section-label">技术画像</div>
                  {profile.technical_profile.primary_machine && (
                    <div style={{ marginBottom: 8, fontSize: 14 }}>💻 {profile.technical_profile.primary_machine}</div>
                  )}
                  {profile.technical_profile.core_stack?.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {profile.technical_profile.core_stack.map((s, i) => (
                        <span key={i} className="tag">{s}</span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Projects */}
              {profile.active_projects?.length > 0 && (
                <div className="profile-card">
                  <div className="section-label">项目</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {profile.active_projects.map((proj, i) => (
                      <div key={i} style={{ display: "flex", gap: 12, alignItems: "baseline" }}>
                        <span style={{ color: "var(--mint)", fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, flexShrink: 0 }}>
                          [{proj.status || "active"}]
                        </span>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 14 }}>{proj.name}</div>
                          {proj.description && <div style={{ color: "var(--text-2)", fontSize: 12, marginTop: 2 }}>{proj.description}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Memory edits */}
              {profile.priority_memory_edits?.length > 0 && (
                <div className="profile-card">
                  <div className="section-label">
                    优先记忆条目 ({profile.priority_memory_edits.length}/30)
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {profile.priority_memory_edits.map((m, i) => (
                      <div key={i} style={{ display: "flex", gap: 10, alignItems: "start", fontSize: 13 }}>
                        <span style={{ color: "var(--text-3)", fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, flexShrink: 0, marginTop: 2 }}>
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        {editMode ? (
                          <input className="edit-input" value={m}
                            onChange={e => {
                              const next = [...profile.priority_memory_edits];
                              next[i] = e.target.value;
                              setProfile(p => ({ ...p, priority_memory_edits: next }));
                            }}
                          />
                        ) : (
                          <span style={{ color: "var(--text-2)", lineHeight: 1.6 }}>{m}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div style={{ display: "flex", gap: 12, marginTop: 28 }}>
              <button className="btn btn-mint" onClick={() => setPhase("inject")}>
                生成注入 Prompt →
              </button>
              <button className="btn btn-ghost" onClick={exportJSON}>
                📦 导出 JSON
              </button>
              <button className="btn btn-ghost" onClick={() => setPhase("upload")}>
                ← 重新选择
              </button>
            </div>
          </div>
        )}

        {/* ── INJECT ── */}
        {phase === "inject" && (
          <div style={{ animation: "fadeUp 0.5s ease" }}>
            <h2 style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 22, fontWeight: 600, marginBottom: 8 }}>
              注入 Prompt
            </h2>
            <p style={{ color: "var(--text-2)", fontSize: 14, marginBottom: 24, lineHeight: 1.7 }}>
              复制以下内容 → 打开新的Claude会话 → 粘贴为第一条消息 → 完成。
            </p>

            <div className="preview-box">
              {generatePrompt()}
            </div>

            <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
              <button className="btn btn-mint"
                onClick={() => copy(generatePrompt(), "prompt")}>
                {copyState === "prompt" ? "✓ 已复制到剪贴板" : "📋 复制 Prompt"}
              </button>
              <button className="btn btn-ghost"
                onClick={() => copy(JSON.stringify(profile, null, 2), "json")}>
                {copyState === "json" ? "✓ 已复制" : "复制 Raw JSON"}
              </button>
              <button className="btn btn-ghost" onClick={exportJSON}>
                📦 下载文件
              </button>
            </div>

            <div className="glass" style={{ padding: 20, marginTop: 28 }}>
              <div className="section-label" style={{ marginBottom: 12 }}>使用说明</div>
              <div style={{ color: "var(--text-2)", fontSize: 13, lineHeight: 2.2 }}>
                <strong style={{ color: "var(--mint)" }}>方法一（推荐）：</strong>复制上方Prompt粘贴为新对话的第一条消息。Claude会立刻理解你的画像，并确认。<br />
                <strong style={{ color: "var(--indigo)" }}>方法二：</strong>手动将「优先记忆条目」逐条添加到 Claude 的 Memory 设置中（Settings → Memory → Edit）。<br />
                <strong style={{ color: "var(--text-2)" }}>方法三：</strong>两者结合——先用Prompt冷启动，再让Claude帮你把关键信息写入Memory。
              </div>
            </div>

            <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
              <button className="btn btn-ghost" onClick={() => setPhase("review")}>
                ← 返回编辑
              </button>
              <button className="btn btn-ghost" onClick={() => {
                setPhase("landing");
                setProfile(null);
                setConversations([]);
                setSelectedConvos(new Set());
                setStats(null);
                setError("");
              }}>
                🔄 重新开始
              </button>
            </div>
          </div>
        )}

        {/* Footer */}
        <div style={{
          marginTop: 80,
          paddingTop: 20,
          borderTop: "1px solid var(--edge)",
          display: "flex",
          justifyContent: "space-between",
          color: "var(--text-3)",
          fontSize: 11,
          fontFamily: "'IBM Plex Mono', monospace",
        }}>
          <span>Memory Transplant v1.0 · Open Source</span>
          <span>数据不离开你的浏览器</span>
        </div>
      </div>
    </>
  );
}
