# HANDOFF — Phase 2 착수용 (갱신: 2026-07-02)

> 신규 세션은 이 파일 → `CLAUDE.md` → `docs/plan.html` 순으로 읽고 바로 Phase 2를 시작하면 된다.
> 권장 세션 설정: **모델 Fable 5 · effort high** (Phase 게이트 리뷰 시점에만 xhigh/ultracode로 상향).

## 1. 어디까지 왔나

- **Phase 0 완료 (2026-07-02)** — 블라인드 에이전트 6개 E2E, 마커 지목 9/9 → CapNote v1 스펙 동결. 근거: `docs/phase0-verification.md`, 재현물: `spike/phase0/`
- **Phase 1 완료 (2026-07-02)** — 워킹 스켈레톤 실기기 검증 완주:
  - ⌥⇧C(또는 트레이 메뉴) → `screencapture -i` 드래그/Space 창 모드/ESC 취소 → always-on-top 프리뷰 창 → ⌘⏎ 경로-only 클립보드 → 직전 앱 포커스 자동 복귀 → ⌘V로 Claude Code가 `~/.capnote/*.png` 경로를 이미지로 수신 확인.
  - `tsc --noEmit` · `eslint --quiet` · `cargo check` 모두 클린.
- 코드 구조 (전부 Phase 1에서 생성):
  - `src-tauri/src/lib.rs` — 앱 셋업(Accessory 정책·트레이·⌥⇧C 등록+실패 폴백), 커맨드 6종(`show_capture_window`, `copy_path_and_restore`, `dismiss_window`, `get_app_status`, `run_test_capture`, `open_screen_recording_settings`)
  - `src-tauri/src/capture.rs` — screencapture 스폰 래퍼 (ESC=파일 미생성, TCC=exit 1+"could not create image"), `~/.capnote/YYYY-MM-DD-HHMMSS.png` 저장(충돌 시 `-n` 접미), 테스트 캡처 픽셀 균일성 검증
  - `src-tauri/src/macos.rs` — frontmost 앱 기억·복귀 (objc2-app-kit NSWorkspace/NSRunningApplication, TCC 프롬프트 없음)
  - `src/main.ts` — 캡처 프리뷰(이미지 논리 크기로 창 리사이즈)·TCC 온보딩 뷰·키 바인딩(⌘⏎/Esc)
  - 이미지 표시는 asset protocol (`$HOME/.capnote/**` 스코프, `tauri.conf.json`)
- 커밋 흐름: `dev` ← `feature/phase1-working-skeleton` 머지 완료. 원격 없음(로컬 전용).
- Phase 1의 실측 발견:
  1. **macOS 14+ 협조적 활성화로 포커스 복귀 동작** — `activateWithOptions(empty)`로 충분 (`ActivateIgnoringOtherApps`는 deprecated·무효). 우리 창이 frontmost일 때 호출되므로 성립.
  2. **동시 인터랙티브 캡처 불가** — 앱 인스턴스 2개가 동시에 screencapture를 띄우면 `cannot run two interactive screen captures at a time` (exit 1, stderr). 인스턴스 내 재진입은 `capturing` 플래그로 방어했으나 **싱글 인스턴스 강제는 없음** → Phase 3 폴리싱 후보(`tauri-plugin-single-instance`). dev 중 `tauri dev` 이중 실행에 주의.
  3. dev 모드 TCC 권한은 터미널(cmux)에 귀속 — 재빌드해도 유지되나 서명 변경 시 리셋 리스크는 여전(plan.html §10).
- 플러그인 버전 핀: `tauri-plugin-global-shortcut`·`tauri-plugin-clipboard-manager` `=2.3.2` (Cargo.toml). 업그레이드는 의도적으로만.

## 2. 지금 할 일 — Phase 2 어노테이션 + CapNote (예상 2~3 active-day)

