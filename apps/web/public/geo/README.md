# 지도 경계(정적 자산)

- `kr-provinces-2018.json` — 시도 17 · `kr-sgg-2018/<시도코드>.json` — 시군구 · `kr-emd-2018/<시도코드>.json` — 읍면동 3,504(시도별로 나눠 확대했을 때 화면에 보이는 시도만 받는다)
- 원자료: 통계청 통계지리정보서비스(SGIS) 센서스용 행정구역경계 2018 · **공공누리 제1유형**(출처 표시 · 상업적 이용·변경 허용)
- 경유: github.com/southkorea/southkorea-maps (`kostat/2018/json`)
- 가공: Douglas-Peucker 단순화(시도 0.004° · 시군구 0.0015° · 읍면동 0.0005° ≈ 50m) · 작은 섬 제외 · 좌표 소수 3자리(읍면동 4자리) · WGS84 경위도
- 쓰는 곳: 경영성과 벤치마크 지도(`app/(main)/executive/finance-benchmark/KoreaBubbleMap.tsx`)
- `kr-sgg-2018-centroids.json` — 시군구 면적 중심(위 시군구 경계에서 계산 · 소수 3자리). **좌표 없는 공시 기관을 "위치 근사"로 그릴 때만** 쓴다(주소의 시군구 중심 — 실제 위치 아님 · 화면이 점선 원으로 구분해 말한다)
