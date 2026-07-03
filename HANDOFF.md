# HANDOFF — Phase 0~3 완료 · 도그푸딩 체제 (갱신: 2026-07-03)

> 신규 세션은 이 파일 → `CLAUDE.md` → `docs/plan.html` 순으로 읽는다. **로드맵상 필수 작업은 남아 있지 않다** — 이후 작업은 (a) 도그푸딩에서 나온 개선, (b) 보류 1건(공증) 해제, (c) Phase 4 백로그(필요 실증 시에만) 중 하나다.

## 1. 현재 상태

- **Phase 0~3 전부 완료** (0·1·2: 2026-07-02, 3: 2026-07-03). 검증 리포트: `docs/phase0-verification.md` · `phase2-verification.md` · `phase3-verification.md`
- 제품 루프: ⌥⇧C(설정 가능) → screencapture → 어노테이션(스마트 툴 3종·인라인 노트·배지 충돌 회피) → ⌘⏎(번인→≤1568px 다운스케일→PNG 저장→`.capnote` 사이드카→CapNote 블록 클립보드→포커스 복귀) → ⌘V. 트레이: Capture / History 10건(Copy CapNote·Re-annotate) / Settings… / Quit.
- 릴리스 번들: `pnpm tauri build` → `.app` 9.8MB + DMG 3.5MB (aarch64, **ad-hoc 서명**). 도그푸딩은 릴리스 `.app`을 /Applications에 두고 쓰는 운용 권장(재빌드마다 TCC 재승인 리스크 회피).
- 커밋 흐름: `dev` ← `feature/phase3-polish` `--no-ff` 머지 완료(`03aafc4`; Wave A `36030a4` → Wave B `b0a762d` → 문서 `c9e206b`). 원격: `https://github.com/JakeB-5/capture-for-agents` (퍼블릭, 기본 브랜치 dev — 이후 브랜치는 `push -u origin <branch>` + dev 대상 PR).
- 코드 지도: `src/annotations|downscale|capnote|burnin|annotator.ts` + `src/main.ts` / `src-tauri/src/lib.rs`(커맨드 9종·트레이·GC 스레드) · `capture.rs`(스폰·pHYs 스케일·GC) · `settings.rs`(설정 로드/저장/라벨) · `macos.rs`(포커스 복귀)
- **Windows 이식 계획서 작성 완료 (07-03)**: `docs/plan-windows.html` — W0 착수 세션은 그 문서를 단일 출처로 읽을 것.
- **Phase W0 착수 (07-03, `feature/w0-spike`)**: §12 결정 0(착수 승인)은 사용자 지시로 해소. macOS에서 가능한 준비물 완료 — `spike/w0/` (공식 `resized_size()` 포트 · 테스트 12/12 · 번인 픽스처 · CapNote 붙여넣기 블록 5종 · winprobe 실측 바이너리) + `.github/workflows/windows-build.yml`(winprobe x64 아티팩트·프런트엔드 windows-latest 빌드). **잔여는 전부 Windows 실기기 검증** — 결정 1(기기 확보)·결정 2(네이티브/WSL 소비 환경) 대기. 절차: `spike/w0/README.md`, 기록처: `docs/w0-verification.md`(진행 중, §7에 macOS 사이드 확정 사실 3건 — 특히 참조 구현 반올림이 half-to-even이라 나이브 포팅 시 ±1px 드리프트). 참고: 계획 수립 중 Anthropic 비전 리사이즈가 "장변+비주얼 토큰 이중 제약"임이 확인됨 — 현행 macOS 다운스케일(1568 단일 규칙)의 백포트 여부는 별도 결정 항목(같은 문서 §6.2·§12).

## 2. 보류 1건 (해제 조건 명시)

1. **공증(notarization)** — Apple Developer 계정($99/yr) 확보 시: 서명 identity 발급 → `tauri.conf.json` `bundle.macOS.signingIdentity` + notarytool 파이프라인. 그 전까지 ad-hoc DMG로 충분(본인 기기 사용).
~~2. 멀티모니터 좌표 실측~~ — **2026-07-03 해제**: 외부 4K(@2x HiDPI) 모니터 캡처로 실측 통과 (pHYs 스케일 감지 정확·좌표 픽셀 일치·블라인드 4/4, `docs/phase3-verification.md` §1 #4). @1x 외부 모니터 케이스는 접하면 같은 방식으로 확인.

## 3. 누적 실측 발견 (재발 방지 노트)

1. **asset protocol은 캔버스를 taint** — 이미지 픽셀을 읽는 코드는 반드시 `load_capture_png` IPC(base64 → same-origin `data:` URL) 경유. asset protocol 설정은 제거된 상태.
2. **Claude Code는 붙여넣은 텍스트 속 이미지 경로를 자동으로 첨부로 치환** — `image:` 라인이 비어 보이는 게 정상 동작. 외부 가정(리스크 #8)으로 거동 변화 감시.
3. **재어노테이션 ESC는 파일을 지우면 안 됨** — `capture-done`의 `reannotate` 플래그가 이를 제어. History 관련 수정 시 유지할 것.
4. **동시 인터랙티브 캡처 불가** — 싱글 인스턴스 플러그인이 방어. dev 중 `tauri dev` 이중 실행은 포트 1420 충돌(잔여 프로세스: `lsof -nP -i :1420`, `pgrep -fl capture-for-agents`).
5. macOS 15+ TCC 주기적 재승인 빈도는 계속 관찰 항목 (phase0-verification.md §6).

## 4. Phase 4 백로그 (필요 실증 시에만 — plan.html §8)

캡처 히스토리 팔레트(UI) · 클립보드 이미지 동시 탑재 옵션 · capnote CLI / MCP 서버 모드(에이전트가 역으로 캡처 요청) · 크로스플랫폼(Windows 이식 계획서 작성 완료: `docs/plan-windows.html` — 착수는 여전히 실수요 실증 + 사용자 승인 게이트). CapNote v1.1 문법 백로그는 `docs/phase0-verification.md` §5 — **v1 문법은 동결, 변경은 v1.1 제안으로만.**

## 5. 규칙 리마인드

- 불변식 5개(CLAUDE.md 원문) 위반 금지. 문법·번인·좌표 정책 단일 출처는 plan.html §4~5.
- CapNote/번인/좌표 파이프라인 변경 시 실제 Claude Code ⌘V E2E 필수.
- git: `feature/<name>` ← dev 분기 → dev로 `--no-ff` 머지. 완료 보고 전 `pnpm check`+`pnpm lint`+`cargo check`.
- 플러그인 버전 핀(`=`) 유지 — global-shortcut·clipboard-manager `=2.3.2`, single-instance `=2.4.2`. Electron 탈출 조건(2d 룰)은 Phase 1~3 내내 미발동.
- 문서 갱신 3종 세트는 Phase 단위 규칙이었음 — 이후 작업은 관련 리포트/README만 정합 유지하면 된다.
