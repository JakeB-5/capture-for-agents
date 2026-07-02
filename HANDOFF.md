# HANDOFF — Phase 3 착수용 (갱신: 2026-07-02)

> 신규 세션은 이 파일 → `CLAUDE.md` → `docs/plan.html` 순으로 읽고 바로 Phase 3를 시작하면 된다.
> 권장 세션 설정: **모델 Fable 5 · effort high** (Phase 게이트 리뷰 시점에만 xhigh/ultracode로 상향).

## 1. 어디까지 왔나

- **Phase 0 완료 (2026-07-02)** — 블라인드 에이전트 6개 E2E, 마커 지목 9/9 → CapNote v1 스펙 동결. 근거: `docs/phase0-verification.md`
- **Phase 1 완료 (2026-07-02)** — 워킹 스켈레톤: ⌥⇧C → screencapture → 프리뷰 → 클립보드 → 포커스 복귀 실기기 완주.
- **Phase 2 완료 (2026-07-02)** — 어노테이션 + CapNote 실기기 E2E 검증 완주 (`docs/phase2-verification.md`):
  - 캡처 → 스마트 툴(클릭=point/드래그=rect/⇧드래그=arrow, 1/2/3/A 전환) → 인라인 노트 팝오버 → ⌘⏎ 원샷 커밋(번인→1568px 다운스케일→PNG 저장→CapNote 블록 클립보드→포커스 복귀) → 실제 Claude Code ⌘V → 블라인드 에이전트 마커 3종 지목 확인.
  - 사용자 실사용 판정: 마커 의도 일치 · 체감 속도 문제없음.
  - `pnpm check` · `pnpm lint` · `cargo check` · `pnpm build` 클린. 인코더는 동결 표준 예시와 바이트 단위 일치(순수 로직 스모크).
- 코드 구조 (Phase 2에서 추가/변경):
  - `src/annotations.ts` — 모델 + `AnnotationStore` (단일 번호 시퀀스 = 배열 순서, 삭제 시 자동 재정렬, 언두 스택)
  - `src/downscale.ts` — `planDownscale` (장변 ≤1568 · @2x→1/2 · 작은 크롭 네이티브 · 업스케일 금지)
  - `src/capnote.ts` — 동결 문법 인코더 (hint v2 원문 포함. **문법 변경 = v1.1 제안으로만**)
  - `src/burnin.ts` — 번인 렌더러 + `hitTest`/`badgeCenter`. 프리뷰·번인·히트테스트가 `badgePlacement` 하나를 공유(WYSIWYG)
  - `src/annotator.ts` — 캔버스 에디터 (포인터 제스처, 팝오버, 선택/삭제/언두, 커밋 파이프라인)
  - `src-tauri/src/lib.rs` — 커맨드 추가: `load_capture_png`(base64 로드), `save_annotated_png`(경로 검증+PNG 매직 체크), `copy_text_and_restore`(구 copy_path_and_restore 대체), `discard_capture`(ESC 취소). 시작 시 GC 스레드
  - `src-tauri/src/capture.rs` — PNG pHYs로 @2x 감지(`capture-done` 페이로드 `{path, scale}`), `gc_capnote_dir`(14일/500개), `is_capnote_png` 경로 가드
