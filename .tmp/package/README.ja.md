# tossinvest-openapi-mcp

> **トス証券（토스증권）Open API** を開発者や AI エージェントが簡単に探索・連携できるよう支援する [MCP](https://modelcontextprotocol.io)（Model Context Protocol）サーバー。

[![npm version](https://img.shields.io/npm/v/tossinvest-openapi-mcp.svg)](https://www.npmjs.com/package/tossinvest-openapi-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![MCP](https://img.shields.io/badge/MCP-stdio-blue.svg)](https://modelcontextprotocol.io)
[![Node](https://img.shields.io/badge/node-%3E%3D18-green.svg)](https://nodejs.org)

**言語:** [한국어](README.md) · [English](README.en.md) · **日本語**

本サーバーはトス証券の OpenAPI 仕様を同梱し、MCP ツールとして提供します。**読み取り専用のドキュメント／探索サーバー** であり、実際の API 呼び出しや注文の実行は行わず、認証情報も一切必要ありません。AI コーディングエージェント（Claude、Cursor など）に接続し、*「トス API で注文を出すには？」* のように尋ねると、仕様に基づいた正確な回答とコードサンプルが得られます。

---

## 概要

MCP クライアントに接続すると、エージェントは次のことができます。

- トス証券 Open API の全エンドポイント・カテゴリの閲覧
- リクエスト／レスポンススキーマと例の参照
- キーワードによるエンドポイント・データモデル検索
- ユースケース志向の連携ガイド（認証、マーケットデータ、注文など）の活用
- **curl / TypeScript / Python** のリクエストコードサンプル生成

> ⚠️ **免責事項**: 本ツールはトス証券の公開 OpenAPI ドキュメントを *説明する* **非公式** ツールです。実際の取引実行、口座アクセス、認証情報の送信は行いません。本番利用の前に必ず公式のトス証券ドキュメントで確認してください。

## 提供ツール

| ツール | 用途 |
|---|---|
| `get_api_overview` | API 全体の概要（最初に実行） |
| `list_categories` | カテゴリ（タグ）一覧と説明 |
| `list_endpoints` | エンドポイント一覧（カテゴリで絞り込み可） |
| `search_endpoints` | キーワードによるエンドポイント検索 |
| `get_endpoint` | 単一エンドポイントの詳細（パラメータ・本文・応答） |
| `list_schemas` | データモデル名の一覧／絞り込み |
| `get_schema` | 単一データモデルのフィールドツリー |
| `get_integration_guide` | 呼び出し手順を含むユースケースガイド |
| `generate_code_sample` | エンドポイントごとの curl/TS/Python サンプル |

## 必要環境

- [Node.js](https://nodejs.org) **18 以上**
- MCP 対応クライアント（Claude Desktop、Claude Code、Cursor など）

## インストールと使い方（stdio）

本サーバーは **stdio** 経由で MCP を通信します。**実行コマンド** を 1 つ選び、対応するブロックを MCP クライアント設定に貼り付けてください。

**実行コマンド**

| ソース | コマンド / 引数 |
|---|---|
| **npm（推奨）** | `npx` · `-y`, `tossinvest-openapi-mcp` |
| GitHub（npm を使わず最新ソースを直接実行） | `npx` · `-y`, `github:JeongSeongMok/tossinvest-openapi-mcp` |
| ソースから実行（`git clone` + `npm install` + `npm run build` 後） | `node` · `/絶対/パス/tossinvest-openapi-mcp/dist/index.js` |

> Node.js 18+ があれば `npx -y tossinvest-openapi-mcp` で公開パッケージをそのまま実行できます。GitHub コマンドは npm を経由せずリポジトリのソースをクローン・ビルド・実行するため、常に最新コードが必要な場合に使います。

### Claude（Claude Desktop / Claude Code / Cursor）— JSON

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

### Codex CLI — TOML（`~/.codex/config.toml`）

```toml
[mcp_servers.tossinvest-openapi]
command = "npx"
args = ["-y", "tossinvest-openapi-mcp"]
```

### 設定ファイルの場所

- **Claude Desktop**: `~/Library/Application Support/Claude/claude_desktop_config.json`（macOS）/ `%APPDATA%\Claude\claude_desktop_config.json`（Windows）
- **Claude Code**: プロジェクトの `.mcp.json`、または `claude mcp add tossinvest-openapi -- npx -y tossinvest-openapi-mcp` を実行
- **Codex CLI**: `~/.codex/config.toml`
- **Cursor**: `~/.cursor/mcp.json`

設定を編集したらクライアントを再起動すると、上記ツールがエージェントに表示されます。

## 動作確認

```bash
npm run build
node dist/index.js
# → stderr に "tossinvest-openapi-mcp running on stdio" が出力され、stdin で MCP メッセージを待機します。
```

## 開発

```
src/
├─ index.ts        # stdio エントリポイント
├─ server.ts       # MCP サーバー + ツール登録
├─ format.ts       # エージェント向けマークダウン描画
├─ codegen.ts      # curl / TS / Python サンプル生成
├─ guides.ts       # ユースケース連携ガイド
└─ spec/store.ts   # openapi.json の読み込み・索引化、$ref 解決
```

トス証券の OpenAPI ドキュメントはリポジトリ直下の `openapi.json` にあり、公開パッケージに同梱されます。仕様を更新するには、このファイルを差し替えて再ビルドしてください。

## ライセンス

[MIT](LICENSE)