목표: **대표 시나리오(Figma 디테일 피드백)를 실사용 가능하게** — 마커 3개짜리 피드백을 ~10초에 생성해 에이전트가 정확히 수정. 상세·완료 기준은 plan.html §8 Phase 2 행, 문법·번인·좌표 정책은 §4~5 (단일 출처, 스펙 동결).

착수 체크리스트 (독립 모듈이 많아 서브에이전트 스워밍 적합 — 위임은 Sonnet):

1. **1568px 다운스케일 파이프라인** — 장변 ≤1568 PNG, Retina @2x는 1/2, 작은 크롭 네이티브 유지, 업스케일 금지 (불변식 3). 좌표계는 저장본 픽셀 하나로 통일 (불변식 2)
2. **스마트 툴 3종 + 단일 번호 시퀀스** — point/rect/arrow가 하나의 자동 증가 번호 공유, 삭제 시 재정렬 (불변식 5). Canvas 2D 어노테이터
3. **인라인 노트 팝오버** — 마커 찍은 직후 그 자리에서 입력, 노트는 텍스트 채널 전용(번인 안 함)
4. **번인 렌더러** — 다운스케일 후 최종 해상도에서: 배지 8~12px 오프셋+리더 라인, rect 점선+2px 아웃셋, point 링 (불변식 4, 동결된 스타일)
5. **CapNote v1 인코더** — 동결 문법(plan.html §4): 헤더(`image:`/`size:` 실측/`scale:`/`source:`/`context:`) + `[n]` 엔트리 + hint v2. ⌘⏎가 경로-only 대신 CapNote 블록 전체를 복사하도록 교체
6. **파일 GC** — 앱 시작 시 14일 경과 또는 500개 초과분 정리
7. **E2E 검증** — 실제 앱 산출물로 Claude Code 붙여넣기, 마커 3종 지목 확인 (Phase 0 방식. 블라인드 검증 1회 권장)

**Electron 탈출 조건(사전 합의)**: Tauri 플러그인 엣지 케이스로 2 active-day 이상 소모되면 Electron 전환. Phase 1에서는 플러그인 이슈 0건이었다.

## 3. 사용자 개입이 필요한 지점 (해당 시점에 요청)

- 어노테이션 UI 실사용 피드백 (마커 찍기 → 노트 입력 → ⌘⏎까지 체감 속도)
- E2E: 생성된 CapNote 블록을 실제 Claude Code에 ⌘V — 에이전트의 마커 지목 정확성 확인
- 대화형 명령은 사용자가 프롬프트에 `! <command>` 로 직접 실행하면 출력이 세션에 들어온다

## 4. 규칙 리마인드 (근거 문서)

- **불변식 5개는 CLAUDE.md가 원문** — 위반 금지. CapNote 문법·번인·좌표 정책의 단일 출처는 plan.html §4~5. **스펙은 동결됨: 문법 변경은 v1.1 제안으로만.**
- CapNote/번인 렌더러/좌표 파이프라인 변경 시 **실제 Claude Code 붙여넣기 E2E 검증** 필수
- git: `git checkout -b feature/<name> dev` → 작업 → `dev`에 `--no-ff` 머지 (원격이 생기면 push -u + dev 대상 PR)
- 완료 보고 전 `pnpm check` + `pnpm lint` + `cargo check`
- **Phase 완료 시 갱신 3종 세트**: ① plan.html 상단 진행 트래커(HTML 주석에 갱신 항목 6개) ② README 로드맵 표 ③ 검증 리포트/체크박스 + 이 HANDOFF 갱신

## 5. Phase 2 이후 예고

- Phase 3 (2~3d): 속도 폴리싱(<300ms 창 표시), 키보드-온리 완주, 히스토리 10건, 멀티모니터/스케일팩터 좌표 정확성, 설정(단축키/경로/보존), 터미널 3종(iTerm2/Terminal/VS Code) 붙여넣기 실측, 에이전트 지목 정확도 평가·hint 튜닝, 싱글 인스턴스 가드, 서명·공증 DMG.
