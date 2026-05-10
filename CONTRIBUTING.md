# 🤝 Contributing to Trade MCP

> Thanks for your interest in contributing! 🎉

![PRs](https://img.shields.io/badge/PRs-welcome-brightgreen) ![Conventional Commits](https://img.shields.io/badge/commits-conventional-blue)

---

## 📋 How to Contribute

1. 🍴 **Fork** the repository
2. 🌿 **Create a branch**: `git checkout -b feat/my-feature`
3. ✏️ **Make your changes**
4. ✅ **Run checks**:
   ```bash
   npm test
   npm run lint
   ```
5. 💬 **Commit** with [conventional format](https://www.conventionalcommits.org/):
   - `feat:` — new feature
   - `fix:` — bug fix
   - `docs:` — documentation
   - `chore:` — maintenance, CI
6. 🚀 **Push** and open a **Pull Request**

---

## 🛠️ Setup

```bash
# 1. Clone your fork
git clone https://github.com/YOUR_USERNAME/TradeMcp.git
cd TradeMcp

# 2. Install dependencies
npm install

# 3. Create config files
cp .env.example .env
cp firebase-applet-config.example.json firebase-applet-config.json

# 4. Start dev server
npm run dev
```

> 📌 You'll need a **Firebase project** and a **64-char hex encryption key**. See `.env.example` for details.

---

## 📐 Code Style

| Rule | Description |
|------|-------------|
| 🟦 **TypeScript** | Strict mode enabled |
| 📦 **ESM** | Use `import` with `.js` extensions |
| 🌐 **Language** | All text and errors in **English** |
| 🧪 **Tests** | Required for new features |

---

## ❓ Questions?

Open a [Discussion](https://github.com/AmaLS367/TradeMcp/discussions) or an [Issue](https://github.com/AmaLS367/TradeMcp/issues).
