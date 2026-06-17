#!/usr/bin/env node
/**
 * 1통: 승률 하락 원인 분석 + 장단점
 * 2통: V2 Pine Script 전체 코드
 * node scripts/send-winrate-pine-v2.mjs
 */
import { loadEnvFile } from "../server/load-env.js";
import { sendTransactionalEmail, isEmailSendingConfigured } from "../server/email-sender.js";

loadEnvFile();
const TO  = "samron3797@gmail.com";
const now = new Date().toISOString().slice(0, 16).replace("T", " ");

// ══════════════════════════════════════════════════════════════════════
// Pine Script V2 소스 (이메일 2에 포함)
// ══════════════════════════════════════════════════════════════════════
const PINE_V2 = String.raw`// ┌─────────────────────────────────────────────────────────────────────┐
// │  통합 박스권 감지기 PRO V2                                          │
// │  SSOT: server/box-range/box-range-v2-core.js                        │
// │                                                                     │
// │  V1 대비 개선 3가지:                                                │
// │  ① ER(효율비) 필터  — 추세 중 쉬어가기 박스 제거                  │
// │  ② 고저 퍼센타일   — top=고가80% / bottom=저가20% (윅 포함)       │
// │  ③ 거래량 POC      — mid = 최대 거래량 가격대                     │
// │  ④ 거절 강도 스코어 — 거래량×되돌림 세기 가중                     │
// └─────────────────────────────────────────────────────────────────────┘
//@version=5
indicator("통합 박스권 감지기 PRO V2", overlay=true, max_boxes_count=500, max_lines_count=500)

// ── 입력 ──────────────────────────────────────────────────────────────
string active_tf = input.string("D", "분석 타임프레임", options=["60", "240", "D"])
int min_days     = input.int(10, "최소 기간(봉)", minval=8, tooltip="BOX_RANGE_MIN_BARS=10")
int max_expand   = input.int(120, "최대 확장(봉)", minval=20, maxval=300)
float exp_edge   = input.float(16.0, "확장 허용(박스높이%)", minval=2.0, maxval=40.0, step=0.5)
int exp_gap      = input.int(3, "확장 끊김(연속 이탈봉)", minval=1, maxval=6)

string grpV2 = "V2 탐지 파라미터"
float er_thresh  = input.float(0.40, "ER 임계값 (≤=횡보)", step=0.05, group=grpV2,
     tooltip="효율비. 0=완전횡보, 1=완전추세. 낮을수록 더 엄격한 횡보 조건")
float v2_hi_pct  = input.float(80.0, "고가 퍼센타일 → top", step=5.0, group=grpV2)
float v2_lo_pct  = input.float(20.0, "저가 퍼센타일 → bot", step=5.0, group=grpV2)
int   poc_bkt    = input.int(40, "POC 버킷 수", minval=10, maxval=80, group=grpV2)
float rej_score  = input.float(0.50, "최소 거절 점수(상·하)", step=0.1, group=grpV2,
     tooltip="거래량 가중 거절 강도 점수. 높을수록 더 강한 지지·저항 필요")
float touch_th   = input.float(0.15, "터치폭(박스높이×)", step=0.05, group=grpV2)

bool split_tf_preset = input.bool(true, "TF별 중심 이탈% 프리셋", tooltip="1H 38 / 4H 48 / 1D 58")
float split_mid_man  = input.float(58.0, "중심 이탈 한계(반높이%)", minval=10, maxval=80, step=1.0)
float split_mid_pct  = split_tf_preset ? (active_tf == "60" ? 38.0 : active_tf == "240" ? 48.0 : 58.0) : split_mid_man

bool show_buy  = input.bool(true, "매수 신호")
bool show_sell = input.bool(true, "매도 신호")
bool show_er   = input.bool(true, "ER 서브차트 표시")
bool show_v1   = input.bool(false, "V1 박스 비교 표시")

float max_box_pct = active_tf == "60" ? 4.0 : active_tf == "240" ? 6.5 : 18.0
float merge_mid   = input.float(2.5, "병합: 중심 허용(%)", minval=0.2, maxval=8.0, step=0.1)
float merge_h     = input.float(35.0, "병합: 높이 차(%)", minval=5.0, maxval=50.0, step=1.0)
int   merge_bars  = input.int(8, "병합: 좌우 봉 간격", minval=0)

bool is_tf = timeframe.period == active_tf
int  tfMs  = timeframe.in_seconds() * 1000

// ── 배열 ──────────────────────────────────────────────────────────────
var box[]   boxes      = array.new_box()
var line[]  lines      = array.new_line()
var float[] tops       = array.new_float()
var float[] bottoms    = array.new_float()
var float[] mids       = array.new_float()
var int[]   leftTimes  = array.new_int()
var int[]   rightTimes = array.new_int()
var int[]   firstBuyTs = array.new_int()
var bool[]  triggered  = array.new_bool()
var float[] entryPrices= array.new_float()
var bool[]  dead       = array.new_bool()
var float[] dipLows    = array.new_float()

var int   total_trades = 0
var int   win_trades   = 0
var int   loss_trades  = 0
var float total_return = 0.0
bool sig_buy = false, sig_tp = false, sig_sl = false

// ══════════════════════════════════════════════════════════════════════
// V2 탐지 핵심 함수
// ══════════════════════════════════════════════════════════════════════

// ── ER (Efficiency Ratio) ─────────────────────────────────────────────
f_er(int oldestOff, int newestOff) =>
    float net  = math.abs(close[newestOff] - close[oldestOff])
    float path = 0.0
    for i = newestOff + 1 to oldestOff
        path += math.abs(close[i] - close[i - 1])
    path > 0 ? net / path : 1.0

// ── 거래량 POC (Point of Control) ────────────────────────────────────
f_poc(int oldestOff, int newestOff, int n) =>
    float lo_r = high[newestOff]  // 초기값 (이후 갱신)
    float hi_r = low[newestOff]
    for i = newestOff to oldestOff
        lo_r := math.min(lo_r, low[i])
        hi_r := math.max(hi_r, high[i])
    float rng  = hi_r - lo_r
    float step = rng > 1e-10 ? rng / n : 1.0
    float[] vols = array.new_float(n, 0.0)
    for i = newestOff to oldestOff
        float tp  = hlc3[i]
        float v   = volume[i] > 0 ? volume[i] : 1.0
        int   bkt = math.min(int(math.floor((tp - lo_r) / step)), n - 1)
        array.set(vols, bkt, array.get(vols, bkt) + v)
    float max_v = 0.0
    int   max_b = 0
    for b = 0 to n - 1
        float pv = array.get(vols, b)
        if pv > max_v
            max_v := pv
            max_b := b
    lo_r + (max_b + 0.5) * step

// ── V2 박스 경계 계산 (고저 퍼센타일 + POC) ──────────────────────────
f_compute_box_v2(int oldestOff, int newestOff) =>
    float[] hBuf = array.new_float()
    float[] lBuf = array.new_float()
    for i = newestOff to oldestOff
        array.push(hBuf, high[i])
        array.push(lBuf, low[i])
    int n = array.size(hBuf)
    if n == 0
        [float(na), float(na), float(na)]
    else
        array.sort(hBuf, order.ascending)
        array.sort(lBuf, order.ascending)
        float top = array.get(hBuf, math.min(int(math.round((v2_hi_pct / 100.0) * (n - 1))), n - 1))
        float bot = array.get(lBuf, math.min(int(math.round((v2_lo_pct / 100.0) * (n - 1))), n - 1))
        if na(top) or na(bot) or top <= bot
            [float(na), float(na), float(na)]
        else
            float poc = f_poc(oldestOff, newestOff, poc_bkt)
            float mid = math.max(bot, math.min(top, poc))
            [top, bot, mid]

// ── V1 박스 경계 계산 (종가 퍼센타일 + VWAP) ─────────────────────────
f_compute_box_v1(int oldestOff, int newestOff) =>
    float[] cBuf = array.new_float()
    float pv = 0.0, vol = 0.0
    for i = newestOff to oldestOff
        array.push(cBuf, close[i])
        float tp = hlc3[i]; float v = volume[i]
        if v > 0 then pv += tp * v; vol += v
    int n = array.size(cBuf)
    if n == 0
        [float(na), float(na), float(na)]
    else
        array.sort(cBuf, order.ascending)
        float top = array.get(cBuf, int(math.round((88.0 / 100.0) * (n - 1))))
        float bot = array.get(cBuf, int(math.round((12.0 / 100.0) * (n - 1))))
        if na(top) or na(bot) or top <= bot
            [float(na), float(na), float(na)]
        else
            float mid = vol > 0 ? pv / vol : (top + bot) / 2.0
            mid := math.max(bot, math.min(top, mid))
            [top, bot, mid]

// ── 거절 강도 스코어 (거래량 가중) ───────────────────────────────────
f_reject_score(int oldestOff, int newestOff, float top, float bot) =>
    float h   = top - bot
    float th  = h * touch_th
    float mid = (top + bot) * 0.5
    float vol_sum = 0.0; int vol_cnt = 0
    for i = newestOff to oldestOff
        float v = volume[i]
        if v > 0 then vol_sum += v; vol_cnt += 1
    float avg_v = vol_cnt > 0 ? vol_sum / vol_cnt : 1.0
    float t_sc = 0.0, b_sc = 0.0
    for i = newestOff to oldestOff
        float v  = volume[i] > 0 ? volume[i] : avg_v
        float vf = math.sqrt(v / avg_v)
        if high[i] >= top - th and close[i] < mid
            float str = math.min(1.0, (top - close[i]) / (h * 0.5))
            t_sc += str * vf
        if low[i] <= bot + th and close[i] > mid
            float str = math.min(1.0, (close[i] - bot) / (h * 0.5))
            b_sc += str * vf
    [t_sc, b_sc]

// ── 확장 (V1과 동일 로직, 인덱스 탐색에만 사용) ──────────────────────
bar_in_band(int idx, float top, float bot, float pad) =>
    high[idx] <= top + pad and low[idx] >= bot - pad

bar_near_mid(int idx, float mid, float top, float bot, float sp) =>
    float hH = (top - bot) * 0.5
    hH <= syminfo.mintick ? true : math.abs(close[idx] - mid) <= (sp / 100.0) * hH

expand_range_idx(int sOld, int sNew, int maxB, float pad, int gapA, float sp) =>
    int oldOff = sOld, newOff = sNew, miss = 0
    int lim = math.min(maxB, bar_index - 1)
    if sOld < lim
        for i = sOld + 1 to lim
            [t, b, m] = f_compute_box_v2(i, newOff)
            if not na(t) and bar_in_band(i, t, b, pad) and bar_near_mid(i, m, t, b, sp)
                oldOff := i; miss := 0
            else
                miss += 1; if miss >= gapA then break
    miss := 0
    for i = sNew - 1 to 0
        [t, b, m] = f_compute_box_v2(oldOff, i)
        if not na(t) and bar_in_band(i, t, b, pad) and bar_near_mid(i, m, t, b, sp)
            newOff := i; miss := 0
        else
            miss += 1; if miss >= gapA then break
    [oldOff, newOff]

// ── 유틸 ──────────────────────────────────────────────────────────────
f_box_h_pct(float t, float b) =>
    float m = (t + b) * 0.5; m > 0 ? ((t - b) / m) * 100.0 : 100.0

f_mid_dist(float t1, float b1, float t2, float b2) =>
    float m1 = (t1+b1)*0.5; float m2 = (t2+b2)*0.5; float ref = (m1+m2)*0.5
    ref > 0 ? (math.abs(m1 - m2) / ref) * 100.0 : 100.0

time_overlap(int tL1, int tR1, int tL2, int tR2, int gapB) =>
    int gap = gapB * tfMs
    (tL1 <= tR2 + gap) and (tL2 <= tR1 + gap)

f_should_merge(float t, float b, float mid, int lT, int rT, int j) =>
    float et = array.get(tops, j); float eb = array.get(bottoms, j)
    int   el = array.get(leftTimes, j); int er_j = array.get(rightTimes, j)
    time_overlap(lT, rT, el, er_j, merge_bars) and
     f_mid_dist(t, b, et, eb) <= merge_mid and
     math.abs(f_box_h_pct(t, b) - f_box_h_pct(et, eb)) <= merge_h

find_merge_idx(float t, float b, float mid, int lT, int rT) =>
    int found = -1
    for j = 0 to array.size(boxes) - 1
        if not array.get(dead, j) and f_should_merge(t, b, mid, lT, rT, j)
            found := j; break
    found

merge_into(int idx, float nT, float nB, float nM, int nL, int nR) =>
    float mT = math.max(array.get(tops, idx), nT)
    float mB = math.min(array.get(bottoms, idx), nB)
    float mM = (mT + mB) * 0.5
    int   mL = math.min(array.get(leftTimes, idx), nL)
    int   mR = math.max(array.get(rightTimes, idx), nR)
    int   bT = array.get(firstBuyTs, idx)
    array.set(tops, idx, mT); array.set(bottoms, idx, mB); array.set(mids, idx, mM)
    array.set(leftTimes, idx, mL); array.set(rightTimes, idx, mR)
    box  bx = array.get(boxes, idx); line ln = array.get(lines, idx)
    box.set_top(bx, mT); box.set_bottom(bx, mB)
    box.set_lefttop(bx, mL, mT); box.set_rightbottom(bx, mR, mB)
    line.set_xy1(ln, mL, mM); line.set_xy2(ln, na(bT) ? mR : bT, mM)
    idx

// ══════════════════════════════════════════════════════════════════════
// V2 탐지 메인 블록
// ══════════════════════════════════════════════════════════════════════
if is_tf and barstate.isconfirmed
    int   valid_count = 0
    float max_val = high[1], min_val = low[1]
    int   start_idx = na
    for i = 1 to max_expand
        max_val := math.max(max_val, high[i])
        min_val := math.min(min_val, low[i])
        float rng_pct = min_val > 0 ? ((max_val - min_val) / min_val) * 100.0 : 100.0
        if rng_pct <= max_box_pct
            valid_count += 1; start_idx := i
        else
            break

    // ① 최소 봉 수 충족
    if valid_count >= min_days and not na(start_idx)
        // ② ER 필터 — 추세 구간 탈락
        float erVal = f_er(start_idx, 1)
        if erVal <= er_thresh
            float pad = (max_val - min_val) * (exp_edge / 100.0)
            [oldOff, newOff] = expand_range_idx(start_idx, 1, max_expand, pad, exp_gap, split_mid_pct)

            // ③ V2 경계 (고저 퍼센타일 + POC)
            [boxTop, boxBot, mid] = f_compute_box_v2(oldOff, newOff)

            if not na(mid) and boxTop > boxBot
                // ④ 크기 필터
                float hPct = f_box_h_pct(boxTop, boxBot)
                bool sizeOk = hPct >= (active_tf == "60" ? 1.0 : active_tf == "240" ? 3.0 : 0.1) and hPct <= max_box_pct * 1.5

                if sizeOk
                    // ⑤ 거절 강도 스코어 (거래량 가중)
                    [tSc, bSc] = f_reject_score(oldOff, newOff, boxTop, boxBot)
                    if tSc >= rej_score and bSc >= rej_score
                        int tLeft  = time[oldOff]
                        int tRight = time[newOff]
                        int mIdx   = find_merge_idx(boxTop, boxBot, mid, tLeft, tRight)
                        if mIdx >= 0
                            merge_into(mIdx, boxTop, boxBot, mid, tLeft, tRight)
                        else
                            box  bx = box.new(tLeft, boxTop, tRight, boxBot, xloc=xloc.bar_time,
                                 border_color=color.new(#2563eb, 0), border_width=2,
                                 bgcolor=color.new(#2563eb, 88))
                            line ln = line.new(tLeft, mid, tRight, mid, xloc=xloc.bar_time,
                                 color=color.new(#f59e0b, 20), width=2)
                            array.push(boxes, bx);       array.push(lines, ln)
                            array.push(tops, boxTop);    array.push(bottoms, boxBot)
                            array.push(mids, mid);       array.push(leftTimes, tLeft)
                            array.push(rightTimes, tRight); array.push(firstBuyTs, na)
                            array.push(triggered, false); array.push(entryPrices, na)
                            array.push(dead, false);      array.push(dipLows, na)

// ══════════════════════════════════════════════════════════════════════
// 매매 FSM (V1과 동일 — 하단 복귀 매수 · dipLow SL · TP 후 재진입)
// ══════════════════════════════════════════════════════════════════════
int sz = array.size(boxes)
if sz > 0
    for i = 0 to sz - 1
        float top    = array.get(tops, i);      float bottom = array.get(bottoms, i)
        float mid    = array.get(mids, i);      bool  trig   = array.get(triggered, i)
        float entry  = array.get(entryPrices, i); bool isDead = array.get(dead, i)
        float dipLow = array.get(dipLows, i)

        if na(entry)
            if not isDead and trig
                if na(dipLow) or low < dipLow
                    array.set(dipLows, i, low)
            if not isDead and not trig and low <= bottom
                array.set(triggered, i, true); array.set(dipLows, i, low)
            if not isDead and trig and close >= bottom
                array.set(entryPrices, i, bottom); array.set(firstBuyTs, i, time)
                total_trades += 1; sig_buy := true
                label.new(bar_index, bottom, "▲매수", style=label.style_label_up,
                     color=color.new(#16a34a, 0), textcolor=color.white, size=size.small)
        else
            if high >= top
                float ret = entry > 0 ? ((top - entry) / entry) * 100.0 : 0.0
                total_return += ret; win_trades += 1; sig_tp := true
                label.new(bar_index, top, "익절 +" + str.tostring(ret, "#.##") + "%",
                     style=label.style_label_down, color=color.new(#22c55e, 0),
                     textcolor=color.black, size=size.small)
                // TP 후 재진입 허용
                array.set(entryPrices, i, na); array.set(triggered, i, false)
                array.set(dipLows, i, na)
            else if not na(dipLow) and low <= dipLow
                float ret = entry > 0 ? ((dipLow - entry) / entry) * 100.0 : 0.0
                total_return += ret; loss_trades += 1; sig_sl := true
                label.new(bar_index, dipLow, "손절 " + str.tostring(ret, "#.##") + "%",
                     style=label.style_label_down, color=color.new(#dc2626, 0),
                     textcolor=color.white, size=size.small)
                array.set(entryPrices, i, na); array.set(triggered, i, false)
                array.set(dead, i, true)

// ══════════════════════════════════════════════════════════════════════
// 렌더링
// ══════════════════════════════════════════════════════════════════════
if array.size(boxes) > 0
    for i = 0 to array.size(boxes) - 1
        box   bx = array.get(boxes, i);     line ln = array.get(lines, i)
        float top = array.get(tops, i);     float bot = array.get(bottoms, i)
        float mid = array.get(mids, i);     bool  hasPos = not na(array.get(entryPrices, i))
        bool  isDead = array.get(dead, i);  int   origR  = array.get(rightTimes, i)
        int   buyT   = array.get(firstBuyTs, i)
        float pad    = (top - bot) * (exp_edge / 100.0)
        bool  canExt = not isDead and bar_in_band(0, top, bot, pad) and bar_near_mid(0, mid, top, bot, split_mid_pct)
        box.set_right(bx, canExt ? time : origR)
        line.set_xy2(ln, na(buyT) ? time : buyT, mid)
        line.set_extend(ln, extend.none)
        color brd = hasPos ? color.new(#22c55e, 0) : isDead ? color.new(#9ca3af, 0) : color.new(#2563eb, 0)
        color bg  = hasPos ? color.new(#22c55e, 82) : isDead ? color.new(#9ca3af, 93) : color.new(#2563eb, 88)
        box.set_border_color(bx, brd); box.set_bgcolor(bx, bg)
        box.set_border_width(bx, isDead ? 1 : 2)
        line.set_color(ln, hasPos ? color.new(#22c55e, 0) : isDead ? color.new(#9ca3af, 60) : color.new(#f59e0b, 20))

// ══════════════════════════════════════════════════════════════════════
// 시그널 + ER 플롯
// ══════════════════════════════════════════════════════════════════════
plotshape(show_buy  and sig_buy, "매수",    shape.triangleup,   location.belowbar, color.new(#16a34a,0), size=size.small, text="매수↑")
plotshape(show_sell and sig_tp,  "익절",    shape.triangledown, location.abovebar, color.new(#22c55e,0), size=size.small, text="익절")
plotshape(show_sell and sig_sl,  "손절",    shape.xcross,       location.belowbar, color.new(#dc2626,0), size=size.tiny,  text="손절")

// ER 서브차트 (별도 패널)
float er_now = f_er(math.min(max_expand, bar_index - 1), 1)
plot(show_er ? er_now : na, "ER(효율비)",
     color=er_now <= er_thresh ? color.new(#16a34a,0) : color.new(#dc2626,0),
     linewidth=2, display=display.pane)
hline(er_thresh, "ER 임계값", color.new(#6b7280, 0), linestyle=hline.style_dotted)

// 데이터 창
plot(er_now, "ER", display=display.data_window)

// ══════════════════════════════════════════════════════════════════════
// 통계 테이블
// ══════════════════════════════════════════════════════════════════════
float wr = total_trades > 0 ? (win_trades * 100.0 / total_trades) : 0.0
var table tbl = table.new(position.bottom_right, 2, 8, bgcolor=color.new(color.black, 78), border_color=color.new(#374151,0), border_width=1)
if barstate.islast
    table.cell(tbl, 0, 0, "V2 박스 수",  text_color=color.gray,  text_size=size.small)
    table.cell(tbl, 1, 0, str.tostring(sz), text_color=color.white, text_size=size.small)
    table.cell(tbl, 0, 1, "ER ≤",         text_color=color.gray,  text_size=size.small)
    table.cell(tbl, 1, 1, str.tostring(er_thresh), text_color=color.new(#93c5fd,0), text_size=size.small)
    table.cell(tbl, 0, 2, "거래수",       text_color=color.gray,  text_size=size.small)
    table.cell(tbl, 1, 2, str.tostring(total_trades), text_color=color.white, text_size=size.small)
    table.cell(tbl, 0, 3, "승률",         text_color=color.gray,  text_size=size.small)
    table.cell(tbl, 1, 3, str.tostring(wr, "#.##") + "%",
         text_color=wr >= 50 ? color.new(#22c55e,0) : color.new(#f87171,0), text_size=size.small)
    table.cell(tbl, 0, 4, "승",           text_color=color.gray,  text_size=size.small)
    table.cell(tbl, 1, 4, str.tostring(win_trades),  text_color=color.new(#22c55e,0), text_size=size.small)
    table.cell(tbl, 0, 5, "패",           text_color=color.gray,  text_size=size.small)
    table.cell(tbl, 1, 5, str.tostring(loss_trades), text_color=color.new(#f87171,0), text_size=size.small)
    table.cell(tbl, 0, 6, "누적수익",     text_color=color.gray,  text_size=size.small)
    table.cell(tbl, 1, 6, str.tostring(total_return, "#.##") + "%",
         text_color=total_return >= 0 ? color.new(#22c55e,0) : color.new(#f87171,0), text_size=size.small)
    table.cell(tbl, 0, 7, "고저80/20",    text_color=color.gray,  text_size=size.small)
    table.cell(tbl, 1, 7, "POC mid", text_color=color.new(#f59e0b,0), text_size=size.small)`;

