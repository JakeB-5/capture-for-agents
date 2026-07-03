# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트

**여기요!!** (영문 표기 Yeogiyo!!, 구 Capture for Agents) — AI 코딩 에이전트(터미널의 Claude Code 등)에게 시각적 피드백을 정확하게 전달하는 macOS 스크린샷 캡처+어노테이션 도구. 캡처 → 번호 마커/사각형/화살표 + 노트 → ⌘V 한 번으로 "정확히 어디를 어떻게" 전달. 포맷명: **CapNote v1**.

**현재 상태: Phase 1 워킹 스켈레톤 완료 (2026-07-02, 캡처→⌘V 루프 실기기 검증).** 작업계획서는 `docs/plan.html`. 구현 전 반드시 그 문서를 먼저 읽을 것. Phase 0 포맷 검증은 완료(`docs/phase0-verification.md`, 마커 지목 9/9) — **CapNote v1 스펙은 동결됨**. 문법 변경은 v1.1 제안으로만.

**다음 작업(Phase 2) 착수 시 `HANDOFF.md`를 먼저 읽을 것** — 진행 상태·착수 체크리스트·사용자 개입 지점이 정리돼 있다.

## 핵심 설계 불변식 (위반 금지 — 이 저장소에서 가장 중요한 규칙)

1. **클립보드는 텍스트 전용.** 이미지를 클립보드에 넣는 코드를 작성하지 않는다. 번인된 PNG는 파일로 저장하고 절대 경로를 텍스트에 포함 → 에이전트가 Read 도구로 읽는다. (Claude Code의 이미지 붙여넣기는 macOS에서 Ctrl+V라는 함정. 텍스트는 ⌘V 한 번으로 시각+의미 채널 동시 도착)
2. **좌표계는 단 하나: 저장된 최종 이미지의 픽셀** (원점 좌상단). 헤더 `size:`에 실측 WxH를 선언. 원본 Retina 좌표를 어떤 경로로도 노출하지 않는다.
3. **이미지는 장변 ≤ 1568px PNG.** Anthropic 비전 API 리사이즈 임계값 이하 → 모델이 보는 픽셀 = 텍스트 좌표 공간이 정확히 1:1. Retina @2x는 1/2 축소, 이미 작은 크롭은 네이티브 유지. **JPEG 금지**(1px 디테일이 아티팩트로 뭉개짐), **업스케일 금지**.
4. **번인(burn-in)은 필수, 단 다운스케일 후 최종 해상도에서 렌더링.** 번호 배지는 대상 픽셀을 가리지 않게 8~12px 오프셋 + 리더 라인, rect 주석은 점선+2px 아웃셋, point는 링(주석의 실제 UI 오인 방지 — Phase 0 검증 발견). 노트 본문 텍스트는 번인하지 않는다(텍스트 채널 담당).
5. **마커·사각형·화살표는 하나의 자동 증가 번호 시퀀스를 공유.** 이 번호가 이미지(시각)와 텍스트(의미)를 잇는 join key — 에이전트의 좌표 해석 정밀도에 의존하지 않는 이중 앵커링. 삭제 시 번호 자동 재정렬.

## 스택 결정

- **Tauri v2 메뉴바 상주 앱.** 어노테이션 UI(제품의 95%)는 TypeScript + Canvas 2D. Rust는 얇은 셸: 공식 플러그인(global-shortcut, clipboard-manager) + `screencapture` 프로세스 스폰 수십 줄.
- 캡처는 자체 오버레이 없이 `/usr/sbin/screencapture -i -x -o -t png <임시파일>` 스폰. ESC 취소는 파일 미생성으로 감지.
- **Electron 탈출 조건(2d 룰):** Tauri 플러그인 엣지 케이스로 2 active-day 이상 소모되면 Electron으로 전환. 아키텍처(웹뷰 UI + CLI 셸아웃)가 1:1 호환이므로 이 결정을 미루지 말 것.
- 저장: `~/.capnote/YYYY-MM-DD-HHMMSS.png` (경로 설정 가능). 앱 시작 시 14일 경과 또는 500개 초과분 자동 정리.

## 빌드/개발 커맨드

- `pnpm install` — 의존성 설치
- `pnpm tauri dev` — 개발 실행 (vite dev 서버 + Rust 빌드)
- `pnpm tauri build` — 릴리스 번들
- `pnpm check` — `tsc --noEmit`
- `pnpm lint` — `eslint --quiet src`
- `cargo check` (in `src-tauri/`) — Rust 컴파일 검증

구조: 프런트엔드 `src/`(vanilla TS + Vite), Rust 셸 `src-tauri/src/`(`lib.rs` 앱 셋업·커맨드, `capture.rs` screencapture 래퍼, `macos.rs` frontmost 복귀). Tauri 플러그인 버전은 Cargo.toml에 `=` 로 핀 — 업그레이드는 의도적으로만.

dev 모드에서는 TCC "화면 기록" 권한이 터미널/IDE에 귀속되는 점에 주의.

## 검증 관례

- **CapNote 포맷·번인 렌더러·좌표(다운스케일) 파이프라인 관련 변경은 반드시 실제 Claude Code에 붙여넣는 E2E 검증을 거친다.** 생성된 CapNote 블록을 붙여넣고, 에이전트가 이미지를 Read하여 마커 3종(point/rect/arrow)을 정확히 지목하는지 확인. 유닛 테스트만으로 통과 처리하지 말 것.
- 좌표 정확성 검증은 저장된 PNG 실측 크기 기준으로 수행 (Retina/멀티모니터 환경 포함).

## 문서 맵

- `HANDOFF.md` — 세션 핸드오프 (현재 진행 상태 · 다음 작업 체크리스트, Phase 완료 시마다 갱신)
- `README.md` — 제품 소개
- `docs/plan.html` — 작업계획서 · 설계 근거 (Phase 0~4 로드맵, 리스크, 일정 산정, 상단 진행 트래커 포함)
- `docs/phase0-verification.md` — Phase 0 포맷 검증 리포트 (스펙 동결 근거)
- `spike/phase0/` — 검증 픽스처·캡처·테스트 블록 (재현용)

CapNote v1 문법·표준 예시·리스크 상세는 `docs/plan.html`을 단일 출처로 삼고, 이 파일에 중복 기술하지 않는다.
