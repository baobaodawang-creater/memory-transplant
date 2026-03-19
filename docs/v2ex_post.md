[开源] Memory Transplant — Claude 记忆迁移工具

做了个工具解决一个实际问题：Claude 账号没了，记忆不能没。

用过 Claude 的人都知道，用久了它会越来越懂你。你的技术栈、沟通习惯、项目上下文、踩过的坑，它全记着。这些东西是你和它几百轮对话换来的，不该因为一次封号就蒸发。

所以这个工具的逻辑是：导出对话 → AI 提炼记忆画像 → 一键注入新账号。三步，搞定。

技术栈：React 18 + Vite，纯前端，无后端。AI 提炼调 Claude Sonnet API，直接从浏览器发请求，不过任何中间服务器。

说实话，很多人——尤其是开发者和深度用户——每天都在担心账号安全。生活压力已经够大了，别再给自己加这份焦虑。装好安全网，然后放心大胆地用。

v1.0 第一版，可能有不完善的地方，会持续更新。

GitHub: https://github.com/baobaodawang-creater/memory-transplant
在线版: https://memory-transplant-20260319153048.netlify.app
附 Word 版用户手册，macOS/Windows 安装教程都有。

你的记忆属于你。欢迎 star / PR / issue。
