# tossinvest-openapi-mcp

> An [MCP](https://modelcontextprotocol.io) (Model Context Protocol) server that helps developers and AI agents **explore and integrate the Toss Securities (토스증권) Open API**.

[![npm version](https://img.shields.io/npm/v/tossinvest-openapi-mcp.svg)](https://www.npmjs.com/package/tossinvest-openapi-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![MCP](https://img.shields.io/badge/MCP-stdio-blue.svg)](https://modelcontextprotocol.io)
[![Node](https://img.shields.io/badge/node-%3E%3D18-green.svg)](https://nodejs.org)

**Languages:** [한국어](README.md) · **English** · [日本語](README.ja.md)

This server bundles the Toss Securities Open API specification and exposes it as MCP tools. It is a **read-only documentation/exploration server** — it does **not** call the real API, place orders, or require any credentials. Point your AI coding agent (Claude, Cursor, etc.) at it and ask things like *"How do I place an order with the Toss API?"* to get accurate, spec-grounded answers and code samples.

---

## What it does

When connected to an MCP client, this server lets an agent:

- Browse every endpoint and category of the Toss Securities Open API
- Read full request/response schemas with examples
- Search endpoints and data models by keyword
- Follow task-oriented integration guides (auth, market data, trading, …)
- Generate ready-to-adapt request snippets in **curl / TypeScript / Python**

> ⚠️ **Disclaimer**: This is an **unofficial** helper that *describes* the Toss Securities public OpenAPI document. It does not execute trades, access accounts, or transmit credentials. Always verify against the official Toss Securities documentation before going to production.

## Available tools

| Tool | Purpose |
|---|---|
| `get_api_overview` | High-level map of the API (start here) |
| `list_categories` | List all categories (tags) with descriptions |
| `list_endpoints` | List endpoints, optionally filtered by category |
| `search_endpoints` | Keyword search across endpoints |
| `get_endpoint` | Full detail of one endpoint (params, body, responses) |
| `list_schemas` | List / filter data model names |
| `get_schema` | Field tree of one data model |
| `get_integration_guide` | Task-oriented walkthrough with a call sequence |
| `generate_code_sample` | curl / TypeScript / Python snippet for an endpoint |

## Requirements

- [Node.js](https://nodejs.org) **18 or newer**
- An MCP-compatible client (Claude Desktop, Claude Code, Cursor, …)

## Installation & usage (stdio)

This server speaks MCP over **stdio**. Pick a **run command**, then paste the matching block into your MCP client config.

**Run commands**

| Source | Command / args |
|---|---|
| **npm (recommended)** | `npx` · `-y`, `tossinvest-openapi-mcp` |
| GitHub (runs the latest source without npm) | `npx` · `-y`, `github:JeongSeongMok/tossinvest-openapi-mcp` |
| From source (after `git clone` + `npm install` + `npm run build`) | `node` · `/absolute/path/to/tossinvest-openapi-mcp/dist/index.js` |

> With Node.js 18+, `npx -y tossinvest-openapi-mcp` runs the published package directly. The GitHub command instead clones, builds, and runs the repository source — use it when you always want the latest code.

### Claude (Claude Desktop / Claude Code / Cursor) — JSON

```jsonc
{
  "mcpServers": {
    "tossinvest-openapi": {
      "command": "npx",
      "args": ["-y", "tossinvest-openapi-mcp"]
    }
  }
}
```

### Codex CLI — TOML (`~/.codex/config.toml`)

```toml
[mcp_servers.tossinvest-openapi]
command = "npx"
args = ["-y", "tossinvest-openapi-mcp"]
```

### Config file locations

- **Claude Desktop**: `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) / `%APPDATA%\Claude\claude_desktop_config.json` (Windows)
- **Claude Code**: project `.mcp.json`, or run `claude mcp add tossinvest-openapi -- npx -y tossinvest-openapi-mcp`
- **Codex CLI**: `~/.codex/config.toml`
- **Cursor**: `~/.cursor/mcp.json`

Restart the client after editing the config. The tools listed above will then be available to the agent.

## Quick verification

```bash
npm run build
node dist/index.js
# → "tossinvest-openapi-mcp running on stdio" on stderr; the process then waits for MCP messages on stdin.
```

## Development

```
src/
├─ index.ts        # stdio entry point
├─ server.ts       # MCP server + tool registrations
├─ format.ts       # agent-readable markdown rendering
├─ codegen.ts      # curl / TS / Python sample generation
├─ guides.ts       # curated integration guides
└─ spec/store.ts   # loads & indexes openapi.json, resolves $ref
```

The Toss Securities OpenAPI document lives at `openapi.json` in the repo root and is bundled into the published package. To update the spec, replace that file and rebuild.

## License

[MIT](LICENSE)
