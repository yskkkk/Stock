import { useMemo, useState } from "react";
import { ko } from "../i18n/ko";
import {
  GLOSSARY_SECTIONS,
  searchFinancialGlossary,
  type GlossarySectionId,
} from "../lib/usFinancialStatementGlossary";
import "./us-financial-glossary.css";

type SectionFilter = GlossarySectionId | "all";

export default function UsFinancialGlossaryPanel({
  compact = false,
}: {
  compact?: boolean;
}) {
  const t = ko.infoBoard.usDict;
  const [query, setQuery] = useState("");
  const [section, setSection] = useState<SectionFilter>("all");

  const entries = useMemo(
    () => searchFinancialGlossary(query, section),
    [query, section],
  );

  const rootClass = compact
    ? "us-fin-glossary us-fin-glossary--compact"
    : "us-fin-glossary";

  return (
    <div className={rootClass}>
      <div className="us-fin-glossary__toolbar">
        <label className="us-fin-glossary__search">
          <span className="us-fin-glossary__search-label">{t.searchLabel}</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.searchPlaceholder}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <div className="us-fin-glossary__chips" role="tablist" aria-label={t.sectionAria}>
          <button
            type="button"
            role="tab"
            aria-selected={section === "all"}
            className={
              section === "all"
                ? "us-fin-glossary__chip us-fin-glossary__chip--on"
                : "us-fin-glossary__chip"
            }
            onClick={() => setSection("all")}
          >
            {t.allSections}
          </button>
          {GLOSSARY_SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={section === s.id}
              className={
                section === s.id
                  ? "us-fin-glossary__chip us-fin-glossary__chip--on"
                  : "us-fin-glossary__chip"
              }
              onClick={() => setSection(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <p className="us-fin-glossary__count">
        {t.resultCount(entries.length)}
      </p>
      {entries.length === 0 ? (
        <p className="us-fin-glossary__empty" role="status">
          {t.searchEmpty}
        </p>
      ) : (
        <ul className="us-fin-glossary__list">
          {entries.map((entry) => (
            <li key={entry.id} className="us-fin-glossary__item">
              <div className="us-fin-glossary__item-head">
                <strong className="us-fin-glossary__en">{entry.en}</strong>
                <span className="us-fin-glossary__ko">{entry.ko}</span>
              </div>
              {entry.formula ? (
                <code className="us-fin-glossary__formula">{entry.formula}</code>
              ) : null}
              <p className="us-fin-glossary__body">{entry.body}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
