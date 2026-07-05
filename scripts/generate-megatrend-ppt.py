#!/usr/bin/env python3
"""Professional mega-trend investment deck with charts, TOC, and section dividers."""

from __future__ import annotations

import tempfile
from pathlib import Path

import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib import font_manager
from pptx import Presentation
from pptx.chart.data import CategoryChartData
from pptx.dml.color import RGBColor
from pptx.enum.chart import XL_CHART_TYPE, XL_LEGEND_POSITION
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.util import Inches, Pt

OUT = Path(__file__).resolve().parent.parent / "reports" / "megatrend-investment-report-2026.pptx"
OUT_FALLBACK = OUT.with_name("megatrend-investment-report-2026-v2.pptx")
CHART_DIR = Path(tempfile.mkdtemp(prefix="megatrend-charts-"))

# ── Palette ──────────────────────────────────────────────────────────
NAVY = RGBColor(0x0F, 0x17, 0x2A)
SLATE = RGBColor(0x1E, 0x29, 0x3B)
CYAN = RGBColor(0x06, 0xB6, 0xD4)
VIOLET = RGBColor(0x8B, 0x5C, 0xF6)
EMERALD = RGBColor(0x10, 0xB9, 0x81)
AMBER = RGBColor(0xF5, 0x9E, 0x0B)
ROSE = RGBColor(0xF4, 0x3F, 0x5E)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
OFF_WHITE = RGBColor(0xF8, 0xFA, 0xFC)
DARK = RGBColor(0x33, 0x41, 0x55)
MUTED = RGBColor(0x94, 0xA3, 0xB8)
LIGHT_LINE = RGBColor(0xE2, 0xE8, 0xF0)

MPL_COLORS = ["#06B6D4", "#8B5CF6", "#10B981", "#F59E0B", "#F43F5E", "#3B82F6", "#EC4899", "#14B8A6"]
TREND_COLORS = {
    "AI 인프라": "#06B6D4",
    "원자력": "#10B981",
    "반도체": "#8B5CF6",
    "양자": "#F59E0B",
    "로보틱스": "#F43F5E",
    "우주": "#3B82F6",
    "바이오": "#EC4899",
    "경제안보": "#14B8A6",
}

_slide_no = 0


def _korean_font() -> str:
    for name in ("Malgun Gothic", "AppleGothic", "NanumGothic", "DejaVu Sans"):
        if name in {f.name for f in font_manager.fontManager.ttflist}:
            return name
    return "DejaVu Sans"


FONT = _korean_font()
plt.rcParams.update({
    "font.family": FONT,
    "axes.unicode_minus": False,
    "figure.facecolor": "#F8FAFC",
    "axes.facecolor": "#FFFFFF",
    "axes.edgecolor": "#E2E8F0",
    "axes.labelcolor": "#334155",
    "xtick.color": "#64748B",
    "ytick.color": "#64748B",
    "grid.color": "#E2E8F0",
    "text.color": "#0F172A",
})


def _save_chart(name: str) -> Path:
    path = CHART_DIR / f"{name}.png"
    plt.tight_layout()
    plt.savefig(path, dpi=180, bbox_inches="tight", facecolor=plt.gcf().get_facecolor())
    plt.close()
    return path


# ── Chart builders (matplotlib) ───────────────────────────────────────

def chart_hyperscaler_capex() -> Path:
    years = ["2024", "2025", "2026", "2027"]
    values = [250, 400, 600, 1000]
    fig, ax = plt.subplots(figsize=(9, 4.5))
    bars = ax.bar(years, values, color=MPL_COLORS[0], width=0.55, edgecolor="white", linewidth=1.5)
    for bar, v in zip(bars, values):
        ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + 18,
                f"${v}B", ha="center", va="bottom", fontsize=12, fontweight="bold", color="#0F172A")
    ax.set_ylabel("Combined Capex (USD Billion)", fontsize=11)
    ax.set_title("하이퍼스케일러 AI Capex 추이 (MS · Goldman · Company Guidance)", fontsize=14, fontweight="bold", pad=14)
    ax.set_ylim(0, 1150)
    ax.yaxis.grid(True, linestyle="--", alpha=0.7)
    ax.set_axisbelow(True)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    return _save_chart("capex")


def chart_capex_allocation() -> Path:
    labels = ["물리 인프라\n(전력·냉각·건설)", "반도체·GPU", "네트워킹·기타"]
    sizes = [78, 17, 5]
    colors = ["#06B6D4", "#8B5CF6", "#94A3B8"]
    fig, ax = plt.subplots(figsize=(8, 5))
    wedges, texts, autotexts = ax.pie(
        sizes, labels=labels, autopct="%1.0f%%", startangle=90,
        colors=colors, explode=(0.04, 0, 0),
        textprops={"fontsize": 11},
        wedgeprops={"edgecolor": "white", "linewidth": 2},
    )
    for t in autotexts:
        t.set_fontweight("bold")
        t.set_fontsize(13)
    ax.set_title("AI 데이터센터 Capex 배분\n(칩 ≠ 전체의 대부분)", fontsize=14, fontweight="bold", pad=16)
    return _save_chart("allocation")


def chart_dc_power() -> Path:
    years = ["2024", "2026", "2030", "2035"]
    pct = [4.4, 6.5, 9.0, 12.0]
    fig, ax = plt.subplots(figsize=(9, 4.5))
    ax.fill_between(years, pct, alpha=0.25, color=MPL_COLORS[2])
    ax.plot(years, pct, marker="o", linewidth=3, markersize=10, color=MPL_COLORS[2])
    for x, y in zip(years, pct):
        ax.annotate(f"{y}%", (x, y), textcoords="offset points", xytext=(0, 12),
                    ha="center", fontsize=11, fontweight="bold")
    ax.set_ylabel("미국 전력 대비 DC 비중 (%)", fontsize=11)
    ax.set_title("데이터센터 전력 수요 전망 (Morningstar · EEI)", fontsize=14, fontweight="bold", pad=14)
    ax.set_ylim(0, 14)
    ax.yaxis.grid(True, linestyle="--", alpha=0.7)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    return _save_chart("dc_power")


