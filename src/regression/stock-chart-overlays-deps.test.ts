import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * 코인 탭 등에서 부모가 자주 리렌더될 때(목록 시세 폴링 등) 인라인 `overlays={{…}}`는
 * 매번 새 참조가 되어 StockChart의 캔들 동기화 effect가 과도하게 돌 수 있다.
 * effect 의존성은 불리언 축으로 두는 것이 안전하다.
 */
describe("StockChart candle sync effect", () => {
  it("depends on overlay flags, not the whole overlays object", () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const path = join(dir, "..", "components", "StockChart.tsx");
    const src = readFileSync(path, "utf8");
    const marker = "prevCandlesForStreamRef.current = candles;";
    const i = src.indexOf(marker);
    expect(i).toBeGreaterThan(-1);
    const slice = src.slice(i, i + 2500);
    expect(slice).toMatch(/overlays\.ma,\s/);
    expect(slice).toMatch(/overlays\.ichimoku,\s/);
    expect(slice).toMatch(/overlays\.volume,\s/);
    expect(slice).toMatch(/overlays\.rsi,\s/);
    expect(slice).not.toMatch(/\boverlays,\s*$/m);
    expect(slice).not.toMatch(/\n\s*overlays,\n/);
  });
});
