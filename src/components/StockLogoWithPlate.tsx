import { useCallback, useEffect, useMemo, useState } from "react";
import type { Market } from "../types";
import {
  analyzeLogoNeedsDarkPlate,
  isKnownLightLogoSymbol,
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
  onError?: () => void;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const [needsDarkPlate, setNeedsDarkPlate] = useState(() =>
    isKnownLightLogoSymbol(symbol, market),
  );

  useEffect(() => {
    if (needsDarkPlate || isKnownLightLogoSymbol(symbol, market)) return;
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
  }, [src, symbol, market, needsDarkPlate]);

  const wrapClasses = useMemo(() => {
    const parts = [wrapClassName, "stock-logo-plate"];
    if (needsDarkPlate) parts.push("stock-logo-plate--dark");
    return parts.filter(Boolean).join(" ");
  }, [wrapClassName, needsDarkPlate]);

  const handleError = useCallback(() => {
    setImgFailed(true);
    onError?.();
  }, [onError]);

  if (imgFailed) return null;

  return (
    <span className={wrapClasses}>
      <img
        className={imgClassName}
        src={src}
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