def chart_megatrend_market_2030() -> Path:
    trends = ["AI Infra", "GLP-1", "Utilities", "Quantum", "Space", "Humanoid", "CHIPS"]
    values = [1000, 175, 280, 11.5, 80, 12, 53]
    colors = [MPL_COLORS[i % len(MPL_COLORS)] for i in range(len(trends))]
    fig, ax = plt.subplots(figsize=(10, 5))
    bars = ax.barh(trends, values, color=colors, height=0.6, edgecolor="white")
    ax.set_xlabel("시장 규모 추정 ($B, 로그 스케일 근사)", fontsize=11)
    ax.set_title("2030 전후 메가트렌드 시장 규모 비교", fontsize=14, fontweight="bold", pad=14)
    for bar, v in zip(bars, values):
        label = f"${v}B" if v >= 10 else f"${v}B"
        ax.text(bar.get_width() + 8, bar.get_y() + bar.get_height() / 2,
                label, va="center", fontsize=10, fontweight="bold")
    ax.set_xlim(0, 1150)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    return _save_chart("market_2030")


def chart_demand_heatmap() -> Path:
    trends = list(TREND_COLORS.keys())
    periods = ["2025-26", "2027-28", "2029-30", "2031-35"]
    # intensity 0-100
    data = [
        [95, 90, 75, 55],  # AI
        [80, 85, 70, 90],  # nuclear
        [90, 85, 70, 50],  # semi
        [40, 65, 85, 90],  # quantum
        [35, 55, 75, 85],  # robotics
        [50, 65, 80, 90],  # space
        [95, 85, 70, 55],  # bio
        [85, 80, 75, 70],  # security
    ]
    fig, ax = plt.subplots(figsize=(10, 5.5))
    im = ax.imshow(data, cmap="YlGnBu", aspect="auto", vmin=0, vmax=100)
    ax.set_xticks(range(len(periods)))
    ax.set_xticklabels(periods, fontsize=10)
    ax.set_yticks(range(len(trends)))
    ax.set_yticklabels(trends, fontsize=10)
    for i in range(len(trends)):
        for j in range(len(periods)):
            ax.text(j, i, data[i][j], ha="center", va="center", fontsize=9,
                    color="white" if data[i][j] > 55 else "#334155", fontweight="bold")
    ax.set_title("메가트렌드별 수요 강도 Heatmap (구조적 추정)", fontsize=14, fontweight="bold", pad=14)
    cbar = plt.colorbar(im, ax=ax, fraction=0.03, pad=0.02)
    cbar.set_label("수요 강도", fontsize=10)
    return _save_chart("heatmap")


def chart_glp1_share() -> Path:
    labels = ["Eli Lilly (LLY)", "Novo Nordisk (NVO)", "기타"]
    sizes = [62, 31, 7]
    colors = ["#06B6D4", "#8B5CF6", "#CBD5E1"]
    fig, ax = plt.subplots(figsize=(7, 5))
    wedges, texts, autotexts = ax.pie(sizes, labels=labels, autopct="%1.0f%%", colors=colors,
                                       startangle=140, wedgeprops={"edgecolor": "white", "linewidth": 2},
                                       textprops={"fontsize": 11})
    for t in autotexts:
        t.set_fontweight("bold")
    ax.set_title("GLP-1 시장 점유율 전망 (2030, TD Cowen)", fontsize=14, fontweight="bold", pad=14)
    return _save_chart("glp1")


def chart_quantum_growth() -> Path:
    years = ["2025", "2026", "2028", "2030", "2032"]
    market = [2.0, 2.9, 6.1, 11.5, 19.0]
    fig, ax = plt.subplots(figsize=(9, 4.5))
    ax.plot(years, market, marker="s", linewidth=3, markersize=9, color=MPL_COLORS[3])
    ax.fill_between(range(len(years)), market, alpha=0.15, color=MPL_COLORS[3])
    ax.set_xticks(range(len(years)))
    ax.set_xticklabels(years)
    for i, v in enumerate(market):
        ax.annotate(f"${v}B", (i, v), textcoords="offset points", xytext=(0, 10), ha="center", fontweight="bold")
    ax.set_ylabel("글로벌 시장 ($B)", fontsize=11)
    ax.set_title("양자컴퓨팅 시장 성장 전망 (Alora Advisory)", fontsize=14, fontweight="bold", pad=14)
    ax.yaxis.grid(True, linestyle="--", alpha=0.7)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    return _save_chart("quantum")


def chart_ionq_vs_google() -> Path:
    categories = ["게이트\n충실도", "연결성", "QEC\n실증", "상용\n매출", "확장\n잠재력"]
    ionq = [99, 95, 55, 90, 70]
    google = [88, 65, 98, 40, 92]
    x = range(len(categories))
    w = 0.35
    fig, ax = plt.subplots(figsize=(9, 5))
    ax.bar([i - w / 2 for i in x], ionq, w, label="IonQ (Trapped Ion)", color="#06B6D4", edgecolor="white")
    ax.bar([i + w / 2 for i in x], google, w, label="Google (Superconducting)", color="#8B5CF6", edgecolor="white")
    ax.set_xticks(list(x))
    ax.set_xticklabels(categories, fontsize=10)
    ax.set_ylim(0, 110)
    ax.set_ylabel("상대 점수 (0–100)", fontsize=11)
    ax.set_title("IonQ vs Google Quantum AI — 기술 포지셔닝", fontsize=14, fontweight="bold", pad=14)
    ax.legend(loc="upper right", framealpha=0.9)
    ax.yaxis.grid(True, linestyle="--", alpha=0.7)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    return _save_chart("ionq_google")


