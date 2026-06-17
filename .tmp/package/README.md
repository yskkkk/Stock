# tossinvest-openapi-mcp

> **토스증권 Open API**를 개발자와 AI 에이전트가 쉽게 탐색·연동할 수 있도록 돕는 [MCP](https://modelcontextprotocol.io)(Model Context Protocol) 서버.

[![npm version](https://img.shields.io/npm/v/tossinvest-openapi-mcp.svg)](https://www.npmjs.com/package/tossinvest-openapi-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![MCP](https://img.shields.io/badge/MCP-stdio-blue.svg)](https://modelcontextprotocol.io)
[![Node](https://img.shields.io/badge/node-%3E%3D18-green.svg)](https://nodejs.org)

**언어:** **한국어** · [English](README.en.md) · [日本語](README.ja.md)

이 서버는 토스증권 OpenAPI(Toss Securities Open API, 토스증권 오픈API) 명세를 내장하여 MCP 도구로 제공합니다. **읽기 전용 문서/탐색 서버**로, 실제 API를 호출하거나 주문을 실행하지 않으며 어떤 인증 정보도 필요로 하지 않습니다. Claude·Cursor·Codex 등 MCP를 지원하는 AI 코딩 에이전트에 연결한 뒤 *"토스증권 API로 주문을 어떻게 넣어?"* 같이 물어보면, 명세에 근거한 정확한 답변과 코드 샘플을 얻을 수 있습니다.

> 토스증권 Open API 연동을 처음 시작하는 개발자가 엔드포인트·인증·주문/시세 API 구조를 빠르게 파악하고, AI 에이전트로 코드를 생성하는 데 활용할 수 있습니다.

---

## 개요

MCP 클라이언트에 연결하면 에이전트는 다음을 할 수 있습니다.

- 토스증권 Open API의 모든 엔드포인트·카테고리 탐색
- 요청/응답 스키마와 예시 조회
- 키워드로 엔드포인트·데이터 모델 검색
- 유스케이스 중심 연동 가이드(인증, 시세, 주문 등) 활용
- **curl / TypeScript / Python** 요청 코드 샘플 생성

> ⚠️ **주의**: 이 도구는 토스증권 공개 OpenAPI 문서를 *설명*하는 **비공식** 도구입니다. 실제 매매 실행, 계좌 접근, 인증 정보 전송을 하지 않습니다. 운영 적용 전 반드시 공식 토스증권 문서로 검증하세요.

## 제공 도구

| 도구 | 용도 |
|---|---|
| `get_api_overview` | API 전체 개요 (여기서 시작) |
| `list_categories` | 카테고리(태그) 목록과 설명 |
| `list_endpoints` | 엔드포인트 목록 (카테고리 필터 가능) |
| `search_endpoints` | 키워드 기반 엔드포인트 검색 |
| `get_endpoint` | 단일 엔드포인트 상세(파라미터·본문·응답) |
| `list_schemas` | 데이터 모델 이름 목록/필터 |
| `get_schema` | 단일 데이터 모델의 필드 트리 |
| `get_integration_guide` | 호출 시퀀스를 포함한 유스케이스 가이드 |
| `generate_code_sample` | 엔드포인트별 curl/TS/Python 코드 샘플 |

## 요구 사항

- [Node.js](https://nodejs.org) **18 이상**
- MCP 호환 클라이언트 (Claude Desktop, Claude Code, Cursor 등)

## 설치 및 사용 (stdio)

이 서버는 **stdio** 방식으로 MCP를 통신합니다. **실행 명령**을 하나 고른 뒤, 해당 블록을 MCP 클라이언트 설정에 붙여 넣으면 됩니다.

**실행 명령**

| 소스 | 명령 / 인자 |
|---|---|
| **npm (권장)** | `npx` · `-y`, `tossinvest-openapi-mcp` |
| GitHub (npm 없이 최신 소스를 직접 실행) | `npx` · `-y`, `github:JeongSeongMok/tossinvest-openapi-mcp` |
| 소스에서 실행 (`git clone` + `npm install` + `npm run build` 후) | `node` · `/절대/경로/tossinvest-openapi-mcp/dist/index.js` |

> Node.js 18+ 만 있으면 `npx -y tossinvest-openapi-mcp` 로 바로 실행됩니다. GitHub 명령은 npm 을 거치지 않고 저장소를 직접 클론·빌드·실행하므로, 항상 최신 소스가 필요할 때 사용합니다.

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

### 설정 파일 위치

- **Claude Desktop**: `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) / `%APPDATA%\Claude\claude_desktop_config.json` (Windows)
- **Claude Code**: 프로젝트의 `.mcp.json`, 또는 `claude mcp add tossinvest-openapi -- npx -y tossinvest-openapi-mcp` 실행
- **Codex CLI**: `~/.codex/config.toml`
- **Cursor**: `~/.cursor/mcp.json`

설정 수정 후 클라이언트를 재시작하면 위 도구들이 에이전트에 노출됩니다.

## 동작 확인

```bash
npm run build
node dist/index.js
# → stderr에 "tossinvest-openapi-mcp running on stdio" 출력 후 stdin으로 MCP 메시지 대기
```

## 개발

```
src/
├─ index.ts        # stdio 진입점
├─ server.ts       # MCP 서버 + 도구 등록
├─ format.ts       # 에이전트 친화적 마크다운 렌더링
├─ codegen.ts      # curl / TS / Python 샘플 생성
├─ guides.ts       # 유스케이스 연동 가이드
└─ spec/store.ts   # openapi.json 로드·인덱싱, $ref 해소
```

토스증권 OpenAPI 문서는 저장소 루트의 `openapi.json`에 있으며 배포 패키지에 함께 번들됩니다. 명세를 갱신하려면 이 파일을 교체하고 다시 빌드하세요.

## 라이선스

[MIT](LICENSE)
