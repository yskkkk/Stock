#!/usr/bin/env python3
"""Generate mega-trend investment report PowerPoint (2026)."""

from pathlib import Path

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.util import Inches, Pt

OUT = Path(__file__).resolve().parent.parent / "reports" / "megatrend-investment-report-2026.pptx"

NAVY = RGBColor(0x1A, 0x2B, 0x4A)
ACCENT = RGBColor(0x2E, 0x86, 0xAB)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
DARK = RGBColor(0x22, 0x22, 0x22)
GRAY = RGBColor(0x66, 0x66, 0x66)
LIGHT_BG = RGBColor(0xF4, 0xF6, 0xF9)


def set_slide_bg(slide, color: RGBColor) -> None:
    fill = slide.background.fill
    fill.solid()
    fill.fore_color.rgb = color


def add_title_bar(slide, title: str, subtitle: str | None = None) -> None:
    bar = slide.shapes.add_shape(1, Inches(0), Inches(0), Inches(10), Inches(1.05))
    bar.fill.solid()
    bar.fill.fore_color.rgb = NAVY
    bar.line.fill.background()
    tf = bar.text_frame
    tf.word_wrap = True
    p = tf.paragraphs[0]
    p.text = title
    p.font.size = Pt(26)
    p.font.bold = True
    p.font.color.rgb = WHITE
    if subtitle:
        p2 = tf.add_paragraph()
        p2.text = subtitle
        p2.font.size = Pt(12)
        p2.font.color.rgb = RGBColor(0xBB, 0xCC, 0xDD)


def add_bullets(slide, items: list[str], left=0.55, top=1.25, width=9.0, height=5.8, size=14):
    box = slide.shapes.add_textbox(Inches(left), Inches(top), Inches(width), Inches(height))
    tf = box.text_frame
    tf.word_wrap = True
    tf.vertical_anchor = MSO_ANCHOR.TOP
    for i, item in enumerate(items):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.text = item
        p.level = 0
        p.font.size = Pt(size)
        p.font.color.rgb = DARK
        p.space_after = Pt(6)


def add_table_slide(prs, title: str, headers: list[str], rows: list[list[str]], col_widths=None):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    set_slide_bg(slide, LIGHT_BG)
    add_title_bar(slide, title)

    n_rows = len(rows) + 1
    n_cols = len(headers)
    left, top, width, height = Inches(0.4), Inches(1.2), Inches(9.2), Inches(0.35 * n_rows + 0.3)
    table = slide.shapes.add_table(n_rows, n_cols, left, top, width, height).table

    if col_widths:
        for i, w in enumerate(col_widths):
            table.columns[i].width = Inches(w)

    for j, h in enumerate(headers):
        cell = table.cell(0, j)
        cell.text = h
        cell.fill.solid()
        cell.fill.fore_color.rgb = NAVY
        for p in cell.text_frame.paragraphs:
            p.font.bold = True
            p.font.size = Pt(10)
            p.font.color.rgb = WHITE

    for i, row in enumerate(rows, start=1):
        for j, val in enumerate(row):
            cell = table.cell(i, j)
            cell.text = val
            for p in cell.text_frame.paragraphs:
                p.font.size = Pt(9)
                p.font.color.rgb = DARK