def chart_nuclear_ppa() -> Path:
    companies = ["Meta\n패키지", "Constellation\n(CEG)", "Vistra\n(VST)", "Oklo\n(SMR)", "TerraPower\n(SMR)"]
    gw = [6.6, 1.1, 2.1, 1.2, 2.0]
    types = ["Total", "Operating", "Operating", "Future", "Future"]
    type_colors = {"Total": "#0F172A", "Operating": "#10B981", "Future": "#F59E0B"}
    colors = [type_colors[t] for t in types]
    fig, ax = plt.subplots(figsize=(9, 4.5))
    bars = ax.bar(companies, gw, color=colors, width=0.55, edgecolor="white")
    for bar, v in zip(bars, gw):
        ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + 0.08,
                f"{v} GW", ha="center", fontweight="bold", fontsize=11)
    ax.set_ylabel("전력 용량 (GW)", fontsize=11)
    ax.set_title("빅테크 원자력 PPA · Meta 6.6GW 패키지", fontsize=14, fontweight="bold", pad=14)
    legend = [mpatches.Patch(color="#10B981", label="가동 원전"), mpatches.Patch(color="#F59E0B", label="SMR (2030–35)")]
    ax.legend(handles=legend, loc="upper right")
    ax.set_ylim(0, 8)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    return _save_chart("nuclear")


def chart_value_chain() -> Path:
    fig, ax = plt.subplots(figsize=(10, 4))
    ax.set_xlim(0, 10)
    ax.set_ylim(0, 4)
    ax.axis("off")
    boxes = [
        (0.3, 2.2, "Hyperscaler\nCapex $600B+", "#0F172A", "white"),
        (2.5, 3.0, "1차: 칩\nNVDA·AVGO·MRVL", "#8B5CF6", "white"),
        (2.5, 1.2, "2차: 물리 인프라\nVRT·ETN·PWR·CAT", "#06B6D4", "white"),
        (5.5, 2.2, "3차: 전력 생산\nCEG·VST·TLN", "#10B981", "white"),
        (8.0, 2.2, "AI 서비스\nMSFT·META·GOOGL", "#F59E0B", "white"),
    ]
    for x, y, text, bg, fg in boxes:
        rect = mpatches.FancyBboxPatch((x, y), 1.8, 1.0, boxstyle="round,pad=0.08",
                                        facecolor=bg, edgecolor="white", linewidth=2)
        ax.add_patch(rect)
        ax.text(x + 0.9, y + 0.5, text, ha="center", va="center", fontsize=9,
                color=fg, fontweight="bold")
    arrows = [(2.1, 2.7, 2.5, 3.4), (2.1, 2.7, 2.5, 1.7), (4.3, 3.4, 5.5, 2.9),
              (4.3, 1.7, 5.5, 2.5), (7.3, 2.7, 8.0, 2.7)]
    for x1, y1, x2, y2 in arrows:
        ax.annotate("", xy=(x2, y2), xytext=(x1, y1),
                    arrowprops=dict(arrowstyle="->", color="#94A3B8", lw=2))
    ax.text(5, 0.3, "← 2026 수익 집중: 2차 물리 인프라 레이어", ha="center", fontsize=12,
            fontweight="bold", color="#06B6D4")
    ax.set_title("AI Value Chain — 자금 흐름", fontsize=14, fontweight="bold", pad=8)
    return _save_chart("value_chain")


def chart_horizon() -> Path:
    horizons = ["0–2년\n(Now)", "3–5년", "5–10년"]
    ai = [95, 60, 30]
    nuclear = [75, 85, 70]
    quantum = [35, 80, 95]
    bio = [90, 60, 40]
    x = range(len(horizons))
    w = 0.2
    fig, ax = plt.subplots(figsize=(9, 5))
    ax.bar([i - 1.5 * w for i in x], ai, w, label="AI 인프라", color=MPL_COLORS[0])
    ax.bar([i - 0.5 * w for i in x], nuclear, w, label="원자력", color=MPL_COLORS[2])
    ax.bar([i + 0.5 * w for i in x], quantum, w, label="양자", color=MPL_COLORS[3])
    ax.bar([i + 1.5 * w for i in x], bio, w, label="GLP-1", color=MPL_COLORS[6])
    ax.set_xticks(list(x))
    ax.set_xticklabels(horizons, fontsize=11)
    ax.set_ylabel("투자 매력도 (상대)", fontsize=11)
    ax.set_title("투자 Horizon별 섹터 매력도", fontsize=14, fontweight="bold", pad=14)
    ax.legend(loc="upper right", ncol=2, fontsize=9)
    ax.set_ylim(0, 110)
    ax.yaxis.grid(True, linestyle="--", alpha=0.7)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    return _save_chart("horizon")


def chart_stock_count() -> Path:
    trends = list(TREND_COLORS.keys())
    counts = [22, 21, 24, 22, 22, 22, 24, 24]
    colors = list(TREND_COLORS.values())
    fig, ax = plt.subplots(figsize=(10, 5))
    bars = ax.bar(trends, counts, color=colors, edgecolor="white", linewidth=1.5)
    ax.set_ylabel("분석 종목 수", fontsize=11)
    ax.set_title("트렌드별 커버리지 종목 수 (각 20+)", fontsize=14, fontweight="bold", pad=14)
    plt.xticks(rotation=25, ha="right", fontsize=9)
    for bar in bars:
        ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + 0.3,
                f"{int(bar.get_height())}", ha="center", fontweight="bold")
    ax.set_ylim(0, 28)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    return _save_chart("stock_count")


# ── PPT helpers ───────────────────────────────────────────────────────

def _next_slide_no() -> int:
    global _slide_no
    _slide_no += 1
    return _slide_no


def blank_slide(prs: Presentation):
    return prs.slides.add_slide(prs.slide_layouts[6])


def set_bg(slide, color: RGBColor) -> None:
    fill = slide.background.fill
    fill.solid()
    fill.fore_color.rgb = color