- 커밋 흐름: `dev` ← `feature/phase2-annotation-capnote` `--no-ff` 머지 (구현 `10e521c` → taint 수정 `14bf1d1` → 문서). 원격 없음(로컬 전용).
- **Phase 2의 실측 발견 3건** (상세: `docs/phase2-verification.md` §3):
  1. **asset protocol은 캔버스를 taint시킴** — `convertFileSrc` 이미지는 교차 출처라 `toBlob()`이 SecurityError. 캡처 로드는 `load_capture_png` IPC(base64 → same-origin `data:` URL)로 교체했고 **asset protocol 설정·기능 플래그는 제거됨**. 이미지 픽셀을 읽는 코드를 추가할 때 asset protocol로 되돌아가지 말 것.
  2. **Claude Code가 붙여넣은 텍스트 속 이미지 경로를 자동으로 이미지 첨부로 치환** — `image:` 라인이 비어 보이는 게 정상(첨부 source가 그 경로). 시각 채널 자동 도착. 외부 가정(리스크 #8)으로 거동 변경 감시.
  3. **배지가 밀집 텍스트에서 이웃 줄을 가림** (리스크 #5 실측) — 충돌 회피 배치는 Phase 3 항목.
- 플러그인 버전 핀: `tauri-plugin-global-shortcut`·`tauri-plugin-clipboard-manager` `=2.3.2`. Phase 1~2 플러그인 이슈 0건 (Electron 탈출 조건 미발동).
- dev 실행 주의: `pnpm tauri dev` 이중 실행 금지(포트 1420 + 동시 인터랙티브 캡처 불가). 잔여 프로세스는 `lsof -nP -i :1420`과 `pgrep -fl capture-for-agents`로 확인 후 정리.

## 2. 지금 할 일 — Phase 3 폴리싱·견고화 (예상 2~3 active-day)

목표: **매일 쓰는 도구의 신뢰성 + 배포 가능 상태.** 완료 기준: 지목 정확도 평가 통과 + 서명·공증 DMG (plan.html §8 Phase 3 행).

착수 체크리스트:

1. **속도** — 캡처 후 어노테이션 창 표시 <300ms 실측·튜닝 (현재 base64 IPC 로드 경유 — 대형 캡처에서 병목이면 여기부터)
2. **키보드-온리 완주** — 캡처→마커→노트→커밋 전 과정 마우스 없이(마커 배치 키보드 이동 등은 과설계 주의 — 최소로)
3. **히스토리 10건** — 최근 캡처 재어노테이션 + 다시 복사 (트레이 메뉴 or 팔레트)
4. **멀티모니터/스케일팩터 좌표 정확성** — @1x/@2x 혼합 환경에서 PNG 실측 기반 검증 (pHYs 감지가 모니터별로 옳은지)
5. **배지 충돌 회피 배치** — Phase 2 실측 발견 3. 배지 후보 방향 선택 시 다른 배지·도형과의 겹침 페널티
6. **싱글 인스턴스 가드** — `tauri-plugin-single-instance` (버전 핀 관례 유지)
7. **설정** — 단축키 / 저장 경로 / 보존 정책(14일·500개)
8. **터미널 3종 실측** — iTerm2 / Terminal / VS Code에 CapNote 멀티라인 ⌘V (bracketed paste 엣지, phase0-verification.md §6 체크박스 갱신)
9. **에이전트 지목 정확도 평가 + hint 튜닝** — Phase 0 방식 블라인드 배치로 정량화, hint 문구 조정은 스펙 동결 범위 내(문법 불변)
10. **서명·공증 DMG** — 안정적 서명으로 TCC 리셋 리스크 완화(리스크 #1). 공증 파이프라인은 Apple Developer 계정 필요(사용자 개입)

**Electron 탈출 조건(사전 합의)**: Tauri 플러그인 엣지 케이스로 2 active-day 이상 소모되면 Electron 전환.

## 3. 사용자 개입이 필요한 지점 (해당 시점에 요청)

- 실기기 실측 전반: 창 표시 속도 체감, 멀티모니터 구성, 터미널 3종 붙여넣기, TCC 재승인 관찰
- 서명·공증: Apple Developer 계정/인증서 준비
- 대화형 명령은 사용자가 프롬프트에 `! <command>` 로 직접 실행하면 출력이 세션에 들어온다

## 4. 규칙 리마인드 (근거 문서)

- **불변식 5개는 CLAUDE.md가 원문** — 위반 금지. CapNote 문법·번인·좌표 정책의 단일 출처는 plan.html §4~5. **스펙 동결: 문법 변경은 v1.1 제안으로만.**
- CapNote/번인 렌더러/좌표 파이프라인 변경 시 **실제 Claude Code 붙여넣기 E2E 검증** 필수
- git: `git checkout -b feature/<name> dev` → 작업 → `dev`에 `--no-ff` 머지 (원격이 생기면 push -u + dev 대상 PR)
- 완료 보고 전 `pnpm check` + `pnpm lint` + `cargo check`
- **Phase 완료 시 갱신 3종 세트**: ① plan.html 상단 진행 트래커(HTML 주석의 갱신 항목 6개) ② README 상태·로드맵 ③ 검증 리포트 + 이 HANDOFF 갱신

## 5. Phase 3 이후 예고 (Phase 4 백로그 — 필요 실증 시에만)

캡처 히스토리 팔레트, 클립보드 이미지 동시 탑재 옵션, capnote CLI / MCP 서버 모드(에이전트가 역으로 캡처 요청), 크로스플랫폼. CapNote v1.1 백로그는 `docs/phase0-verification.md` §5.
