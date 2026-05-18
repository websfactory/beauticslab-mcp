# BeauticsLab MCP

**"Are there any irritants in my skincare routine?" Just ask Claude.**

BeauticsLab MCP brings Korean cosmetics catalogs (Olive Young, Daiso, and e-commerce listings on Naver, Coupang, 11st) together with the skincare routines you've saved on BeauticsLab, all inside the AI tool you already use. Search products, look up your routines, analyze full ingredient lists.

Service: [beauticslab.com](https://beauticslab.com) · [한국어](./README.md) · [Smithery](https://smithery.ai/servers/websfactoryinfo/beauticslab)

![BeauticsLab MCP demo](./docs/demo.gif)

> Calling BeauticsLab MCP from Claude Code: vitamin C serum recommendation → routine lookup → overlap check, all in one conversation. ([HD video](https://github.com/user-attachments/assets/70f9f9ac-2a72-466c-9c19-9f5e7a3576a1))

---

## At a glance

- **Server URL**: `https://mcp.beauticslab.com/mcp`
- **Connect**: Add the URL under "Custom Connector / MCP Server" in your AI tool, sign in with your BeauticsLab account, approve access.
- **Account**: Same Google / Kakao login you use on beauticslab.com.
- **Status**: Beta (free).

---

## What you can do

Just talk to your AI normally.

- 🔍 **"Recommend an alcohol-free toner for dry skin"** → Searches Olive Young, Daiso, and major Korean e-commerce listings, plus BeauticsLab's verified custom catalog.
- 📋 **"Show me my evening routine"** → Returns the skincare routine you saved on BeauticsLab.
- 🧪 **"Are there irritants in Dr. Different Vita-Lift?"** → Full ingredient list (Korean + English) with EWG grades.

The AI then takes those results and does the comparing, recommending, and answering in one go.

> Read-only. Nothing is created or modified.

---

## Tools

| Tool | Description |
|---|---|
| `search_product` | Keyword product search (Korean queries recommended). Four sources: Olive Young, Daiso, Korean e-commerce (Naver, Coupang, 11st, etc.), and verified custom items. |
| `get_my_routine` | Your BeauticsLab routines, the products inside, and (optionally) a summary of key ingredients. |
| `get_product_ingredients` | Full ingredient list + EWG grades for a single product. Pass the `goodsNo` returned by the other two tools. |

The intended flow: find products via search or routine, then drill into a specific one with `get_product_ingredients`.

No access to other users' data. Strictly your own account.

---

## Connecting

Each AI tool connects differently. Read only the section for the tool you actually use.

> Guidance below is current as of 2026-05-13. UI labels and menu locations change.

### Claude Desktop · claude.ai

**Claude Desktop**
1. Open `Settings → Connectors`.
2. Click **"Add custom connector"** at the bottom.
3. Enter `https://mcp.beauticslab.com/mcp` and click Add.
4. A new browser window prompts BeauticsLab login → "Allow" → returns to Claude.
5. In a new chat, try "Show me my BeauticsLab routine."

**claude.ai web (Pro/Max)**
1. `Customize → Connectors → +` (Add custom connector).
2. Enter the URL, then proceed as above.

**claude.ai Team / Enterprise**
- Org owner: register via `Organization settings → Connectors → Add → Custom → Web`.
- Members: enable from `Customize → Connectors`.

> Leave the Client ID / Secret fields under Advanced settings **blank**. The server handles Dynamic Client Registration (DCR).

Reference: [Anthropic: Custom connectors with remote MCP](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)

---

### Claude Code (CLI)

Register with one command:

```bash
claude mcp add --transport http beauticslab https://mcp.beauticslab.com/mcp
```

Or edit `.mcp.json` in your project root directly:

```json
{
  "mcpServers": {
    "beauticslab": {
      "type": "http",
      "url": "https://mcp.beauticslab.com/mcp"
    }
  }
}
```

On first call a browser OAuth window opens. Sign in to BeauticsLab → "Allow" → verify with `claude mcp list` showing `beauticslab ... ✓ Connected`.

Reference: [Anthropic: Claude Code MCP](https://docs.claude.com/en/docs/claude-code/mcp)

---

### ChatGPT

> As of 2025-12-17, ChatGPT officially labels "Connectors" as **"Apps"**.

1. `Settings → Apps & Connectors → Advanced settings → Developer Mode` → toggle ON.
2. `Settings → Apps & Connectors → Create`.
3. Fill in:
   - Name: `BeauticsLab`
   - Connector URL: `https://mcp.beauticslab.com/mcp`
4. Save → an OAuth page opens → sign in to BeauticsLab → allow.
5. Call BeauticsLab tools from a new conversation.

> ChatGPT shows an "unverified custom MCP server" warning banner on registration. That's expected.

Reference: [OpenAI: Connect from ChatGPT (Apps SDK)](https://developers.openai.com/apps-sdk/deploy/connect-chatgpt)

---

### Cursor

Config file (pick one):
- Global: `~/.cursor/mcp.json`
- Per-project: `<project>/.cursor/mcp.json`

Contents:

```json
{
  "mcpServers": {
    "beauticslab": {
      "url": "https://mcp.beauticslab.com/mcp"
    }
  }
}
```

Or via UI: `Cursor Settings → Tools & MCP → New MCP Server`.

On save, Cursor opens a browser OAuth popup. Sign in → allow → credentials stay inside Cursor (never written to JSON).

Reference: [Cursor: Model Context Protocol](https://cursor.com/docs/mcp)

---

### VS Code (GitHub Copilot Chat)

Config file:
- Workspace: `.vscode/mcp.json`
- User-global: Command Palette → `MCP: Open User Configuration`

Contents:

```json
{
  "servers": {
    "beauticslab": {
      "type": "http",
      "url": "https://mcp.beauticslab.com/mcp"
    }
  }
}
```

Reference: [VS Code: MCP configuration reference](https://code.visualstudio.com/docs/copilot/reference/mcp-configuration)

---

### Cline (VS Code extension)

The smoothest verified OAuth + DCR flow.

1. Cline sidebar → **Remote Servers** tab.
2. Enter URL: `https://mcp.beauticslab.com/mcp`.
3. Click **Authenticate** → browser OAuth → credentials persisted.

Or edit config directly:

```json
{
  "mcpServers": {
    "beauticslab": {
      "url": "https://mcp.beauticslab.com/mcp",
      "type": "streamableHttp",
      "disabled": false,
      "autoApprove": [],
      "timeout": 60
    }
  }
}
```

Reference: [Cline: Connecting to a Remote Server](https://docs.cline.bot/mcp/connecting-to-a-remote-server)

---

### Zed

Add to `settings.json` under `context_servers`:

```json
{
  "context_servers": {
    "beauticslab": {
      "url": "https://mcp.beauticslab.com/mcp"
    }
  }
}
```

Save without an Authorization header, and Zed walks you through the standard MCP OAuth flow.

Reference: [Zed: Model Context Protocol](https://zed.dev/docs/ai/mcp)

---

### Other MCP-compatible clients

Any client that meets these requirements works:

- Supports MCP **Streamable HTTP** transport.
- Supports **OAuth 2.1 + PKCE (S256)**.
- Ideally supports **Dynamic Client Registration (DCR)**. Without DCR, a pre-registered client is required.

All you need is the endpoint: `https://mcp.beauticslab.com/mcp`.

Per-client compatibility: see [modelcontextprotocol.io/clients](https://modelcontextprotocol.io/clients).

---

## Authentication / Permissions

- Protocol: OAuth 2.1 + PKCE (S256) + Dynamic Client Registration
- Scope: `mcp:read` (read-only)
- Identity: BeauticsLab account (Google / Kakao social login)
- No anonymous mode. Every call requires a user context.

Server metadata (for verification):
- `https://mcp.beauticslab.com/.well-known/oauth-protected-resource`
- `https://mcp.beauticslab.com/.well-known/oauth-authorization-server`

---

## FAQ

**Q. Is my routine data sent anywhere external?**
No. Access happens only within the AI session you logged into, and responses go back only to that client. You cannot see anyone else's data.

**Q. Which AI tools are supported?**
Verified: Claude Desktop, claude.ai, ChatGPT, Cursor, Cline, Zed, VS Code (Copilot Chat). Any client implementing the MCP standard (Streamable HTTP + OAuth 2.1, spec 2025-11-25) should also work.

**Q. Where does the data come from?**
Public catalogs from Olive Young, Daiso, and Korean e-commerce (Naver, Coupang, 11st, etc.), plus custom products verified by BeauticsLab.

**Q. Korean or English: which searches better?**
Korean. English works but accuracy drops.

**Q. How do I disconnect or revoke access?**
Remove the BeauticsLab entry from your AI tool's Connectors / MCP settings. Tokens are stored client-side and expire automatically.

**Q. Any usage limits?**
No SLA during beta. Abnormal traffic patterns may be throttled.

---

## Support

- Questions / issue reports: [KakaoTalk inquiry on the BeauticsLab site](https://beauticslab.com)

---

## License

Proprietary. All rights reserved. © BeauticsLab.
