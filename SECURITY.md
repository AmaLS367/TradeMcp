# 🔒 Security Policy

We take the security of Trade MCP, user connection keys, and execution boundaries very seriously. Since Trade MCP manages encrypted API credentials and trade proposals, maintaining a highly secure code environment is our top priority.

[Supported Versions](#-supported-versions) · [Reporting a Vulnerability](#-reporting-a-vulnerability) · [Encryption Architecture](#-encryption-architecture)

---

## ✅ Supported Versions

We actively maintain and secure the latest major release of Trade MCP. Please ensure you are running a supported version:

| Version | Supported | Status |
|---|---|---|
| Latest Release | ✅ **Yes** | Fully supported. Active security patches. |
| Pre-release / Dev | ⚠️ **Partial** | Monitored, but recommended for testing only. |
| Older Versions | ❌ **No** | Not maintained. Please upgrade immediately. |

---

## 🚨 Reporting a Vulnerability

If you discover a security vulnerability in Trade MCP, please **do not report it publicly**. Reporting security concerns publicly can expose user credentials and live portfolios to unnecessary risk.

### How to Report Privately:
1. Navigate to [🔐 Report a Security Advisory on GitHub](https://github.com/AmaLS367/TradeMcp/security/advisories/new).
2. Provide a detailed summary containing:
   - 📌 **Description:** A description of the vulnerability and its potential scope.
   - 🔄 **Reproduction:** Step-by-step instructions or proof-of-concept scripts to reproduce the issue.
   - 💥 **Impact:** The estimated blast radius (e.g. read-only metadata leak, execution bypass).
   - 🔧 **Suggested Fix:** A proposed fix or mitigation strategy (if available).

We will investigate all reports promptly and coordinate a patch release prior to public disclosure.

---

## 🏗️ Encryption Architecture

Trade MCP is built with security as a foundational layer:
- **AES-256-GCM:** All user-supplied exchange keys and data provider secrets are encrypted locally using AES-256-GCM before writing to the database.
- **Key Isolation:** The encryption key (`ENCRYPTION_KEY`) is stored entirely in memory via environmental variables and is never written to Firestore.
- **OAuth Scope Verification:** All client connections are validated via OAuth 2.0 PKCE, restricting tool access according to client profiles.
