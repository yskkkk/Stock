import { ko } from "../i18n/ko";
import "./info-board-tab.css";

export default function InfoBoardTab() {
  const rows = ko.infoBoard.perEbitdaRows;

  return (
    <div className="workspace info-board-tab" aria-label={ko.infoBoard.aria}>
      <header className="info-board-tab__head">
        <div>
          <h2 className="info-board-tab__title">{ko.infoBoard.title}</h2>
          <p className="info-board-tab__sub">{ko.infoBoard.subtitle}</p>
        </div>
      </header>

      <section
        className="info-board-tab__article card"
        aria-labelledby="info-board-per-ebitda-title"
      >
        <h3 id="info-board-per-ebitda-title" className="info-board-tab__article-title">
          {ko.infoBoard.perEbitdaTitle}
        </h3>
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
      </section>
    </div>
  );
}
