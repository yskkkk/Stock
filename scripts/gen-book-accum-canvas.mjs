/**
 * scripts/book-accum-examples-30.json → Cursor canvas
 * node scripts/gen-book-accum-canvas.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";

const data = JSON.parse(
  readFileSync("scripts/book-accum-examples-30.json", "utf8"),
);
const embedded = JSON.stringify(data.examples);

const canvas = `import {
  Card,
  CardBody,
  CardHeader,
  Grid,
  H1,
  H2,
  Stack,
  Text,
  useHostTheme,
} from "cursor/canvas";

type Candle = { date: string; o: number; h: number; l: number; c: number; v: number };
type Example = {
  symbol: string;
  name: string;
  market: string;
  signalDate: string;
  score: number;
  rvol: number | null;
  signalIndex: number;
  candles: Candle[];
};

const EXAMPLES: Example[] = ${embedded};

const CHART_W = 168;
const CHART_H = 76;
const PAD = 5;

function MiniCandles({
  candles,
  signalIndex,
}: {
  candles: Candle[];
  signalIndex: number;
}) {
  const theme = useHostTheme();
  if (!candles.length) return null;

  const min = Math.min(...candles.map((c) => c.l));
  const max = Math.max(...candles.map((c) => c.h));
  const range = max - min || 1;
  const innerW = CHART_W - PAD * 2;
  const innerH = CHART_H - PAD * 2;
  const barW = innerW / candles.length;

  return (
    <svg
      width={CHART_W}
      height={CHART_H}
      aria-label="매집봉 주변 OHLC"
      style={{ display: "block" }}
    >
      <line
        x1={PAD}
        y1={CHART_H - PAD}
        x2={CHART_W - PAD}
        y2={CHART_H - PAD}
        stroke={theme.stroke.tertiary}
        strokeWidth={1}
      />
      {candles.map((c, i) => {
        const x = PAD + i * barW + barW / 2;
        const y = (v: number) => PAD + ((max - v) / range) * innerH;
        const yH = y(c.h);
        const yL = y(c.l);
        const yO = y(c.o);
        const yC = y(c.c);
        const top = Math.min(yO, yC);
        const bodyH = Math.max(1, Math.abs(yC - yO));
        const isSignal = i === signalIndex;
        const bull = c.c >= c.o;
        const wickColor = isSignal ? theme.accent.primary : theme.text.quaternary;
        const bodyColor = isSignal
          ? theme.accent.primary
          : bull
            ? theme.text.secondary
            : theme.text.tertiary;
        return (
          <g key={c.date}>
            <line x1={x} y1={yH} x2={x} y2={yL} stroke={wickColor} strokeWidth={1} />
            <rect
              x={x - Math.max(1.5, barW * 0.28)}
              y={top}
              width={Math.max(3, barW * 0.56)}
              height={bodyH}
              fill={bodyColor}
            />
          </g>
        );
      })}
    </svg>
  );
}

function ExampleCard({ ex }: { ex: Example }) {
  const theme = useHostTheme();
  const sig = ex.candles[ex.signalIndex];
  const upperPct =
    sig && sig.h > sig.l
      ? Math.round(((sig.h - Math.max(sig.o, sig.c)) / (sig.h - sig.l)) * 100)
      : 0;
  const bodyPct =
    sig && sig.h > sig.l
      ? Math.round((Math.abs(sig.c - sig.o) / (sig.h - sig.l)) * 100)
      : 0;

  return (
    <Card size="sm">
      <CardHeader trailing={\`\${ex.score}pt\`}>
        {\`\${ex.name} \${ex.symbol.replace(/\\.KS$/, "")}\`}
      </CardHeader>
      <CardBody>
        <Text size="sm" tone="tertiary" style={{ marginBottom: 4 }}>
          {\`\${ex.signalDate} · RVOL \${ex.rvol ?? "-"} · 윗꼬리 \${upperPct}% · 몸통 \${bodyPct}%\`}
        </Text>
        <MiniCandles candles={ex.candles} signalIndex={ex.signalIndex} />
        <Text size="sm" tone="quaternary" style={{ marginTop: 6 }}>
          {\`신호봉 O \${sig?.o?.toLocaleString()} H \${sig?.h?.toLocaleString()} L \${sig?.l?.toLocaleString()} C \${sig?.c?.toLocaleString()} V \${sig?.v?.toLocaleString()}\`}
        </Text>
      </CardBody>
    </Card>
  );
}

export default function BookAccumExamplesCanvas() {
  const theme = useHostTheme();
  return (
    <Stack gap={4} style={{ padding: 16, maxWidth: 920 }}>
      <Stack gap={1}>
        <H1>매집봉 실제 예시 30건</H1>
        <Text tone="secondary">
          서버 preset 「느슨」·일봉 · KR 유니버스 스캔 · 신호일 기준 전후 OHLC (Yahoo)
        </Text>
        <Text size="sm" tone="tertiary">
          Source: scripts/book-accum-examples-30.json · generated ${data.generatedAt.slice(0, 10)}
        </Text>
      </Stack>
      <H2>종목별 미니 캔들 (▲ = 매집 신호봉)</H2>
      <Grid columns={3} gap={3}>
        {EXAMPLES.map((ex) => (
          <ExampleCard key={ex.symbol + ex.signalDate} ex={ex} />
        ))}
      </Grid>
      <Text size="sm" tone="quaternary" style={{ borderTop: \`1px solid \${theme.stroke.tertiary}\`, paddingTop: 8 }}>
        각 패널: 신호봉 전 12봉 + 신호 + 후 3봉. accent 색 = detectBookAccumulationLatest 확정봉.
      </Text>
    </Stack>
  );
}
`;

const out =
  "C:/Users/samro/.cursor/projects/c-Stock/canvases/book-accum-examples-30.canvas.tsx";
writeFileSync(out, canvas, "utf8");
console.log("Wrote", out);
