/**
 * 발표 카드 소제목·상세 — 공시 본문/메타 기반 (+ optional OpenAI)
 */
import { fetchEdgarFilingPlainText } from "./us-announcement-filing-text.js";

/**
 * @param {string} form
 * @param {string} kind
 * @param {string} title
 * @param {string} text
 */
export function buildFilingHeadlineAndDetail(form, kind, title, text) {
  const f = String(form ?? "").toUpperCase();
  const k = String(kind ?? "");
  const t = String(title ?? "").trim();
  const body = String(text ?? "").trim();
  const lower = body.toLowerCase();

  /** @type {string} */
  let headline = "";
  /** @type {string[]} */
  const detailParts = [];

  if (k === "guidance" || f.startsWith("8-K")) {
    const hasGuidance =
      /guidance|outlook|expects|full[- ]year|fiscal year|provides update/i.test(
        body,
      ) || /item\s*2\.02|item\s*7\.01|item\s*8\.01/i.test(body);
    const hasEarn =
      /results of operations|earnings|quarterly results|item\s*2\.02/i.test(body);
    if (hasGuidance && hasEarn) {
      headline = "실적 발표와 함께 가이던스·전망을 업데이트한 8-K";
    } else if (hasGuidance) {
      headline = "경영진 가이던스·아웃룩을 담은 8-K";
    } else if (hasEarn) {
      headline = "분기/연간 실적(Results) 관련 8-K";
    } else {
      headline = t && t !== "8-K" ? t.slice(0, 80) : "중요 사건(8-K) 공시";
    }
    const itemMatch = body.match(/Item\s+(\d+\.\d+)[^\n.]{0,120}/i);
    if (itemMatch) detailParts.push(`주요 항목: Item ${itemMatch[1]}.`);
    if (/raises|increases|above|higher than/i.test(lower)) {
      detailParts.push("톤상 상향·호조 언급이 보입니다.");
    } else if (/lowers|reduces|below|weak|decline/i.test(lower)) {
      detailParts.push("톤상 하향·둔화 언급이 보입니다.");
    }
  } else if (k === "governance" || /DEF\s*14/i.test(f)) {
    if (/compensation|executive|pay/i.test(body)) {
      headline = "임원 보상·주주총회(Proxy) 관련 공시";
    } else if (/director|board|nominee/i.test(body)) {
      headline = "이사회·이사 선임 관련 Proxy 공시";
    } else if (/shareholder proposal|proposal/i.test(body)) {
      headline = "주주제안·의결 안건이 포함된 Proxy";
    } else {
      headline = "주주총회·지배구조(Proxy) 공시";
    }
    detailParts.push(
      "이사회 구성, 경영진 보수, 주주제안 등 거버넌스 안건을 확인하는 자료입니다.",
    );
  } else if (k === "earnings" || /^10-[QK]/.test(f)) {
    headline =
      f.startsWith("10-K")
        ? "연간 보고서(10-K) 제출"
        : "분기 보고서(10-Q) 제출";
    detailParts.push(
      "확정 재무제표·MD&A가 포함됩니다. 컨센·가이던스와 숫자를 대조해 보세요.",
    );
  } else if (k === "consensus") {
    headline = t || "애널리스트 컨센서스 변경";
    detailParts.push(
      "증권사 추정 평균이 직전 스냅샷 대비 의미 있게 움직였습니다.",
    );
  } else {
    headline = t ? t.slice(0, 80) : "기업 공시";
  }

  if (body) {
    const snip = body.slice(0, 280).replace(/\s+/g, " ").trim();
    if (snip) detailParts.push(`원문 요지: ${snip}${body.length > 280 ? "…" : ""}`);
  } else if (!detailParts.length) {
    detailParts.push("원문 링크에서 세부 수치·문구를 확인하세요.");
  }

  return {
    headline: headline.slice(0, 120),
    detail: detailParts.join(" ").slice(0, 900),
  };
}

/**
 * @param {{
 *   form?: string | null;
 *   kind: string;
 *   title?: string;
 *   symbol?: string;
 *   edgarUrl?: string | null;
 *   metrics?: Record<string, unknown>;
 * }} cardLike
 */
export async function enrichAnnouncementCopy(cardLike) {
  const form = cardLike.form ?? null;
  const kind = String(cardLike.kind ?? "");
  const title = String(cardLike.title ?? "");
  let text = "";

  if (cardLike.edgarUrl) {
    const fetched = await fetchEdgarFilingPlainText(cardLike.edgarUrl);
    if (fetched.ok) text = fetched.text;
  }

  let { headline, detail } = buildFilingHeadlineAndDetail(
    form ?? "",
    kind,
    title,
    text,
  );

  if (kind === "consensus" && cardLike.metrics) {
    const chg = Number(cardLike.metrics.consensusChangePct);
    if (Number.isFinite(chg)) {
      headline = `${cardLike.symbol ?? ""} 컨센 ${chg >= 0 ? "상향" : "하향"} ${chg >= 0 ? "+" : ""}${chg.toFixed(1)}%`.trim();
      detail = `애널리스트 합의 EPS가 직전 대비 ${chg >= 0 ? "+" : ""}${chg.toFixed(1)}% 움직였습니다. Yahoo Analysis에서 기간·애널 수를 함께 확인하세요.`;
    }
  }

  const key = String(process.env.OPENAI_API_KEY ?? "").trim();
  if (key && text) {
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: String(process.env.STOCK_ANNOUNCEMENT_LLM_MODEL ?? "gpt-4o-mini").trim(),
          temperature: 0.2,
          max_tokens: 280,
          messages: [
            {
              role: "system",
              content:
                "Reply in Korean JSON only: {\"headline\":\"<=40 chars one-line\",\"detail\":\"2-4 short sentences\"}. No inventing numbers not in text.",
            },
            {
              role: "user",
              content: `Symbol ${cardLike.symbol} form ${form} kind ${kind}\nDraft headline: ${headline}\nText:\n${text.slice(0, 6000)}`,
            },
          ],
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (res.ok) {
        const data = await res.json();
        const raw = String(data?.choices?.[0]?.message?.content ?? "").trim();
        const m = raw.match(/\{[\s\S]*\}/);
        if (m) {
          const parsed = JSON.parse(m[0]);
          if (parsed.headline) headline = String(parsed.headline).slice(0, 120);
          if (parsed.detail) detail = String(parsed.detail).slice(0, 900);
        }
      }
    } catch {
      /* keep rules */
    }
  }

  return {
    headline,
    detail,
    enrichedAt: Date.now(),
  };
}
