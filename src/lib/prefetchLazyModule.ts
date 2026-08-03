/** 메인 탭 lazy 청크를 미리 받아 두어「불러오는 중」빈 화면을 줄인다. */
export function prefetchLazyModule(loader: () => Promise<unknown>): void {
  try {
    const p = loader();
    if (p && typeof (p as Promise<unknown>).then === "function") {
      (p as Promise<unknown>).catch(() => {});
    }
  } catch {
    /* ignore */
  }
}
