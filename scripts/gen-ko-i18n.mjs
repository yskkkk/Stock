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
    title: "YSTOCK",
    subtitle: "\uAD6D\uB0B4 300 \u00B7 S&P 500",
    topBarFxLabel: "\uC6D0/\uB2EC\uB7EC",
    topBarFxAria:
      "\uC6D0\u00B7\uB2EC\uB7EC \uD658\uC728 (KST 09:00 \uAE30\uC900, \uC57D 20\uCD08\uB9C8\uB2E4 \uAC31\uC2E0)",
    topBarFxBasis: "{date} 09:00",
    telegram: "\uD154\uB808\uADF8\uB7A8",
    telegramResetAria: "\uC624\uB298 \uD154\uB808\uADF8\uB7A8 \uC54C\uB9BC \uC774\uB825 \uCD08\uAE30\uD654",
    telegramResetLabel: "\uC54C\uB9BC \uCD08\uAE30\uD654",
    mainNav: "\uBA54\uC778 \uBA54\uB274",
    themeToggleAria:
      "\uB2E4\uD06C \uBAA8\uB4DC\uC640 \uD654\uC774\uD2B8 \uBAA8\uB4DC \uC804\uD658",
    themeUseLight: "\uD654\uC774\uD2B8 \uBAA8\uB4DC",
    themeUseDark: "\uB2E4\uD06C \uBAA8\uB4DC",
    themeToggleDisabledAria:
      "\uD654\uBA74 \uD14C\uB9C8 \uC804\uD658 (\uC77C\uC2DC \uBE44\uD65C\uC131\uD654)",
    themeToggleDisabledHint:
      "\uD14C\uB9C8 \uC804\uD658\uC774 \uC77C\uC2DC\uC801\uC73C\uB85C \uBE44\uD65C\uC131\uD654\uB418\uC5C8\uC2B5\uB2C8\uB2E4",
    lightPaletteAria: "\uD654\uC774\uD2B8 \uBAA8\uB4DC \uC0C9\uC870 \uC120\uD0DD",
    pageTopToolsAria:
      "\uB2E4\uD06C\u00B7\uD654\uC774\uD2B8 \uBAA8\uB4DC \u00B7 \uC6B4\uC601 \u00B7 \uBD88\uD3B8 \uC811\uC218 \uB3C4\uAD6C \uC601\uC5ED",
    footerTheme:
      "\uB2E4\uD06C\u00B7\uD654\uC774\uD2B8 \uBAA8\uB4DC \uC804\uD658",
    siteFooterAria: "\uc0ac\uc774\ud2b8 \ud558\ub2e8 \ub9c1\ud06c",
    footerDevYsk: "ysk \uac1c\ubc1c\uc911",
    footerFeedback: "\ubd88\ud3b8/\ubb38\uc758",
    footerFeedbackTitle: "\ubd88\ud3b8\u00b7\ubb38\uc758",
    footerFeedbackPlaceholder:
      "\ubd88\ud3b8\u00b7\ubb38\uc758 \ub0b4\uc6a9\uc744 \uc801\uc5b4 \uc8fc\uc138\uc694\u2026",
    footerCopyright: "@ysk \uc5b4\ub514\uac14\uc5b4",
    pullToRefreshHint: "\uC544\uB798\uB85C \uB2F9\uACA8 \uC0C8\uB85C\uACE0\uCE68",
    pullToRefreshRelease: "\uB193\uC73C\uBA74 \uC0C8\uB85C\uACE0\uCE68",
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
    tabRecommendations: "\uc8fc\uc2dd \ucd94\ucc9c\ubaa9\ub85d",
    tabLiveTrading: "\uc2e4\uac70\ub798",
    tabOps: "\uC6B4\uC601",
    liveTradeSimFeedbackApplied: "\ud504\ub85c\uadf8\ub7a8 \uc124\uc815\uc5d0 \ubc18\uc601\ud588\uc2b5\ub2c8\ub2e4.",
    liveTradeSimFeedbackTitle: "\uc2dc\ubbac \uccad\uc0b0 \ubd84\uc11d",
    liveTradeSimFeedbackWin: "\uc218\uc775 \uc694\uc778",
    liveTradeSimFeedbackLoss: "\uc190\uc2e4\u00b7\uac1c\uc120 \uc694\uc778",
    liveTradeSimFeedbackApplying: "\ubc18\uc601 \uc911\u2026",
    liveTradeSimFeedbackApply: "\uc124\uc815\uc5d0 \ubc18\uc601",
    liveTradePfRefresh: "\uc0c8\ub85c\uace0\uce68",
    liveTradeSimFeedbackNoApply: "\ubc18\uc601\ud560 \ubcc0\uacbd\uc774 \uc5c6\uc2b5\ub2c8\ub2e4.",
    liveTradeSimRecTitle: "\ucd94\ucc9c \uc2e4\uc801 \uae30\ubc18 \uc2dc\ubbac \uc124\uc815",
    liveTradeSimRecSub: "\ucd94\ucc9c \ubaa9\ub85d \uc2b9\ub960\u00b7\uadfc\uac70 \ubd84\uc11d\uc73c\ub85c \uc81c\uc548\ud55c \uc2dc\ubbac \uc2dc\uc791 \uac12\uc785\ub2c8\ub2e4.",
    liveTradeSimRecApply: "\ud3fc\uc5d0 \uc801\uc6a9\ud588\uc2b5\ub2c8\ub2e4.",
    liveTradeSimRunCollapse: "\uc811\uae30",
    liveTradeSimRunExpand: "\ud3bc\uce58\uae30",
    liveTradeSimRunSince: "\uc2dc\uc791",
    liveTradePfHoldings: "\ubcf4\uc720",
    liveTradePfReturn: "\uc218\uc775\ub960",
    liveTradeSimStop: "\uc2dc\ubbac \uc911\uc9c0",
    liveTradeSimRunSettings: "\uc2dc\ubbac \uc124\uc815",
    liveTradeSimRunAutoBuyOn: "\uc54c\ub9bc \uc790\ub3d9 \ub9e4\uc218",
    liveTradeSimRunAutoBuyOff: "\uc54c\ub9bc \ub9e4\uc218 \ub054",
    liveTradeSimRunAutoSellOn: "\ubaa9\ud45c\uac00 \uc790\ub3d9 \ub9e4\ub3c4",
    liveTradeSimRunAutoSellOff: "\uc790\ub3d9 \ub9e4\ub3c4 \ub054",
    liveTradeAutoExitHint: "\ub9e4\uc218 \uc2dc \uc77c\ubd09 \ubcc0\ub3d9\uc131(ATR)\u00b720\uc77c \uc9c0\uc9c0\u00b7\uc800\ud56d\u00b7\ucd94\ucc9c \uc2e0\ud638\ub97c \ubd84\uc11d\ud574 \uc885\ubaa9\ub9c8\ub2e4 \ubaa9\ud45c\uac00\u00b7\uc190\uc808\uac00\uc640 \uc2dc\ub098\ub9ac\uc624\ub97c \uc790\ub3d9 \uc124\uc815\ud569\ub2c8\ub2e4.",
    liveTradeMinScoreShort: "\ucd5c\uc18c \uc810\uc218",
    liveTradeFieldMaxPos: "\ucd5c\ub300 \ub3d9\uc2dc \ubcf4\uc720 \uc885\ubaa9 \uc218",
    liveTradeFieldMaxPosInvalid:
      "\ucd5c\ub300 \ub3d9\uc2dc \ubcf4\uc720 \uc885\ubaa9 \uc218\ub97c \ud655\uc778\ud574 \uc8fc\uc138\uc694. (1~50 \uc0ac\uc774 \uc815\uc218)",
    liveTradePfUnrealized: "\ud3c9\uac00 \uc190\uc775",
    liveTradeSimRunHoldings: "\ubcf4\uc720",
    liveTradePfNoHoldings: "\ubcf4\uc720 \uc885\ubaa9\uc774 \uc5c6\uc2b5\ub2c8\ub2e4.",
    liveTradePfColSymbol: "\uc885\ubaa9",
    liveTradePfColQty: "\uc218\ub7c9",
    liveTradePfColCurrent: "\ud604\uc7ac\uac00",
    liveTradePfColTargetSell: "\ubaa9\ud45c \ub9e4\ub3c4\uac00",
    liveTradePfColStopLoss: "\uc190\uc808\uac00",
    liveTradePfColPnl: "\ud3c9\uac00\uc190\uc775",
    liveTradePfColEntryStructure: "\uc9c4\uc785 \uad6c\uc870",
    liveTradePfColScenario: "\ub9e4\ub3c4 \uc2dc\ub098\ub9ac\uc624",
    liveTradeExitIfSuccess: "\uc131\uacf5 \uc2dc",
    liveTradeExitIfFailure: "\uc2e4\ud328 \uc2dc",
    liveTradeExitWhy: "\uac00\uaca9 \uc124\uc815 \uadfc\uac70",
    liveTradeSimRunRecentTrades: "\ucd5c\uadfc \uccb4\uacb0",
    liveTradePfNoTrades: "\uac70\ub798 \ub0b4\uc5ed\uc774 \uc5c6\uc2b5\ub2c8\ub2e4.",
    liveTradePfColTime: "\uc2dc\uac01",
    liveTradePfColSide: "\uad6c\ubd84",
    liveTradePfColPrice: "\ub2e8\uac00",
    liveTradePfColAmount: "\uae08\uc561",
    liveTradeSideBuy: "\ub9e4\uc218",
    liveTradeSideSell: "\ub9e4\ub3c4",
    liveTradeSimRunTitle: "\uac00\ub3d9 \uc911 \uc2dc\ubbac\ub808\uc774\uc158",
    liveTradeSimRunSub: "\uc2dc\ubbac \uc790\ub3d9 \uc2dc\uc791\ub41c \ud504\ub85c\uadf8\ub7a8\uc758 \ubcf4\uc720\u00b7\ubaa9\ud45c\uac00\u00b7\ucd5c\uadfc \uccb4\uacb0\uc744 20\ucd08\ub9c8\ub2e4 \uac31\uc2e0\ud569\ub2c8\ub2e4.",
    liveTradePfUpdated: "\uac31\uc2e0",
    liveTradeSimRunEmpty: "\uac00\ub3d9 \uc911\uc778 \uc2dc\ubbac\uc774 \uc5c6\uc2b5\ub2c8\ub2e4. \ud504\ub85c\uadf8\ub7a8\uc5d0\uc11c \u00ab\uc2dc\ubbac \uc790\ub3d9 \uc2dc\uc791\u00bb\uc73c\ub85c \ucf20 \ub4a4, \ub04c \ub54c\ub294 \u00ab\uc2dc\ubbac \uc911\uc9c0\u00bb\ub97c \ub204\ub974\uc138\uc694.",
    liveTradePfLoading: "\ubd88\ub7ec\uc624\ub294 \uc911\u2026",
    liveTradePfInvested: "\ub9e4\uc785 \uc6d0\uac00",
    liveTradePfEval: "\ud3c9\uac00 \uae08\uc561",
    liveTradePfRealized: "\uc2e4\ud604 \uc190\uc775",
    liveTradePfFeeNote: "\uc655\ubcf5 0.2%",
    liveTradeSimFilled: "\uccb4\uacb0 {price} \u00b7 {time}",
    liveTradePfColAvg: "\ud3c9\uade0\uac00",
    liveTradeSimSell: "\uc2dc\ubbac \ub9e4\ub3c4",
    liveTradeSimSellHint: "\ud604\uc7ac 1\ubd84\ubd09 \uc2dc\uc138\ub85c \ub9e4\ub3c4\ud569\ub2c8\ub2e4.",
    liveTradePfSellQty: "\uc218\ub7c9",
    liveTradePfSellConfirm: "\ub9e4\ub3c4 \ubc18\uc601",
    liveTradeCancelEdit: "\ucde8\uc18c",
    liveTradePfAllPrograms: "\uc804\uccb4 \ud504\ub85c\uadf8\ub7a8",
    liveTradePfTitle: "\ubcf4\uc720\u00b7\uac70\ub798\u00b7\uc218\uc775",
    liveTradePfProgramFilter: "\ud504\ub85c\uadf8\ub7a8",
    liveTradePfTabSummary: "\uc218\uc775 \uc694\uc57d",
    liveTradePfTabHoldings: "\ubcf4\uc720 \uc885\ubaa9",
    liveTradePfTabTrades: "\uac70\ub798 \ub0b4\uc5ed",
    liveTradePfColProgram: "\ud504\ub85c\uadf8\ub7a8",
    liveTradeSimTag: "\uc2dc\ubbac",
    liveTradeSimNoProgram: "\ud504\ub85c\uadf8\ub7a8\uc744 \uc120\ud0dd\ud558\uc138\uc694.",
    liveTradeSimPickSymbol: "\uc885\ubaa9\uc744 \uc120\ud0dd\ud558\uc138\uc694.",
    liveTradeSimTitle: "\ub9e4\uc218\u00b7\ub9e4\ub3c4 \uc2dc\ubbac\ub808\uc774\uc158",
    liveTradeSimNote: "\uccb4\uacb0\uac00\u00b7\uc2dc\uac01\uc740 \uc694\uccad \uc2dc\uc810 1\ubd84\ubd09 \uc2dc\uc138\uc640 \ub3d9\uc77c\ud569\ub2c8\ub2e4.",
    liveTradeFieldMarkets: "\uc2dc\uc7a5",
    liveTradeMarketKr: "\uad6d\ub0b4",
    liveTradeMarketUs: "\ubbf8\uad6d",
    liveTradeMarketCrypto: "\ucf54\uc778",
    liveTradeCryptoSimNote:
      "\ucf54\uc778\uc740 \ube57\uc378 KRW \uc2dc\uc138\u00b7\uc6d0\ud654 \ub9e4\uc218 \uae08\uc561 \uae30\uc900\uc785\ub2c8\ub2e4. \uc2e4\ub9e4\ub9e4\ub294 \u00ab\ub354 \ube57\uc378 API\u00bb\uc5d0\uc11c \uac70\ub798\uc18c \uc2e4\uc8fc\ubb38\uc744 \ucf1c\uc57c \ud569\ub2c8\ub2e4.",
    liveTradeFieldAmountKrwCrypto:
      "\uad6d\ub0b4\u00b7\ucf54\uc778 1\ud68c \ub9e4\uc218 \uae08\uc561 (\uc6d0)",
    liveTradeFieldMarketsRequired:
      "\uad6d\ub0b4\u00b7\ubbf8\uad6d\u00b7\ucf54\uc778 \uc911 \ud558\ub098 \uc774\uc0c1 \uc120\ud0dd\ud558\uc138\uc694.",
    liveTradeFieldSellHorizon: "\ub9e4\ub3c4 \uad00\uc810 (\ubcf4\uc720 \uae30\uac04 \uac00\uc815)",
    liveTradeSellHorizonShort: "\ub2e8\uae30",
    liveTradeSellHorizonMedium: "\uc911\uae30",
    liveTradeSellHorizonLong: "\uc7a5\uae30",
    liveTradeSimSymbol: "\uc885\ubaa9 \uac80\uc0c9",
    liveTradeSimSymbolPh: "\uc885\ubaa9\uba85 \ub610\ub294 \ucf54\ub4dc",
    liveTradeSimBuy: "\uc2dc\ubbac \ub9e4\uc218",
    liveTradeStatusArmed: "\uc2e4\ub9e4\ub9e4 \uc911",
    liveTradeStatusSim: "\uc2dc\ubbac \uc790\ub3d9",
    liveTradeStatusPaused: "\uc911\uc9c0",
    liveTradeStatusError: "\uc624\ub958",
    liveTradeStatusDraft: "\ub4f1\ub85d\ub428",
    liveTradeSaved: "\uc800\uc7a5\ud588\uc2b5\ub2c8\ub2e4.",
    liveTradeRegistered: "\uc2e4\ub9e4\ub9e4 \ud504\ub85c\uadf8\ub7a8\uc744 \ub4f1\ub85d\ud588\uc2b5\ub2c8\ub2e4.",
    liveTradeDeleteConfirm: "\uc774 \uc2e4\ub9e4\ub9e4 \ud504\ub85c\uadf8\ub7a8\uc744 \uc0ad\uc81c\ud560\uae4c\uc694?",
    liveTradeDeleteConfirmNamed:
      "\u300c{name}\u300d \ud504\ub85c\uadf8\ub7a8\ub9cc \uc0ad\uc81c\ud569\ub2c8\ub2e4. \ub2e4\ub978 \uc2dc\ubbac\u00b7\uc2e4\ub9e4\ub9e4\ub294 \uc720\uc9c0\ub429\ub2c8\ub2e4. \uacc4\uc18d\ud560\uae4c\uc694?",
    liveTradeDeleteRunningConfirm:
      "\u300c{name}\u300d\uc740(\ub294) \uc2e4\ud589 \uc911\uc785\ub2c8\ub2e4. \uc774 \ud504\ub85c\uadf8\ub7a8\ub9cc \uc911\uc9c0\u00b7\uc0ad\uc81c\ud569\ub2c8\ub2e4. \uacc4\uc18d\ud560\uae4c\uc694?",
    liveTradeArmedOk: "\uc2e4\ub9e4\ub9e4\ub97c \uc2dc\uc791\ud588\uc2b5\ub2c8\ub2e4. \uc2a4\ud06c\ub9ac\ub108 \uace0\ub4dd\uc810 \uc885\ubaa9\uc774 \uc870\uac74\uc5d0 \ub9de\uc73c\uba74 \uc8fc\ubb38\uc774 \uc2e4\ud589\ub429\ub2c8\ub2e4.",
    liveTradeArmedWaitToss: "\ub4f1\ub85d\uc740 \uc644\ub8cc\ub410\uc9c0\ub9cc \ud1a0\uc2a4 API \uacc4\uc88c \uc124\uc815 \ud6c4\uc5d0 \uc2e4\uc81c \uc8fc\ubb38\uc774 \uac00\ub2a5\ud569\ub2c8\ub2e4.",
    liveTradeArmedOkBithumb:
      "\ube57\uc378 \uc2e4\ub9e4\ub9e4\ub97c \uc2dc\uc791\ud588\uc2b5\ub2c8\ub2e4. \uc2a4\ud06c\ub9ac\ub108 \uace0\ub4dd\uc810 \uc885\ubaa9\uc774 \uc870\uac74\uc5d0 \ub9de\uc73c\uba74 \ube57\uc378 \uc8fc\ubb38\uc774 \uc2e4\ud589\ub429\ub2c8\ub2e4.",
    liveTradeArmedWaitBithumbKeys:
      "\ube57\uc378 API Key\u00b7Secret Key\ub97c \uc800\uc7a5\ud55c \ub4a4 \uc2e4\ub9e4\ub9e4\ub97c \uc2dc\uc791\ud560 \uc218 \uc788\uc2b5\ub2c8\ub2e4.",
    liveTradeArmedWaitBithumb:
      "\ube57\uc378 \uc5f0\ub3d9\uc744 \ud655\uc778\ud55c \ub4a4 \u00ab\ube57\uc378 \uc2e4\ub9e4\ub9e4 \uc2dc\uc791\u00bb\uc744 \ub20c\ub7ec \uc8fc\uc138\uc694.",
    liveTradeSimStartOk: "\uc2dc\ubbac \uc790\ub3d9 \ub9e4\ub9e4\ub97c \uc2dc\uc791\ud588\uc2b5\ub2c8\ub2e4. \ud154\ub808\uadf8\ub7a8 \uc54c\ub9bc \uc2dc \uc790\ub3d9 \ub9e4\uc218\ud569\ub2c8\ub2e4.",
    liveTradeDisarmed: "\uc2e4\ub9e4\ub9e4\ub97c \uc911\uc9c0\ud588\uc2b5\ub2c8\ub2e4.",
    liveTradeTitle: "\uc2e4\ub9e4\ub9e4 \ud504\ub85c\uadf8\ub7a8",
    liveTradeOpenRecModels: "\ucd94\ucc9c \ubaa9\ub85d\uc5d0\uc11c \ubaa8\ub378 \uad00\ub9ac",
    liveTradeApiRowAria: "\ud1a0\uc2a4\u00b7\ube57\uc378 API \uc5f0\ub3d9 \uc0c1\ud0dc",
    liveTradeTossTitle: "\ud1a0\uc2a4 API \uc5f0\ub3d9",
    liveTradeTossChecklist: "\uc5f0\ub3d9 \uc0c1\ud0dc",
    liveTradeTossItemApi: "API \ud0a4",
    liveTradeTossOk: "\uc124\uc815\ub428",
    liveTradeTossNo: "\ubbf8\uc124\uc815",
    liveTradeTossItemAccount: "\uacc4\uc88c",
    liveTradeTossItemOrders: "\uc2e4\uc8fc\ubb38",
    liveTradeTossSim: "\uc2dc\ubbac\ub808\uc774\uc158",
    liveTradeBithumbTitle: "\ube57\uc378 API \uc5f0\ub3d9",
    liveTradeBithumbChecklist: "\uc5f0\ub3d9 \uc0c1\ud0dc",
    liveTradeBithumbItemKey: "API Key",
    liveTradeBithumbItemSecret: "Secret Key",
    liveTradeBithumbItemExchangeOrders: "\uac70\ub798\uc18c \uc2e4\uc8fc\ubb38",
    liveTradeExchangeOrdersOn: "\ud5c8\uc6a9",
    liveTradeExchangeOrdersOff: "\ucc28\ub2e8(\uc2dc\ubbac\ub9cc)",
    liveTradeFeeLabel: "\uc218\uc218\ub958",
    liveTradeAuthTitle: "\uc2e4\ub9e4\ub9e4 \ub85c\uadf8\uc778",
    liveTradeAuthHint:
      "\uac1c\uc778 \ube44\ud2b8\uc378\u00b7\ud1a0\uc2a4 API\ub85c\ub9cc \uc8fc\ubb38\ud569\ub2c8\ub2e4. \uc774\uba54\uc77c\u00b7\ube44\ubc00\ubc88\uc73c\ub85c \uacc4\uc815\uc744 \ub9cc\ub4e0 \ub4a4 \uc5f0\ub3d9\ud558\uc138\uc694.",
    liveTradeAuthLogin: "\ub85c\uadf8\uc778",
    liveTradeAuthRegister: "\ud68c\uc6d0\uac00\uc785",
    liveTradeAuthEmail: "\uc774\uba54\uc77c",
    liveTradeAuthPassword: "\ube44\ubc00\ubc88\ud638 (8\uc790 \uc774\uc0c1)",
    liveTradeAuthLoginSubmit: "\ub85c\uadf8\uc778",
    liveTradeAuthRegisterSubmit: "\uac00\uc785",
    liveTradeAuthLogout: "\ub85c\uadf8\uc544\uc6c3",
    liveTradeAuthSignedIn: "\ub85c\uadf8\uc778:",
    liveTradeAuthRequired:
      "\uc2e4\ub9e4\ub9e4 \uae30\ub2a5\uc744 \uc0ac\uc6a9\ud558\ub824\uba74 \uc704\uc5d0\uc11c \ub85c\uadf8\uc778\ud558\uc138\uc694.",
    liveTradeCredSave: "API \uc800\uc7a5",
    liveTradeCredChangeApi: "API \ubcc0\uacbd",
    liveTradeCredTest: "\uc5f0\uacb0 \ud14c\uc2a4\ud2b8",
    liveTradeCredLiveOrders: "\uc2e4\uc8fc\ubb38 \ud5c8\uc6a9 (\ub044\uba74 \uc2dc\ubbac\ub9cc)",
    liveTradeCredSaved: "\uc800\uc7a5\ud588\uc2b5\ub2c8\ub2e4.",
    liveTradeCredKeyPlaceholder: "\uc0c8 \ud0a4 \uc785\ub825 \uc2dc \uad50\uccb4",
    liveTradeCredSecretPlaceholder: "\ube44\uc6cc\ub450\uba74 \uae30\uc874 \uac12 \uc720\uc9c0",
    liveTradeCredNoMasterKey:
      "\uc11c\ubc84\uc5d0 CREDENTIALS_MASTER_KEY\uac00 \uc5c6\uc2b5\ub2c8\ub2e4. \uad00\ub9ac\uc790\uac00 .env\ub97c \uc124\uc815\ud574\uc57c \ud569\ub2c8\ub2e4.",
    liveTradeCredEnvTossHint:
      "\uc11c\ubc84 .env \ud1a0\uc2a4 \ud0a4\uac00 \uc124\uc815\ub418\uc5b4 \uc788\uc2b5\ub2c8\ub2e4. \uac1c\uc778 \ud0a4\ub294 \ub2e4\uc74c \ub2e8\uacc4\uc5d0 \uc800\uc7a5\ud569\ub2c8\ub2e4.",
    liveTradeFormTitle: "\uc2e4\ub9e4\ub9e4 \ub4f1\ub85d",
    liveTradeFormEdit: "\ud504\ub85c\uadf8\ub7a8 \uc218\uc815",
    liveTradeFormNew: "\uc0c8 \ud504\ub85c\uadf8\ub7a8",
    liveTradeNoModels: "\ub4f1\ub85d\ub41c \uae30\uc220 \ubaa8\ub378\uc774 \uc5c6\uc2b5\ub2c8\ub2e4.",
    liveTradeFieldName: "\ud504\ub85c\uadf8\ub7a8 \uc774\ub984",
    liveTradeNamePlaceholder: "\uc608: \uae30\ubcf8 \ubaa8\ub378 \uc2e4\ub9e4\ub9e4",
    liveTradeFieldModel: "\uae30\uc220 \ubd84\uc11d \ubaa8\ub378",
    liveTradeFieldMinScore: "\ucd5c\uc18c \uc810\uc218 (\ud154\ub808\uadf8\ub7a8 \uae30\uc900 \ube44\uc728)",
    liveTradeFieldAmountKrw: "\uad6d\ub0b4 1\ud68c \ub9e4\uc218 \uae08\uc561 (\uc6d0)",
    liveTradeFieldAmountCrypto: "\ucf54\uc778 1\ud68c \ub9e4\uc218 \uae08\uc561 ($)",
    liveTradeFieldAmountUsdCrypto:
      "\ubbf8\uad6d\u00b7\ucf54\uc778 1\ud68c \ub9e4\uc218 \uae08\uc561 ($)",
    liveTradeFieldSimAutoBuy: "\uc54c\ub9bc \uc2dc \uc790\ub3d9 \uc2dc\ubbac \ub9e4\uc218",
    liveTradeFieldAutoSell: "\ubaa9\ud45c\u00b7\uc190\uc808\uac00 \uc790\ub3d9 \ub9e4\ub3c4",
    liveTradeFieldAmountUsd: "\ubbf8\uad6d 1\ud68c \ub9e4\uc218 \uae08\uc561 ($)",
    liveTradeFieldAmountKrwMin: "\ucd5c\uc18c {n}\uc6d0 \uc774\uc0c1",
    liveTradeSave: "\uc800\uc7a5",
    liveTradeRegister: "\ubaa8\ub378 \ub4f1\ub85d",
    liveTradeListTitle: "\ub4f1\ub85d\ub41c \ud504\ub85c\uadf8\ub7a8",
    liveTradeListEmpty: "\ub4f1\ub85d\ub41c \ud504\ub85c\uadf8\ub7a8\uc774 \uc5c6\uc2b5\ub2c8\ub2e4.",
    liveTradeCurrentReturn: "\ud604\uc7ac \uc218\uc775\ub960",
    liveTradeArmedAt: "\uc2dc\uc791",
    liveTradeLastRun: "\ub9c8\uc9c0\ub9c9 \uc2e4\ud589",
    liveTradeDisarm: "\uc2e4\ub9e4\ub9e4 \uc911\uc9c0",
    liveTradeSimStart: "\uc2dc\ubbac \uc790\ub3d9 \uc2dc\uc791",
    liveTradeArm: "\uc2e4\ub9e4\ub9e4 \uc2dc\uc791",
    liveTradeArmBithumb: "\ube57\uc378 \uc2e4\ub9e4\ub9e4 \uc2dc\uc791",
    liveTradeArmToss: "\ud1a0\uc2a4 \uc2e4\ub9e4\ub9e4 \uc2dc\uc791",
    liveTradeEdit: "\uc218\uc815",
    liveTradeDelete: "\uc0ad\uc81c",
    liveTradeLeftRailAria: "\uc2e4\ub9e4\ub9e4 \ud604\ud669",
    liveTradeLeftRailTitle: "\uc2e4\ub9e4\ub9e4",
    liveTradeLeftRailOpen: "\uc790\uc138\ud788",
    liveTradeLeftRailExpand: "\ud3bc\uce58\uae30",
    liveTradeLeftRailCollapse: "\uc811\uae30",
    liveTradeLeftRailTotalReturn: "\ucd1d \uc218\uc775\ub960",
    liveTradeLeftRailTotalInvested: "\ub9e4\uc218\ucd1d\uae08\uc561",
    liveTradeLeftRailTotalEval: "\ud3c9\uac00\uae08\uc561",
    liveTradeLeftRailColCoin: "\ucf54\uc778",
    liveTradeLeftRailColReturn: "\uc218\uc775\ub960",
    liveTradeLeftRailColValue: "\ud3c9\uac00\uae08",
    liveTradeLeftRailColWeight: "\ube44\uc911",
    liveTradeLeftRailTotal: "\ud569\uacc4",
    liveTradeLeftRailHoldings: "\ubcf4\uc720",
    liveTradeLeftRailHoldingsShort: "\ubcf4\uc720",
    liveTradeLeftRailChgShort: "\ub4f1\ub77d",
    liveTradeLeftRailBuySellShort: "\ub9e4\u00b7\ubaa9\u00b7\uc190",
    liveTradeLeftRailNoHolding: "\uc5c6\uc744",
    liveTradeLeftRailLaneBithumb: "\ube57\uc378",
    liveTradeLeftRailLaneToss: "\ud1a0\uc2a4",
    liveTradeLeftRailLaneBoth: "\ube57\uc378\u00b7\ud1a0\uc2a4",
    liveTradeLeftRailLaneLive: "\uc2e4\ub9e4\ub9e4",
    liveTradeLeftRailSimOrders: "\uc2dc\ubbac \uc8fc\ubb38",
    liveTradeLeftRailLiveOrders: "\uc2e4\uc8fc\ubb38",
    footerInquiry: "\ubb38\uc758",
    footerInquiryPlaceholder: "\ubb38\uc758 \ub0b4\uc6a9\uc744 \uc801\uc5b4 \uc8fc\uc138\uc694\u2026",
    footerInquiryTitle: "\ubb38\uc758\ud558\uae30",
    leftRailAria: "\uc8fc\uc694 \uc9c0\uc218 \u00b7 \ud658\uc728 \uacc4\uc0b0",
    leftRailBithumbAccountAria: "\ube57\uc378 \uacc4\uc88c \uc794\uace0\u00b7\ubcf4\uc720",
    leftRailBithumbAccountNeedKeys: "\uc2e4\uac70\ub798 \ud0ed\uc5d0\uc11c \ube57\uc378 API\ub97c \uc800\uc7a5\ud558\uba74 \uc794\uace0\u00b7\ubcf4\uc720\uac00 \ud45c\uc2dc\ub429\ub2c8\ub2e4.",
    leftRailBithumbAccountTitle: "\ube57\uc378 \uacc4\uc88c",
    leftRailBithumbBalanceHide: "\uc794\uc561 \uac00\ub9ac\uae30",
    leftRailBithumbBalanceShow: "\uc794\uc561 \ubcf4\uae30",
    liveTradeActivitySub: "\uc2e4\ub9e4\ub9e4\u00b7\uc2dc\ubbac \ud504\ub85c\uadf8\ub7a8\uc758 \ubcf4\uc720\u00b7\ubaa9\ud45c\uac00\u00b7\ucd5c\uadfc \uccb4\uacb0\uc744 20\ucd08\ub9c8\ub2e4 \uac31\uc2e0\ud569\ub2c8\ub2e4.",
    liveTradeActivityTitle: "\uac00\ub3d9 \uc911 \uc2e4\ub9e4\ub9e4 \u00b7 \uc2dc\ubbac\ub808\uc774\uc158",
    liveTradeActivityEmpty: "\uac00\ub3d9 \uc911\uc778 \uc2e4\ub9e4\ub9e4\u00b7\uc2dc\ubbac\uc774 \uc5c6\uc2b5\ub2c8\ub2e4. \u00ab\uc2e4\ub9e4\ub9e4 \uc2dc\uc791\u00bb \ub610\ub294 \u00ab\uc2dc\ubbac \uc790\ub3d9 \uc2dc\uc791\u00bb\uc73c\ub85c \ucf20 \ub4a4 \uac01\uac01 \u00ab\uc911\uc9c0\u00bb\ub85c \ub055\uc138\uc694.",
    liveTradeAuthRegistrationClosed: "\uc2e0\uaddc \ud68c\uc6d0\uac00\uc785\uc740 \ud604\uc7ac \uc911\ub2e8\ub418\uc5b4 \uc788\uc2b5\ub2c8\ub2e4. \uacc4\uc815\uc774 \uc788\uc73c\uba74 \ub85c\uadf8\uc778\ud558\uc138\uc694.",
    liveTradeBithumbItemOrders: "\uac70\ub798\uc18c \uc2e4\uc8fc\ubb38",
    liveTradeChartOpenLookup: "\uc885\ubaa9 \uac80\uc0c9 \ud0ed\uc5d0\uc11c \ucc28\ud2b8 \ubcf4\uae30",
    liveTradeCredOrderModeHint: "\uc571 \uc548 \u00ab\uc2dc\ubbac \uc790\ub3d9 \uc2dc\uc791\u00bb \ud504\ub85c\uadf8\ub7a8\uc740 API\ub9cc \uc800\uc7a5\ub418\uc5b4 \uc788\uc73c\uba74 \uc2e4\uc8fc\ubb38 \ud5c8\uc6a9 \uc5ec\ubd80\uc640 \uad00\uacc4\uc5c6\uc774 \ub3cc\uc544\uac11\ub2c8\ub2e4. \uc5ec\uae30 \uc124\uc815\uc740 \ube57\uc378\u00b7\ud1a0\uc2a4\uc5d0 \uc2e4\uc81c \uc8fc\ubb38\uc744 \ub123\uc744\uc9c0 \uc5ec\ubd80\uc785\ub2c8\ub2e4.",
    liveTradeCredOrderModeLive: "\ud5c8\uc6a9",
    liveTradeCredOrderModeSaved: "\uc8fc\ubb38 \ubaa8\ub4dc\ub97c \uc800\uc7a5\ud588\uc2b5\ub2c8\ub2e4.",
    liveTradeCredOrderModeSim: "\ucc28\ub2e8 (\uc2dc\ubbac\u00b7\uc5f0\uacb0 \ud14c\uc2a4\ud2b8\ub9cc)",
    liveTradeCredOrderModeTitle: "\uac70\ub798\uc18c \uc2e4\uc8fc\ubb38",
    liveTradeCredTestAvgBuy: "\ud3c9\ub2e8",
    liveTradeCredTestBalance: "\uacc4\uc88c \uc794\uc561",
    liveTradeCredTestHoldings: "\ubcf4\uc720 \uc885\ubaa9",
    liveTradeCredTestKrwAvailable: "\uc8fc\ubb38 \uac00\ub2a5",
    liveTradeCredTestKrwLocked: "\uc8fc\ubb38 \uc911",
    liveTradeCredTestKrwTotal: "\uc6d0\ud654 \ud569\uacc4",
    liveTradeCredTestNoHoldings: "\ubcf4\uc720 \ucf54\uc778 \uc5c6\uc74c",
    liveTradeLiveRunEmpty: "\uac00\ub3d9 \uc911\uc778 \uc2e4\ub9e4\ub9e4\uac00 \uc5c6\uc2b5\ub2c8\ub2e4. \u00ab\uc2e4\ub9e4\ub9e4 \uc2dc\uc791\u00bb\uc73c\ub85c \ucf20 \ub4a4 \u00ab\uc2e4\ub9e4\ub9e4 \uc911\uc9c0\u00bb\ub85c \ub055\ub2c8\ub2e4.",
    liveTradeLiveRunTitle: "\uc2e4\ub9e4\ub9e4",
    liveTradePfColBuyPrice: "\uad6c\ub9e4\uac00",
    liveTradePfColRealizedPnl: "\uc2e4\ud604 \uc190\uc775",
    liveTradePfColRealizedPnlPct: "\uc190\uc775\ub960",
    liveTradePfColSellPrice: "\ud310\ub9e4\uac00",
    liveTradePfFxKrw: "\uc6d0\ud654 \ud658\uc0b0",
    liveTradePfTotalKrw: "\ud569\uacc4",
    marketIndicesAria: "\uc8fc\uc694 \uc2dc\uc7a5 \uc9c0\uc218\u00b7\ud658\uc728 (\uc57d 20\ucd08\ub9c8\ub2e4 \uac31\uc2e0)",
    marketIndicesEmpty: "\uc9c0\uc218 \uc2dc\uc138\ub97c \ubd88\ub7ec\uc624\uc9c0 \ubabb\ud588\uc2b5\ub2c8\ub2e4.",
    marketIndicesLoading: "\ubd88\ub7ec\uc624\ub294 \uc911\u2026",
    marketIndicesOpenChart: "{name} \u2014 \uc885\ubaa9 \uac80\uc0c9\uc5d0\uc11c \ucc28\ud2b8 \uc5f4\uae30",
    marketIndicesTitle: "\uc8fc\uc694 \uc9c0\uc218",
    opsGlobalQueueSourceClaudeCode: "Claude Code",
    quoteCurrencyFxBasis: "\uc6d0\ud654 \ud45c\uc2dc \u00b7 {date} 09:00 KST \ud658\uc728(\uacf5\ud734\u00b7\uc8fc\ub9d0\u00b709\uc2dc \uc804\uc774\uba74 \uc9c1\uc804 \uc601\uc5c5\uc77c)",
    signalHintClose: "\ub2eb\uae30",
    signalHintLongPress: "\uae38\uac8c \ub20c\ub7ec \uc124\uba85 \ubcf4\uae30",
    stockLookupAnalysis: "\ubd84\uc11d",
    stockLookupAnalysisBuyNo: "\ub9e4\uc218 \ud6c4\ubcf4 \uc544\ub2d8",
    stockLookupAnalysisBuyOk: "\uc2a4\ud06c\ub9ac\ub108 \ub9e4\uc218 \ud6c4\ubcf4",
    stockLookupAnalysisClose: "\ub2eb\uae30",
    stockLookupAnalysisConditions: "\uc2e0\ud638 {met}/{total} (\ud544\uc694 {req}+)",
    stockLookupAnalysisError: "\ubd84\uc11d\uc744 \ubd88\ub7ec\uc624\uc9c0 \ubabb\ud588\uc2b5\ub2c8\ub2e4.",
    stockLookupAnalysisFoot: "\uc77c\ubd09 {n}\ubd09 \uae30\uc900 \u00b7 \uc2a4\ud06c\ub9ac\ub108\uc640 \ub3d9\uc77c \ub85c\uc9c1",
    stockLookupAnalysisInsufficient: "\uc77c\ubd09 \ub370\uc774\ud130\uac00 \ubd80\uc871\ud569\ub2c8\ub2e4(\ud604\uc7ac {n}\ubd09, \ucd5c\uc18c 55\ubd09 \ud544\uc694).",
    stockLookupAnalysisLoading: "\uc77c\ubd09\u00b7\uc2e0\ud638 \ubd84\uc11d \uc911\u2026",
    stockLookupAnalysisMaxScore: "\ub9cc\uc810 {n}\uc810",
    stockLookupAnalysisModel: "\ubaa8\ub378: {name}",
    stockLookupAnalysisModelDefault: "\uae30\ubcf8",
    stockLookupAnalysisScore: "\uac00\uc911 \uc810\uc218",
    stockLookupAnalysisTgHint: "\ud154\ub808\uadf8\ub7a8: \uac00\uc911 \uc810\uc218 {min}\uc810 \ucd08\uacfc \ud544\uc694",
    stockLookupAnalysisTgNo: "\ud154\ub808\uadf8\ub7a8 \ubbf8\ub2ec",
    stockLookupAnalysisTgOk: "\ud154\ub808\uadf8\ub7a8 \uc54c\ub9bc \uc870\uac74",
    stockLookupAnalysisTitle: "\uae30\uc220 \ubd84\uc11d \uc0c1\ud0dc",
    themeSwitchToDark: "\ub2e4\ud06c\ubaa8\ub4dc \uc804\ud658",
    themeSwitchToLight: "\ud654\uc774\ud2b8\ubaa8\ub4dc\uc804\ud658",
    topBarFxCalcAmountAria: "\uae08\uc561 \uc785\ub825",
    topBarFxCalcKrwToUsd: "\uc6d0\u2192\ub2ec\ub7ec",
    topBarFxCalcModeAria: "\ud658\uc0b0 \ubc29\ud5a5",
    topBarFxCalcRateLine: "1 USD = {rate}",
    topBarFxCalcTitle: "\ud658\uc728 \uacc4\uc0b0",
    topBarFxCalcUsdToKrw: "\ub2ec\ub7ec\u2192\uc6d0",
    opsGlobalQueueEmpty: "\uc9c4\ud589 \uc911\uc778 \uc791\uc5c5\uc774 \uc5c6\uc2b5\ub2c8\ub2e4.",
    picksHistoryInitialPrice: "\ucd5c\ucd08",
    picksHistoryQuotesLoading: "\uc2dc\uc138 \uc870\ud68c \uc911\u2026",
    picksHistoryCurrentPrice: "\ud604\uc7ac",
    picksHistoryVsInitial: "\ub300\ube44",
    recTrackerFeeRoundTrip: "\uc655\ubcf50.2%",
    recTrackerWin: "\uc2b9",
    recTrackerLoss: "\ud328",
    recTrackerFlat: "\ubcf4\ud569",
    recTrackerUnknown: "\u2014",
    recTrackerTitle: "\ucd94\ucc9c \uc2e4\uc801 \ucd94\uc801",
    recTrackerMarketAll: "\uc804\uccb4",
    recTrackerRefresh: "\uc0c8\ub85c\uace0\uce68",
    recTrackerDateAll: "\uc804\uccb4 \uc77c\uc790",
    recTrackerLoading: "\ubd88\ub7ec\uc624\ub294 \uc911\u2026",
    recTrackerEmpty: "\uae30\ub85d\ub41c \ucd94\ucc9c\uc774 \uc5c6\uc2b5\ub2c8\ub2e4.",
    recTrackerFilterNoMatch:
      "\uc120\ud0dd\ud55c \uc870\uac74\uc5d0 \ub9de\ub294 \ucd94\ucc9c\uc774 \uc5c6\uc2b5\ub2c8\ub2e4. \ud544\ud130\ub97c \ubc14\uafb8\uac70 \ub2e4\uc2dc \uc120\ud0dd\ud574 \ubcf4\uc138\uc694.",
    recTrackerNoTelegramForStats: "\uc54c\ub9bc \uc885\ubaa9 \uc5c6\uc74c",
    recTrackerUnknownHint: "\ud604\uc7ac\uac00 \uc870\ud68c \uc2e4\ud328 \u2014 \uc0c8\ub85c\uace0\uce68 \ub610\ub294 \uc7a0\uc2dc \ud6c4 \ub2e4\uc2dc \uc2dc\ub3c4",
    recTrackerWinRate: "\uc2b9\ub960",
    recTrackerWins: "\uc2b9",
    recTrackerLosses: "\ud328",
    recTrackerTotal: "\ucd94\uc801",
    recTrackerByModel: "\ubaa8\ub378\ubcc4 \uc2b9\ub960",
    recTrackerClearFilter: "\ud544\ud130 \ud574\uc81c",
    recTrackerByScore: "\uc810\uc218\ubcc4 \uc2b9\ub960",
    recTrackerScoreUnit: "\uc810",
    recTrackerBigGainSignalsTitle: "5%\u2191 \uc0c1\uc2b9 \uc885\ubaa9 \ub9e4\uc218 \uc0ac\uc778",
    recTrackerBigGainSignalsSub: "\uc218\uc218\ub8cc \ubc18\uc601 \ub4f1\ub77d {pct}% \ucd08\uacfc \uc885\ubaa9\uc5d0\uc11c \ubc1c\uacac\ub41c \uadfc\uac70",
    recTrackerBigGainStocks: "{n}\uc885\ubaa9",
    recTrackerBigGainHits: "{n}\uac74",
    recTrackerBigGainEmpty: "\uc120\ud0dd \uc870\uac74\uc5d0 5% \ucd08\uacfc \uc0c1\uc2b9 \uc885\ubaa9\uc774 \uc5c6\uc2b5\ub2c8\ub2e4.",
    recTrackerBySignal: "\uadfc\uac70\ubcc4 \uc2b9\ub960",
    recTrackerColDate: "\uc77c\uc790",
    recTrackerColName: "\uc885\ubaa9",
    recTrackerColScore: "\uc810\uc218",
    recTrackerColSignals: "\uadfc\uac70",
    recTrackerColEntry: "\ucd94\ucc9c\uac00",
    recTrackerColCurrent: "\ud604\uc7ac\uac00",
    recTrackerColCurrentHint: "\ud604\uc7ac\uac00 \u00b7 \uc218\uc218\ub8cc \ubc18\uc601 \ub4f1\ub77d",
    recTrackerColChange: "\ub4f1\ub77d",
    recTrackerColResult: "\uacb0\uacfc",
    recTrackerTelegramBadgeTitle: "\ud154\ub808\uadf8\ub7a8 \uc54c\ub9bc \ubc1c\uc1a1 \uc885\ubaa9",
    recTrackerOpenChart: "\ucc28\ud2b8 \ubcf4\uae30",
    recTrackerColModel: "\ubd84\uc11d \ubaa8\ub378",
    recTrackerTelegramBadge: "\uc54c\ub9bc",
    recTrackerScoreMismatchHint: "\uc810\uc218\u00b7\uadfc\uac70 \ubd88\uc77c\uce58",
    recTrackerNoSignals: "\uadfc\uac70 \ubbf8\uae30\ub85d",
    recTrackerMetricShare: "\ucd94\ucc9c \uc911 \ube44\uc728",
    recTrackerMetricExpectancy: "\ud3c9\uade0 \uae30\ub300 \uc218\uc775",
    recTrackerMetricAvgWin: "\ub9de\ucd94\uba74",
    recTrackerMetricAvgLoss: "\ud2c0\ub9ac\uba74",
    recTrackerMetricSolo: "\uc774 \uadfc\uac70\ub9cc",
    recTrackerMetricMulti: "\ub2e4\ub978 \uadfc\uac70\uc640 \ud568\uaed8",
    recTrackerMetricHighScore: "\uace0\uc810\uc218(7+)",
    recTrackerMetricLowScore: "\uc800\uc810\uc218(4\u2193)",
    recTrackerMetricKr: "\uad6d\ub0b4",
    recTrackerMetricUs: "\ubbf8\uad6d",
    recTrackerMetricCoCount: "\ud568\uaed8 \ubd99\ub294 \uadfc\uac70",
    recTrackerMetricBigLoss: "3% \uc774\ud558 \ud328",
    recTrackerMetricRecent: "\ucd5c\uadfc 14\uc77c",
    recTrackerMetricFlat: "\uc544\uc9c1 \ubbf8\ud655\uc815",
    recTrackerChipSelected: "\uc120\ud0dd",
    recTrackerAnalysisViewList: "\ud574\ub2f9 \uadfc\uac70 \ubaa9\ub85d \ubcf4\uae30",
    recTrackerAnalysisTitle: "\uc2b9\ub960 \ub0ae\uc740 \uadfc\uac70 \u2014 \uc27d\uac8c \ubcf4\uae30",
    recTrackerAnalysisNone: "\uc804\uccb4 \ub300\ube44 \ud604\uc800\ud788 \ub0ae\uc740 \uadfc\uac70\ub294 \uc5c6\uc2b5\ub2c8\ub2e4.",
    recTrackerAnalysisBaseline:
      "\ube44\uad50 \uae30\uc900: \uc804\uccb4 \uc2b9\ub960 {rate} (\uc2b9\u00b7\ud328 \ud655\uc815 {decided}\uac74)",
    recTrackerAnalysisSecOverview: "\ud55c\ub208\uc5d0 \ubcf4\uae30",
    recTrackerAnalysisSecProfit: "\uc774\uacbc\uc3a8\uc744 \ub54c vs \uc874\uc558\uc744 \ub54c",
    recTrackerAnalysisMetricsAria: "\uc218\uce58 \uc694\uc57d",
    recTrackerAnalysisSecPattern: "\ub2e8\ub3c5\u00b7\uc810\uc218\u00b7\uc2dc\uc7a5",
    recTrackerAnalysisSecTogether: "\ud568\uaed8 \ubd99\ub294 \uadfc\uac70",
    recTrackerAnalysisSecWhy: "\uc65c \uc2b9\ub960\uc774 \ub0ae\uac8c \ub098\uc62c\uc744\uae4c",
    recTrackerUpgradeApplyOne: "\uc801\uc6a9",
    recTrackerModelsActiveSaved: "\ud65c\uc131 \ubaa8\ub378\uc744 \uc800\uc7a5\ud588\uc2b5\ub2c8\ub2e4.",
    recTrackerUpgradeNoTarget: "\ud3b8\uc9d1\ud560 \ubaa8\ub378\uc744 \uc120\ud0dd\ud558\uc138\uc694.",
    recTrackerUpgradeAppliedOne: "\u300c{label}\u300d \uac00\uc911\uce58\ub97c \ubc18\uc601\ud588\uc2b5\ub2c8\ub2e4. \ub2e4\uc74c \uc2a4\uce94\ubd80\ud130 \uc801\uc6a9\ub429\ub2c8\ub2e4.",
    recTrackerUpgradeAppliedAll: "\uc81c\uc548\ud55c \uac00\uc911\uce58\ub97c \ubaa8\ub450 \ubc18\uc601\ud588\uc2b5\ub2c8\ub2e4.",
    recTrackerUpgradeResetDone: "\uae30\ubcf8 \uac00\uc911\uce58\ub85c \ubcf5\uc6d0\ud588\uc2b5\ub2c8\ub2e4.",
    recTrackerModelsCreated: "\ubaa8\ub378 \u300c{name}\u300d\uc744(\ub97c) \ub9cc\ub4e4\uc5c8\uc2b5\ub2c8\ub2e4.",
    recTrackerUpgradeBaseline: "\uc2b9\ub960 {rate} \u00b7 {decided}\uac74",
    recTrackerUpgradeTitle: "\uc2b9\ub960 \uae30\ubc18 \uae30\uc220 \ubd84\uc11d \uc5c5\uadf8\ub808\uc774\ub4dc",
    recTrackerModelsActive: "\ud65c\uc131 \ubaa8\ub378",
    recTrackerUpgradeMaxScore: "\ucd5c\ub300 {n}\uc810",
    recTrackerModelsEditTarget: "\ud3b8\uc9d1 \ub300\uc0c1",
    recTrackerModelsNewNamePh: "\ubaa8\ub378 \uc774\ub984",
    recTrackerModelsSaveAs: "\uc0c8 \ubaa8\ub378",
    recTrackerUpgradeNone: "\uc870\uc815 \uc81c\uc548 \uc5c6\uc74c",
    recTrackerUpgradeHeadline: "\uc6b0\uc120",
    recTrackerUpgradeApplyAll: "\uc804\uccb4 \uc801\uc6a9",
    recTrackerUpgradeReset: "\uae30\ubcf8 \uac00\uc911\uce58\ub85c \ubcf5\uc6d0",
    picksStatsStreakLabel: "\uC601\uC5C5\uC77C \uC5F0\uC18D \uCD94\uCC9C",
    picksStatsStreakUnit: "\uC77C",
    picksStatsSinceFirstLabel: "\uCCAB \uCD94\uCC9C\uAC00 \uB300\uBE44",
    picksStatsFirstDateTitle: "\uCCAB\uC73C\uB85C \uB4F1\uC7A5\uD55C \uCD94\uCC9C \uC77C\uC790",
    pickTurnoverShort: "\uAC70\uB798\uB300\uAE08",
    pickTurnoverTitle: "\uB2F9\uC77C \uAC70\uB798\uB300\uAE08 (\uAC70\uB798\uB7C9 \u00D7 \uD604\uC7AC\uAC00)",
    picksHistoryButton: "\uC77C\uC790\uBCC4 \uCD94\uCC9C",
    picksHistoryButtonAria: "\uC77C\uC790\uBCC4 \uCD94\uCC9C \uBAA9\uB85D \uC5F4\uAE30",
    picksHistoryModalTitle: "\uC77C\uC790\uBCC4 \uCD94\uCC9C \uBAA9\uB85D",
    picksHistoryClose: "\uB2EB\uAE30",
    picksHistoryColDate: "\uC77C\uC790",
    picksHistoryColKr: "\uAD6D\uB0B4",
    picksHistoryColUs: "\uBBF8\uAD6D",
    picksHistoryLoading: "\uBD88\uB7EC\uC624\uB294 \uC911\u2026",
    opsPanelTitle: "\uAC1C\uBC1C \uC694\uCCAD",
    opsMainTabAgent: "\uC5D0\uC774\uC804\uD2B8",
    opsMainTabFileWork: "\uD30C\uC77C\u00B7\uC694\uCCAD",
    opsFileDevLoadError:
      "\uD30C\uC77C \uBC18\uC601 \uBAA9\uB85D\uC744 \uBD88\uB7EC\uC62C \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.",
    opsFileDevSaveError: "\uC800\uC7A5\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.",
    opsFileDevEmpty:
      "\uB4F1\uB85D\uB41C \uD56D\uBAA9\uC774 \uC5C6\uC2B5\uB2C8\uB2E4. \u201C\uD56D\uBAA9 \uCD94\uAC00\u201D\uB97C \uB20C\uB7EC JSON\uC744 \uC801\uACE0 \uC800\uC7A5\uD558\uC138\uC694.",
    opsFileDevItemLabel: "\uBC18\uC601\uC6A9 JSON (\uC608: {\"files\":[{\"path\":\"src/a.ts\",\"content\":\"\u2026\"}]})",
    opsFileDevPlaceholder:
      '{"files":[{"path":"src/example.ts","content":"// ..."}]}',
    opsFileDevStatusApplied: "\uBC18\uC601 \uC644\uB8CC",
    opsFileDevSummaryLabel: "\uC694\uC57D",
    opsRecordModeAdd: "\uD56D\uBAA9 \uCD94\uAC00",
    opsRecordModeSave: "\uD050 \uC800\uC7A5",
    opsRecordModeSaving: "\uC800\uC7A5 \uC911\u2026",
    opsRecordModeLoadError: "\uAE30\uB85D \uBAA8\uB4DC \uBAA9\uB85D\uC744 \uBD88\uB7EC\uC62C \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.",
    opsRecordModeSaveError: "\uC800\uC7A5\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.",
    opsRecordModeEmpty:
      "\uB4F1\uB85D\uB41C \uAC1C\uBC1C \uD56D\uBAA9\uC774 \uC5C6\uC2B5\uB2C8\uB2E4. \u201C\uD56D\uBAA9 \uCD94\uAC00\u201D\uB97C \uB20C\uB7EC \uC694\uCCAD \uB0B4\uC6A9\uC744 \uC801\uACE0 \uC800\uC7A5\uD558\uC138\uC694.",
    opsRecordModeItemLabel: "\uAC1C\uBC1C \uC694\uCCAD \uB0B4\uC6A9",
    opsRecordModePlaceholder:
      "\uC774 \uD56D\uBAA9\uC744 Cursor \uC5D0\uC774\uC804\uD2B8\uC5D0 \uADF8\uB300\uB85C \uC804\uB2EC\uD569\uB2C8\uB2E4. \uBE44\uC5B4 \uC788\uC73C\uBA74 \uC2E4\uD589\uB418\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.",
    opsRecordModeRemove: "\uC0AD\uC81C",
    opsRecordModeRemoveAria: "\uC774 \uD56D\uBAA9 \uC0AD\uC81C",
    opsRecordModeRequeue: "\uB2E4\uC2DC \uB300\uAE30",
    opsRecordModeRequeueAria: "\uC624\uB958 \uD56D\uBAA9\uC744 \uB2E4\uC2DC \uB300\uAE30 \uC5F4\uC5D0 \uC62C\uB9BC\uAE30",
    opsRecordModeQueueRankLabel: "\uB300\uAE30\uC5F4 \uC21C\uC704",
    opsRecordModeStatusPending: "\uB300\uAE30",
    opsRecordModeStatusRunning: "\uC2E4\uD589 \uC911",
    opsRecordModeStatusDone: "\uC644\uB8CC",
    opsRecordModeStatusError: "\uC624\uB958",
    opsRecordModeSaveBlocked:
      "\uC2E4\uD589 \uC911\uC778 \uD56D\uBAA9\uC774 \uC788\uC744 \uB54C\uB294 \uC800\uC7A5\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4. \uC644\uB8CC\uB41C \uD6C4 \uB2E4\uC2DC \uC2DC\uB3C4\uD558\uC138\uC694.",
    opsWorkWriteLabel: "\uC791\uC131",
    opsWorkApplyQueue: "\uD050\uC5D0 \uBC18\uC601",
    opsWorkApplying: "\uBC18\uC601 \uC911\u2026",
    opsWorkApplyError: "\uD050 \uBC18\uC601\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.",
    opsWorkSaving: "\uC800\uC7A5 \uC911\u2026",
    opsWorkSaveError: "\uD30C\uC77C\uC5D0 \uC800\uC7A5\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.",
    opsWorkSectionRequests: "Cursor \uC2E4\uD589 \uB300\uAE30 \uBAA9\uB85D",
    opsGlobalQueueTitle: "\uAC1C\uBC1C \uB300\uAE30\uC5F4",
    opsGlobalQueueSourceFile: "\uAE30\uB85D",
    opsGlobalQueueFieldSource: "\uCD9C\uCC98",
    opsGlobalQueueFieldIp: "IP",
    opsGlobalQueueFieldStatus: "\uCC98\uB9AC \uC0C1\uD0DC",
    opsGlobalQueueFieldTitle: "\uC694\uCCAD \uC81C\uBAA9",
    opsGlobalQueueFieldRegistered: "\uB4F1\uB85D",
    opsGlobalQueueFieldProcessRank: "\uCC98\uB9AC \uC21C\uC704",
    opsGlobalQueueSourceAgent: "Cursor \uC5D0\uC774\uC804\uD2B8",
    opsGlobalQueueSourceRecord: "\uAE30\uB85D \uBAA8\uB4DC",
    opsGlobalQueueSourceIde: "Cursor IDE",
    opsGlobalQueueSourceWeb: "\uC6F9",
    opsFileRequestHistoryTitle: "\uD30C\uC77C\u00B7\uC694\uCCAD \uC774\uB825",
    opsFileRequestHistoryEmpty:
      "\uAE30\uB85D \uBAA8\uB4DC \uC2E4\uD589 \uB85C\uADF8\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4. \uD050\uC5D0 \uC694\uCCAD\uC744 \uB123\uACE0 \uC11C\uBC84\uAC00 \uC2E4\uD589\uD558\uBA74 \uC5EC\uAE30\uC5D0 \uD45C\uC2DC\uB429\uB2C8\uB2E4.",
    opsFileRequestHistoryLoadError: "\uD30C\uC77C\u00B7\uC694\uCCAD \uC774\uB825\uC744 \uBD88\uB7EC\uC62C \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.",
    opsFileRequestHistoryHint:
      "\uC11C\uBC84\uC5D0 \uC800\uC7A5\uB41C \uAE30\uB85D \uBAA8\uB4DC \uD65C\uB3D9 \uB85C\uADF8(ops-record-mode-activity.log) \uCD5C\uADFC \uC774\uBCA4\uD2B8\uC785\uB2C8\uB2E4.",
    opsFileRequestActivityStart: "\uC2E4\uD589 \uC2DC\uC791",
    opsFileRequestActivityOk: "\uC2E4\uD589 \uC644\uB8CC",
    opsFileRequestActivityError: "\uC2E4\uD589 \uC624\uB958",
    opsFileRequestActivityIdLabel: "\uC791\uC5C5 id",
    opsInstructionLabel: "\uC694\uCCAD \uB0B4\uC6A9",
    opsCancelRequest: "\uC694\uCCAD \uC911\uB2E8",
    opsCancelled: "\uC694\uCCAD\uC774 \uC911\uB2E8\uB418\uC5C8\uC2B5\uB2C8\uB2E4.",
    opsInstructionPlaceholder:
      "\uC608: \uD53C\uD06C \uBAA9\uB85D \uC815\uB82C \uAE30\uC900\uC5D0 '\uC2DC\uAC00\uCD1D\uC561' \uCD94\uAC00. \uB2E4\uB978 \uC791\uC5C5\uC774 \uC9C4\uD589 \uC911\uC774\uBA74 \uC5EC\uAE30\uC5D0 \uC774\uC5B4\uC11C \uC801\uC5B4 \uC804\uB2EC\uD558\uBA74 \uC11C\uBC84 \uB300\uAE30\uC5F4\uC5D0 \uC21C\uC11C\uB300\uB85C \uC313\uC785\uB2C8\uB2E4.",
    opsStoredTruncated: "\uC774\uD558 \uC800\uC7A5 \uC0DD\uB7B5",
    opsHistoryTitle: "\uC5D0\uC774\uC804\uD2B8 \uC2E4\uD589 \uC774\uB825",
    opsHistoryEmpty: "\uC800\uC7A5\uB41C \uC2E4\uD589 \uC774\uB825\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.",
    opsHistoryClearAll: "\uC804\uCCB4 \uC0AD\uC81C",
    opsHistoryClearConfirm:
      "\uC800\uC7A5\uB41C \uC5D0\uC774\uC804\uD2B8 \uC2E4\uD589 \uC774\uB825\uC744 \uBAA8\uB450 \uC0AD\uC81C\uD560\uAE4C\uC694?",
    opsHistoryInstructionReplay: "\uD574\uB2F9 \uC694\uCCAD\uB0B4\uC6A9",
    opsHistoryRequestIp: "\uC694\uCCAD IP",
    opsHistoryStreamArchived: "\uC9C4\uD589 \uB85C\uADF8 (\uC800\uC7A5\uBCF8)",
    opsHistoryToolLogTitle:
      "\uD30C\uC77C\u00B7\uB3C4\uAD6C \uC694\uCCAD \uAE30\uB85D (\uACBD\uB85C\u00B7\uC778\uC790 \uB4F1)",
    opsHistoryWorkspaceAppliedBadge: "\uBC18\uC601\uD568",
    opsHistoryMarkWorkspaceApplied: "\uC791\uC5C5 \uBC18\uC601\uD568\uC73C\uB85C \uD45C\uC2DC",
    opsHistoryUnmarkWorkspaceApplied: "\uBC18\uC601 \uD45C\uC2DC \uD574\uC81C",
    opsHistoryRetryBlockedApplied:
      "\uC774\uBBF8 \uBC18\uC601\uD568\uC73C\uB85C \uD45C\uC2DC\uB41C \uC2E4\uD589\uC740 \uC5EC\uAE30\uC11C \uB2E4\uC2DC \uC2E4\uD589\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4. \uD45C\uC2DC\uB97C \uD574\uC81C\uD55C \uB4A4 \uC7AC\uC2DC\uB3C4\uD558\uC138\uC694.",
    opsHistoryMarkAppliedError: "\uD45C\uC2DC \uC800\uC7A5\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.",
    opsHistoryStatusRunning: "\uC2E4\uD589 \uC911",
    opsHistoryStatusWaiting: "\uD050\uC6B0 \uB300\uAE30",
    opsHistoryStatusOk: "\uC644\uB8CC",
    opsHistoryStatusError: "\uC624\uB958",
    opsHistoryStatusCancelled: "\uC911\uB2E8",
    opsHistoryStatusRejected: "\uC815\uCC45 \uCC28\uB2E8",
    opsQueuePending: "\uC2E4\uD589 \uB300\uAE30 {n}\uAC74",
    opsAgentServerQueueHint:
      "\uC694\uCCAD\uC740 \uC11C\uBC84\uC758 \uC5D0\uC774\uC804\uD2B8 \uC2E4\uD589 \uD050\uC5D0 \uC21C\uC11C\uB300\uB85C \uC62C\uB77C\uAC00\uBA70, \uC55E\uC120 \uC791\uC5C5\uC774 \uB05D\uB09C \uB4A4 \uC2E4\uD589\uB429\uB2C8\uB2E4. \uC9C4\uD589\uC740 \uC704 \uC2E4\uD589 \uD050\uC640 \uC774\uB825\uC5D0 \uD45C\uC2DC\uB429\uB2C8\uB2E4.",
    opsAgentQueueSubtitle: "\uC5D0\uC774\uC804\uD2B8 \uC2E4\uD589 \uD050",
    opsUnifiedQueueSeqTitle:
      "\uB2E8\uC77C \uC2E4\uD589 \uD050 \uAE30\uC900 \uB300\uAE30 \uC21C\uBC88 (\uC5D0\uC774\uC804\uD2B8\u00B7\uD30C\uC77C \uC694\uCCAD \uB3D9\uC77C)",
    opsAgentQueueEmpty:
      "\uB300\uAE30 \uB610\uB294 \uC2E4\uD589 \uC911\uC778 \uC694\uCCAD\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.",
    opsAgentQueueWaiting: "\uB300\uAE30",
    opsMyIpJobsTitle: "\uC774 \uC5F0\uACB0(IP)\uC758 \uC5D0\uC774\uC804\uD2B8 \uC791\uC5C5",
    opsMyIpJobsHint:
      "\uAC19\uC740 \uC811\uC18D(IP)\uC5D0\uC11C \uB300\uAE30\u00B7\uC2E4\uD589 \uC911\uC778 \uC694\uCCAD\uC774 \uC5EC\uAE30\uC5D0 \uD45C\uC2DC\uB429\uB2C8\uB2E4.",
    opsRemotePendingBadge: "\uC11C\uBC84\uC5D0\uC11C \uC9C4\uD589 \uC911\uC778 \uB3D9\uC77C IP \uC694\uCCAD",
    opsRemotePendingHint:
      "\uC704 \uC2E4\uD589 \uD050 \uCE74\uB4DC\uB97C \uB204\uB974\uBA74 \uC9C4\uD589 \uC0C1\uD669\uACFC \uC694\uCCAD \uC6D0\uBB38\uC744 \uBCFC \uC218 \uC788\uC2B5\uB2C8\uB2E4.",
    opsQueueProgressModalTitle: "\uC5D0\uC774\uC804\uD2B8 \uC9C4\uD589 \uC0C1\uD669",
    opsQueueProgressCloseAria: "\uC9C4\uD589 \uC0C1\uD669 \uB2EB\uAE30",
    opsQueueProgressWaitingNotice:
      "\uC55E\uC120 \uC791\uC5C5\uC774 \uB05D\uB0A0 \uB54C\uAE4C\uC9C0 \uB300\uAE30 \uC911\uC785\uB2C8\uB2E4. \uC2E4\uD589\uC774 \uC2DC\uC791\uB418\uBA74 \uC544\uB798\uC758 \uB85C\uADF8\uC640 \uC0C1\uD0DC\uAC00 \uC11C\uBC84\uC5D0\uC11C \uAC31\uC2E0\uB429\uB2C8\uB2E4.",
    opsHistoryRunningNoReplayHint:
      "\uC2E4\uD589 \uC911\u00B7\uB300\uAE30 \uC0C1\uD0DC\uC758 \uC694\uCCAD \uC6D0\uBB38\uACFC \uC9C4\uD589 \uB85C\uADF8\uB294 \uC704\uC758 \uC2E4\uD589 \uD050 \uCE74\uB4DC\uB97C \uB204\uB978 \uD31D\uC5C5\uC5D0\uC11C \uD655\uC778\uD558\uC138\uC694.",
    opsQueueProgressStale: "이 실행을 아직 불러올 수 없습니다. 잠시 후 다시 눌러주세요.",
    opsQueueProgressLogPending:
      "\uC11C\uBC84\uC5D0 \uC800\uC7A5\uB41C \uC9C4\uD589 \uB85C\uADF8\uAC00 \uC544\uC9C1 \uBE44\uC5B4 \uC788\uC2B5\uB2C8\uB2E4. \uC7A0\uC2DC \uD6C4 \uB2E4\uC2DC \uD655\uC778\uD558\uC138\uC694.",
    opsMyIpJobsNone:
      "\uD604\uC7AC \uC774 IP\uC5D0\uC11C \uC11C\uBC84\uAC00 \uCD94\uC801 \uC911\uC778 \uB300\uAE30\u00B7\uC2E4\uD589 \uC791\uC5C5\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.",
    opsMyIpNoViewerIp:
      "\uC811\uC18D IP\uB97C \uD655\uC778\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4. \uC544\uB798 \uC804\uCCB4 \uD050\uC5D0\uC11C \uC0C1\uD0DC\uB97C \uD655\uC778\uD558\uC138\uC694.",
    opsMyIpHistoryRunning:
      "\uC2E4\uD589 \uC911 (\uC774\uB825\uC5D0 \uC800\uC7A5\uB41C \uB3D9\uC77C IP \uC791\uC5C5)",
    opsHistoryDeleteRunningConfirm:
      "\uC2E4\uD589 \uC911\uC785\uB2C8\uB2E4. \uC0AD\uC81C\uD558\uBA74 \uD574\uB2F9 \uC2E4\uD589\uC744 \uC911\uB2E8\uD558\uACE0 \uBAA9\uB85D\uC5D0\uC11C \uC81C\uAC70\uD569\uB2C8\uB2E4. \uACC4\uC18D\uD560\uAE4C\uC694?",
    opsHistoryDeleteEntry: "\uC0AD\uC81C",
    opsHistoryDeleteEntryAria: "\uC774 \uC2E4\uD589 \uAE30\uB85D \uC0AD\uC81C",
    opsHistoryDeleteEntryConfirm:
      "\uC774 \uC2E4\uD589 \uAE30\uB85D\uC744 \uC0AD\uC81C\uD560\uAE4C\uC694?",
    opsHistoryRetryFromError: "\uC624\uB958 \uC694\uCCAD \uB2E4\uC2DC \uC2E4\uD589",
    opsHistoryRetryFromErrorAria:
      "\uC774 \uAE30\uB85D\uC758 \uC694\uCCAD \uB0B4\uC6A9\uC73C\uB85C \uC5D0\uC774\uC804\uD2B8\uB97C \uB2E4\uC2DC \uC2E4\uD589\uD569\uB2C8\uB2E4",
    opsLiveErrorRetryAria:
      "\uC704 \uC624\uB958 \uB0B4\uC6A9\uC73C\uB85C \uAC19\uC740 \uC694\uCCAD\uC744 \uB2E4\uC2DC \uC2E4\uD589\uD569\uB2C8\uB2E4",
    opsSubmit: "\uC5D0\uC774\uC804\uD2B8\uC5D0 \uC804\uB2EC",
    opsSubmitting: "\uC2E4\uD589 \uC911\u2026 (\uC218 \uBD84 \uAC78\uB9B4 \uC218 \uC788\uC2B5\uB2C8\uB2E4)",
    opsStreamTitle: "\uC9C4\uD589\u00B7\uC751\uB2F5 (\uC2E4\uC2DC\uAC04)",
    opsStreamPhase: "\uB2E8\uACC4",
    opsStreamThinking: "\uC0DD\uAC01",
    opsStreamTool: "\uB3C4\uAD6C",
    opsStreamCursorStatus: "Cursor \uC0C1\uD0DC",
    opsResultLabel: "\uACB0\uACFC",
    opsStatusLabel: "\uC0C1\uD0DC",
    opsDurationLabel: "\uC18C\uC694 \uC2DC\uAC04",
    opsRuntimeLabel: "\uC2E4\uD589 \uD658\uACBD",
    opsError: "\uC694\uCCAD\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.",
    opsNoKey:
      "\uC11C\uBC84\uC5D0 CURSOR_API_KEY\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4. .env \uC608: .env.example\uC744 \uCC38\uACE0\uD558\uC5EC \uD0A4\uB97C \uB123\uACE0 \uAC1C\uBC1C \uC11C\uBC84\uB97C \uB2E4\uC2DC \uC2DC\uC791\uD558\uC138\uC694.",
    rescanning: "\uC694\uCCAD \uC911\u2026",
    rescan: "\uC804\uCCB4 \uC7AC\uBD84\uC11D",
    serverRestart: "\uC11C\uBC84 \uC7AC\uAE30\uB3D9",
    serverRestartTitle: "Node\u00B7Vite \uAC1C\uBC1C \uC11C\uBC84\uB97C \uC7AC\uAE30\uB3D9\uD569\uB2C8\uB2E4 (\uC790\uB3D9 git pull \uD6C4 \uC0AC\uC774\uD074\uACFC \uBCC4\uB3C4).",
    serverRestartConfirm:
      "\uC11C\uBC84\uB97C \uC7AC\uAE30\uB3D9\uD560\uAE4C\uC694? \uC7A0\uC2DC \uC5F0\uACB0\uC774 \uB044\uAE40 \uB4A4 \uC790\uB3D9\uC73C\uB85C \uC0C8\uB85C\uACE0\uCE68\uB429\uB2C8\uB2E4.",
    serverRestartPasswordPlaceholder: "\uC7AC\uAE30\uB3D9 \uBE44\uBC00\uBC88\uD638",
    serverRestartPasswordRequired: "\uBE44\uBC00\uBC88\uD638\uB97C \uC785\uB825\uD558\uC138\uC694.",
    serverRestartSubmit: "\uD655\uC778",
    serverRestartCancel: "\uCDE8\uC18C",
    serverRestarting: "\uC7AC\uAE30\uB3D9 \uC911\u2026",
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
    stockLookupHotTitle: "\uAC70\uB798\uB300\uAE08 \uC0C1\uC704",
    stockLookupHotLoading: "\uC778\uAE30 \uC885\uBAA9 \uBD88\uB7EC\uC624\uB294 \uC911\u2026",
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
    quoteBarLoading: "\uC2DC\uC138 \uBD88\uB7EC\uC624\uB294 \uC911\u2026",
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
    subtitle:
      "\uB0A8\uC740 \uC2DC\uAC04 \uC21C \u00B7 \uC9C0\uD45C \uBC0F \uAE30\uC5C5 \uC2E4\uC801",
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
    forecastLabel: "\uC608\uC0C1\uCE58",
    forecastPending: "\uBC1C\uD45C \uC804",
    forecastHelp:
      "예상치는 시장 컨센서스(애널리스트 추정)입니다. 서버에 FINNHUB_API_KEY가 있으면 Finnhub estimate로 자동 채웁니다. 없으면 server/data/macro-releases.json의 forecast(수동) 또는 발표 전 표시입니다. 발표값(actual)은 쓰지 않습니다.",
    sectorEarningsTitle: "\uC8FC\uBAA9 \uC139\uD130 \uC2E4\uC801 (\uC608\uC815)",
    sectorEarningsSubtitle:
      "Yahoo Finance \uC608\uC815\uC77C \uAE30\uC900 \u00B7 \uD589\uC5B0 3\uC8FC \uB0B4 \uC8FC\uC694 \uC139\uD130 \uB300\uD45C\uC885",
    sectorEarningsCardHint: "\uC2E4\uC801 \uC77C\uC815 \u00B7 Yahoo \uC885\uBAA9 \uD398\uC774\uC9C0\uB85C \uC5F4\uAE30",
    earningsMetaLabel: "\uC2E4\uC801",
    earningsMetaPending: "\uC77C\uC815\uB9CC \uD655\uC778",
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
    priceAtSendLabel: "\uBC1C\uC1A1\uAC00",
    priceAtSendTitle:
      "\uC54C\uB9BC \uBC1C\uC1A1 \uB2F9\uC2DC \uAE30\uB85D\uD55C \uAC00\uACA9(\uB2E8\uC77C)",
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
      "허용된 IP와 일치하면 API·대시보드를 쓸 수 있습니다. 대기: 접속 신청만 접수된 상태입니다. 승인하면 해당 IP가 아래 허용 목록에 반영되고, 거절하면 이번 신청만 종료됩니다. 허가 취소는 이미 허용된 IP 행을 목록에서 빼서 곧바로 API 접속을 막습니다.",
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
    adminPending: "대기 중인 신청 (IP)",
    adminAllowed: "허용 목록 (IP)",
    adminApprove: "승인",
    adminReject: "거절",
    adminRevoke: "허가 취소",
    adminClose: "닫기",
    adminEmptyPending: "대기 중인 신청이 없습니다.",
    adminEmptyAllowed: "허용된 IP 행이 없습니다.",
    adminUa: "User-Agent",
    adminRequestedAt: "신청 시각",
    adminError: "요청에 실패했습니다.",
    adminMemoLabel: "내 메모 (누구·용도)",
    adminMemoPlaceholder: "예: 홍길동 노트북, 사무실 PC",
    adminMemoSave: "메모 저장",
    adminRequestMessage: "신청 메시지",
  },
  launch: {
    loading: "\uBD88\uB7EC\uC624\uB294 \uC911\u2026",
  },
  mobile: {
    downloadGalaxy: "\uAC24\uB7ED\uC2DC",
    downloadGalaxyTitle: "Android APK \uB2E4\uC6B4\uB85C\uB4DC",
    downloadIphone: "\uC544\uC774\uD3F0",
    downloadIphoneTitle:
      "Safari\uC5D0\uC11C \uD648 \uD654\uBA74\uC5D0 \uCD94\uAC00 (\uC571 \uC124\uCE58)",
    serverSetupTitle: "\uC11C\uBC84 \uC5F0\uACB0",
    serverSetupHint:
      "\uBAA8\uBC14\uC77C \uC571\uC740 PC\uC5D0 \uB6F0\uB294 Stock \uC11C\uBC84\uC5D0 \uC811\uC18D\uD569\uB2C8\uB2E4. \uAC19\uC740 Wi\u2011Fi\uC5D0\uC11C \uC811\uC18D \uAC00\uB2A5\uD55C \uC8FC\uC18C\uB97C \uC785\uB825\uD558\uC138\uC694. (\uC608: https://192.168.0.10:5173)",
    serverUrlLabel: "Stock \uC11C\uBC84 \uC8FC\uC18C",
    serverUrlPlaceholder: "https://\uB0B4PC\uC8FC\uC18C:5173",
    serverUrlInvalid: "\uC62C\uBC14\uB978 http(s) \uC8FC\uC18C\uB97C \uC785\uB825\uD558\uC138\uC694.",
    serverConnectFailed:
      "\uC11C\uBC84\uC5D0 \uC5F0\uACB0\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4. dev \uC2E4\uD589 \uC5EC\uBD80\uC640 \uBC29\uD654\uBCBD \uD3EC\uD2B8\uB97C \uD655\uC778\uD558\uC138\uC694.",
    serverChecking: "\uC5F0\uACB0 \uD655\uC778 \uC911\u2026",
    serverSave: "\uC5F0\uACB0 \uD6C4 \uC2DC\uC791",
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
  mobile: {
${emitObj(t.mobile, 4)}
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

export function liveTradeHeaderStripArmed(n: number) {
  return \`\uC2E4\uB9E4\uB9E4 \${n}\uAC1C \uC2E4\uD589 \uC911\`;
}

export function liveTradeHeaderStripSim(n: number) {
  return \`\uC2DC\uBBAC \${n}\uAC1C\`;
}
`;

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, src, "utf8");
console.log("wrote", out);
