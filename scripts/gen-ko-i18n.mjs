/**
 * UTF-8 한글 문자열 단일 출처 — 이 스크립트만 수정 후 npm run i18n:gen
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { macroGuide } from "./macro-guide-data.mjs";

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "i18n", "ko.ts");

const t = {
  app: {
    title: "\uC885\uBAA9 \uB300\uC2DC\uBCF4\uB4DC",
    subtitle: "\uAD6D\uB0B4 300 \u00B7 \uB098\uC2A4\uB2E5 500",
    telegram: "\uD154\uB808\uADF8\uB7A8",
    telegramResetAria: "\uC624\uB298 \uD154\uB808\uADF8\uB7A8 \uC54C\uB9BC \uC774\uB825 \uCD08\uAE30\uD654",
    telegramResetLabel: "\uC54C\uB9BC \uCD08\uAE30\uD654",
    mainNav: "\uBA54\uC778 \uBA54\uB274",
    themeToggleAria: "\uD654\uBA74 \uD14C\uB9C8 \uC804\uD658",
    themeToolbarAria: "\uD14C\uB9C8 \uBC0F \uC0C9\uC870 \uB3C4\uAD6C",
    themeUseLight: "\uB77C\uC774\uD2B8 \uBAA8\uB4DC",
    themeUseDark: "\uB2E4\uD06C \uBAA8\uB4DC",
    lightPaletteAria: "\uB77C\uC774\uD2B8 \uBAA8\uB4DC \uC0C9\uC870 \uC120\uD0DD",
    lightPaletteHint: "\uB208\uC5D0 \uD3B8\uD55C \uD1A4",
    lightPaletteMist: "\uBBF8\uC2A4\uD2B8 \uBE14\uB8E8\uADF8\uB808\uC774",
    lightPalettePaper: "\uD398\uC774\uD37C \uC6DC \uBCA0\uC774\uC9C0",
    lightPaletteSage: "\uC138\uC774\uC9C0 \uADF8\uB9B0",
    lightPaletteLavender: "\uC18C\uD504\uD2B8 \uB77C\uBCA4\uB354",
    lightPaletteSand: "\uC6DC \uC0CC\uB4DC",
    lightPaletteDusk: "\uB354\uC2A4\uD06C \uBE14\uB8E8",
    tabScreener: "\uC2A4\uD06C\uB9AC\uB108",
    tabBullish: "\uC0C1\uC2B9 \uC720\uB9DD",
    tabStockLookup: "\uC885\uBAA9 \uAC80\uC0C9",
    tabCrypto: "\uCF54\uC778",
    tabOps: "\uC6B4\uC601",
    opsPanelTitle: "Cursor \uC5D0\uC774\uC804\uD2B8 \uC5F0\uB3D9",
    opsPanelHint:
      "\uAD00\uB9AC\uC790(Bearer \uB610\uB294 \uB4F1\uB85D IP)\uB9CC \uC0AC\uC6A9\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4. \uC11C\uBC84\uC5D0 CURSOR_API_KEY\uAC00 \uC788\uC5B4\uC57C \uC2E4\uD589\uB429\uB2C8\uB2E4. \uB85C\uCEEC \uC5D0\uC774\uC804\uD2B8\uAC00 \uC791\uB3D9\uD558\uB824\uBA74 Cursor CLI/\uD658\uACBD\uC774 \uC900\uBE44\uB418\uC5B4 \uC788\uC5B4\uC57C \uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.",
    opsInstructionLabel: "\uC694\uCCAD \uB0B4\uC6A9",
    opsInstructionPlaceholder:
      "\uC608: \uD53C\uD06C \uBAA9\uB85D \uC815\uB82C \uAE30\uC900\uC5D0 '\uC2DC\uAC00\uCD1D\uC561' \uCD94\uAC00",
    opsContextLabel: "\uCD94\uAC00 \uCEE8\uD14D\uC2A4\uD2B8 (\uC120\uD0DD)",
    opsContextPlaceholder:
      "\uC7AC\uD604 \uB2E8\uACC4, \uC6B0\uC120\uC21C\uC704, \uAD00\uB828 URL \uB4F1",
    opsSubmit: "\uC5D0\uC774\uC804\uD2B8\uC5D0 \uC804\uB2EC",
    opsSubmitting: "\uC2E4\uD589 \uC911\u2026 (\uC218 \uBD84 \uAC78\uB9B4 \uC218 \uC788\uC2B5\uB2C8\uB2E4)",
    opsResultLabel: "\uACB0\uACFC",
    opsStatusLabel: "\uC0C1\uD0DC",
    opsDurationLabel: "\uC18C\uC694 \uC2DC\uAC04",
    opsError: "\uC694\uCCAD\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.",
    opsNoKey:
      "\uC11C\uBC84\uC5D0 CURSOR_API_KEY\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4. .env \uC608: .env.example\uC744 \uCC38\uACE0\uD558\uC5EC \uD0A4\uB97C \uB123\uACE0 \uAC1C\uBC1C \uC11C\uBC84\uB97C \uB2E4\uC2DC \uC2DC\uC791\uD558\uC138\uC694.",
    rescanning: "\uC694\uCCAD \uC911\u2026",
    rescan: "\uC804\uCCB4 \uC7AC\uBD84\uC11D",
    nextRescanSoon: "\uACE7 \uC2DC\uC791",
    retry: "\uB2E4\uC2DC \uC2DC\uB3C4",
    marketKr: "\uAD6D\uB0B4",
    marketUs: "\uB098\uC2A4\uB2E5",
    bullishHint: "\uACE8\uB4E0\uD06C\uB85C\uC2A4\u00B7\uC77C\uBAA9\u00B7\uC815\uBC30\uC5F4 \uB4F1 \uC0C1\uC2B9 \uC2E0\uD638\uAC00 \uAC15\uD55C \uC885\uBAA9",
    reason: "\uC774\uC720",
    reasonSuffix: "\uB85C \uADFC\uAC70 \uD655\uC778",
    selectTitle: "\uC885\uBAA9\uC744 \uC120\uD0DD\uD558\uC138\uC694",
    selectDesc:
      "\uC67C\uCABD \uBAA9\uB85D\uC5D0\uC11C \uC885\uBAA9\uC744 \uB204\uB974\uBA74 \uCC28\uD2B8\uAC00 \uD45C\uC2DC\uB429\uB2C8\uB2E4",
    stockLookupSelectTitle: "\uC885\uBAA9\uC744 \uAC80\uC0C9\uD558\uAC70\uB098 \uC120\uD0DD\uD558\uC138\uC694",
    stockLookupSelectDesc:
      "Yahoo Finance \uAC80\uC0C9 \uACB0\uACFC\uC5D0\uC11C \uC885\uBAA9\uC744 \uB204\uB974\uBA74 \uCC28\uD2B8\uAC00 \uC5F4\uB9BD\uB2C8\uB2E4.",
    stockLookupPlaceholder: "\uC774\uB984 \uB610\uB294 \uC2EC\uBCFC (\uC608: \uC0BC\uC131, AAPL, 005930)",
    stockLookupAria: "\uC885\uBAA9 \uAC80\uC0C9",
    stockLookupIdle: "\uAC80\uC0C9\uC5B4\uB97C \uC785\uB825\uD558\uC138\uC694.",
    stockLookupNoHits: "\uAC80\uC0C9 \uACB0\uACFC\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.",
    stockLookupQuotePending: "\uC2DC\uC138 \uBD88\uB7EC\uC624\uB294 \uC911",
    stockLookupMktRegular: "\uC7A5\uC911",
    stockLookupMktClosed: "\uB9C8\uAC10",
    stockLookupMktPre: "\uD504\uB9AC\uB9C8\uCF13",
    stockLookupMktPost: "\uC560\uD504\uD130\uB9C8\uCF13",
    stockLookupLoading: "\uAC80\uC0C9 \uC911\u2026",
    stockLookupError: "\uAC80\uC0C9\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.",
    quoteCurrencyToggleAria:
      "\uC2DC\uC138 \uD1B5\uD654 \uD45C\uC2DC(\uB2EC\uB7EC \u2194 \uC6D0\uD654) \uC804\uD658",
    quoteCurrencyShowKrw: "\uC6D0\uD654\uB85C \uBCF4\uAE30",
    quoteCurrencyShowUsd: "\uB2EC\uB7EC\uB85C \uBCF4\uAE30",
    chartLoading: "\uCC28\uD2B8 \uB370\uC774\uD130\uB97C \uBD88\uB7EC\uC624\uB294 \uC911",
    chartEmpty: "\uD45C\uC2DC\uD560 \uCE94\uB4E4\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.",
    cacheTag: "\uCE90\uC2DC",
    candleSuffix: Buffer.from([0xeb, 0xb4, 0x89]).toString("utf8"),
    chipMa: "\uC774\uD3C9(\uC77C)",
    chipIch: "\uC77C\uBAA9",
    chipVol: "\uAC70\uB798\uB7C9",
    chipRsi: "RSI",
    failBtnTitle: "\uC870\uD68C \uC2E4\uD328 \uC885\uBAA9 \uBAA9\uB85D",
    telegramConfirm:
      "\uC624\uB298 \uBC1C\uC1A1\uD55C \uD154\uB808\uADF8\uB7A8 \uC54C\uB9BC \uC774\uB825\uC744 \uCD08\uAE30\uD654\uD560\uAE4C\uC694?\n\uAC19\uC740 \uC885\uBAA9\uC774 \uB2E4\uC2DC \uC810\uC218 \uC870\uAC74\uC744 \uB9CC\uC871\uD558\uBA74 \uC54C\uB9BC\uC774 \uC7AC\uC804\uC1A1\uB429\uB2C8\uB2E4.",
    telegramResetFail: "\uC54C\uB9BC \uC774\uB825 \uCD08\uAE30\uD654\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.",
    telegramListAria: "\uC624\uB298 \uBC1C\uC1A1\uD55C \uD154\uB808\uADF8\uB7A8 \uC54C\uB9BC \uC885\uBAA9 \uC870\uD68C",
    telegramListTitle: "\uD154\uB808\uADF8\uB7A8 \uC54C\uB9BC \uC774\uB825",
    telegramListLoadFail: "\uC54C\uB9BC \uC774\uB825\uC744 \uBD88\uB7EC\uC624\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.",
    profitModelBtn: "\uC218\uC775 \uBAA8\uB378",
    profitModelTitle: "\uAC00\uC815 \uB9E4\uC218\uAC00",
    profitModelHint:
      "\uC124\uC815\uD55C \uAC00\uACA9\uC5D0 1\uC8FC\uB97C \uB9E4\uC218\uD588\uB2E4\uACE0 \uAC00\uC815\uD560 \uB54C, \uD604\uC7AC \uC2DC\uC138 \uAE30\uC900 \uC218\uC775\uB960\uC785\uB2C8\uB2E4. \uC2DC\uC138\uB294 \uC8FC\uAE30\uC801\uC73C\uB85C \uAC31\uC2E0\uB429\uB2C8\uB2E4.",
    profitModelEntry: "\uB9E4\uC218\uAC00",
    profitModelPlaceholder: "\uC608: 70000",
    profitModelUseQuote: "\uD604\uC7AC\uAC00 \uC801\uC6A9",
    profitModelApply: "\uC801\uC6A9",
    profitModelCancel: "\uCDE8\uC18C",
    profitModelClear: "\uB9E4\uC218\uAC00 \uD574\uC81C",
    profitModelClose: "\uB2EB\uAE30",
    profitModelReturn: "\uC218\uC775\uB960",
    profitModelPerShare: "\uC8FC\uB2F9 \uC190\uC775",
    profitModelCurrentRef: "\uD604\uC7AC \uC2DC\uC138 \uCC38\uACE0",
    profitModelStripCurrent: "\uD604\uC7AC\uAC00",
    profitModelPersistHint:
      "\uB370\uC774\uD130\uB294 \uC774 \uBE0C\uB77C\uC6B0\uC800\uC5D0 \uC800\uC7A5\uB418\uC5B4 \uD0ED\uC744 \uB2EB\uC544\uB3C4 \uC720\uC9C0\uB429\uB2C8\uB2E4. \uB2E4\uB978 PC\u00B7\uBE0C\uB77C\uC6B0\uC800\uC640\uB294 \uACF5\uC720\uB418\uC9C0 \uC54A\uC73C\uBA70, \uACC4\uC815 \uB85C\uADF8\uC778\uC740 \uC9C0\uC6D0\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.",
    profitModelBrowserId: "\uC774 \uBE0C\uB77C\uC6B0\uC800 ID",
    profitModelEntryTime: "\uB9E4\uC218 \uC2DC\uC810",
    profitModelSell: "\uD604\uC7AC\uAC00\uB85C \uB9E4\uB3C4 \uAE30\uB85D",
    profitModelStripExit: "\uAE30\uB85D \uB9E4\uB3C4\uAC00",
    profitModelStripEntryTime: "\uB9E4\uC218 \uC2DC\uC810",
    profitChartMarkerLabel: "\uB9E4\uC218",
  },
  macro: {
    title: "\uC8FC\uC694 \uC9C0\uD45C \uBC1C\uD45C",
    subtitle: "\uB0A8\uC740 \uC2DC\uAC04 \uAE30\uC900 (KST)",
    live: "\uC9C4\uD589 \uC911",
    soon: "\uACE7 \uBC1C\uD45C",
    loading: "\uC77C\uC815 \uBD88\uB7EC\uC624\uB294 \uC911\u2026",
    empty: "\uC608\uC815\uB41C \uBC1C\uD45C\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.",
    regionUs: "US",
    regionKr: "KR",
    guideWhat: "\uC774 \uC9C0\uD45C\uB294?",
    guideHigh: "\uC608\uC0C1\uBCF4\uB2E4 \uB192\uC744 \uB54C",
    guideLow: "\uC608\uC0C1\uBCF4\uB2E4 \uB0AE\uC744 \uB54C",
    guideNote: "\uCC38\uACE0",
    guideClose: "\uB2EB\uAE30",
    cardHint: "\uD074\uB9AD\uD558\uBA74 \uC124\uBA85",
  },
  errors: {
    picksLoad: "\uC885\uBAA9 \uBAA9\uB85D\uC744 \uBD88\uB7EC\uC62C \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.",
    chartLoad: "\uCC28\uD2B8\uB97C \uBD88\uB7EC\uC62C \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.",
    newsLoad: "\uB274\uC2A4\uB97C \uBD88\uB7EC\uC62C \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.",
    network:
      "\uC11C\uBC84\uC5D0 \uC5F0\uACB0\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4. \uD130\uBBF8\uB110\uC5D0\uC11C npm run dev \uAC00 \uC2E4\uD589 \uC911\uC778\uC9C0 \uD655\uC778\uD558\uC138\uC694.",
    parse: "\uC11C\uBC84 \uC751\uB2F5\uC744 \uC77D\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.",
    request: "\uC694\uCCAD\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.",
  },
  screenFailures: {
    title: "\uC870\uD68C \uC2E4\uD328 \uC885\uBAA9",
    sub: "\uCD1D {n}\uAC74 \u00B7 Yahoo \uCC28\uD2B8 \uB370\uC774\uD130\uB97C \uAC00\uC838\uC624\uC9C0 \uBABB\uD55C \uC885\uBAA9",
    empty: "\uC2E4\uD328 \uB0B4\uC5ED\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.",
    kr: "\uAD6D\uB0B4",
    us: "\uB098\uC2A4\uB2E5",
    close: "\uB2EB\uAE30",
  },
  telegramSent: {
    title: "\uD154\uB808\uADF8\uB7A8 \uC54C\uB9BC \uC774\uB825",
    sub: "\uC624\uB298 \uBC1C\uC1A1 \u00B7 \uCD1D {n}\uAC74",
    empty: "\uC624\uB298 \uBC1C\uC1A1\uD55C \uC54C\uB9BC\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.",
    loading: "\uC774\uB825 \uBD88\uB7EC\uC624\uB294 \uC911\u2026",
    kr: "\uAD6D\uB0B4",
    us: "\uB098\uC2A4\uB2E5",
    crypto: "\uCF54\uC778",
    openStockRowAria: "\uCC28\uD2B8\uC5D0\uC11C \uC885\uBAA9 \uC5F4\uAE30",
    close: "\uB2EB\uAE30",
    scoreSuffix: "\uC810",
  },
  feedback: {
    cornerButton: "\uBD88\uD3B8",
    cornerAria: "\uBD88\uD3B8 \uC811\uC218",
    menuSubmit: "\uB0B4\uC6A9 \uC811\uC218",
    menuInbox: "\uC811\uC218\uD568 \uD655\uC778",
    submitTitle: "\uBD88\uD3B8 \uC811\uC218",
    submitPlaceholder: "\uBD88\uD3B8 \uC0AC\uD56D\uC744 \uC801\uC5B4 \uC8FC\uC138\uC694\u2026",
    submitSend: "\uBCF4\uB0B4\uAE30",
    submitOk: "\uC811\uC218\uB418\uC5C8\uC2B5\uB2C8\uB2E4.",
    submitClose: "\uB2EB\uAE30",
    inboxTitle: "\uBD88\uD3B8 \uC811\uC218\uD568",
    inboxPasswordLabel: "\uBE44\uBC00\uBC88\uD638",
    inboxPasswordPlaceholder: "\uC811\uC218\uD568 \uBE44\uBC00\uBC88\uD638",
    inboxUnlock: "\uD655\uC778",
    inboxReload: "\uC0C8\uB85C\uACE0\uCE68",
    inboxLock: "\uC7A0\uAE08",
    inboxClose: "\uB2EB\uAE30",
    inboxEmpty: "\uC811\uC218\uB41C \uB0B4\uC6A9\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.",
    inboxIp: "IP",
    inboxTime: "\uC2DC\uAC01",
    inboxMsg: "\uB0B4\uC6A9",
    inboxUa: "UA",
    inboxReplies: "답글",
    inboxReplyPlaceholder: "관리자 답글…",
    inboxReplyFieldLabel: "관리자 답글",
    inboxReplySend: "답글 등록",
    inboxDelete: "삭제",
    inboxDeleteConfirm: "이 접수를 삭제할까요? 되돌릴 수 없습니다.",
    inboxPublicHint: "누구나 이 목록을 볼 수 있습니다.",
    accessGrantDelegate: "관리 권한 부여",
    accessRevokeDelegate: "관리 권한 제거",
    accessDelegateBadge: "위임 관리자",
    accessDelegateConfirm:
      "이 IP에 관리자 화면·불편 접수함 조작 권한을 줄까요? (ACCESS_ADMIN_TOKEN 또는 기존 관리자만 가능)",
    accessRevokeDelegateConfirm:
      "이 IP의 위임 관리자 권한만 제거할까요? 접속 허용(일반 API)은 그대로입니다.",
    inboxHintNoServer:
      "접수함은 공개 조회됩니다. 답글·삭제·IP 위임은 관리자만 가능합니다.",
  },
  crypto: {
    panelTitle:
      "\uC8FC\uC694 \uCF54\uC778 (Binance USDT \u00B7 24h \uAC70\uB798\uB7C9 \uC21C)",
    listAria: "\uCF54\uC778 \uC120\uD0DD",
    listVolShort: "\uAC70\uB798\uB7C9",
    listVolTitle: "24h USDT \uAC70\uB798\uB300\uAE08 (\uB0B4\uB9BC\uCC28\uC21C \uC815\uB82C)",
    drawToolbarAria: "\uCC28\uD2B8 \uB4DC\uB85C\uC789 \uB3C4\uAD6C",
    chartDrawDelete: "\uC0AD\uC81C",
    chartDrawCopy: "\uBCF5\uC0AC",
    chartDrawAdd: "\uCD94\uAC00",
    chartDrawRayHandleAnchor: "\uAD11\uC120 \uAE30\uC900\uC810 \uB4DC\uB798\uADF8",
    chartDrawRayHandleThrough: "\uAD11\uC120 \uD1B5\uACFC\uC810 \uB4DC\uB798\uADF8",
    drawCursor: "\uCEE4\uC11C",
    drawHLine: "\uC218\uD3C9\uC120",
    drawRay: "\uAD11\uC120",
    drawRayDisabled: "\uAD11\uC120 (\uC77C\uC2DC \uBE44\uD65C\uC131)",
    drawMagnet: "\uB9C8\uADF8\uB12B",
    drawMagnetAria:
      "\uB9C8\uADF8\uB12B: \uBD09\uC758 \uC2DC\uAC00\u00B7\uACE0\uAC00\u00B7\uC800\uAC00\u00B7\uC885\uAC00\uC5D0 \uAC00\uACA9 \uC2A4\uB0B5",
    drawClear: "\uC804\uCCB4 \uC0AD\uC81C",
    chartEngineTv: "TradingView",
    chartEngineApp:
      "\uC571 \uCC28\uD2B8 (\uC9C0\uD45C\u00B7\uBBF8\uB2C8 \uB4DC\uB85C\uC789)",
    tvCopyrightSuffix: " by TradingView",
    tvChartAria: "TradingView \uC784\uBCA0\uB4DC \uCC28\uD2B8",
  },
  access: {
    checking: "접근 권한을 확인하는 중…",
    openingApp: "서비스 화면을 여는 중…",
    statusFetchFail:
      "접근 권한을 확인할 수 없습니다. 서버가 실행 중인지·주소가 맞는지 확인한 뒤 다시 시도해 주세요.",
    gateTitle: "접근 제한",
    gateBody: "",
    yourIp: "",
    statePending: "",
    stateRejected: "",
    stateNone: "",
    messageLabel: "메모 (선택)",
    messagePlaceholder: "신청 사유, 연락처 등",
    submitRequest: "접속 신청",
    submitting: "전송 중…",
    adminTitle: "IP 접근 관리",
    adminConsoleTitle: "관리자",
    adminToolbarBtn: "관리자",
    adminTabAccess: "IP 접근",
    adminTabFeedback: "불편 접수함",
    adminTabTelegram: "텔레그램",
    adminTabListAria: "관리자 메뉴",
    adminTelegramOpenList: "발송 목록",
    adminPasswordLabel: "관리자 비밀번호",
    adminConfirm: "확인",
    adminIntro:
      "허용된 IP만 API·대시보드를 쓸 수 있습니다. 대기: 접속 신청만 접수된 상태입니다. 승인하면 해당 IP가 아래 허용 목록에 올라가고, 거절하면 이번 신청만 종료됩니다. 허가 취소는 이미 허용된 IP를 목록에서 빼서 곧바로 API 접속을 막습니다.",
    adminLockAgain: "관리 종료",
    adminLockHint:
      "이 브라우저에 저장된 관리자 비밀번호만 지웁니다. 서버의 허용 IP·신청 기록은 바뀌지 않습니다.",
    adminIpBanner:
      "서버에 등록된 관리자 IP로 접속 중입니다. 비밀번호 없이 이용합니다. (다른 PC·다른 회선 IP에서는 관리자 화면을 열 수 없을 수 있습니다.)",
    adminRevokeConfirm:
      "이 IP({ip})를 허용 목록에서 제거할까요? 즉시 API 접속이 차단됩니다.",
    adminWrongPassword: "비밀번호가 올바르지 않습니다.",
    adminDeviceInfo: "기기·환경",
    adminTokenPlaceholder: "비밀번호 입력",
    adminSaveToken: "확인",
    adminLoad: "목록 새로고침",
    adminPending: "대기 중인 신청",
    adminAllowed: "허용된 IP",
    adminApprove: "승인",
    adminReject: "거절",
    adminRevoke: "허가 취소",
    adminClose: "닫기",
    adminEmptyPending: "대기 중인 신청이 없습니다.",
    adminEmptyAllowed: "허용된 IP가 없습니다.",
    adminUa: "User-Agent",
    adminRequestedAt: "신청 시각",
    adminError: "요청에 실패했습니다.",
    adminMemoLabel: "내 메모 (누구·용도)",
    adminMemoPlaceholder: "예: 홍길동 노트북, 사무실 PC",
    adminMemoSave: "메모 저장",
    adminRequestMessage: "신청 메시지",
    requestDeviceNote: "",
  },
  launch: {
    loading: "\uBD88\uB7EC\uC624\uB294 \uC911\u2026",
  },
};

function emitObj(obj, indent = 2) {
  const sp = " ".repeat(indent);
  const lines = [];
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "string") {
      lines.push(`${sp}${k}: ${JSON.stringify(v)},`);
    }
  }
  return lines.join("\n");
}

function emitMacroGuide(guide, indent = 2) {
  const sp = " ".repeat(indent);
  const lines = [];
  for (const [code, entry] of Object.entries(guide)) {
    lines.push(`${sp}${code}: {`);
    lines.push(`${sp}  what: ${JSON.stringify(entry.what)},`);
    lines.push(`${sp}  high: ${JSON.stringify(entry.high)},`);
    lines.push(`${sp}  low: ${JSON.stringify(entry.low)},`);
    if (entry.note) {
      lines.push(`${sp}  note: ${JSON.stringify(entry.note)},`);
    }
    lines.push(`${sp}},`);
  }
  return lines.join("\n");
}

const src = `/** Auto-generated by scripts/gen-ko-i18n.mjs — do not edit by hand */
export const ko = {
  app: {
${emitObj(t.app, 4)}
  },
  macro: {
${emitObj(t.macro, 4)}
  },
  errors: {
${emitObj(t.errors, 4)}
  },
  screenFailures: {
${emitObj(t.screenFailures, 4)}
  },
  telegramSent: {
${emitObj(t.telegramSent, 4)}
  },
  feedback: {
${emitObj(t.feedback, 4)}
  },
  crypto: {
${emitObj(t.crypto, 4)}
  },
  access: {
${emitObj(t.access, 4)}
  },
  launch: {
${emitObj(t.launch, 4)}
  },
} as const;

