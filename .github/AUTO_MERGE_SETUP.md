# 비공개·무료 저장소에서 오토 머지 쓰기

이 저장소에는 두 가지가 있습니다.

1. **GitHub 기본 오토 머지** — PR 화면의 **Enable auto-merge** (조건 충족 시 GitHub가 머지)
2. **Actions 자동 머지** — `.github/workflows/auto-merge-cursor-prs.yml` (에이전트 PR 등)

---

## 1. 저장소 공통 설정 (소유자 / Admin)

### 1-1 Pull Requests

1. GitHub → **저장소** → **Settings** → **General**
2. 아래쪽 **Pull requests** 섹션
   - **Allow auto-merge** ✅
   - 사용할 머지 방식 중 **Allow squash merging** ✅ (권장)

### 1-2 Actions 가 PR 을 머지할 때 (워크플로 2번용)

1. **Settings** → **Actions** → **General**
2. **Workflow permissions** → **Read and write permissions** 선택
3. (표시되면) **Allow GitHub Actions to create and approve pull requests** — 브랜치 보호 때문에 막히면 켜 보기

---

## 2. `main` 브랜치 보호 (기본 오토 머지 UI 띄우기)

GitHub 문서: **Enable auto-merge** 는 PR 이 **지금 당장 머지될 수 없을 때**만 보입니다.  
가장 흔한 이유는 **필수 상태 검사(CI)** 또는 **필수 리뷰**입니다.

이 저장소의 PR 은 워크플로 **PR check** (`pr-check` job)가 돌아갑니다.

### 2-1 클래식 브랜치 보호 규칙

1. **Settings** → **Branches** → **Branch protection rules** → **Add rule** (또는 `main` 규칙 편집)
2. **Branch name pattern**: `main`
3. 권장 옵션:
   - **Require a pull request before merging** ✅  
     - **Required number of approvals before merging**: 가능하면 **0** (UI 에서 0 이 안 되면 1 로 두고 본인이 Approve 하거나, Rulesets 로 조정)
   - **Require status checks to pass before merging** ✅  
     - **Status checks that are required** 에서 검색 후 추가: **`pr-check`** (워크플로 이름이 `PR check`, job 이름이 `pr-check` 이면 목록에 `pr-check` 또는 `PR check / pr-check` 형태로 보일 수 있음 — 한 번 PR 을 열어 CI 가 돈 뒤 목록에서 고르는 것이 확실합니다.)
   - (선택) **Require branches to be up to date before merging** — 엄격하게 맞추고 싶을 때

4. **Create** / **Save changes**

> 첫 PR 이 merge 되기 전에는 필수 체크 목록에 `pr-check` 가 안 보일 수 있습니다. **임시 PR 하나**를 열어 워크플로가 한 번 성공한 뒤, 브랜치 보호에서 체크를 지정하세요.

### 2-2 Repository rules (Rulesets) 사용 시

같은 내용을 **Rulesets** 로도 설정할 수 있습니다. 조직 정책에 따라 여기만 허용되는 경우가 있습니다.

---

## 3. PR 에서 기본 오토 머지 켜기

1. **Pull requests** → 해당 PR
2. CI 가 초록이 될 때까지 대기 (필수 체크가 있으면)
3. **Enable auto-merge** → 방식(Squash 등) 선택 → **Confirm auto-merge**

필수 리뷰가 1 이상이면, 그만큼 Approve 가 나와야 머지됩니다.

---

## 4. 에이전트 PR Actions 자동 머지

1. **`cursor/**` 브랜치에 푸시**되면 워크플로 **Open PR for cursor branches** 가 기본 브랜치로 향하는 **열린 PR 이 없을 때 PR 을 자동 생성**합니다. (이미 Draft PR 만 있으면 `gh pr ready` 로 전환합니다.)
2. 그 다음 워크플로 **Auto-merge Cursor agent PRs** 가 `pull_request` 이벤트로 **Draft 면 먼저 Ready 로 바꾼 뒤** 머지를 시도합니다.

- head 브랜치가 **`cursor/`** 로 시작하는 PR (위 1에서 생성되거나 수동으로 연 PR)  
- 또는 PR에 라벨 **`cursor-auto-merge`** 를 붙이면 (라벨은 저장소에 한 번 생성)

필수 리뷰 때문에 `GITHUB_TOKEN` 이 막히면 **Settings → Secrets → Actions** 에 `AUTO_MERGE_TOKEN` (PAT, `contents` + `pull-requests`) 을 추가합니다.

---

## 5. 무료·비공개에서의 참고

- **비공개 + 무료**여도 위 기능은 **일반적으로 동일**합니다. (조직 무료 플랜은 조직 설정으로 Actions 가 막힐 수 있음.)
- **Actions 분**은 계정 한도 내에서 소모됩니다.
- **필수 체크 이름**은 GitHub UI 에 표시되는 그대로 선택해야 합니다. 애매하면 PR → **Checks** 탭에서 정확한 이름을 확인하세요.

---

## 6. API 키·토큰 (Git 에 올리지 않기)

- **커밋 가능:** `.env.example` 만 (값 비움).
- **로컬만:** 프로젝트 루트 `.env` 또는 **`.env.local`** 에 실제 값을 넣습니다. 둘 다 `.gitignore` 에 포함되어 있으며, **`.env.local` 이 있으면 같은 키는 여기 값이 우선**합니다 (`server/load-env.js`).
- PR 에 `.env` / `.env.local` / `.pem` 이 들어가면 워크플로 **Block secret files in PR** 이 실패합니다.
- 과거에 키가 커밋·푸시된 적이 있으면 **키를 즉시 폐기·재발급**하고, 필요 시 `git filter-repo` 등으로 히스토리에서 제거해야 합니다 (이 저장소만으로는 대신 해 줄 수 없음).