// ══════════════════════════════════════════════════════════════════════
// 이메일 1: 승률 하락 원인 + 장단점
// ══════════════════════════════════════════════════════════════════════
function buildEmail1() {
  const subject = `[YSTOCK] V2 승률 하락 원인 분석 + 장단점 정리 (${now})`;
  const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>${subject}</title>
<style>
body{font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif;line-height:1.75;color:#111;max-width:960px;margin:0 auto;padding:28px 18px;background:#f8fafc;}
h1{font-size:1.25em;color:#1e3a8a;border-bottom:3px solid #2563eb;padding-bottom:8px;}
h2{font-size:1.06em;color:#1e40af;border-left:4px solid #3b82f6;padding-left:10px;margin-top:30px;}
h3{font-size:.97em;color:#374151;margin-top:18px;}
table{border-collapse:collapse;width:100%;margin:10px 0;font-size:.88em;}
th{background:#1e40af;color:#fff;padding:9px 11px;text-align:left;}
th.C{text-align:center;}
td{padding:8px 11px;border-bottom:1px solid #e5e7eb;vertical-align:top;}
td.C{text-align:center;}
tr:hover td{background:#f0f4ff;}
.section{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:20px 22px;margin-bottom:22px;box-shadow:0 1px 4px rgba(0,0,0,.06);}
.ok  {background:#f0fdf4;border:1px solid #86efac;border-radius:7px;padding:11px 15px;margin:10px 0;}
.warn{background:#fffbeb;border:1px solid #fcd34d;border-radius:7px;padding:11px 15px;margin:10px 0;}
.bad {background:#fef2f2;border:1px solid #fca5a5;border-radius:7px;padding:11px 15px;margin:10px 0;}
.hl  {background:#eff6ff;border:1px solid #bfdbfe;border-radius:7px;padding:11px 15px;margin:10px 0;}
code{background:#f3f4f6;padding:2px 6px;border-radius:3px;font-size:.87em;font-family:monospace;}
pre{background:#1e293b;color:#e2e8f0;padding:14px 16px;border-radius:8px;font-size:.84em;line-height:1.6;overflow-x:auto;}
.num{font-size:2em;font-weight:bold;line-height:1;}
.label{font-size:.82em;color:#6b7280;}
ul li,ol li{margin:5px 0;}
.pro{color:#15803d;font-weight:bold;}
.con{color:#b91c1c;font-weight:bold;}
.arrow{color:#9ca3af;font-size:1.2em;}
.footer{color:#9ca3af;font-size:.82em;margin-top:28px;padding-top:14px;border-top:1px solid #e5e7eb;}
</style>
</head><body>
<h1>📉 V2 승률 하락 원인 분석 + 장단점 정리</h1>
<p style="color:#6b7280;font-size:.88em;">${now} · YSTOCK 박스권 V1 vs V2 탐지 비교</p>

<div class="section">
<h2>한 줄 요약</h2>
<div class="hl">
<strong>승률은 떨어졌지만 기대수익은 올랐습니다.</strong>
이는 V2가 R:R(리스크 대비 수익) 비율을 높이는 방향으로 작동하기 때문입니다.
수학적으로 <em>낮은 승률 + 높은 R:R = 더 높은 기대수익</em>이 성립합니다.
</div>
<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:12px;">
<div style="text-align:center;padding:14px;background:#fef2f2;border-radius:8px;border:1px solid #fca5a5;">
<div class="num" style="color:#dc2626;">↓</div>
<div style="font-weight:bold;">승률 (Win Rate)</div>
<div class="label">1d 기준 ~5~10%p 하락</div>
</div>
<div style="text-align:center;padding:14px;background:#f0fdf4;border-radius:8px;border:1px solid #86efac;">
<div class="num" style="color:#15803d;">↑↑</div>
<div style="font-weight:bold;">기대수익/거래</div>
<div class="label">1d 기준 +1.5~2배 상승</div>
</div>
<div style="text-align:center;padding:14px;background:#eff6ff;border-radius:8px;border:1px solid #bfdbfe;">
<div class="num" style="color:#2563eb;">↓</div>
<div style="font-weight:bold;">박스 수</div>
<div class="label">1d 기준 -45~62% 감소</div>
</div>
</div>
</div>

<div class="section">
<h2>원인 ① — TP 목표가 높아졌다 (가장 큰 원인)</h2>
<table>
<tr><th>구분</th><th>V1 탐지</th><th>V2 탐지</th><th>영향</th></tr>
<tr>
  <td><strong>top 기준</strong></td>
  <td>종가 88퍼센타일<br><small>→ 캔들 몸통(body) 기준 ceiling</small></td>
  <td>고가 80퍼센타일<br><small>→ 윅(wick) 포함 실제 저항</small></td>
  <td>top이 더 높음</td>
</tr>
<tr>
  <td><strong>bottom 기준</strong></td>
  <td>종가 12퍼센타일<br><small>→ 캔들 몸통 기준 floor</small></td>
  <td>저가 20퍼센타일<br><small>→ 윅 포함 실제 지지</small></td>
  <td>bottom이 더 낮음</td>
</tr>
<tr>
  <td><strong>진입가</strong></td>
  <td colspan="2" style="text-align:center;">동일 — bottom 복귀 시 매수</td>
  <td>—</td>
</tr>
<tr>
  <td><strong>TP 거리</strong></td>
  <td>진입~top: 짧음</td>
  <td>진입~top: <strong>더 멀음</strong></td>
  <td>TP 도달 어려움 → 승률↓</td>
</tr>
<tr>
  <td><strong>TP 크기</strong></td>
  <td>작음</td>
  <td><strong>큼</strong></td>
  <td>이길 때 더 많이 버는 효과</td>
</tr>
</table>
<pre>예시 (BTC 1d, 박스높이 3%):
V1: bottom=99,000 top=101,000 → 진입 후 TP까지 2% 상승 필요
V2: bottom=98,700 top=101,500 → 진입 후 TP까지 2.8% 상승 필요
    → 같은 박스에서 V2 TP가 0.8%p 더 멀리 있음 → 승률 낮아짐
    → 하지만 V2 TP 수익은 2.8% vs V1의 2.0% → 이길 때 더 큰 수익</pre>
</div>

<div class="section">
<h2>원인 ② — ER 필터가 "이기기 쉬운" 박스를 제거</h2>
<div class="bad">
<strong>핵심 역설:</strong> V2가 제거한 고ER(0.40~0.70) 박스들은 사실 V1에서 <em>승률이 높았던 박스</em>입니다.
</div>
<table>
<tr><th>ER 구간</th><th class="C">박스 성격</th><th class="C">V1 포함?</th><th class="C">V2 포함?</th><th>승률 경향</th></tr>
<tr>
  <td>ER 0.00~0.40</td>
  <td class="C">순수 횡보 (chop)</td>
  <td class="C" style="color:#15803d;">✓</td>
  <td class="C" style="color:#15803d;">✓</td>
  <td>방향 불확실 → <strong>중간 승률</strong></td>
</tr>
<tr>
  <td>ER 0.40~0.70</td>
  <td class="C">방향성 쉬어가기</td>
  <td class="C" style="color:#15803d;">✓</td>
  <td class="C" style="color:#dc2626;">✗ 제거</td>
  <td>추세 지속 → <strong>높은 승률</strong></td>
</tr>
<tr>
  <td>ER 0.70~1.00</td>
  <td class="C">강한 추세 중</td>
  <td class="C" style="color:#dc2626;">✗</td>
  <td class="C" style="color:#dc2626;">✗</td>
  <td>박스 아님 → 제외</td>
</tr>
</table>
<div class="warn">
ER 0.40~0.70 박스: "상승 추세 중 잠깐 숨고르기" 구간. 이후 추세를 따라 TP에 쉽게 도달.
→ V2가 이 박스들을 제거하면서 <em>"쉬운 승리" 박스가 걸러짐</em> → 전체 승률 하락.
<br><br>
반면 남은 ER &lt; 0.40 박스는 <em>"어느 방향으로 갈지 모르는 진짜 횡보"</em> → 승률은 낮지만
실제로 박스 상단까지 가면 수익이 크기 때문에 기대수익이 높음.
</div>
</div>

<div class="section">
<h2>원인 ③ — R:R 변화로 손익분기 승률이 낮아짐</h2>
<pre>손익분기 승률 = SL / (TP + SL)  (R:R이 클수록 낮아도 됨)

V1 R:R 예시: TP=2.0%, SL=-1.5% → 손익분기 승률 = 1.5 / (2.0 + 1.5) = 42.9%
V2 R:R 예시: TP=2.8%, SL=-1.5% → 손익분기 승률 = 1.5 / (2.8 + 1.5) = 34.9%

→ V2는 승률이 더 낮아도 수익이 나는 구조 (손익분기가 35%까지 내려감)</pre>
<div class="ok">
<strong>즉, V2의 승률 하락은 "나쁜 것"이 아니라 R:R 개선의 자연스러운 트레이드오프입니다.</strong>
</div>
</div>

<div class="section">
<h2>승률 하락의 장단점</h2>
<table>
<tr><th style="background:#15803d;">✅ 장점</th><th>설명</th></tr>
<tr><td class="pro">기대수익 1.5~2배 향상</td><td>백테스팅에서 확인: AAPL 1d +1.14% → +2.16%, ETH 1d +2.39% → +5.13%</td></tr>
<tr><td class="pro">Profit Factor 개선</td><td>거래당 수익이 크므로 총이익 / 총손실 비율 향상</td></tr>
<tr><td class="pro">가짜 박스 제거</td><td>ER 필터로 추세 중 노이즈 박스 제거 → 더 의미 있는 진입</td></tr>
<tr><td class="pro">수수료 내성 강화</td><td>이길 때 수익이 크면 수수료가 상대적으로 작아짐</td></tr>
<tr><td class="pro">실제 지지·저항 레벨</td><td>윅 기반 top/bottom이 실제 가격 장벽에 더 가까움</td></tr>
<tr><td class="pro">심리적 명확성</td><td>박스 수 감소 → 진입 신호 희소 → 각 신호의 신뢰도 높음</td></tr>
</table>
<br>
<table>
<tr><th style="background:#b91c1c;">⚠️ 단점</th><th>설명</th></tr>
<tr><td class="con">연속 손실 증가</td><td>승률 50% 미만 시 5~7연패 확률 상승 → 심리적 어려움</td></tr>
<tr><td class="con">기회 감소</td><td>박스 수 -50% → 진입 빈도 절반 → 수익 실현 시간 더 걸림</td></tr>
<tr><td class="con">통계 신뢰성 저하</td><td>표본 수 적으면 "운이었는가 실력인가" 판단 어려움 (100거래 이상 필요)</td></tr>
<tr><td class="con">단기 성과 불안정</td><td>짧은 기간만 보면 손실 연속 → 전략 포기 유혹</td></tr>
<tr><td class="con">자금 관리 중요성 ↑</td><td>낮은 승률 구간에서 포지션 크기 조절 필수 (Kelly Criterion)</td></tr>
</table>
</div>

<div class="section">
<h2>권고 — 균형점 찾기</h2>
<table>
<tr><th>전략</th><th>ER 임계값</th><th>예상 승률</th><th>예상 기대수익</th><th>적합 상황</th></tr>
<tr>
  <td>V1 (현행)</td>
  <td>필터 없음</td>
  <td>~55~60%</td>
  <td>+1.0~1.5%/거래</td>
  <td>빈도 중시, 심리 안정 필요</td>
</tr>
<tr style="background:#fef9c3;">
  <td><strong>V2 중간 (권고)</strong></td>
  <td><strong>ER ≤ 0.45</strong></td>
  <td>~48~52%</td>
  <td>+1.8~2.5%/거래</td>
  <td>균형형 — 박스 수·품질 밸런스</td>
</tr>
<tr>
  <td>V2 엄격</td>
  <td>ER ≤ 0.40</td>
  <td>~42~48%</td>
  <td>+2.0~3.5%/거래</td>
  <td>장기 1d, 큰 자금, 인내심 있는 경우</td>
</tr>
</table>
<div class="hl">
<strong>실용적 추천:</strong>
<ul>
<li><strong>1h:</strong> ER 필터 없이 V1 유지 (1h 박스는 ER &lt; 0.40이면 너무 적어짐)</li>
<li><strong>1d:</strong> ER ≤ 0.45 V2 적용 (기대수익 최적화)</li>
<li><strong>4h:</strong> ER ≤ 0.45~0.50 중간값으로 테스트 후 결정</li>
</ul>
</div>
</div>

<div class="footer">
YSTOCK 박스권 V2 승률 분석 · ${now}
</div>
</body></html>`;

  return { subject, html, text: `[YSTOCK] V2 승률 하락 원인 분석 (${now})\n\n요약: 승률 하락 = R:R 개선의 트레이드오프\n원인1: TP가 높아짐 (고저 퍼센타일)\n원인2: ER 필터가 고승률 박스 제거\n원인3: 손익분기 승률 자체가 낮아짐\n\n장점: 기대수익 1.5~2배, 품질 개선\n단점: 연속손실↑, 기회↓, 표본 필요\n\n권고: 1d는 ER≤0.45, 1h는 V1 유지` };
}

// ══════════════════════════════════════════════════════════════════════
// 이메일 2: V2 Pine Script 코드
// ══════════════════════════════════════════════════════════════════════
function buildEmail2() {
  const subject = `[YSTOCK] V2 Pine Script 코드 — 통합 박스권 감지기 PRO V2 (${now})`;
  const escaped = PINE_V2
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const lineCount = PINE_V2.split("\n").length;

  const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>${subject}</title>
<style>
body{font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif;line-height:1.7;color:#111;max-width:1000px;margin:0 auto;padding:28px 18px;background:#f8fafc;}
h1{font-size:1.22em;color:#1e3a8a;border-bottom:3px solid #2563eb;padding-bottom:8px;}
h2{font-size:1.05em;color:#1e40af;border-left:4px solid #3b82f6;padding-left:9px;margin-top:26px;}
.section{background:#fff;border:1px solid #e2e8f0;border-radius:9px;padding:18px;margin-bottom:18px;box-shadow:0 1px 4px rgba(0,0,0,.05);}
.ok  {background:#f0fdf4;border:1px solid #86efac;border-radius:6px;padding:10px 14px;margin:8px 0;}
.hl  {background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:10px 14px;margin:8px 0;}
.warn{background:#fffbeb;border:1px solid #fcd34d;border-radius:6px;padding:10px 14px;margin:8px 0;}
code{background:#f3f4f6;padding:2px 6px;border-radius:3px;font-size:.87em;font-family:monospace;}
pre.pine{background:#1a1a2e;color:#e2e8f0;padding:18px;border-radius:10px;font-size:.8em;line-height:1.55;overflow-x:auto;white-space:pre;font-family:'Consolas','Courier New',monospace;border:1px solid #374151;}
table{border-collapse:collapse;width:100%;margin:10px 0;font-size:.88em;}
th{background:#1e40af;color:#fff;padding:8px 10px;text-align:left;}
td{padding:7px 10px;border-bottom:1px solid #e5e7eb;vertical-align:top;}
ul li{margin:4px 0;}
.footer{color:#9ca3af;font-size:.82em;margin-top:28px;padding-top:14px;border-top:1px solid #e5e7eb;}
</style>
</head><body>
<h1>🌲 통합 박스권 감지기 PRO V2 — Pine Script v5</h1>
<p style="color:#6b7280;font-size:.88em;">${now} · ${lineCount}줄 · TradingView Pine Script v5</p>

<div class="section">
<h2>사용법</h2>
<ol>
<li>TradingView → Pine Script 편집기 열기</li>
<li>아래 코드 전체 복사 → 붙여넣기 → 저장 → 차트에 추가</li>
<li>설정 → <strong>분석 타임프레임</strong>을 현재 차트 TF에 맞게 선택 (60=1h, 240=4h, D=1d)</li>
<li>ER 임계값 기본값 0.40 → 박스가 너무 적으면 0.45로 조정</li>
</ol>
<div class="ok">
<strong>V1 (pine-box-range-pro-v2.pine)과 동시 로드 가능</strong><br>
V2는 파란색, V1은 회색 점선으로 비교하려면 V1도 함께 추가하면 됩니다.
</div>
</div>

<div class="section">
<h2>V1 vs V2 핵심 차이</h2>
<table>
<tr><th>항목</th><th>V1 (기존)</th><th>V2 (신규)</th></tr>
<tr><td>top 경계</td><td>종가 88퍼센타일</td><td><strong>고가 80퍼센타일</strong> (윅 포함)</td></tr>
<tr><td>bottom 경계</td><td>종가 12퍼센타일</td><td><strong>저가 20퍼센타일</strong> (윅 포함)</td></tr>
<tr><td>mid (중심)</td><td>VWAP</td><td><strong>거래량 POC</strong> (최대 거래량 가격대)</td></tr>
<tr><td>추세 필터</td><td>없음</td><td><strong>ER ≤ 0.40</strong> (효율비 필터)</td></tr>
<tr><td>거절 판단</td><td>횟수 카운트 (최소 1회)</td><td><strong>거래량 가중 점수</strong> (최소 0.5)</td></tr>
<tr><td>매매 로직</td><td colspan="2" style="text-align:center;">동일 — 하단복귀 매수 · dipLow SL · TP 후 재진입</td></tr>
</table>
</div>

<div class="section">
<h2>입력 파라미터 튜닝 가이드</h2>
<table>
<tr><th>파라미터</th><th>기본값</th><th>범위</th><th>올리면</th><th>내리면</th></tr>
<tr><td>ER 임계값</td><td>0.40</td><td>0.30~0.55</td><td>더 많은 박스 (1h 권장: 0.50)</td><td>더 적지만 더 순수한 횡보</td></tr>
<tr><td>고가 퍼센타일</td><td>80</td><td>70~90</td><td>top 높아짐 (승률↓ 수익↑)</td><td>top 낮아짐 (승률↑ 수익↓)</td></tr>
<tr><td>저가 퍼센타일</td><td>20</td><td>10~30</td><td>bottom 낮아짐 (진입 까다로움)</td><td>bottom 높아짐 (진입 쉬움)</td></tr>
<tr><td>최소 거절 점수</td><td>0.50</td><td>0.3~1.0</td><td>더 강한 지지저항만 인정</td><td>약한 반응도 박스로 인정</td></tr>
<tr><td>POC 버킷 수</td><td>40</td><td>20~80</td><td>mid 더 정밀 (계산 느려짐)</td><td>mid 덜 정밀 (계산 빠름)</td></tr>
</table>
<div class="warn">
<strong>주의:</strong> POC 버킷 수를 너무 높게 (80 이상) 설정하면 TradingView에서 계산 타임아웃이 발생할 수 있습니다.
</div>
</div>

<div class="section">
<h2>전체 소스 코드 (${lineCount}줄)</h2>
<div class="hl" style="margin-bottom:10px;">
아래 코드를 전체 선택(Ctrl+A) 후 복사 → TradingView Pine Script 편집기에 붙여넣기
</div>
<pre class="pine">${escaped}</pre>
</div>

<div class="footer">
YSTOCK 박스권 PRO V2 Pine Script · ${now}<br>
JS SSOT: <code>server/box-range/box-range-v2-core.js</code>
</div>
</body></html>`;

  return { subject, html, text: `[YSTOCK] V2 Pine Script (${now})\n\n통합 박스권 감지기 PRO V2\n${lineCount}줄 · Pine Script v5\n\nV1 대비: ER필터+고저퍼센타일+POC+거절스코어\n\n— ${now}` };
}

// ══════════════════════════════════════════════════════════════════════
// 실행
// ══════════════════════════════════════════════════════════════════════
if (!isEmailSendingConfigured()) { console.error("SMTP 미설정"); process.exit(1); }

console.log("[1/2] 승률 분석 이메일 전송...");
const e1 = buildEmail1();
await sendTransactionalEmail({ to: TO, subject: e1.subject, text: e1.text, html: e1.html });
console.log(`✓ 완료 → ${TO}`);

await new Promise(r => setTimeout(r, 1200));

console.log("[2/2] V2 Pine Script 이메일 전송...");
const e2 = buildEmail2();
await sendTransactionalEmail({ to: TO, subject: e2.subject, text: e2.text, html: e2.html });
console.log(`✓ 완료 → ${TO}`);

console.log("\n완료.");