export const macroGuide = {
${emitMacroGuide(macroGuide, 2)}
} as const;

export type MacroGuideCode = keyof typeof macroGuide;

export function getMacroGuide(code: string) {
  return macroGuide[code as MacroGuideCode];
}

export function failedCountLabel(n: number) {
  return \`\uC2E4\uD328 \${n}\uAC74\`;
}

export function screenFailuresSub(n: number) {
  return ko.screenFailures.sub.replace("{n}", String(n));
}

export function screenFailuresSection(market: "kr" | "us", n: number) {
  const label = market === "kr" ? ko.screenFailures.kr : ko.screenFailures.us;
  return \`\${label} (\${n})\`;
}

export function telegramSentSub(n: number) {
  return ko.telegramSent.sub.replace("{n}", String(n));
}

export function telegramSentSection(market: "kr" | "us" | "crypto", n: number) {
  const label =
    market === "kr"
      ? ko.telegramSent.kr
      : market === "us"
        ? ko.telegramSent.us
        : ko.telegramSent.crypto;
  return \`\${label} (\${n})\`;
}

export function nextRescanCountdown(time: string) {
  return \`\uB2E4\uC74C \uC7AC\uBD84\uC11D \${time}\`;
}
`;

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, src, "utf8");
console.log("wrote", out);
