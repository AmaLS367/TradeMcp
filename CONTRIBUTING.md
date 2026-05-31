# 🤝 Contributing to Trade MCP

Thanks for your interest in contributing to Trade MCP! 🎉 We welcome contributions from developers of all skill levels to help make remote algorithmic trading safer and more accessible.

[Quick Start](#-quick-start) · [Code Style](#-code-style) · [Development Flow](#-development-flow) · [Pull Requests](#-pull-requests) · [Security](SECURITY.md)

---

## 📋 How to Contribute

1. **Fork** the repository on GitHub.
2. **Clone** your fork locally and set up the repository.
3. **Create a branch** for your work: `git checkout -b feat/my-feature-name`.
4. **Implement** your feature or bugfix, ensuring strict adherence to TypeScript conventions.
5. **Run tests** and verify everything builds cleanly:
   ```bash
   npm run lint
   npm test
   ```
6. **Commit** your changes using [Conventional Commits](https://www.conventionalcommits.org/):
   - `feat(earn): add flexible yield tool`
   - `fix(bybit): resolve invalid parameter 180001`
   - `docs(mcp): update client setup guides`
7. **Push** your branch to your fork: `git push origin feat/my-feature-name`.
8. **Open a Pull Request** against the `main` branch of the upstream repository.

---

## ⚡ Quick Start

Setting up Trade MCP locally takes less than five minutes:

```bash
# 1. Clone your fork
git clone https://github.com/YOUR_USERNAME/TradeMcp.git
cd TradeMcp

# 2. Install development dependencies
npm install

# 3. Create your local config
cp .env.example .env
cp firebase-applet-config.example.json firebase-applet-config.json

# 4. Generate a local encryption key
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 5. Fill out the .env file with your key and Firebase credentials

# 6. Start the local development server
npm run dev
```

---

## 📐 Code Style

We maintain a strict and highly consistent codebase:

| Standard | Rule & Enforcement |
|---|---|
| **Language** | All source code, comments, docstrings, and commit messages must be in **English**. |
| **TypeScript** | Strict type-safety enabled (`tsconfig.json`). Explicit return types are preferred on all core functions. |
| **Linting** | Ensure zero TypeScript compile errors or warnings. Run `npm run lint` before committing. |
| **DRY Connections** | Never access Firestore credentials directly in new tools. Always leverage the unified `createExchange` or `createExchangeClient` wrappers. |
| **Testing** | Include unit/integration tests under `src/server/` with the `.test.ts` naming convention. |

---

## 🐛 Issues and Bug Reports

If you encounter unexpected errors or have a feature suggestion, please open a detailed issue on our GitHub issues page. Include:
- A clear description of the problem or feature request.
- The environment configuration (Docker vs Node, OS, AI Client version).
- Full console outputs, API error payloads, or step-by-step reproduction steps.

---

Thank you for helping us build a more secure future for agentic trading! 💎
