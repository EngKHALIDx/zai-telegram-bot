# 🤖 Z.ai Telegram Agent v15.0

Real-time Agent Mode Telegram Bot - Works like chat.z.ai agent!

## ✨ Features

- 🤖 **Agent Mode Only** - Like chat.z.ai Agent, not chat
- ⏳ **Real-time Display** - Shows every step as it happens (tool, input, output, duration)
- ⏹️ **Stop Button** - Stop any operation instantly
- ⏱️ **Live Timer** - Shows elapsed time, step count, progress
- 🔄 **Iterative Tool Calling** - AI calls tools, sees results, continues until done
- 📝 **Session Based** - Each task is a clean session
- 🌟 **6 AI Models** - GLM-5.1, Plus, Vision, Flash, etc.
- 🔧 **13 Tools** - Shell, code execution, web search, image gen, GitHub push, etc.
- 👁️ **Vision** - Analyze images
- 🔒 **User Auth** - Restrict access
- ⏰ **24/7** - GitHub Actions

## 📋 Commands

- `/start` / `/help` - Show help
- `/new` - New session (clean)
- `/model` - Choose model
- `/think` - Toggle deep thinking
- `/stop` - Stop current operation
- `/status` - Show running operation
- `/reset` - Reset everything

Just send any message and the agent starts working!

## 🚀 Setup

```bash
git clone https://github.com/EngKHALIDx/zai-telegram-bot.git
cd zai-telegram-bot
npm install
cp .env.example .env
# Edit .env
npm start
```

## 📁 Structure

```
src/
├── index.ts       # Main: polling, commands, agent loop
├── tools.ts       # 13 tools with real-time display
├── operations.ts  # Real-time operation display system
├── zai.ts         # Z.ai API client
├── telegram.ts    # Telegram API with edit support
```

## 🎯 How It Works

1. User sends a request
2. Bot calls Z.ai API with system prompt + tools
3. If AI wants to use a tool → parse & execute
4. Show each step in real-time (tool name, input, output, duration)
5. Send results back to AI for next iteration
6. Repeat until AI gives final answer
7. All with a ⏹️ Stop button!

## License

MIT
