# winprobe — Phase W0 스로어웨이 프로브

Windows 실기기에서 실행하는 검증 바이너리 (docs/plan-windows.html §12 체크리스트 4~5). 스파이크 코드 — 제품에 포함되지 않음.

- `winprobe monitors` — xcap `Monitor::all()` 캡처: 물리 px 크기·scale factor 실측(§6.1), 균일 픽셀 WARN으로 Win11 프라이버시 토글 차단 감지(§5), 프레임을 `winprobe-out/`에 저장.
- `winprobe hotkey` — global-hotkey(플러그인 백엔드)로 Alt+Shift+C 콜백 발화 스모크 (§8 / 리스크 2).
- `winprobe overlay` — 숨김 사전 생성 창(warm) 표시 지연 실측: hotkey → 웹뷰 paint까지 ms, 목표 <300ms (§5 설계 노트). ESC로 숨김, 반복 측정.
- `winprobe overlay --cold` — 매번 창+웹뷰를 새로 생성하는 cold 비교치.

빌드: `cargo build --release` (x64 아티팩트는 CI `windows-build` 워크플로가 생성). macOS에서도 컴파일·실행되지만 실측값은 Windows 실기기 기준만 유효.
