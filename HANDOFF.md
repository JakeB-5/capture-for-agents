# HANDOFF — Phase 1 착수용 (작성: 2026-07-02)

> 신규 세션은 이 파일 → `CLAUDE.md` → `docs/plan.html` 순으로 읽고 바로 Phase 1을 시작하면 된다.
> 권장 세션 설정: **모델 Fable 5 · effort high** (Phase 게이트 리뷰 시점에만 xhigh/ultracode로 상향).

## 1. 어디까지 왔나

- 저장소는 **문서만 있는 그린필드, 제품 코드 0줄**. 현재 브랜치 `dev` 클린, `main`은 초기 커밋 상태.
- 완료된 것:
  1. **설계 문서 3종** — CLAUDE.md / README.md / docs/plan.html (ELI10 작업계획서, SVG 6종 + 상단 진행 트래커)
  2. **Phase 0 포맷 검증 (2026-07-02)** — 블라인드 에이전트 6개로 E2E 검증, 마커 지목 9/9 · 파싱 무오류 → **CapNote v1 스펙 동결**. 동결 시 수정 4건(`scale:` 헤더, 선택적 `"라벨"`, hint v2, 번인 스타일: rect 점선+2px 아웃셋·point 링)은 세 문서에 반영 완료. 근거: `docs/phase0-verification.md`, 재현물: `spike/phase0/`
- 커밋 흐름: `main`(8aecd13 초기 커밋) → `dev`에 Phase 0 검증(e11bb75)·진행 트래커(ac84cd8) 머지 완료. 원격 없음(로컬 전용).
- Phase 0의 부수 발견: TCC 미승인 시 `screencapture`는 **exit 1 + "could not create image from display"** 로 감지 가능하게 실패한다 → 온보딩/래퍼 설계에 사용할 것.
- 테스트 산출물 `~/.capnote/2026-07-02-181000.png`가 남아 있음 (검증용, 지워도 무방).

## 2. 지금 할 일 — Phase 1 워킹 스켈레톤 (예상 1~2 active-day)

목표: **단축키 → 캡처 → 창 표시 → ⌘Enter(경로-only 텍스트 복사) → 직전 앱 포커스 복귀** 루프를 최단 경로로 관통시키고, 리스크(TCC·포커스·플러그인)를 최전방에서 검증. 상세·완료 기준은 plan.html §8 Phase 1 행.

착수 체크리스트:

1. `create-tauri-app` 스캐폴드 (pnpm + TypeScript) — **완료 즉시 CLAUDE.md "빌드/개발 커맨드" 섹션을 실제 커맨드로 갱신** (지금은 '예정' 표기)
2. 메뉴바(트레이) 상주 + `global-shortcut` 플러그인: 기본 ⌥⇧C, 등록 실패 감지 시 대체 키 제안 + 트레이 메뉴 폴백. 플러그인 버전 핀.
3. `screencapture` 스폰 래퍼: `/usr/sbin/screencapture -i -x -o -t png <tmpfile>` — ESC 취소는 파일 미생성으로, TCC 미승인은 exit 1로 감지
4. 캡처 이미지 표시 창 (always-on-top, 이미지 크기, 어노테이션은 Phase 2)
5. 경로-only 클립보드 (`clipboard-manager`, writeText만 사용 — 불변식 1: 이미지 클립보드 금지)
6. frontmost 앱 기억 → 복사 후 명시적 재활성화
7. TCC 온보딩: 테스트 캡처의 픽셀 검증 + 시스템 설정 딥링크

**Electron 탈출 조건(사전 합의)**: Tauri 플러그인 엣지 케이스로 2 active-day 이상 소모되면 Electron 전환. 이 결정을 미루지 말 것.

## 3. 사용자 개입이 필요한 지점 (자동화 불가 — 미리 물어보지 말고 해당 시점에 요청)

- TCC "화면 기록" 승인 프롬프트 클릭 (dev 모드에선 권한이 터미널/IDE에 귀속되는 점 주의)
- `screencapture -i` 대화형 확인: 드래그 선택, Space 창 모드 토글, ESC 취소 → `docs/phase0-verification.md` §6 체크박스 갱신
- 대화형 명령은 사용자가 프롬프트에 `! <command>` 로 직접 실행하면 출력이 세션에 들어온다

## 4. 규칙 리마인드 (근거 문서)

- **불변식 5개는 CLAUDE.md가 원문** — 위반 금지. CapNote 문법·번인·좌표 정책의 단일 출처는 plan.html §4~5. **스펙은 동결됨: 문법 변경은 v1.1 제안으로만.**
- CapNote/번인 렌더러/좌표 파이프라인 변경 시 **실제 Claude Code 붙여넣기 E2E 검증** 필수 (Phase 0 방식 재사용: `spike/phase0/` 참조. Phase 2 완료 시엔 픽스처가 아닌 실제 앱 산출물로 블라인드 검증 1회 권장)
- git: `git checkout -b feature/<name> dev` → 작업 → `dev`에 `--no-ff` 머지 (원격이 생기면 push -u + dev 대상 PR)
- 완료 보고 전 `tsc --noEmit` + `eslint --quiet` (스캐폴드 후부터)
- **Phase 완료 시 갱신 3종 세트**: ① plan.html 상단 진행 트래커(HTML 주석에 갱신 항목 6개 명시됨) ② README 로드맵 표 ③ 검증 리포트/체크박스

## 5. Phase 1 이후 예고

- Phase 2 (2~3d): 스마트 툴 3종 + 단일 번호 시퀀스, 인라인 노트, 번인 렌더러(동결된 스타일 규칙 적용), 1568px 다운스케일, CapNote v1 인코더, 파일 GC(14일/500개). 독립 모듈이 많아 서브에이전트 스워밍(위임은 Sonnet) 적합.
- Phase 3 (2~3d): 속도 폴리싱, 히스토리, 멀티모니터 좌표, 설정, 터미널 3종 실측, 에이전트 지목 정확도 평가, 서명·공증 DMG.
