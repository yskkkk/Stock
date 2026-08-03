import { useCallback, useMemo, useState } from "react";
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
