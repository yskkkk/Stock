import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useMobileBackHandler } from "../hooks/useMobileBackHandler";
import { ko } from "../i18n/ko";
import { MOBILE_BACK_PRIORITY } from "../lib/mobileBackStack";
import "./info-board-tab.css";

type InfoBoardPostMeta = (typeof ko.infoBoard.posts)[number];

function formatPostDate(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return ymd;
  return `${m[1]}.${m[2]}.${m[3]}`;
}

function TermRows({
  rows,
}: {
  rows: ReadonlyArray<{ term: string; meaning: string }>;
}) {
  return (
    <div className="info-board-tab__table-wrap info-board-tab__table-wrap--compact">
      <table className="info-board-tab__table info-board-tab__table--kv">
        <tbody>
          {rows.map((row) => (
            <tr key={row.term}>
              <th scope="row">{row.term}</th>
              <td>{row.meaning}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BulletList({ items }: { items: readonly string[] }) {
  return (
    <ul className="info-board-tab__bullets">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="info-board-tab__section">
      <h4 className="info-board-tab__section-title">{title}</h4>
      {children}
    </section>
  );
}

function OrlandoBrkPostBody() {
  const t = ko.infoBoard.orlandoBrk;
  return (
    <>
      <p className="info-board-tab__article-lead">{t.lead}</p>
      <p className="info-board-tab__disclaimer">{t.disclaimer}</p>
      <p className="info-board-tab__source">{t.sourceNote}</p>

      <Section title={t.secTerms}>
        <TermRows rows={t.terms} />
      </Section>

      <Section title={t.secIncome}>
        <TermRows rows={t.incomeRows} />
        <div className="info-board-tab__callout">
          <strong className="info-board-tab__callout-label">{t.secOpEarnings}</strong>
          <p className="info-board-tab__callout-body">{t.opEarningsBody}</p>
        </div>
      </Section>

      <Section title={t.secBuyback}>
        <BulletList items={t.buybackPoints} />
      </Section>

      <Section title={t.secTech}>
        <BulletList items={t.techPoints} />
      </Section>

      <Section title={t.secFair}>
        <div className="info-board-tab__formula" role="note">
          <span className="info-board-tab__formula-label">{t.formulaLabel}</span>
          <code className="info-board-tab__formula-code">{t.formula}</code>
        </div>
        <p className="info-board-tab__prose">{t.formulaRule}</p>
        <h5 className="info-board-tab__subhead">{t.brkExampleTitle}</h5>
        <div className="info-board-tab__table-wrap info-board-tab__table-wrap--compact">
          <table className="info-board-tab__table info-board-tab__table--kv">
            <tbody>
              {t.brkExampleRows.map((row) => (
                <tr key={row.label}>
                  <th scope="row">{row.label}</th>
                  <td>
                    <span className="info-board-tab__bench">{row.value}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="info-board-tab__note-block">{t.formulaLimit}</p>
      </Section>

      <Section title={t.secSa}>
        <p className="info-board-tab__prose">{t.saLead}</p>
        <h5 className="info-board-tab__subhead">{t.saColTitle}</h5>
        <TermRows rows={t.saCols} />
        <h5 className="info-board-tab__subhead">{t.saMetricTitle}</h5>
        <div className="info-board-tab__glossary">
          {t.saDetails.map((item) => (
            <article key={item.term} className="info-board-tab__glossary-card">
              <h6 className="info-board-tab__glossary-term">{item.term}</h6>
              {item.formula ? (
                <code className="info-board-tab__glossary-formula">{item.formula}</code>
              ) : null}
              <p className="info-board-tab__glossary-body">{item.body}</p>
              {item.tips.length > 0 ? (
                <ul className="info-board-tab__glossary-tips">
                  {item.tips.map((tip) => (
                    <li key={tip}>{tip}</li>
                  ))}
                </ul>
              ) : null}
            </article>
          ))}
        </div>
        <h5 className="info-board-tab__subhead">{t.saGooglTitle}</h5>
        <div className="info-board-tab__table-wrap info-board-tab__table-wrap--compact">
          <table className="info-board-tab__table info-board-tab__table--kv">
            <tbody>
              {t.saGooglRows.map((row) => (
                <tr key={row.label}>
                  <th scope="row">{row.label}</th>
                  <td>{row.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <h5 className="info-board-tab__subhead">{t.saStepsTitle}</h5>
        <ol className="info-board-tab__steps">
          {t.saSteps.map((step, i) => (
            <li key={step}>
              <span className="info-board-tab__step-n">{i + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
        <h5 className="info-board-tab__subhead">{t.saQuickTitle}</h5>
        <div className="info-board-tab__table-wrap info-board-tab__table-wrap--compact">
          <table className="info-board-tab__table info-board-tab__table--kv">
            <tbody>
              {t.saQuickRows.map((row) => (
                <tr key={row.label}>
                  <th scope="row">{row.label}</th>
                  <td>
                    <span className="info-board-tab__bench">{row.value}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title={t.secMindset}>
        <BulletList items={t.mindsetPoints} />
      </Section>

      <Section title={t.secCheck}>
        <ol className="info-board-tab__checklist">
          {t.checklist.map((item, i) => (
            <li key={item}>
              <span className="info-board-tab__check-n">{i + 1}</span>
              <span>{item}</span>
            </li>
          ))}
        </ol>
      </Section>
    </>
  );
}

function PerEbitdaPostBody() {
  const rows = ko.infoBoard.perEbitdaRows;
  return (
    <>
      <p className="info-board-tab__article-lead">{ko.infoBoard.perEbitdaLead}</p>
      <div className="info-board-tab__table-wrap">
        <table className="info-board-tab__table">
          <thead>
            <tr>
              <th scope="col">{ko.infoBoard.colSector}</th>
              <th scope="col">{ko.infoBoard.colTraits}</th>
              <th scope="col">{ko.infoBoard.colPer}</th>
              <th scope="col">{ko.infoBoard.colEvEbitda}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.sector}>
                <th scope="row">
                  <span className="info-board-tab__sector">{row.sector}</span>
                  {row.examples ? (
                    <span className="info-board-tab__examples">{row.examples}</span>
                  ) : null}
                </th>
                <td>{row.traits}</td>
                <td>
                  <span className="info-board-tab__bench">{row.per}</span>
                  {row.perNote ? (
                    <span className="info-board-tab__note">{row.perNote}</span>
                  ) : null}
                </td>
                <td>
                  <span className="info-board-tab__bench">{row.evEbitda}</span>
                  {row.evNote ? (
                    <span className="info-board-tab__note">{row.evNote}</span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function renderPostBody(postId: string) {
  switch (postId) {
    case "orlando-brk-valuation":
      return <OrlandoBrkPostBody />;
    case "per-ebitda":
      return <PerEbitdaPostBody />;
    default:
      return (
        <p className="info-board-tab__empty" role="status">
          {ko.infoBoard.empty}
        </p>
      );
  }
}

export default function InfoBoardTab() {
  const posts = ko.infoBoard.posts;
  const [openId, setOpenId] = useState<string | null>(null);

  const openPost = useMemo(
    () => (openId ? posts.find((p) => p.id === openId) ?? null : null),
    [openId, posts],
  );

  const closePost = useCallback(() => setOpenId(null), []);

  useMobileBackHandler(
    openPost != null,
    MOBILE_BACK_PRIORITY.WORKSPACE_PICK,
    closePost,
  );

  return (
    <div className="workspace info-board-tab" aria-label={ko.infoBoard.aria}>
      <header className="info-board-tab__head">
        <div>
          <h2 className="info-board-tab__title">{ko.infoBoard.title}</h2>
          <p className="info-board-tab__sub">{ko.infoBoard.subtitle}</p>
        </div>
        {!openPost ? (
          <span className="info-board-tab__count">
            {ko.infoBoard.postCount(posts.length)}
          </span>
        ) : null}
      </header>

      {openPost ? (
        <article
          className="info-board-tab__article card"
          aria-labelledby="info-board-post-title"
        >
          <div className="info-board-tab__post-toolbar">
            <button
              type="button"
              className="btn btn--ghost info-board-tab__back"
              onClick={closePost}
            >
              {ko.infoBoard.backToList}
            </button>
          </div>
          <p className="info-board-tab__post-meta">
            <span className="info-board-tab__chip">{openPost.category}</span>
            <span>{formatPostDate(openPost.publishedAt)}</span>
            <span>{openPost.author}</span>
          </p>
          <h3 id="info-board-post-title" className="info-board-tab__article-title">
            {openPost.title}
          </h3>
          {renderPostBody(openPost.id)}
        </article>
      ) : (
        <section
          className="info-board-tab__feed"
          aria-label={ko.infoBoard.listAria}
        >
          {posts.length === 0 ? (
            <p className="info-board-tab__empty" role="status">
              {ko.infoBoard.empty}
            </p>
          ) : (
            <ul className="info-board-tab__post-list">
              {posts.map((post: InfoBoardPostMeta) => (
                <li key={post.id}>
                  <button
                    type="button"
                    className="info-board-tab__post-card card"
                    onClick={() => setOpenId(post.id)}
                    aria-label={ko.infoBoard.openPostAria(post.title)}
                  >
                    <div className="info-board-tab__post-card-top">
                      <span className="info-board-tab__chip">{post.category}</span>
                      <time dateTime={post.publishedAt}>
                        {formatPostDate(post.publishedAt)}
                      </time>
                    </div>
                    <span className="info-board-tab__post-card-title">
                      {post.title}
                    </span>
                    <span className="info-board-tab__post-card-excerpt">
                      {post.excerpt}
                    </span>
                    <span className="info-board-tab__post-card-author">
                      {post.author}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
