import { useCallback, useEffect, useMemo, useState } from "react";
import type { Market } from "../types";
import {
  analyzeLogoNeedsDarkPlate,
  isKnownLightLogoSymbol,
  stripLogoNearWhiteBackground,
} from "../lib/stockLogoContrast";

export default function StockLogoWithPlate({
  symbol,
  market,
  src,
  imgClassName = "",
  wrapClassName = "",
  width,
  height,
  loading = "lazy",
  transparentWrap = false,
  stripWhiteBackground = false,
  onError,
}: {
  symbol: string;
  market: Market;
  src: string;
  imgClassName?: string;
  wrapClassName?: string;
  width: number;
  height: number;
  loading?: "lazy" | "eager";
  /** true면 배경판·어두운 패드 없이 로고만 */
  transparentWrap?: boolean;
  /** FMP 흰 사각 배경 제거·선명화 (CORS 실패 시 multiply 폴백) */
  stripWhiteBackground?: boolean;
  onError?: () => void;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const [displaySrc, setDisplaySrc] = useState(src);
  const [stripFallback, setStripFallback] = useState(false);
  const [needsDarkPlate, setNeedsDarkPlate] = useState(
    () => !transparentWrap && isKnownLightLogoSymbol(symbol, market),
  );

  useEffect(() => {
    setDisplaySrc(src);
    setStripFallback(false);
  }, [src]);

  useEffect(() => {
    if (!stripWhiteBackground) return;
    let cancelled = false;
    const probe = new Image();
    probe.crossOrigin = "anonymous";
    probe.onload = () => {
      if (cancelled) return;
      const stripped = stripLogoNearWhiteBackground(probe, {
        size: Math.max(width, height) * 2,
        sharpen: 1.14,
      });
      if (stripped) {
        setDisplaySrc(stripped);
        setStripFallback(false);
      } else {
        setDisplaySrc(src);
        setStripFallback(true);
      }
    };
    probe.onerror = () => {
      if (!cancelled) {
        setDisplaySrc(src);
        setStripFallback(true);
      }
    };
    probe.src = src;
    return () => {
      cancelled = true;
      probe.onload = null;
      probe.onerror = null;
    };
  }, [src, stripWhiteBackground, width, height]);

  useEffect(() => {
    if (transparentWrap || stripWhiteBackground || needsDarkPlate || isKnownLightLogoSymbol(symbol, market)) {
      return;
    }
    const probe = new Image();
    probe.crossOrigin = "anonymous";
    probe.onload = () => {
      if (analyzeLogoNeedsDarkPlate(probe)) {
        setNeedsDarkPlate(true);
      }
    };
    probe.onerror = () => {
      /* CORS·404 — known-symbol 폴백만 사용 */
    };
    probe.src = src;
    return () => {
      probe.onload = null;
      probe.onerror = null;
    };
  }, [src, symbol, market, needsDarkPlate, transparentWrap]);

  const wrapClasses = useMemo(() => {
    const parts = [wrapClassName, "stock-logo-plate"];
    if (transparentWrap) {
      parts.push("stock-logo-plate--transparent");
    } else if (needsDarkPlate) {
      parts.push("stock-logo-plate--dark");
    }
    if (stripWhiteBackground && stripFallback) {
      parts.push("stock-logo-plate--white-strip-fallback");
    }
    return parts.filter(Boolean).join(" ");
  }, [wrapClassName, needsDarkPlate, transparentWrap, stripWhiteBackground, stripFallback]);

  const handleError = useCallback(() => {
    setImgFailed(true);
    onError?.();
  }, [onError]);

  if (imgFailed) return null;

  return (
    <span className={wrapClasses}>
      <img
        className={imgClassName}
        src={displaySrc}
        alt=""
        width={width}
        height={height}
        loading={loading}
        decoding="async"
        onError={handleError}
      />
    </span>
  );
}
