# Phase W0 검증 리포트 — Windows 3대 가설 스파이크

> 상태: **진행 중** (준비물 작성 2026-07-03 · 실기기 검증 대기). 절차 원본: `docs/plan-windows.html` §12 체크리스트 1~7.
> 준비물: `spike/w0/` (resized-size 포트·픽스처·CapNote 블록·winprobe 바이너리) + `.github/workflows/windows-build.yml`.

## 0. 사전 결정 상태 (plan §12)

| 결정 | 상태 |
|---|---|
| 0. Windows 트랙 착수 승인 | ✅ 2026-07-03 사용자 지시로 승인 |
| 1. 검증 기기 확보 방법 | ⬜ 미정 |
| 2. 1차 소비 환경 (네이티브/WSL) | ⬜ 미정 (미정이면 양쪽 모두 E2E) |

## 1. 환경 셋업 (체크리스트 1)

- [ ] 실기기/VM에 Rust MSVC 툴체인 + pnpm + Claude Code(네이티브·WSL) 설치
- [x] GitHub Actions `windows-latest` 워크플로 골격 (`windows-build.yml`) — winprobe x64 아티팩트 + 프런트엔드 빌드
  - CI 실행 결과: _(run URL·결과 기입)_
- 기기 정보: _(모델 · Windows 버전 · 모니터 구성/배율 기입)_

## 2. Claude Code 경로 E2E (체크리스트 2) → pathStyle 기본값 확정

붙여넣기 블록: `spike/w0/capnote-blocks/` (YOURNAME 치환 후 사용, 절차는 `spike/w0/README.md`).

| # | 소비자 | `image:` 경로 형태 | Read 성공 | 비고 |
|---|---|---|---|---|
| 1 | 네이티브 Claude Code | `C:\Users\...` 백슬래시 | ⬜ | |
| 2 | 네이티브 Claude Code | `C:/Users/...` 슬래시 | ⬜ | |
| 3 | WSL Claude Code | `/mnt/c/Users/...` | ⬜ | |
| 4 | WSL Claude Code | `C:\Users\...` (자동 변환 여부 프로브) | ⬜ | 미해결 질문 1 |

**판정 — pathStyle 기본값 / 네이티브 구분자:** _(기입)_

## 3. 터미널 매트릭스 (체크리스트 3) → §7.3 확정

블록: `spike/w0/capnote-blocks/terminal-paste-probe.txt`

| 터미널 | 멀티라인 한 덩어리 도착 | 개행 보존 | 한국어(모지바케 없음) | 판정 |
|---|---|---|---|---|
| Windows Terminal (PowerShell) | ⬜ | ⬜ | ⬜ | |
| VS Code 통합 터미널 | ⬜ | ⬜ | ⬜ | |
| Git Bash (mintty) | ⬜ | ⬜ | ⬜ | |
| conhost | ⬜ | ⬜ | ⬜ | |

## 4. xcap 캡처 실측 (체크리스트 4)

`winprobe monitors` — 125% / 150% 모니터에서:

| 항목 | 결과 |
|---|---|
| 반환 프레임 = 물리 픽셀인가 | ⬜ |
| scale factor 취득값 정확한가 | ⬜ |
| Win11 프라이버시 토글 Off 시 거동 (미해결 질문 3) | ⬜ |

## 5. 단축키·오버레이 (체크리스트 5)

| 항목 | 결과 |
|---|---|
| `winprobe hotkey` — Alt+Shift+C 콜백 발화 (리스크 2 스모크) | ⬜ |
| `winprobe overlay` — 사전 생성 창 표시 지연 (목표 <300ms) | ⬜ ms |
| `winprobe overlay --cold` — 콜드 스타트 지연 | ⬜ ms |

## 6. 블라인드 지목 테스트 (체크리스트 6) → 프로필 기본값·scale: 표기 확정

픽스처: `spike/w0/fixture.html` (http 서빙 필요) → PNG를 `%USERPROFILE%\.capnote\`에 저장 → 블록 ⌘V→Ctrl+V → 에이전트가 마커 3종 지목.

| 시나리오 | point | rect | arrow | scale: 해석 정상 |
|---|---|---|---|---|
| 2560×1440 @125% (범용) | ⬜ | ⬜ | ⬜ | ⬜ |
| 1800×1350 @150% (범용, 소수 scale) | ⬜ | ⬜ | ⬜ | ⬜ |
| _(추가 시나리오)_ | | | | |

기준: macOS Phase 0의 9/9 방식. **판정 — 다운스케일 프로필 기본값 / `scale:` 표기:** _(기입)_

## 7. macOS 사이드에서 이미 확정된 사실 (2026-07-03)

1. **공식 `resized_size()` 참조 구현 포팅 검증 완료** — `spike/w0/resized-size.mjs`, 테스트 12/12 통과 (공식 문서 A4 예시 924×1307 + plan §6.3 표 전 항목, 범용·고해상도 프로필 모두).
2. **참조 구현의 반올림은 Python `round()` = half-to-even (banker's rounding).** 나이브한 JS `Math.round`/Rust `f64::round`(half-away-from-zero)로 포팅하면 정확히 .5로 떨어지는 종횡비에서 단변이 1px 어긋난다 (실측: 1800×1350 범용 → 1270×952가 정답인데 Math.round는 1269×952). **W2에서 TS/Rust 구현 시 half-to-even을 명시 구현할 것.** plan §6.5의 ±1px 반올림 규칙 항목과 결합해 확정 필요.
3. 엣지 제한은 **패딩 후 크기 기준** (`ceil(edge/28)*28 ≤ maxEdge`) — 장변 원본값 기준이 아님. API는 28px 배수로 하단·우측 패딩하지만 원점은 불변이므로 좌표 매핑에는 영향 없음 (공식 vision-coordinates 문서).

## 8. 종합 판정

- [ ] 3대 가설 (에이전트 경로 Read / 단축키·캡처 / 좌표 1:1) 통과 여부: _(기입)_
- [ ] plan-windows.html 트래커·§6~7 정책 갱신, HANDOFF.md 갱신 → W1 착수
