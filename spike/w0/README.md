# Phase W0 스파이크 러너북

Windows 검증 기기에서 실행하는 절차. 결과는 전부 `docs/w0-verification.md`에 기입한다.
절차 원본: `docs/plan-windows.html` §12 체크리스트 1~7. **앱 코드는 한 줄도 수정하지 않는다.**

## 준비물 (이 디렉터리)

| 파일 | 용도 |
|---|---|
| `resized-size.mjs` / `resized-size.test.mjs` | 공식 `resized_size()` 참조 구현 포트 (검증 완료 12/12) |
| `fixture.html` | 번인 픽스처 생성기 — 시나리오별 PNG + CapNote 블록 (체크리스트 6) |
| `capnote-blocks/` | Claude Code 붙여넣기 E2E용 블록 5종 (체크리스트 2~3) |
| `winprobe/` | 캡처·배율·단축키·오버레이 실측 바이너리 (체크리스트 4~5) |

## 기기 셋업 (체크리스트 1)

1. Rust MSVC 툴체인(`rustup`, host `x86_64-pc-windows-msvc`) + Node 22 + pnpm 설치.
2. Claude Code 설치 — 네이티브(PowerShell)와 WSL2 양쪽 (결정 2가 미정이므로 둘 다).
3. winprobe 확보: GitHub Actions `windows-build` 런의 `winprobe-x64` 아티팩트를 내려받거나, 기기에서 `cargo build --release --manifest-path spike/w0/winprobe/Cargo.toml`.

## 실행 순서

### A. 픽스처 PNG·블록 생성 (체크리스트 6 준비)

```powershell
cd spike/w0
python -m http.server 8000   # 또는 npx serve . (모듈 import 때문에 file:// 불가)
```

브라우저에서 `http://localhost:8000/fixture.html` → 시나리오 선택 → PNG 다운로드 →
`%USERPROFILE%\.capnote\` 폴더를 만들어 저장. 페이지의 CapNote 블록 textarea에서
`YOURNAME`이 실제 사용자명으로 치환됐는지 확인(수동 치환).

`capnote-blocks/*.txt`의 `YOURNAME`도 실제 사용자명으로 치환:

```powershell
Get-ChildItem capnote-blocks\*.txt | ForEach-Object {
  (Get-Content $_ -Raw) -replace 'YOURNAME', $env:USERNAME | Set-Content $_ -NoNewline
}
```

### B. Claude Code 경로 E2E (체크리스트 2 → pathStyle 확정)

네이티브 Claude Code(Windows Terminal)에서 `native-backslash.txt` → `native-forwardslash.txt`를
각각 Ctrl+V로 붙여넣고 에이전트가 이미지를 Read해 마커를 지목하는지 확인.
WSL Claude Code에서 `wsl-mnt-c.txt` → `wsl-cpath.txt` 동일 반복 (후자는 C:\ 자동 변환 여부 프로브).
주의: 붙여넣은 블록의 `image:` 줄이 비어 보이는 것은 정상 (HANDOFF §3.2 — 경로가 첨부로 치환됨).

### C. 터미널 매트릭스 (체크리스트 3)

`terminal-paste-probe.txt`를 Windows Terminal / VS Code 터미널 / Git Bash(mintty) / conhost
4곳에 붙여넣어 멀티라인 한 덩어리 도착·개행 보존·한국어 확인.

### D. 캡처·배율 실측 (체크리스트 4)

125%·150% 배율 모니터 구성에서:

```powershell
.\winprobe.exe monitors   # 모니터별 물리 px 크기·scale factor 출력
.\winprobe.exe capture    # 모니터별 winprobe-capture-<N>.png 저장 (현재 디렉터리)
```

`monitors`의 물리 픽셀 크기·scale factor와 `winprobe-capture-<N>.png`의 실측 크기를 대조.
설정 > 개인 정보 > "데스크톱 앱 스크린샷 허용"을 Off로 바꾼 뒤 `capture`를 재실행해
거동(실패/균일 픽셀 WARN)을 기록.

### E. 단축키·오버레이 (체크리스트 5)

```powershell
.\winprobe.exe hotkey          # Alt+Shift+C 콜백 발화 스모크
.\winprobe.exe overlay         # 사전 생성 창: 표시 지연 ms (목표 <300)
.\winprobe.exe overlay --cold  # 콜드 스타트 비교
```

### F. 블라인드 지목 (체크리스트 6 → 프로필·scale: 표기 확정)

A에서 만든 PNG가 `%USERPROFILE%\.capnote\`에 있는 상태에서, 픽스처 페이지의 CapNote 블록을
Claude Code에 Ctrl+V → 마커 3종(point/rect/arrow)을 "무엇을 가리키는지" 블라인드로 답하게 하고
씨딩된 버그 3건과 대조 (macOS Phase 0의 9/9 기준). 최소 2560×1440 @125%와 1800×1350 @150%
(소수 `scale:` 계수 오해석 여부) 두 시나리오.

### G. 기록·마감 (체크리스트 7)

`docs/w0-verification.md`의 표를 채우고 판정 3건(pathStyle 기본값 · 다운스케일 프로필 ·
`scale:` 표기)을 확정 → `docs/plan-windows.html` 트래커·§6~7과 `HANDOFF.md` 갱신 → W1 착수.