def add_footer(slide, text: str = "Mega-Trend Investment Research 2026") -> None:
    n = _next_slide_no()
    bar = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0), Inches(7.1), Inches(10), Inches(0.4))
    bar.fill.solid()
    bar.fill.fore_color.rgb = SLATE
    bar.line.fill.background()
    tf = bar.text_frame
    tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    p = tf.paragraphs[0]
    p.text = f"  {text}                                                                                    {n}"
    p.font.size = Pt(9)
    p.font.color.rgb = MUTED


def add_accent_line(slide, top=1.05) -> None:
    line = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0), Inches(top), Inches(10), Inches(0.06))
    line.fill.solid()
    line.fill.fore_color.rgb = CYAN
    line.line.fill.background()


def slide_title(slide, title: str, subtitle: str | None = None) -> None:
    set_bg(slide, OFF_WHITE)
    hdr = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0), Inches(0), Inches(10), Inches(1.15))
    hdr.fill.solid()
    hdr.fill.fore_color.rgb = NAVY
    hdr.line.fill.background()
    tf = hdr.text_frame
    tf.margin_left = Inches(0.45)
    p = tf.paragraphs[0]
    p.text = title
    p.font.size = Pt(28)
    p.font.bold = True
    p.font.color.rgb = WHITE
    if subtitle:
        p2 = tf.add_paragraph()
        p2.text = subtitle
        p2.font.size = Pt(12)
        p2.font.color.rgb = CYAN
    add_accent_line(slide)
    add_footer(slide)


def add_image(slide, path: Path, left=0.45, top=1.35, width=9.1) -> None:
    slide.shapes.add_picture(str(path), Inches(left), Inches(top), width=Inches(width))


def add_kpi_row(slide, kpis: list[tuple[str, str, str]], top=1.4) -> None:
    """(value, label, color_hex)"""
    w = 2.15
    for i, (val, label, hex_c) in enumerate(kpis):
        left = 0.45 + i * (w + 0.12)
        card = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(left), Inches(top), Inches(w), Inches(1.35))
        card.fill.solid()
        card.fill.fore_color.rgb = WHITE
        card.line.color.rgb = LIGHT_LINE
        # top stripe
        stripe = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(left), Inches(top), Inches(w), Inches(0.08))
        r, g, b = int(hex_c[1:3], 16), int(hex_c[3:5], 16), int(hex_c[5:7], 16)
        stripe.fill.solid()
        stripe.fill.fore_color.rgb = RGBColor(r, g, b)
        stripe.line.fill.background()
        box = slide.shapes.add_textbox(Inches(left), Inches(top + 0.15), Inches(w), Inches(1.1))
        tf = box.text_frame
        p1 = tf.paragraphs[0]
        p1.text = val
        p1.font.size = Pt(22)
        p1.font.bold = True
        p1.font.color.rgb = NAVY
        p1.alignment = PP_ALIGN.CENTER
        p2 = tf.add_paragraph()
        p2.text = label
        p2.font.size = Pt(9)
        p2.font.color.rgb = MUTED
        p2.alignment = PP_ALIGN.CENTER


def add_bullets(slide, items: list[str], left=0.55, top=1.35, width=4.3, size=13, color=DARK):
    box = slide.shapes.add_textbox(Inches(left), Inches(top), Inches(width), Inches(5.5))
    tf = box.text_frame
    tf.word_wrap = True
    for i, item in enumerate(items):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.text = f"▸  {item}"
        p.font.size = Pt(size)
        p.font.color.rgb = color
        p.space_after = Pt(8)


def section_divider(prs: Presentation, num: str, title: str, subtitle: str, color: RGBColor) -> None:
    slide = blank_slide(prs)
    set_bg(slide, color)
    # decorative circle
    circ = slide.shapes.add_shape(MSO_SHAPE.OVAL, Inches(7.2), Inches(-0.8), Inches(4), Inches(4))
    circ.fill.solid()
    circ.fill.fore_color.rgb = RGBColor(min(color.red + 20, 255) if hasattr(color, 'red') else 0x1E, 0x29, 0x3B)
    circ.fill.transparency = 0.5
    circ.line.fill.background()
    box = slide.shapes.add_textbox(Inches(0.7), Inches(2.3), Inches(8), Inches(3))
    tf = box.text_frame
    p0 = tf.paragraphs[0]
    p0.text = num
    p0.font.size = Pt(56)
    p0.font.bold = True
    p0.font.color.rgb = CYAN
    p1 = tf.add_paragraph()
    p1.text = title
    p1.font.size = Pt(36)
    p1.font.bold = True
    p1.font.color.rgb = WHITE
    p2 = tf.add_paragraph()
    p2.text = subtitle
    p2.font.size = Pt(16)
    p2.font.color.rgb = MUTED
    p2.space_before = Pt(12)
    add_footer(slide)


def add_table(slide, headers, rows, left=0.4, top=1.3, col_widths=None):
    nr, nc = len(rows) + 1, len(headers)
    tbl = slide.shapes.add_table(nr, nc, Inches(left), Inches(top), Inches(9.2), Inches(0.32 * nr + 0.2)).table
    if col_widths:
        for i, w in enumerate(col_widths):
            tbl.columns[i].width = Inches(w)
    for j, h in enumerate(headers):
        c = tbl.cell(0, j)
        c.text = h
        c.fill.solid()
        c.fill.fore_color.rgb = NAVY
        for p in c.text_frame.paragraphs:
            p.font.bold = True
            p.font.size = Pt(9)
            p.font.color.rgb = WHITE
    for i, row in enumerate(rows, 1):
        bg = OFF_WHITE if i % 2 else WHITE
        for j, val in enumerate(row):
            c = tbl.cell(i, j)
            c.text = val
            c.fill.solid()
            c.fill.fore_color.rgb = bg
            for p in c.text_frame.paragraphs:
                p.font.size = Pt(8)
                p.font.color.rgb = DARK


def add_native_bar_chart(slide, title: str, categories, series_name, values, left=5.0, top=1.4):
    chart_data = CategoryChartData()
    chart_data.categories = categories
    chart_data.add_series(series_name, values)
    chart = slide.shapes.add_chart(
        XL_CHART_TYPE.COLUMN_CLUSTERED, Inches(left), Inches(top), Inches(4.5), Inches(3.8), chart_data
    ).chart
    chart.has_legend = False
    chart.chart_title.text_frame.text = title
    chart.chart_title.text_frame.paragraphs[0].font.size = Pt(11)
    return chart


