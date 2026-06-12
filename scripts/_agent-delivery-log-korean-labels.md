운영 로그 한글 설명 — 적용

요청: 로그만 보면 뭔지 모르겠다 → 앞으로 한글 설명 붙이기

변경
1. server/ops-tool-log-ko.js — 도구명·상태·인자를 한글 한 줄로
   예: [파일 읽기] 완료 — 파일: src/App.tsx
   (기존 Read (completed) — {"path":...} 대체)

2. server/cursor-ops-agent.js — 에이전트 진행 저장 시 위 포맷 사용

3. src/lib/opsToolLogKo.ts + OpsManagementTab — 예전 영문 이력도 표시 시 보강

4. ko.ts — «지금 하는 작업», «에이전트가 한 작업» 라벨

5. .cursor/rules/log-korean-labels.mdc — 이후 로그 추가 시 규칙

서버 재시작 후 새 에이전트 실행부터 한글 도구 로그가 쌓입니다.
