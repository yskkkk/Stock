import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readIdeTurnNotifyPair } from "./ops-ide-transcript-text.js";

/** @type {string[]} */
const tmpFiles = [];

afterEach(() => {
  for (const f of tmpFiles.splice(0)) {
    try {
      fs.unlinkSync(f);
    } catch {
      /* ignore */
    }
  }
});

/**
 * @param {unknown[]} rows
 */
function writeJsonl(rows) {
  const f = path.join(
    os.tmpdir(),
    `ops-ide-turn-pair-${Date.now()}-${Math.random().toString(16).slice(2)}.jsonl`,
  );
  fs.writeFileSync(
    f,
    rows.map((r) => JSON.stringify(r)).join("\n") + "\n",
    "utf8",
  );
  tmpFiles.push(f);
  return f;
}

function userRow(text) {
  return {
    role: "user",
    message: { content: [{ type: "text", text: `<user_query>${text}</user_query>` }] },
  };
}

function assistantRow(text) {
  return {
    role: "assistant",
    message: { content: [{ type: "text", text }] },
  };
}

describe("readIdeTurnNotifyPair", () => {
  it("pairs frozen request with that turn's assistant, not the next turn", () => {
    const file = writeJsonl([
      userRow("요청 A"),
      assistantRow("응답 A"),
      userRow("요청 B"),
      assistantRow("응답 B"),
    ]);
    const pair = readIdeTurnNotifyPair(file, "요청 A", 0);
    expect(pair.userRequest).toBe("요청 A");
    expect(pair.agentResponse).toBe("응답 A");
    expect(pair.userLineIndex).toBe(0);
  });

  it("does not fall back to last assistant when turn index is unknown", () => {
    const file = writeJsonl([
      userRow("요청 A"),
      assistantRow("응답 A"),
      userRow("요청 B"),
      assistantRow("응답 B"),
    ]);
    const pair = readIdeTurnNotifyPair(file, "없는 요청", undefined);
    expect(pair.userRequest).toBe("없는 요청");
    expect(pair.agentResponse).toBe("");
    expect(pair.userLineIndex).toBe(-1);
  });

  it("re-finds index when stored line does not match frozen request", () => {
    const file = writeJsonl([
      userRow("요청 A"),
      assistantRow("응답 A"),
      userRow("요청 B"),
      assistantRow("응답 B"),
    ]);
    const pair = readIdeTurnNotifyPair(file, "요청 A", 2);
    expect(pair.userRequest).toBe("요청 A");
    expect(pair.agentResponse).toBe("응답 A");
    expect(pair.userLineIndex).toBe(0);
  });
});