# ── Build deck ────────────────────────────────────────────────────────

def build() -> Path:
    global _slide_no
    _slide_no = 0

    # Pre-render charts
    charts = {
        "capex": chart_hyperscaler_capex(),
        "allocation": chart_capex_allocation(),
        "dc_power": chart_dc_power(),
        "market": chart_megatrend_market_2030(),
        "heatmap": chart_demand_heatmap(),
        "glp1": chart_glp1_share(),
        "quantum": chart_quantum_growth(),
        "ionq": chart_ionq_vs_google(),
        "nuclear": chart_nuclear_ppa(),
        "value_chain": chart_value_chain(),
        "horizon": chart_horizon(),
        "stock_count": chart_stock_count(),
    }

    prs = Presentation()
    prs.slide_width = Inches(10)
    prs.slide_height = Inches(7.5)

    # ── 1. Cover ──
    slide = blank_slide(prs)
    set_bg(slide, NAVY)
    accent = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0), Inches(0), Inches(0.18), Inches(7.5))
    accent.fill.solid()
    accent.fill.fore_color.rgb = CYAN
    accent.line.fill.background()
    deco = slide.shapes.add_shape(MSO_SHAPE.OVAL, Inches(6.5), Inches(4.5), Inches(5), Inches(5))
    deco.fill.solid()
    deco.fill.fore_color.rgb = SLATE
    deco.line.fill.background()
    tb = slide.shapes.add_textbox(Inches(0.65), Inches(1.8), Inches(8.5), Inches(4))
    tf = tb.text_frame
    for i, (txt, sz, bold, col) in enumerate([
        ("MEGA-TREND", 18, False, CYAN),
        ("2026–2035\n투자 전략 발표자료", 40, True, WHITE),
        ("8대 메가트렌드 · 수요 시점 · 180+ 종목 분석", 18, False, MUTED),
        ("", 8, False, MUTED),
        ("2026년 7월 5일", 13, False, MUTED),
        ("Morgan Stanley · McKinsey · Gartner · CHIPS Act", 11, False, MUTED),
    ]):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.text = txt
        p.font.size = Pt(sz)
        p.font.bold = bold
        p.font.color.rgb = col
        if i == 1:
            p.line_spacing = 1.1
    add_footer(slide, "CONFIDENTIAL — For Discussion Purposes")

    # ── 2. TOC ──
    slide = blank_slide(prs)
    slide_title(slide, "목차", "Table of Contents")
    toc = [
        ("01", "Executive Summary", "핵심 메시지 · 시장 규모 · 수요 Heatmap"),
        ("02", "AI 물리 인프라", "2차 파생 — Electrons, Not Tokens"),
        ("03", "원자력 · AI 전력", "PPA Rush · SMR Pipeline"),
        ("04", "반도체 · CHIPS", "리쇼어링 · 48D 마감"),
        ("05", "양자 · PQC", "FTQC Roadmap · 보안 마이그레이션"),
        ("06", "자율 · 로보틱스", "Factory → Humanoid"),
        ("07", "우주 경제", "Launch · Connectivity · Defense"),
        ("08", "바이오 · GLP-1", "Code Meets Cell"),
        ("09", "경제안보", "희토류 · 방산 · Cyber"),
        ("10", "결론 · Appendix", "Horizon · ETF · 면책"),
    ]
    for i, (num, title, sub) in enumerate(toc):
        row, col = divmod(i, 2)
        left = 0.5 + col * 4.8
        top = 1.45 + row * 1.05
        card = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(left), Inches(top), Inches(4.5), Inches(0.88))
        card.fill.solid()
        card.fill.fore_color.rgb = WHITE
        card.line.color.rgb = LIGHT_LINE
        box = slide.shapes.add_textbox(Inches(left + 0.15), Inches(top + 0.1), Inches(4.2), Inches(0.75))
        tf = box.text_frame
        p = tf.paragraphs[0]
        p.text = f"{num}   {title}"
        p.font.size = Pt(13)
        p.font.bold = True
        p.font.color.rgb = NAVY
        p2 = tf.add_paragraph()
        p2.text = sub
        p2.font.size = Pt(9)
        p2.font.color.rgb = MUTED

    # ── 3. Agenda / Key message ──
    slide = blank_slide(prs)
    slide_title(slide, "오늘의 핵심 논지", "The Great Broadening — 2026")
    add_kpi_row(slide, [
        ("$600B+", "2026 AI Capex", "#06B6D4"),
        ("75–80%", "물리 인프라 비중", "#8B5CF6"),
        ("8", "메가트렌드", "#10B981"),
        ("180+", "분석 종목", "#F59E0B"),
    ])
    add_bullets(slide, [
        "메가캡 AI에서 전력·장비·실물자산으로 수익 분산",
        "지금 수요 집중: AI 2차 인프라 · GLP-1 · 원전 PPA · CHIPS 장비",
        "다음 Wave (2028–32): SMR · FTQC · Humanoid · PQC 의무화",
    ], top=3.0, width=9.0, size=15)

    # ── SECTION 01 ──
    section_divider(prs, "01", "Executive Summary", "시장 전망 · 수요 타이밍 · 투자 Horizon", NAVY)

    slide = blank_slide(prs)
    slide_title(slide, "하이퍼스케일러 AI Capex 폭발적 성장")
    add_image(slide, charts["capex"], top=1.25, width=9.1)

    slide = blank_slide(prs)
    slide_title(slide, "AI Capex는 칩이 아닌 물리 인프라로")
    add_image(slide, charts["allocation"], left=0.5, top=1.3, width=4.8)
    add_bullets(slide, [
        "Goldman: capex의 ~75%가 DC·전력·냉각",
        "Vertiv +270% YoY, 백로그 $15B",
        "변압기 납기 5년 — 공급 제약",
        "2차 파생 = multi-year backlog",
    ], left=5.5, top=1.5, width=4.2, size=12)

    slide = blank_slide(prs)
    slide_title(slide, "데이터센터 전력 수요")
    add_image(slide, charts["dc_power"])

    slide = blank_slide(prs)
    slide_title(slide, "2030 메가트렌드 시장 규모 비교")
    add_image(slide, charts["market"])

    slide = blank_slide(prs)
    slide_title(slide, "메가트렌드별 수요 강도 Heatmap")
    add_image(slide, charts["heatmap"], top=1.2, width=9.2)
    add_bullets(slide, [
        "100 = 구조적 수요 정점",
        "AI·바이오·반도체: 지금",
        "양자·로보·우주: 2028+",
    ], left=0.5, top=6.0, width=9, size=10)

    slide = blank_slide(prs)
    slide_title(slide, "8대 메가트렌드 한눈에")
    add_table(slide,
        ["#", "트렌드", "2030 규모", "수요 Peak", "단계"],
        [
            ["1", "AI 물리 인프라", "$600B+ capex", "2025–32", "백로그"],
            ["2", "원자력·전력", "$1.4T 유틸", "25–28 / 30–35", "PPA"],
            ["3", "반도체·CHIPS", "$52.7B+", "건설 peak", "Fab"],
            ["4", "양자+PQC", "$11.5B QC", "PQC 26–31", "상용화"],
            ["5", "로보틱스", "$4–18B", "28–32", "파일럿"],
            ["6", "우주", "$2T(2040)", "26–35", "IPO"],
            ["7", "GLP-1", "$150–190B", "24–30", "Peak"],
            ["8", "경제안보", "$12B+", "25–30", "정책"],
        ], top=1.25, col_widths=[0.35, 1.8, 1.8, 1.6, 1.2])

    slide = blank_slide(prs)
    slide_title(slide, "투자 Horizon별 섹터 매력도")
    add_image(slide, charts["horizon"])

    # ── SECTION 02 AI ──
    section_divider(prs, "02", "AI 물리 인프라", "Electrons, Not Tokens · 2025–2032", SLATE)

    slide = blank_slide(prs)
    slide_title(slide, "AI Value Chain — 자금이 흐르는 곳")
    add_image(slide, charts["value_chain"], top=1.5, width=9.2)

    slide = blank_slide(prs)
    slide_title(slide, "3-Layer Physical Stack")
    layers = [
        ("Layer 1", "칩 · 인터커넥트", "NVDA  AVGO  MRVL", "#8B5CF6"),
        ("Layer 2", "랙 전력 · 냉각", "VRT  ETN  ABB  Schneider", "#06B6D4"),
        ("Layer 3", "건물 · 백업 · 그리드", "CAT  PWR  GNRC  STX", "#10B981"),
    ]
    for i, (layer, name, tickers, hex_c) in enumerate(layers):
        top = 1.4 + i * 1.75
        card = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.5), Inches(top), Inches(9), Inches(1.45))
        card.fill.solid()
        card.fill.fore_color.rgb = WHITE
        card.line.color.rgb = LIGHT_LINE
        r, g, b = int(hex_c[1:3], 16), int(hex_c[3:5], 16), int(hex_c[5:7], 16)
        tag = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.65), Inches(top + 0.25), Inches(1.3), Inches(0.95))
        tag.fill.solid()
        tag.fill.fore_color.rgb = RGBColor(r, g, b)
        tag.line.fill.background()
        tb = slide.shapes.add_textbox(Inches(0.65), Inches(top + 0.35), Inches(1.3), Inches(0.8))
        tf = tb.text_frame
        p = tf.paragraphs[0]
        p.text = layer
        p.font.size = Pt(11)
        p.font.bold = True
        p.font.color.rgb = WHITE
        p.alignment = PP_ALIGN.CENTER
        tb2 = slide.shapes.add_textbox(Inches(2.2), Inches(top + 0.2), Inches(7), Inches(1.1))
        tf2 = tb2.text_frame
        p1 = tf2.paragraphs[0]
        p1.text = name
        p1.font.size = Pt(16)
        p1.font.bold = True
        p1.font.color.rgb = NAVY
        p2 = tf2.add_paragraph()
        p2.text = tickers
        p2.font.size = Pt(12)
        p2.font.color.rgb = MUTED

    slide = blank_slide(prs)
    slide_title(slide, "핵심 종목 — AI 인프라")
    add_table(slide,
        ["티커", "시총", "역할", "백로그/가이드", "Rating"],
        [
            ["VRT", "~$50B", "랙 전력·냉각", "$15B backlog", "★★★★★"],
            ["ETN", "~$140B", "변압기·SWGR", "AI 15-20% rev", "★★★★★"],
            ["PWR", "~$60B", "송전 EPC", "$44B backlog", "★★★★★"],
            ["NVDA", "~$3T", "GPU", "Rubin roadmap", "★★★★★"],
            ["AVGO", "~$1T", "Custom ASIC", "Multi-yr wins", "★★★★★"],
            ["CAT", "~$180B", "DC 건설", "$63B backlog", "★★★★★"],
        ], top=1.25, col_widths=[0.7, 0.9, 2.0, 2.2, 1.0])

    # ── SECTION 03 Nuclear ──
    section_divider(prs, "03", "원자력 · AI 전력", "Nuclear Renaissance · PPA → SMR", RGBColor(0x05, 0x4A, 0x3A))

    slide = blank_slide(prs)
    slide_title(slide, "빅테크 원자력 확보 경쟁")
    add_image(slide, charts["nuclear"])

    slide = blank_slide(prs)
    slide_title(slide, "투자 3-Bucket Framework")
    buckets = [
        ("Bucket 1", "Cash-flow 유틸", "CEG · VST · TLN · D", "지금 PPA 수익", "#10B981", "Moderate"),
        ("Bucket 2", "SMR Pure-play", "OKLO · SMR · NNE", "2030–35 옵션", "#F59E0B", "Very High"),
        ("Bucket 3", "연료·인프라", "CCJ · BWXT · LEU · GEV", "방산+상업", "#06B6D4", "Moderate"),
    ]
    for i, (b, title, tickers, desc, hex_c, risk) in enumerate(buckets):
        top = 1.35 + i * 1.85
        card = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.5), Inches(top), Inches(9), Inches(1.55))
        card.fill.solid()
        card.fill.fore_color.rgb = WHITE
        card.line.color.rgb = LIGHT_LINE
        r, g, b = int(hex_c[1:3], 16), int(hex_c[3:5], 16), int(hex_c[5:7], 16)
        tb = slide.shapes.add_textbox(Inches(0.7), Inches(top + 0.15), Inches(8.5), Inches(1.3))
        tf = tb.text_frame
        p = tf.paragraphs[0]
        p.text = f"{b}  |  {title}"
        p.font.size = Pt(15)
        p.font.bold = True
        p.font.color.rgb = RGBColor(r, g, b)
        p2 = tf.add_paragraph()
        p2.text = f"{tickers}   —   {desc}   |   Risk: {risk}"
        p2.font.size = Pt(12)
        p2.font.color.rgb = DARK

    # ── SECTION 04 Semi ──
    section_divider(prs, "04", "반도체 · CHIPS", "Reshoring · 48D Cliff Dec 2026", RGBColor(0x3B, 0x1D, 0x6E))

    slide = blank_slide(prs)
    slide_title(slide, "CHIPS Act 현황")
    add_kpi_row(slide, [
        ("$38.7B", "39B 중 배정", "#8B5CF6"),
        ("35%", "48D Tax Credit", "#06B6D4"),
        ("12/31/26", "착공 마감", "#F43F5E"),
        ("22%", "US Adv Logic Share", "#10B981"),
    ])
    add_bullets(slide, [
        "Intel $8.5B + $11B loan + Secure Enclave $3B",
        "TSMC AZ 4nm HVM · Intel 18A · Samsung 2nm",
        "Fab: INTC TSM MU GFS  |  장비: AMAT LRCX KLAC ASML",
        "장비사 = CHIPS 무관하게 capex cycle 수혜",
    ], top=3.1, width=9.0, size=14)

    slide = blank_slide(prs)
    slide_title(slide, "CHIPS 주요 수혜 기업")
    add_table(slide,
        ["기업", "CHIPS 지원", "프로젝트", "상태"],
        [
            ["Intel", "$8.5B+대출", "AZ, OH, OR", "18A HVM"],
            ["TSMC", "$6.6B", "Arizona Fab21", "4nm 가동"],
            ["Samsung", "$6.4B", "Taylor TX", "2nm 2026"],
            ["Micron", "$6.16B", "NY, Idaho", "DRAM megafab"],
            ["AMAT", "—", "장비 #1", "Capex cycle"],
            ["ASML", "—", "EUV 독점", "필수"],
        ], top=1.25, col_widths=[1.0, 1.5, 2.5, 2.0])

    # ── SECTION 05 Quantum ──
    section_divider(prs, "05", "양자 · PQC", "FTQC 2028–30 · Security Migration", RGBColor(0x78, 0x35, 0x0F))

    slide = blank_slide(prs)
    slide_title(slide, "양자컴퓨팅 시장 성장")
    add_image(slide, charts["quantum"])

    slide = blank_slide(prs)
    slide_title(slide, "IonQ vs Google — 기술 포지셔닝")
    add_image(slide, charts["ionq"], top=1.2, width=9.0)
    add_bullets(slide, [
        "IonQ: 상용 매출 $64.7M(Q1'26), RPO $470M",
        "Google: below-threshold QEC 최초 실증",
        "PQC: PANW CRWD NET LAES — 2030–31 의무화",
    ], left=0.5, top=6.05, width=9, size=10)

    slide = blank_slide(prs)
    slide_title(slide, "양자 + PQC 종목 맵")
    add_table(slide,
        ["구분", "티커", "포지션", "수요 시점"],
        [
            ["하드웨어", "IONQ RGTI QBTS", "Trapped ion / SC", "2028 FTQC"],
            ["빅테크", "IBM GOOGL MSFT", "Cloud + R&D", "2029"],
            ["PQC", "PANW CRWD NET", "TLS·Zero Trust", "2026–31"],
            ["Secure HW", "LAES WKEY NXPI", "Root of Trust", "2027 ANSSI"],
        ], top=1.3, col_widths=[1.2, 2.5, 2.5, 2.0])

    # ── SECTION 06 Robotics ──
    section_divider(prs, "06", "자율 · 로보틱스", "Factory Floor → Humanoid", RGBColor(0x7F, 0x1D, 0x1D))

    slide = blank_slide(prs)
    slide_title(slide, "Autonomy Stack — 3 Layers")
    add_kpi_row(slide, [
        ("750K+", "Amazon Robots", "#F43F5E"),
        ("1/hr", "Figure BotQ", "#06B6D4"),
        ("37.9%", "CAGR 26-30", "#10B981"),
        ("$39B", "Figure AI Val", "#8B5CF6"),
    ])
    add_bullets(slide, [
        "Ground: TSLA Optimus · UBTECH · AMZN · SYM",
        "Components: NVDA TER CGNX ABB FANUY ROK",
        "Medical: ISRG  |  Defense drones: AVAV KTOS",
        "비상장 Figure/Agility → 간접 노출만",
    ], top=3.1, width=9.0, size=14)

    # ── SECTION 07 Space ──
    section_divider(prs, "07", "우주 경제", "SpaceX IPO · Launch Economy", RGBColor(0x1E, 0x3A, 0x8A))

    slide = blank_slide(prs)
    slide_title(slide, "우주 경제 — 투자 맵")
    cols = [
        ("Launch", "SPCX RKLB FLY", "#3B82F6"),
        ("Connectivity", "ASTS IRDM GSAT", "#8B5CF6"),
        ("Earth Obs", "PL BKSY", "#06B6D4"),
        ("Defense", "LMT NOC RTX LHX", "#10B981"),
    ]
    for i, (title, tickers, hex_c) in enumerate(cols):
        row, col = divmod(i, 2)
        left = 0.5 + col * 4.7
        top = 1.4 + row * 2.6
        card = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(left), Inches(top), Inches(4.4), Inches(2.2))
        card.fill.solid()
        card.fill.fore_color.rgb = WHITE
        card.line.color.rgb = LIGHT_LINE
        r, g, b = int(hex_c[1:3], 16), int(hex_c[3:5], 16), int(hex_c[5:7], 16)
        hdr = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(left), Inches(top), Inches(4.4), Inches(0.55))
        hdr.fill.solid()
        hdr.fill.fore_color.rgb = RGBColor(r, g, b)
        hdr.line.fill.background()
        tb = slide.shapes.add_textbox(Inches(left), Inches(top + 0.08), Inches(4.4), Inches(0.5))
        p = tb.text_frame.paragraphs[0]
        p.text = title
        p.font.size = Pt(14)
        p.font.bold = True
        p.font.color.rgb = WHITE
        p.alignment = PP_ALIGN.CENTER
        tb2 = slide.shapes.add_textbox(Inches(left + 0.2), Inches(top + 0.75), Inches(4), Inches(1.2))
        p2 = tb2.text_frame.paragraphs[0]
        p2.text = tickers
        p2.font.size = Pt(16)
        p2.font.bold = True
        p2.font.color.rgb = NAVY
        p2.alignment = PP_ALIGN.CENTER
    add_bullets(slide, ["RKLB Q1'26: $200M rev (+63%), backlog $2.2B+  |  PwC: $2T by 2040"],
                top=6.2, width=9, size=11)

    # ── SECTION 08 Bio ──
    section_divider(prs, "08", "바이오 · GLP-1", "Code Meets Cell · $150–190B", RGBColor(0x83, 0x15, 0x5C))

    slide = blank_slide(prs)
    slide_title(slide, "GLP-1 시장 지배 구조")
    add_image(slide, charts["glp1"], left=0.5, top=1.3, width=4.5)
    add_bullets(slide, [
        "2030: $150B+ (JPM $200B)",
        "59M 환자 (TD Cowen)",
        "LLY: orforglipron(oral), retatrutide",
        "NVO: CagriSema FDA review",
        "Challenger: AMGN VKTX GPCR",
        "Tools: TMO DHR ILMN CRSP",
    ], left=5.3, top=1.5, width=4.3, size=12)

    # ── SECTION 09 Security ──
    section_divider(prs, "09", "경제안보", "Critical Minerals · Defense · Cyber", RGBColor(0x0F, 0x4C, 0x4A))

    slide = blank_slide(prs)
    slide_title(slide, "경제안보 투자 축")
    add_kpi_row(slide, [
        ("$12B", "Project Vault", "#14B8A6"),
        ("15%", "DoD in MP", "#06B6D4"),
        ("$110/kg", "NdPr Floor", "#F59E0B"),
        ("43", "Critical Min Stocks", "#8B5CF6"),
    ])
    add_bullets(slide, [
        "희토류: MP USAR  |  구리: FCX SCCO BHP",
        "방산: LMT NOC RTX GD LHX HII",
        "Gov AI: PLTR  |  Cyber: CRWD PANW",
        "MP: magnet production Dec 2025 시작",
    ], top=3.1, width=9.0, size=14)

    # ── SECTION 10 Conclusion ──
    section_divider(prs, "10", "결론 · Appendix", "Action Framework", NAVY)

    slide = blank_slide(prs)
    slide_title(slide, "트렌드별 커버리지")
    add_image(slide, charts["stock_count"], top=1.2, width=9.2)

    slide = blank_slide(prs)
    slide_title(slide, "투자 실행 프레임워크")
    add_table(slide,
        ["Horizon", "액션", "대표 ETF"],
        [
            ["0–2년", "AI infra · GLP-1 · Nuclear PPA · Semi equip", "SOXX, NUKZ"],
            ["3–5년", "SMR · Quantum · Humanoid · Space", "ARKX, BOTZ"],
            ["5–10년", "PQC · Bio-factory · Lunar", "HACK, XBI"],
        ], top=1.5, col_widths=[1.5, 5.5, 2.2])
    add_bullets(slide, [
        "DC 지연 = VRT/PWR 백로그 연장 (장기 positive)",
        "Capped Real Rates → 실물·성장주 우호",
        "면책: 투자 권유 아님 — 최신 공시 확인 필수",
    ], top=3.8, width=9, size=12)

    # ── Thank you ──
    slide = blank_slide(prs)
    set_bg(slide, NAVY)
    accent2 = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0), Inches(3.4), Inches(10), Inches(0.08))
    accent2.fill.solid()
    accent2.fill.fore_color.rgb = CYAN
    accent2.line.fill.background()
    tb = slide.shapes.add_textbox(Inches(0.7), Inches(2.2), Inches(8.6), Inches(2.5))
    tf = tb.text_frame
    p = tf.paragraphs[0]
    p.text = "Thank You"
    p.font.size = Pt(44)
    p.font.bold = True
    p.font.color.rgb = WHITE
    p2 = tf.add_paragraph()
    p2.text = "Q & A"
    p2.font.size = Pt(24)
    p2.font.color.rgb = CYAN
    p2.space_before = Pt(16)
    p3 = tf.add_paragraph()
    p3.text = "Great Broadening — 좁은 승자에서 넓은 기회로"
    p3.font.size = Pt(14)
    p3.font.color.rgb = MUTED
    p3.space_before = Pt(24)
    add_footer(slide)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    target = OUT
    try:
        prs.save(str(target))
    except PermissionError:
        target = OUT_FALLBACK
        prs.save(str(target))
    return target


if __name__ == "__main__":
    path = build()
    print(f"Saved: {path} ({_slide_no} slides)")