def build() -> Path:
    prs = Presentation()
    prs.slide_width = Inches(10)
    prs.slide_height = Inches(7.5)

    # --- Title ---
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    set_slide_bg(slide, NAVY)
    tbox = slide.shapes.add_textbox(Inches(0.6), Inches(2.0), Inches(8.8), Inches(2.5))
    tf = tbox.text_frame
    p = tf.paragraphs[0]
    p.text = "2026–2035 메가트렌드\n투자 리서치 보고서"
    p.font.size = Pt(40)
    p.font.bold = True
    p.font.color.rgb = WHITE
    p.alignment = PP_ALIGN.LEFT
    p2 = tf.add_paragraph()
    p2.text = "주식시장 · 수요 시점 · 종목 분석"
    p2.font.size = Pt(20)
    p2.font.color.rgb = RGBColor(0xAA, 0xCC, 0xEE)
    p3 = tf.add_paragraph()
    p3.text = "기준일: 2026년 7월 5일  |  Morgan Stanley · McKinsey · Gartner · CHIPS Act 교차 검증"
    p3.font.size = Pt(12)
    p3.font.color.rgb = RGBColor(0x88, 0x99, 0xAA)
    p3.space_before = Pt(24)

    # --- Disclaimer ---
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    set_slide_bg(slide, LIGHT_BG)
    add_title_bar(slide, "면책 및 방법론")
    add_bullets(
        slide,
        [
            "본 자료는 공개 리서치·정책 문서 기반이며 투자 권유가 아닙니다.",
            "시가총액·재무 수치는 변동성이 크므로 매매 전 최신 공시를 확인하세요.",
            "수요 시점은 구조적 추정이며 실제 타이밍은 정책·기술·금리에 따라 달라집니다.",
            "출처: Morgan Stanley Big Picture 2026, McKinsey/Gartner Tech Trends, CHIPS Act, Morningstar, IonQ IR 등",
        ],
        size=16,
    )

    # --- Executive summary table ---
    add_table_slide(
        prs,
        "Executive Summary — 8대 메가트렌드",
        ["#", "메가트렌드", "2030 규모", "수요 집중 시기", "현재 단계"],
        [
            ["1", "AI 물리 인프라", "Capex $800B–$1.1T", "2025–2032 (지금)", "백로그 폭발"],
            ["2", "원자력·AI 전력", "유틸 $1.4T(26–30)", "운영 25–28 / SMR 30–35", "PPA rush"],
            ["3", "반도체·CHIPS", "CHIPS $52.7B+", "건설 peak / 48D 26.12", "Fab 가동"],
            ["4", "양자 + PQC", "QC $11.5B(2030)", "PQC 26–31 / FTQC 28–32", "조기 상업화"],
            ["5", "자율·로보틱스", "$4–18B(2030)", "공장 26–28 / 소비 28–32", "파일럿→양산"],
            ["6", "우주 경제", "~$2T(2040)", "2026–2035 가속", "SpaceX IPO 이후"],
            ["7", "바이오·GLP-1", "$150–190B(30–35)", "24–30 peak", "수요>공급 완화"],
            ["8", "경제안보", "Vault $12B 등", "2025–2030 구조적", "정책 주도"],
        ],
        col_widths=[0.4, 2.2, 2.4, 2.4, 1.8],
    )

    # --- Key message ---
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    set_slide_bg(slide, LIGHT_BG)
    add_title_bar(slide, "핵심 메시지: Great Broadening")
    add_bullets(
        slide,
        [
            "2026부터 수익이 메가캡 AI에서 전력·장비·국제·실물자산으로 분산 (Morgan Stanley)",
            "하이퍼스케일러 2026 AI capex $527B~$690B → 2027 $1T+",
            "AI capex의 75–80%는 칩이 아닌 건물·전력·냉각·그리드로 흐름",
            "변압기·스위치기어 납기 최대 5년 → 공급 제약 = 가격·마진 우호",
            "데이터센터 전력: 미국 전체 4.4% → 9%(2030), 2035 6배 (Morningstar)",
        ],
        size=15,
    )

    # --- Timeline ---
    add_table_slide(
        prs,
        "투자 Horizon별 우선 메가트렌드",
        ["Horizon", "우선 트렌드", "근거"],
        [
            ["0–2년", "AI 물리 인프라, 원전 PPA, GLP-1, CHIPS 장비", "지금 cash flow·backlog"],
            ["3–5년", "SMR, Quantum FTQC, Humanoid, Space Neutron", "LOI→건설→가동"],
            ["5–10년", "PQC 완료, Bio-factory, Lunar economy", "Regulatory deadline"],
        ],
        col_widths=[1.2, 4.5, 3.5],
    )

    # --- Trend 1 ---
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    set_slide_bg(slide, LIGHT_BG)
    add_title_bar(slide, "① AI 물리 인프라 (2차 파생)", "Electrons, Not Tokens — 2025–2032 수요 정점")
    add_bullets(
        slide,
        [
            "Layer 1 칩·인터커넥트: NVDA, AVGO, MRVL, Lightelligence(1879.HK)",
            "Layer 2 랙 전력·냉각: VRT (백로그 $15B, +270% YoY), ETN, ABB, Schneider",
            "Layer 3 건물·백업: CAT ($63B backlog), GNRC, STX, PWR (Quanta $44B backlog)",
            "Colo·네트워크: EQIX, DLR, ANET, CSCO, SMCI, DELL, HPE",
            "전력 교차: CEG, FSLR  |  소형: HUT (GW급 AI campus)",
        ],
        size=13,
    )

    add_table_slide(
        prs,
        "① AI 인프라 — 핵심 종목 스냅샷",
        ["티커", "시총(추정)", "역할", "구현", "CEO 성향"],
        [
            ["NVDA", "~$3T+", "GPU 풀스택", "★★★★★", "Jensen Huang — 공격적 로드맵"],
            ["VRT", "~$50B+", "랙 전력·액침냉각", "★★★★★", "Giorgio Bruno — M&A 확장"],
            ["ETN", "~$140B", "변압기·스위치기어", "★★★★★", "Craig Arnold — 저변동"],
            ["PWR", "~$60B", "송전·DC EPC", "★★★★★", "전력 병목 해소"],
            ["AVGO", "~$1T+", "커스텀 ASIC+스위치", "★★★★★", "Hock Tan — lock-in"],
            ["CAT", "~$180B", "DC 건설·발전", "★★★★★", "숨은 AI 수혜"],
        ],
        col_widths=[0.8, 1.0, 2.5, 0.8, 3.1],
    )

    # --- Trend 2 ---
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    set_slide_bg(slide, LIGHT_BG)
    add_title_bar(slide, "② 원자력·AI 전력", "운영원전 2025–28  |  SMR 2030–35")
    add_bullets(
        slide,
        [
            "Meta 6.6GW 패키지: Vistra 2.1GW + Oklo 1.2GW + TerraPower (2026.1)",
            "MS·Google·Amazon·Oracle 동일 rush — baseload 전력 확보 경쟁",
            "Cash-flow 유틸 (★★★★★): CEG, VST, TLN, D, NEE, SO, DUK, EXC, AEP",
            "SMR pure-play (고위험): OKLO (Meta anchor), SMR (NRC 인증), NNE",
            "인프라·연료: BWXT, GEV, CCJ (Westinghouse 49%), LEU (HALEU), BE",
        ],
        size=13,
    )

    # --- Trend 3 ---
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    set_slide_bg(slide, LIGHT_BG)
    add_title_bar(slide, "③ 반도체·CHIPS 리쇼어링", "48D 세액공제 35% — 2026.12.31 착공 마감")
    add_bullets(
        slide,
        [
            "CHIPS $38.7B/39B 배정 — Intel $8.5B+대출, TSMC $6.6B, Samsung, Micron",
            "Fab 가동: TSMC AZ 4nm, Intel 18A HVM, Samsung Taylor 2nm",
            "Fab: INTC (turnaround), TSM, MU, GFS  |  장비: AMAT, LRCX, KLAC, ASML",
            "Packaging·전력: AMKR, ON (SiC), MPWR, ARM, AMD, ENTG",
            "Intel CEO Lip-Bu Tan — foundry pivot  |  장비사는 CHIPS 의존도 낮음 (자체 capex)",
        ],
        size=13,
    )

    # --- Trend 4 Quantum ---
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    set_slide_bg(slide, LIGHT_BG)
    add_title_bar(slide, "④ 양자컴퓨팅 + PQC", "QC $2B→$11.5B(2030)  |  PQC 2026–2035 의무화")
    add_bullets(
        slide,
        [
            "FTQC 로드맵: IonQ CRQC 2028, IBM 2029, Quantinuum Apollo 2030",
            "하드웨어: IONQ, RGTI, QBTS, QUBT  |  빅테크: IBM, GOOGL, MSFT, AMZN",
            "PQC: PANW, CRWD, NET (2029 TLS), FTNT, ZS, LAES/WKEY (secure element)",
            "IonQ Q1'26: 매출 $64.7M (+755%), RPO $470M, FY26 $260–270M",
            "CEO Niccolo de Masi — M&A·SPAC aggressive  |  Peter Chapman → Executive Chair",
        ],
        size=13,
    )

    add_table_slide(
        prs,
        "IonQ vs Google Quantum AI — 기술 대조",
        ["항목", "IonQ (트랩드 이온)", "Google (Willow, 초전도)"],
        [
            ["큐비트", "Forte ~36, Tempo ~100 (#AQ 64)", "Willow 105"],
            ["2큐비트 충실도", "99.99% (업계 기록)", "99.88%"],
            ["연결성", "All-to-all", "Nearest-neighbor"],
            ["오류정정", "2027–28 목표", "2024 below-threshold QEC 최초"],
            ["상용화", "매출·RPO 급성장", "내부 R&D + Cloud"],
            ["종합", "정밀도·매출 ↑", "규모·QEC 연구 ↑"],
        ],
        col_widths=[1.5, 3.8, 3.8],
    )

    # --- Trend 5 ---
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    set_slide_bg(slide, LIGHT_BG)
    add_title_bar(slide, "⑤ 자율·로보틱스 스택", "공장 2026–28  |  소비자 2028–32")
    add_bullets(
        slide,
        [
            "Amazon 75만+ warehouse robots  |  Figure AI BotQ 1대/시간 (2026)",
            "Tesla Optimus Gen3, Boston Dynamics Atlas → Hyundai commercial",
            "직접: TSLA, UBTECH(9880.HK)  |  부품·SI: NVDA, TER, CGNX, ABB, FANUY, ROK",
            "물류: AMZN, SYM (Walmart)  |  의료: ISRG  |  방산 드론: AVAV, KTOS",
            "비상장: Figure AI ($39B), Agility Robotics — 간접 노출만 가능",
        ],
        size=13,
    )

    # --- Trend 6 ---
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    set_slide_bg(slide, LIGHT_BG)
    add_title_bar(slide, "⑥ 우주 경제", "SpaceX IPO (2026.6) — 섹터 벤치마크")
    add_bullets(
        slide,
        [
            "PwC: 우주경제 $2T by 2040  |  RKLB Q1'26 매출 $200M (+63%), backlog $2.2B+",
            "Launch: SPCX (SpaceX), RKLB (Neutron 2026), FLY (Firefly)",
            "Connectivity: ASTS (space cellular), IRDM, GSAT  |  Earth obs: PL, BKSY",
            "Lunar: LUNR  |  Defense prime: LMT, NOC, RTX, LHX  |  ETF: UFO, ARKX",
        ],
        size=13,
    )

    # --- Trend 7 ---
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    set_slide_bg(slide, LIGHT_BG)
    add_title_bar(slide, "⑦ 바이오·롱제비티 (Code Meets Cell)", "GLP-1 $150–190B by 2030–35")
    add_bullets(
        slide,
        [
            "LLY 62% + NVO 31% = 93% share (2030, TD Cowen)  |  59M 환자 (2030)",
            "LLY: tirzepatide, orforglipron(oral), retatrutide  |  NVO: CagriSema",
            "Challenger: AMGN (MariTide), VKTX, GPCR (oral)  |  Tools: TMO, DHR, ILMN",
            "Gene edit: CRSP, NTLA, BEAM  |  Metabolic: DXCM, HIMS (telehealth)",
            "수요 peak 2024–30  |  제네릭·oral 확대 2030+",
        ],
        size=13,
    )

    # --- Trend 8 ---
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    set_slide_bg(slide, LIGHT_BG)
    add_title_bar(slide, "⑧ 경제안보", "방산·희토류·사이버 — 2025–2032 구조적")
    add_bullets(
        slide,
        [
            "Project Vault $12B  |  MP Materials: DoD 15% 지분, NdPr floor $110/kg",
            "희토류: MP, USAR, ALOY  |  구리: FCX, SCCO, BHP, RIO, TECK",
            "리튬: ALB, SQM (cyclical)  |  방산: LMT, NOC, RTX, GD, LHX, HII",
            "Gov AI: PLTR  |  Cyber: CRWD, PANW  |  MP CEO James Litinsky — China decouple",
        ],
        size=13,
    )

    # --- Value chain ---
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    set_slide_bg(slide, LIGHT_BG)
    add_title_bar(slide, "AI Value Chain — 자금 흐름")
    box = slide.shapes.add_textbox(Inches(0.8), Inches(1.5), Inches(8.4), Inches(4.5))
    tf = box.text_frame
    tf.word_wrap = True
    lines = [
        "하이퍼스케일러 Capex ($527B+)",
        "  ├─ 1차: NVDA · AVGO · MRVL  (칩·ASIC)",
        "  ├─ 2차: VRT · ETN · PWR · CAT  (전력·냉각·건설) ← 2026 outperform",
        "  └─ 3차: CEG · VST  (전력 생산)",
        "",
        "Quantum Modality Tier (2030 FTQC)",
        "  S: Google, IBM  |  A: IonQ, Quantinuum",
        "  B: Rigetti, Atom Computing  |  C: D-Wave, QUBT",
    ]
    for i, line in enumerate(lines):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.text = line
        p.font.size = Pt(16 if i == 0 else 14)
        p.font.color.rgb = NAVY if i in (0, 5) else DARK
        p.font.bold = i in (0, 5)

    # --- Extra considerations ---
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    set_slide_bg(slide, LIGHT_BG)
    add_title_bar(slide, "추가 고려사항")
    add_bullets(
        slide,
        [
            "K-형 경제: 고소득 AI·바이오 수혜 vs 저소득 전력요금↑ → 유틸 규제 리스크",
            "중국 New China: EV·배터리·로봇 export — US reshoring 미러 trade",
            "Capped Real Rates: 고부채 → 실질금리 상한 → 성장주·실물자산 우호",
            "AI monetization gap: adoption > monetization — vertical AI (healthcare) 선별",
            "DC 지연 = Vertiv·Quanta 백로그 연장 (단기 negative, 장기 positive)",
            "ETF: SOXX/SMH, NUKZ, UFO/ARKX, BOTZ/ROBO",
        ],
        size=14,
    )

    # --- Stock count summary ---
    add_table_slide(
        prs,
        "트렌드별 정리 종목 수",
        ["트렌드", "종목 수", "대표 티커"],
        [
            ["AI 물리 인프라", "22", "VRT, ETN, PWR, NVDA, AVGO"],
            ["원자력·전력", "21", "CEG, VST, OKLO, CCJ"],
            ["반도체·CHIPS", "24", "INTC, TSM, AMAT, ASML"],
            ["양자 + PQC", "22", "IONQ, IBM, GOOGL, PANW"],
            ["자율·로보틱스", "22", "TSLA, ISRG, AMZN, NVDA"],
            ["우주 경제", "22", "SPCX, RKLB, ASTS, LMT"],
            ["바이오·GLP-1", "24", "LLY, NVO, AMGN, TMO"],
            ["경제안보", "24", "MP, FCX, LMT, PLTR"],
        ],
        col_widths=[2.5, 1.0, 5.5],
    )

    # --- Conclusion ---
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    set_slide_bg(slide, NAVY)
    tbox = slide.shapes.add_textbox(Inches(0.7), Inches(1.8), Inches(8.6), Inches(4.0))
    tf = tbox.text_frame
    p = tf.paragraphs[0]
    p.text = "결론"
    p.font.size = Pt(32)
    p.font.bold = True
    p.font.color.rgb = WHITE
    for line in [
        "2026–2030 핵심 = AI가 만든 전기·실물·안보 수요",
        "지금 수요 집중: AI 2차 인프라 · GLP-1 · 원전 PPA · CHIPS 장비",
        "다음 Wave (2028–32): SMR · FTQC · Humanoid B2B · PQC 의무화",
        "",
        "Great Broadening — 좁은 승자에서 넓은 기회로",
    ]:
        p2 = tf.add_paragraph()
        p2.text = line
        p2.font.size = Pt(18)
        p2.font.color.rgb = RGBColor(0xCC, 0xDD, 0xEE)
        p2.space_before = Pt(10)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    prs.save(str(OUT))
    return OUT


if __name__ == "__main__":
    path = build()
    print(f"Saved: {path}")
