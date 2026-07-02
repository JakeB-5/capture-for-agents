# Phase 0 검증 리포트 — CapNote v1 포맷 E2E 검증

- **일시**: 2026-07-02
- **결론**: **검증 통과 — CapNote v1 스펙 동결** (아래 4개 수정을 반영해 동결)
- **방법**: 정답 좌표를 아는 픽스처 화면을 렌더링해 번인 PNG + CapNote 블록을 수동 생성하고, 정답을 모르는 **블라인드 에이전트 6개**(실제 Claude 서브에이전트)에게 블록만 전달해 해석 정확도를 채점

## 1. 픽스처와 정답

가짜 대시보드 화면(1246x820 PNG, `~/.capnote/2026-07-02-181000.png`)을 절대 좌표로 렌더링. 핵심 함정: **동일한 카드 2개(Card A/B)를 나란히 배치**하고 마커는 오른쪽 Card B에만 지정 — 라벨링 없는 스크린샷으로는 특정 불가능한 상황을 재현.

| 마커 | 정답 대상 | 요구 수정 |
|---|---|---|
| `[1] rect (460,120)-(780,300)` | **Card B** (Card A 아님) | 1px solid #E5E7EB 보더 추가 |
| `[2] arrow (520,300)->(520,340)` | Card B 하단 ↔ Save 버튼 사이 간격 | 40px → 24px |
| `[3] point (1108,32)` | 헤더 우측 16x16 아이콘 | 16x16 → 20x20 |

재현 아티팩트: `spike/phase0/` (fixture.html, capture.png, capnote-block.txt)

## 2. 결과 스코어카드

| 에이전트 | 구성 | 이미지 Read | 마커 지목 | 판정 |
|---|---|---|---|---|
| hint-only ×2 | 블록만 전달, 이미지를 열라는 지시 없음 | **2/2 자발적 Read** (hint만으로 유도됨) | 6/6 정확 (Card B 특정 포함) | ✅ |
| explicit ×1 | Read 지시 포함 (대조군) | 1/1 | 3/3 정확 + 번인 rect와 실제 보더를 구분해냄 | ✅ |
| text-only ×1 | 비전 금지 (이미지 없는 모델 가정) | — | 좌표·size 대비로 상대 위치 3/3 정확, 모르는 것(라벨·아이콘 종류)은 정직하게 표기 | ✅ |
| cold parser ×2 | 포맷 사전 설명 없이 구조화 파싱 | — | 2/2 **완전 동일·무오류** 추출 (종류·좌표·노트·hint 전부) | ✅ |

**총평: 마커 지목 9/9, 파싱 무오류, hint 단독으로 이미지 열람 유도 성공.** 이중 채널(번인+텍스트) 설계와 join key(번호) 가설이 검증됨.

## 3. 환경·파이프라인 검증

- **다운스케일 파이프라인** (`sips`): 2492x1640 → `--resampleWidth 1246` → 1246x820, PNG 유지 확인. ✅
- **screencapture 무권한 거동**: TCC 화면 기록 권한이 없는 프로세스에서 `screencapture -x` 실행 시 **exit 1 + "could not create image from display"** — 조용한 오염 이미지가 아니라 **감지 가능한 실패**를 반환. 온보딩에서 exit code로 권한 미승인 감지 가능 (단, "권한 부분 승인" 상태의 거동은 Phase 1 실기기 검증 유지). ✅
- **`~/.capnote/` 경로 접근**: 프로젝트 밖 홈 디렉터리 경로를 에이전트 6/6이 Read 성공 (이 환경 기준. 미해결 질문 #2는 다른 샌드박스 환경에서 계속 관찰). ✅

## 4. 스펙 동결 — v1 확정 수정 4건 (에이전트 피드백 수렴 기반)

| # | 수정 | 근거 (6개 중 요청 수) |
|---|---|---|
| A1 | 헤더에 `scale: 1 image px = 1 CSS px` 라인 추가 (표준 다운스케일 정책상 항상 1:1이 되므로 기본 출력에 포함) | 4/6 — source 산문에서 스케일을 역산해야 했음 |
| A2 | 마커 라인에 선택적 라벨: `[n] rect (x1,y1)-(x2,y2) "Card B"` (대상의 가시 텍스트) | 5/6 — 비전 없는 모델·코드 grep에 가장 큰 개선 |
| A3 | hint v2: `…Coordinates are image pixels (origin top-left); px values in notes are CSS px.` | 4/6 — 노트 속 수치(40px 등)의 단위 기준이 불명확했음 |
| A4 | 번인 스타일: **rect는 점선 + 대상 바깥 2px 아웃셋** (보더 지적 시 주석이 실제 보더처럼 보이는 문제), **point는 채운 점 대신 링** (대상 가림 방지) | 3/3 비전 에이전트 전원이 지적 |

A2의 정규식은 `^\[(\d+)\] (point|rect|arrow) \(([^)]+\)?[^"]*)( "(.*)")?$` 형태로 라벨이 없어도 하위 호환된다.

## 5. v1.1 백로그 (지금은 반영하지 않음 — 필요 실증 시)

- 수정 요구의 구조화 필드 분리 (`property/current/expected`) — 자동 검증용
- 브라우저 캡처 시 DOM selector/컴포넌트명 필드
- 마커 주변 OCR 스니펫 (이미지 접근 불가 에이전트용)
- 주석 없는 원본 이미지 병기 (`image_clean:`)

## 6. 남은 수동 확인 (사용자 실기기 필요 — Phase 1 착수 시)

- [x] `screencapture -i` 대화형 실사용: 드래그 선택, Space 창 모드 토글, ESC 취소 시 파일 미생성 확인 (TCC 권한 승인 상태에서) — **✅ 2026-07-02 Phase 1 실기기 확인** (Phase 1 스켈레톤 앱의 ⌥⇧C 트리거 경유, 3종 모두 정상)
- [ ] iTerm2/Terminal/VS Code 터미널의 Claude Code에 실제 ⌘V 붙여넣기 (멀티라인 bracketed paste) — cmux 터미널 1종은 2026-07-02 Phase 1에서 확인(경로 텍스트 ⌘V → Claude Code가 이미지 수신), 3종 실측은 Phase 3
- [ ] macOS 15+ 주기적 재승인 프롬프트 빈도 관찰

## 부록 — 테스트에 사용한 블록 원문 (동결 전 v1 초안)

수정 A1~A3 반영 **이전**의 초안으로 테스트했으며, 그 상태로도 9/9를 기록했다. 동결본 문법은 `docs/plan.html` §4가 단일 출처다.

```capnote v1
image: /Users/jin/.capnote/2026-07-02-181000.png
size: 1246x820
source: region capture @2x, downscaled 1/2 (2026-07-02 18:10)
context: Figma 시안 대비 대시보드 화면 디테일 미반영 3건
[1] rect (460,120)-(780,300)
    이 카드에 1px solid #E5E7EB 보더가 빠져 있음. 시안에는 있는데 구현에 없음.
[2] arrow (520,300)->(520,340)
    카드와 아래 버튼 사이 간격이 지금 40px인데 시안 기준 24px로 줄일 것.
[3] point (1108,32)
    이 아이콘이 시안 기준 20x20인데 지금 16x16으로 렌더링됨.
hint: Read the image file at the path above. Numbered badges matching [n] are burned into the image. Coordinates are image pixels (origin top-left), not CSS px.
```
