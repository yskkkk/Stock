/**
 * main.tsx 최상단에서 import — React 트리 마운트 전에
 * 지수 벨트·지표/실적 API를 페이지와 동시에 시작한다.
 */
import { startShellCriticalPrefetch } from "./tabPrefetch";

startShellCriticalPrefetch();
