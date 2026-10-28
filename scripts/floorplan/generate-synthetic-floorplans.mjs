#!/usr/bin/env node
// 합성 평면도 생성기 — 가상병원(위루비병원) 본관 B1·1F~6F
//
// 🔴 이것은 **실제 건물이 아니다.** 가상병원에는 실제 도면이 없어서(기획 spatial-flow-vision-3d §10)
//    도면 판독(P1) 시험·3D 뷰어(P2)·길안내(P3) 개발용으로 **정답이 알려진 도면**을 만든다.
//    치수는 병원 건축의 흔한 형태(8.4m 기둥 격자·복도 2.8m·저층부+병동 타워)를 따랐을 뿐,
//    법령·시설 기준 적합성을 검증한 것이 아니다.
//
// 산출물(apps/api/prisma/fixtures/floorplans-synthetic/):
//   <층>.svg · <층>.png  — 도면(판독 입력). 도면에는 SpaceNode 코드를 적지 않는다(실도면에 없으므로).
//   <층>.assets.svg · <층>.assets.png — 같은 도면 + 장비·단말 배치 레이어(가상 배치 예시)
//   space-import.v1.json — 정답(공간·문·동선 그래프·수직 연결·자산 배치). SpaceNode 코드 매핑 포함.
//
// 검증(실패하면 종료 코드 1): 공간 겹침 · 외곽 이탈 · 문이 허공으로 열림 · 층 그래프 단절 ·
//   접근성(엘리베이터만) 도달 불가 · 시드 SpaceNode ZONE 코드와 불일치(누락·중복·층 어긋남).
//
// 실행: node scripts/floorplan/generate-synthetic-floorplans.mjs [--no-png]

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = join(ROOT, 'apps/api/prisma/fixtures/floorplans-synthetic');
const SEED = join(ROOT, 'apps/api/prisma/seed.ts');
const PX = 24; // px per meter
const MARGIN = { l: 110, t: 120, r: 60, b: 150 };
const NOTICE = '합성 도면 — 실제 건물 아님 · 가상병원 시연·도면 판독 시험용';

// ─────────────────────────────────────────────────────────────
// 격자 · 층
// ─────────────────────────────────────────────────────────────
const GX = [0, 8.4, 16.8, 25.2, 33.6, 42.0, 50.4, 58.8, 67.2, 75.6, 84.0];
const GY_TOWER = [0, 8.0, 10.8, 18.8];
const GY_PODIUM = [0, 8.0, 10.8, 18.8, 29.6, 32.4, 40.4];
const PODIUM = { x: 0, y: 0, w: 84, h: 40.4 };
const TOWER = { x: 0, y: 0, w: 84, h: 18.8 };

// 층: key · 시드 FLOOR 코드 · 레벨 · 바닥 표고(m) · 층고(m)
const FLOORS = [
  { key: 'B1', seedCode: 'B1', level: -1, title: '지하 1층 — 건강검진센터·설비', elev: -4.5, height: 4.5, fp: PODIUM, gy: GY_PODIUM },
  { key: '1F', seedCode: '1f', level: 1, title: '1층 — 로비·응급·수술·중환자', elev: 0, height: 5.0, fp: PODIUM, gy: GY_PODIUM },
  { key: '2F', seedCode: '2f', level: 2, title: '2층 — 외래·검사·영상', elev: 5.0, height: 4.5, fp: PODIUM, gy: GY_PODIUM },
  { key: '3F', seedCode: '3f', level: 3, title: '3층 — 내과병동', elev: 9.5, height: 3.9, fp: TOWER, gy: GY_TOWER },
  { key: '4F', seedCode: '4f', level: 4, title: '4층 — 외과병동', elev: 13.4, height: 3.9, fp: TOWER, gy: GY_TOWER },
  { key: '5F', seedCode: '5f', level: 5, title: '5층 — 소아청소년·산부인과 병동', elev: 17.3, height: 3.9, fp: TOWER, gy: GY_TOWER },
  { key: '6F', seedCode: '6f', level: 6, title: '6층 — 정형외과병동·재활', elev: 21.2, height: 3.9, fp: TOWER, gy: GY_TOWER },
];

// ─────────────────────────────────────────────────────────────
// 공간 정의 DSL
//   S(name, x1, y1, x2, y2, opts)
//   opts: code(SpaceNode 코드) · type · num(실번호) · d(문 목록) · open(벽 없는 공간) · cap · rx(출입 통제)
//   문: 'N' | 'S.3' (벽 위치 비율) | 'N.5w1.8' (폭) | 'W!' (외부 출입구) | 'E.4v' (저층 계단 등 비접근성 표시 없음 — 예약)
// ─────────────────────────────────────────────────────────────
const S = (name, x1, y1, x2, y2, o = {}) => ({ name, x1, y1, x2, y2, ...o });
const COR = (name, x1, y1, x2, y2, o = {}) => S(name, x1, y1, x2, y2, { type: 'CORRIDOR', open: true, ...o });

// 모든 층 공통 코어(수직 정렬) — 북측 띠 x33.6~50.4
function core() {
  return [
    S('비상용 엘리베이터 (침대용)', 33.6, 0, 36.4, 4.4, { type: 'ELEVATOR', v: 'EV1', d: ['S'] }),
    S('침대용 엘리베이터', 36.4, 0, 39.2, 4.4, { type: 'ELEVATOR', v: 'EV2', d: ['S'] }),
    S('EPS', 39.2, 0, 42.0, 4.4, { type: 'SHAFT', d: ['S.5w0.9'] }),
    S('TPS', 42.0, 0, 44.8, 4.4, { type: 'SHAFT', d: ['S.5w0.9'] }),
    S('승객용 엘리베이터', 44.8, 0, 47.6, 4.4, { type: 'ELEVATOR', v: 'EV3', d: ['S'] }),
    S('승객용 엘리베이터', 47.6, 0, 50.4, 4.4, { type: 'ELEVATOR', v: 'EV4', d: ['S'] }),
    S('엘리베이터 홀', 33.6, 4.4, 50.4, 8.0, { type: 'HALL', open: true, hall: true }),
  ];
}
const stairA = () => S('특별피난계단 A', 0, 0, 4.2, 8.0, { type: 'STAIR', v: 'STA', d: ['S.5w1.2'] });
const stairB = () => S('특별피난계단 B', 79.8, 0, 84, 8.0, { type: 'STAIR', v: 'STB', d: ['S.5w1.2'] });
const stairC = () => S('피난계단 C', 21.0, 32.4, 25.2, 40.4, { type: 'STAIR', v: 'STC', d: ['N.5w1.2'] });
const stairD = () => S('피난계단 D', 79.8, 32.4, 84, 40.4, { type: 'STAIR', v: 'STD', d: ['N.5w1.2'] });
const toilets = (x) => [
  S('화장실(남)', x, 0, x + 4.2, 8.0, { type: 'TOILET', d: ['S.5w0.9'] }),
  S('화장실(여)', x + 4.2, 0, x + 8.4, 8.0, { type: 'TOILET', d: ['S.5w0.9'] }),
];

// 병동 북측 지원 띠(3~6F 공통 뼈대) — 층별로 일부 교체
function wardNorth(fl, ns, extra = {}) {
  return [
    stairA(),
    S('오물처리실', 4.2, 0, 8.4, 8.0, { type: 'SUPPORT', rx: true, d: ['S.5w0.9'] }),
    S('린넨실', 8.4, 0, 12.6, 8.0, { type: 'SUPPORT', d: ['S.5w0.9'] }),
    S('샤워실', 12.6, 0, 16.8, 8.0, { type: 'TOILET', d: ['S.5w0.9'] }),
    extra.lounge ?? S('보호자 휴게실', 16.8, 0, 25.2, 8.0, { type: 'LOUNGE', d: ['S.5w1.2'] }),
    ...toilets(25.2),
    ...core(),
    S(`${fl}층 간호스테이션`, 50.4, 0, 58.8, 8.0, { type: 'NURSE_STATION', code: ns, d: ['S.3w1.8', 'S.8w0.9'] }),
    S('처치실', 58.8, 0, 63.0, 8.0, { type: 'TREATMENT', d: ['S.5w1.2'] }),
    S('투약준비실', 63.0, 0, 67.2, 8.0, { type: 'SUPPORT', rx: true, d: ['S.5w0.9'] }),
    S('배선실', 67.2, 0, 71.4, 8.0, { type: 'SUPPORT', rx: true, d: ['S.5w0.9'] }),
    S('간호사 휴게·탈의실', 71.4, 0, 75.6, 8.0, { type: 'STAFF', rx: true, d: ['S.5w0.9'] }),
    S('면담실', 75.6, 0, 79.8, 8.0, { type: 'CONSULT', d: ['S.5w0.9'] }),
    stairB(),
    COR(`${fl}층 병동 복도`, 0, 8.0, 84, 10.8),
  ];
}
const ward = (name, x1, x2, cap, o = {}) =>
  S(name, x1, 10.8, x2, 18.8, { type: 'WARD_ROOM', cap, d: ['N.75w1.2'], ...o });

// ─────────────────────────────────────────────────────────────
// 층별 배치
// ─────────────────────────────────────────────────────────────
const LAYOUT = {
  B1: [
    stairA(),
    S('기계실', 4.2, 0, 25.2, 8.0, { type: 'PLANT', rx: true, d: ['S.8w1.8'] }),
    ...toilets(25.2),
    ...core(),
    S('전기실', 50.4, 0, 63.0, 8.0, { type: 'PLANT', rx: true, d: ['S.5w1.8'] }),
    S('비상발전기실', 63.0, 0, 71.4, 8.0, { type: 'PLANT', rx: true, d: ['S.5w1.8'] }),
    S('의료가스 매니폴드실', 71.4, 0, 75.6, 8.0, { type: 'PLANT', rx: true, d: ['S.5w1.2'] }),
    S('저수조실', 75.6, 0, 79.8, 8.0, { type: 'PLANT', rx: true, d: ['S.5w0.9'] }),
    stairB(),
    COR('지하 1층 복도', 0, 8.0, 84, 10.8),
    S('신체계측실', 0, 10.8, 8.4, 20.2, { type: 'EXAM', d: ['N.5'] }),
    S('검진 채혈실', 8.4, 10.8, 16.8, 20.2, { type: 'LAB', code: 'B1-LAB', d: ['N.5w1.2'] }),
    S('채뇨 화장실', 16.8, 10.8, 21.0, 20.2, { type: 'TOILET', d: ['N.5'] }),
    S('안과 검사실', 21.0, 10.8, 25.2, 20.2, { type: 'EXAM', d: ['N.5'] }),
    S('청력검사실', 0, 20.2, 8.4, 29.6, { type: 'EXAM', d: ['S.5'] }),
    S('폐기능검사실', 8.4, 20.2, 12.6, 29.6, { type: 'EXAM', d: ['S.5'] }),
    S('결과상담실 1', 12.6, 20.2, 16.8, 29.6, { type: 'CONSULT', d: ['S.5'] }),
    S('결과상담실 2', 16.8, 20.2, 21.0, 29.6, { type: 'CONSULT', d: ['S.5'] }),
    S('검진 의사실', 21.0, 20.2, 25.2, 29.6, { type: 'STAFF', rx: true, d: ['S.5'] }),
    COR('검진 연결복도', 25.2, 10.8, 28.0, 29.6),
    S('검진 접수', 28.0, 10.8, 37.8, 16.8, { type: 'RECEPTION', code: 'B1-RC', d: ['S.5w1.8'] }),
    S('검진 탈의실(남)', 37.8, 10.8, 44.1, 16.8, { type: 'LOCKER', d: ['S.5'] }),
    S('검진 탈의실(여)', 44.1, 10.8, 50.4, 16.8, { type: 'LOCKER', d: ['S.5'] }),
    S('검진 대기 라운지', 28.0, 16.8, 50.4, 29.6, { type: 'WAITING', open: true }),
    S('초음파실', 50.4, 10.8, 58.8, 20.2, { type: 'IMAGING', code: 'B1-US', cap: 3, d: ['W.75w1.2'] }),
    S('검진 X-ray', 58.8, 10.8, 67.2, 20.2, { type: 'IMAGING', code: 'B1-XRAY', shield: true, d: ['N.3w1.2'] }),
    S('X-ray 조정실', 67.2, 10.8, 71.4, 20.2, { type: 'STAFF', rx: true, d: ['N.5'] }),
    S('의료폐기물 보관실', 71.4, 10.8, 79.8, 20.2, { type: 'SUPPORT', rx: true, d: ['N.5w1.5'] }),
    S('린넨·물품 창고', 79.8, 10.8, 84, 29.6, { type: 'SUPPORT', rx: true, d: ['N.5w1.2'] }),
    S('위내시경실', 50.4, 20.2, 63.0, 29.6, { type: 'ENDOSCOPY', code: 'B1-GI', cap: 3, d: ['S.3w1.2'] }),
    S('내시경 세척실', 63.0, 20.2, 67.2, 29.6, { type: 'SUPPORT', rx: true, d: ['W.5', 'S.5'] }),
    S('검진 회복실', 67.2, 20.2, 79.8, 29.6, { type: 'RECOVERY', code: 'B1-REST', cap: 6, d: ['S.3w1.2'] }),
    COR('지하 1층 남측 복도', 0, 29.6, 84, 32.4),
    S('직원 탈의실', 0, 32.4, 21.0, 40.4, { type: 'LOCKER', rx: true, d: ['N.5w1.2'] }),
    stairC(),
    S('주차장 연결통로', 25.2, 32.4, 42.0, 40.4, { type: 'HALL', open: true, d: ['S.5w3.0!'] }),
    S('중앙공급실(CSSD)', 42.0, 32.4, 63.0, 40.4, { type: 'SUPPORT', rx: true, d: ['N.2w1.5'] }),
    S('영양 조리실', 63.0, 32.4, 79.8, 40.4, { type: 'SUPPORT', rx: true, d: ['N.5w1.5'] }),
    stairD(),
  ],

  '1F': [
    stairA(),
    S('소생실', 4.2, 0, 12.6, 8.0, { type: 'ER', rx: true, cap: 2, d: ['S.5w1.8'] }),
    S('응급 음압격리실', 12.6, 0, 16.8, 8.0, { type: 'ISOLATION', rx: true, cap: 1, d: ['S.5w1.2'] }),
    S('응급 처치실', 16.8, 0, 21.0, 8.0, { type: 'TREATMENT', rx: true, d: ['S.5w1.2'] }),
    S('오물처리실', 21.0, 0, 25.2, 8.0, { type: 'SUPPORT', rx: true, d: ['S.5'] }),
    ...toilets(25.2),
    ...core(),
    S('장애인 화장실', 50.4, 0, 54.6, 8.0, { type: 'TOILET', d: ['S.5w1.2'] }),
    S('방재실', 54.6, 0, 58.8, 8.0, { type: 'STAFF', rx: true, d: ['S.5'] }),
    S('수술실 1', 58.8, 0, 67.2, 8.0, { type: 'SURGERY', code: 'F1-OR1', num: 'OR-1', rx: true, d: ['S.5w1.8'] }),
    S('수술실 2', 67.2, 0, 75.6, 8.0, { type: 'SURGERY', code: 'F1-OR2', num: 'OR-2', rx: true, d: ['S.5w1.8'] }),
    S('멸균물품 준비실', 75.6, 0, 79.8, 8.0, { type: 'SUPPORT', rx: true, d: ['S.5w1.2'] }),
    stairB(),
    COR('1층 중앙복도', 0, 8.0, 58.8, 10.8),
    COR('수술부 청결복도', 58.8, 8.0, 84, 10.8, { rx: true }),
    S('구급차 출입구', 0, 10.8, 4.2, 18.8, { type: 'HALL', d: ['W.5w2.4!', 'E.5w2.4'] }),
    S('응급 의료진실', 0, 18.8, 4.2, 29.6, { type: 'STAFF', rx: true, d: ['E.5'] }),
    S('응급실', 4.2, 10.8, 25.2, 29.6, { type: 'ER', code: 'F1-ER', cap: 20, d: ['N.5w1.8', 'S.8w2.4'] }),
    COR('로비 연결복도', 25.2, 10.8, 28.0, 29.6),
    S('접수/원무', 28.0, 10.8, 37.8, 16.8, { type: 'RECEPTION', code: 'F1-RC', cap: 8, d: ['S.5w3.0'] }),
    S('수납', 37.8, 10.8, 44.8, 16.8, { type: 'CASHIER', code: 'F1-CS', cap: 4, d: ['S.5w2.4'] }),
    S('약국', 44.8, 10.8, 54.6, 16.8, { type: 'PHARMACY', code: 'F1-PH', cap: 10, d: ['S.5w2.4', 'E.5'] }),
    S('조제실', 54.6, 10.8, 58.8, 16.8, { type: 'SUPPORT', rx: true }),
    S('로비', 28.0, 16.8, 58.8, 29.6, { type: 'LOBBY', code: 'F1-LB', cap: 50, open: true, esc: [30.0, 20.0, 33.0, 28.0] }),
    S('회복실', 58.8, 10.8, 71.4, 18.8, { type: 'RECOVERY', code: 'F1-RCV', rx: true, cap: 6, d: ['N.3w1.8'] }),
    S('마취 준비실', 58.8, 18.8, 63.0, 24.2, { type: 'SUPPORT', rx: true, d: ['N.5w1.2'] }),
    S('중환자실 음압격리실', 63.0, 18.8, 71.4, 24.2, { type: 'ISOLATION', rx: true, cap: 1, d: ['E.5w1.2'] }),
    S('중환자실', 71.4, 10.8, 84, 29.6, { type: 'ICU', code: 'F1-ICU', rx: true, cap: 6, d: ['N.5w1.8'] }),
    S('중환자실 보호자 대기실', 58.8, 24.2, 71.4, 29.6, { type: 'WAITING', d: ['S.5w1.2'] }),
    COR('1층 남측 복도', 0, 29.6, 84, 32.4),
    S('응급 대기실', 0, 32.4, 12.6, 40.4, { type: 'WAITING', code: 'F1-WAIT', cap: 15, d: ['W.5w2.4!', 'N.5w1.8'] }),
    S('트리아지실', 12.6, 32.4, 16.8, 40.4, { type: 'TRIAGE', d: ['N.5w1.2'] }),
    S('응급 원무', 16.8, 32.4, 21.0, 40.4, { type: 'RECEPTION', d: ['N.5'] }),
    stairC(),
    S('편의점', 25.2, 32.4, 33.6, 40.4, { type: 'AMENITY', code: 'F1-CONV', cap: 10, d: ['N.5w1.8'] }),
    S('주출입구 풍제실', 33.6, 32.4, 42.0, 40.4, { type: 'HALL', open: true, d: ['S.5w3.0!'] }),
    S('카페', 42.0, 32.4, 54.6, 40.4, { type: 'AMENITY', code: 'F1-CAFE', cap: 20, d: ['N.5w1.8'] }),
    S('화장실(남)', 54.6, 32.4, 58.8, 40.4, { type: 'TOILET', d: ['N.5'] }),
    S('화장실(여)', 58.8, 32.4, 63.0, 40.4, { type: 'TOILET', d: ['N.5'] }),
    S('의무기록·서류발급', 63.0, 32.4, 71.4, 40.4, { type: 'RECEPTION', d: ['N.5w1.8'] }),
    S('보안실', 71.4, 32.4, 75.6, 40.4, { type: 'STAFF', rx: true, d: ['N.5'] }),
    S('물품 하역장', 75.6, 32.4, 79.8, 40.4, { type: 'SUPPORT', rx: true, d: ['N.5w1.5', 'S.5w3.0!'] }),
    stairD(),
  ],

  '2F': [
    stairA(),
    S('소아청소년과', 4.2, 0, 8.4, 8.0, { type: 'CLINIC', code: 'F2-PD-204', num: '204', d: ['S.5'] }),
    S('산부인과', 8.4, 0, 12.6, 8.0, { type: 'CLINIC', code: 'F2-OB-205', num: '205', d: ['S.5'] }),
    S('정형외과', 12.6, 0, 16.8, 8.0, { type: 'CLINIC', code: 'F2-OS-206', num: '206', d: ['S.5'] }),
    S('이비인후과', 16.8, 0, 21.0, 8.0, { type: 'CLINIC', code: 'F2-ENT-207', num: '207', d: ['S.5'] }),
    S('안과', 21.0, 0, 25.2, 8.0, { type: 'CLINIC', code: 'F2-EYE-208', num: '208', d: ['S.5'] }),
    ...toilets(25.2),
    ...core(),
    S('피부과', 50.4, 0, 54.6, 8.0, { type: 'CLINIC', code: 'F2-DRM-209', num: '209', d: ['S.5'] }),
    S('정신건강의학과', 54.6, 0, 58.8, 8.0, { type: 'CLINIC', code: 'F2-PSY-210', num: '210', d: ['S.5'] }),
    S('가정의학과', 58.8, 0, 63.0, 8.0, { type: 'CLINIC', code: 'F2-FM-211', num: '211', d: ['S.5'] }),
    S('비뇨의학과', 63.0, 0, 67.2, 8.0, { type: 'CLINIC', code: 'F2-URO-212', num: '212', d: ['S.5'] }),
    S('신경외과', 67.2, 0, 71.4, 8.0, { type: 'CLINIC', code: 'F2-NS-213', num: '213', d: ['S.5'] }),
    S('외래 처치실', 71.4, 0, 75.6, 8.0, { type: 'TREATMENT', d: ['S.5w1.2'] }),
    S('수유실', 75.6, 0, 79.8, 8.0, { type: 'NURSE_ROOM', d: ['S.5'] }),
    stairB(),
    COR('2층 중앙복도', 0, 8.0, 84, 10.8),
    S('전문과 대기실', 0, 10.8, 25.2, 20.2, { type: 'WAITING', open: true }),
    S('채혈실/검사실', 0, 20.2, 12.6, 29.6, { type: 'LAB', code: 'F2-LAB', cap: 10, d: ['N.5w1.8'] }),
    S('채뇨 화장실', 12.6, 20.2, 16.8, 24.9, { type: 'TOILET', d: ['N.5'] }),
    S('검체 처리실', 12.6, 24.9, 16.8, 29.6, { type: 'SUPPORT', rx: true, d: ['S.5'] }),
    S('심전도실', 16.8, 20.2, 21.0, 29.6, { type: 'EKG', code: 'F2-EKG', cap: 2, d: ['N.5'] }),
    S('폐기능검사실', 21.0, 20.2, 25.2, 29.6, { type: 'EXAM', d: ['N.5'] }),
    COR('외래 연결복도', 25.2, 10.8, 28.0, 29.6),
    S('에스컬레이터 홀', 28.0, 10.8, 37.8, 29.6, { type: 'HALL', open: true, esc: [30.0, 20.0, 33.0, 28.0] }),
    S('내과 대기실', 37.8, 10.8, 50.4, 20.2, { type: 'WAITING', code: 'F2-IM-W', cap: 30, dept: '내과', open: true }),
    S('내과 1진료실', 37.8, 20.2, 42.0, 29.6, { type: 'CLINIC', code: 'F2-IM-201', num: '201', d: ['N.5'] }),
    S('내과 2진료실', 42.0, 20.2, 46.2, 29.6, { type: 'CLINIC', code: 'F2-IM-202', num: '202', d: ['N.5'] }),
    S('내과 처치실', 46.2, 20.2, 50.4, 29.6, { type: 'TREATMENT', d: ['N.5w1.2'] }),
    S('외과 대기실', 50.4, 10.8, 63.0, 20.2, { type: 'WAITING', code: 'F2-SG-W', cap: 20, dept: '외과', open: true }),
    S('외과 1진료실', 50.4, 20.2, 54.6, 29.6, { type: 'CLINIC', code: 'F2-SG-203', num: '203', d: ['N.5'] }),
    S('외과 처치실', 54.6, 20.2, 58.8, 29.6, { type: 'TREATMENT', d: ['N.5w1.2'] }),
    S('상담실', 58.8, 20.2, 63.0, 29.6, { type: 'CONSULT', d: ['N.5'] }),
    S('검사 대기실', 63.0, 10.8, 84, 20.2, { type: 'WAITING', open: true }),
    S('내시경실', 63.0, 20.2, 71.4, 29.6, { type: 'ENDOSCOPY', code: 'F2-ENDO', cap: 3, d: ['N.5w1.2'] }),
    S('내시경 회복실', 71.4, 20.2, 79.8, 29.6, { type: 'RECOVERY', d: ['W.5w1.2', 'N.5w1.2'] }),
    S('내시경 세척실', 79.8, 20.2, 84, 29.6, { type: 'SUPPORT', rx: true, d: ['S.5'] }),
    COR('2층 남측 복도', 0, 29.6, 84, 32.4),
    S('영상실 (X-ray/CT)', 0, 32.4, 12.6, 40.4, { type: 'IMAGING', code: 'F2-IMG', cap: 5, shield: true, d: ['N.5w1.5'] }),
    S('영상 조정실', 12.6, 32.4, 16.8, 40.4, { type: 'STAFF', rx: true, d: ['N.5'] }),
    S('영상 탈의실', 16.8, 32.4, 21.0, 40.4, { type: 'LOCKER', d: ['N.5'] }),
    stairC(),
    S('영상 대기실', 25.2, 32.4, 33.6, 40.4, { type: 'WAITING', d: ['N.5w1.8'] }),
    S('판독실', 33.6, 32.4, 37.8, 40.4, { type: 'STAFF', rx: true, d: ['N.5'] }),
    S('2층 수납', 37.8, 32.4, 46.2, 40.4, { type: 'CASHIER', d: ['N.5w2.4'] }),
    S('외래 간호사실', 46.2, 32.4, 50.4, 40.4, { type: 'STAFF', rx: true, d: ['N.5'] }),
    S('회의실', 50.4, 32.4, 58.8, 40.4, { type: 'STAFF', rx: true, d: ['N.5w1.2'] }),
    S('직원 휴게실', 58.8, 32.4, 63.0, 40.4, { type: 'STAFF', rx: true, d: ['N.5'] }),
    S('의국', 63.0, 32.4, 71.4, 40.4, { type: 'STAFF', rx: true, d: ['N.5w1.2'] }),
    S('교수 연구실', 71.4, 32.4, 79.8, 40.4, { type: 'STAFF', rx: true, d: ['N.5'] }),
    stairD(),
  ],

  '3F': [
    ...wardNorth(3, 'F3-NS'),
    ward('301호', 0, 4.2, 2, { code: 'F3-301', num: '301' }),
    ward('302호', 4.2, 8.4, 2, { code: 'F3-302', num: '302' }),
    ward('303호', 8.4, 12.6, 2, { code: 'F3-303', num: '303' }),
    ward('304호', 12.6, 16.8, 2, { code: 'F3-304', num: '304' }),
    ward('305호', 16.8, 21.0, 2, { code: 'F3-305', num: '305' }),
    ward('306호', 21.0, 29.4, 4, { num: '306' }),
    ward('307호', 29.4, 37.8, 4, { num: '307' }),
    ward('308호', 37.8, 46.2, 4, { num: '308' }),
    ward('309호', 46.2, 54.6, 4, { num: '309' }),
    ward('310호', 54.6, 63.0, 4, { num: '310' }),
    ward('311호 (1인실)', 63.0, 67.2, 1, { num: '311' }),
    ward('312호 (1인실)', 67.2, 71.4, 1, { num: '312' }),
    S('격리 전실', 71.4, 10.8, 73.8, 18.8, { type: 'ANTEROOM', rx: true, d: ['N.5w1.2'] }),
    S('313호 음압격리실', 73.8, 10.8, 79.8, 18.8, { type: 'ISOLATION', num: '313', cap: 1, rx: true, d: ['W.4w1.2'] }),
    S('비품 창고', 79.8, 10.8, 84, 18.8, { type: 'SUPPORT', rx: true, d: ['N.5'] }),
  ],

  '4F': [
    ...wardNorth(4, 'F4-NS'),
    ward('401호', 0, 4.2, 2, { code: 'F4-401', num: '401' }),
    ward('402호', 4.2, 8.4, 2, { code: 'F4-402', num: '402' }),
    ward('403호', 8.4, 12.6, 2, { code: 'F4-403', num: '403' }),
    ward('404호', 12.6, 21.0, 4, { code: 'F4-404', num: '404' }),
    ward('405호 (1인실)', 21.0, 25.2, 1, { code: 'F4-405', num: '405' }),
    ward('406호', 25.2, 33.6, 4, { num: '406' }),
    ward('407호', 33.6, 42.0, 4, { num: '407' }),
    ward('408호', 42.0, 50.4, 4, { num: '408' }),
    ward('409호', 50.4, 54.6, 2, { num: '409' }),
    ward('410호', 54.6, 58.8, 2, { num: '410' }),
    ward('411호', 58.8, 67.2, 4, { num: '411' }),
    ward('412호', 67.2, 75.6, 4, { num: '412' }),
    ward('413호 (1인실)', 75.6, 79.8, 1, { num: '413' }),
    S('비품 창고', 79.8, 10.8, 84, 18.8, { type: 'SUPPORT', rx: true, d: ['N.5'] }),
  ],

  '5F': [
    ...wardNorth(5, 'F5-NS', {
      lounge: S('수유실', 16.8, 0, 25.2, 8.0, { type: 'NURSE_ROOM', code: 'F5-NURSE', cap: 6, d: ['S.5w1.2'] }),
    }),
    ward('501호 (소아)', 0, 4.2, 2, { code: 'F5-501', num: '501' }),
    ward('502호 (소아)', 4.2, 8.4, 2, { code: 'F5-502', num: '502' }),
    ward('505호 (소아)', 8.4, 16.8, 4, { num: '505' }),
    ward('506호 (소아)', 16.8, 25.2, 4, { num: '506' }),
    S('소아 놀이실', 25.2, 10.8, 29.4, 18.8, { type: 'LOUNGE', d: ['N.5w1.2'] }),
    ward('503호 (산부)', 29.4, 33.6, 2, { code: 'F5-503', num: '503' }),
    ward('504호 (산부)', 33.6, 37.8, 2, { code: 'F5-504', num: '504' }),
    ward('507호 (산부)', 37.8, 46.2, 4, { num: '507' }),
    S('분만실', 46.2, 10.8, 58.8, 18.8, { type: 'DELIVERY', code: 'F5-LDR', cap: 2, rx: true, d: ['N.5w1.8'] }),
    S('신생아실', 58.8, 10.8, 67.2, 18.8, { type: 'NURSERY', rx: true, cap: 8, d: ['N.5w1.2'] }),
    S('신생아중환자실', 67.2, 10.8, 79.8, 18.8, { type: 'ICU', code: 'F5-NICU', cap: 4, rx: true, d: ['E.5w1.2'] }),
    S('NICU 전실·손씻기', 79.8, 10.8, 84, 18.8, { type: 'ANTEROOM', rx: true, d: ['N.5w1.2'] }),
  ],

  '6F': [
    ...wardNorth(6, 'F6-NS'),
    ward('601호', 0, 8.4, 4, { code: 'F6-601', num: '601' }),
    ward('602호', 8.4, 16.8, 4, { code: 'F6-602', num: '602' }),
    ward('603호', 16.8, 21.0, 2, { code: 'F6-603', num: '603' }),
    ward('604호', 21.0, 29.4, 4, { num: '604' }),
    ward('605호', 29.4, 37.8, 4, { num: '605' }),
    ward('606호', 37.8, 42.0, 2, { num: '606' }),
    S('물리치료실', 42.0, 10.8, 63.0, 18.8, { type: 'THERAPY', code: 'F6-GYM', cap: 10, d: ['N.2w1.8', 'N.8w1.2'] }),
    S('재활치료실', 63.0, 10.8, 75.6, 18.8, { type: 'THERAPY', code: 'F6-REHAB', cap: 8, d: ['N.5w1.8'] }),
    S('치료사 탈의실', 75.6, 10.8, 79.8, 18.8, { type: 'LOCKER', rx: true, d: ['N.5'] }),
    S('비품 창고', 79.8, 10.8, 84, 18.8, { type: 'SUPPORT', rx: true, d: ['N.5'] }),
  ],
};

// ─────────────────────────────────────────────────────────────
// 기하 유틸
// ─────────────────────────────────────────────────────────────
const EPS = 1e-6;
const r2 = (n) => Math.round(n * 100) / 100;
const inside = (s, x, y) => x > s.x1 + EPS && x < s.x2 - EPS && y > s.y1 + EPS && y < s.y2 - EPS;
const overlapArea = (a, b) =>
  Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1)) * Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// 두 사각형이 맞닿은 선분(길이 > 0) — 없으면 null
function sharedEdge(a, b) {
  const ox1 = Math.max(a.x1, b.x1), ox2 = Math.min(a.x2, b.x2);
  const oy1 = Math.max(a.y1, b.y1), oy2 = Math.min(a.y2, b.y2);
  if (Math.abs(a.x2 - b.x1) < EPS || Math.abs(b.x2 - a.x1) < EPS) {
    const x = Math.abs(a.x2 - b.x1) < EPS ? a.x2 : a.x1;
    if (oy2 - oy1 > EPS) return { orient: 'V', x, y1: oy1, y2: oy2, len: oy2 - oy1 };
  }
  if (Math.abs(a.y2 - b.y1) < EPS || Math.abs(b.y2 - a.y1) < EPS) {
    const y = Math.abs(a.y2 - b.y1) < EPS ? a.y2 : a.y1;
    if (ox2 - ox1 > EPS) return { orient: 'H', y, x1: ox1, x2: ox2, len: ox2 - ox1 };
  }
  return null;
}

function parseDoor(spec) {
  const m = /^([NSEW])(\.\d+)?(?:w([\d.]+))?(!)?$/.exec(spec);
  if (!m) throw new Error(`문 표기 오류: ${spec}`);
  return { side: m[1], p: m[2] ? Number('0' + m[2]) : 0.5, w: m[3] ? Number(m[3]) : 1.0, ext: !!m[4] };
}

function doorPoint(s, d) {
  const { side, p } = d;
  if (side === 'N') return [s.x1 + (s.x2 - s.x1) * p, s.y1];
  if (side === 'S') return [s.x1 + (s.x2 - s.x1) * p, s.y2];
  if (side === 'W') return [s.x1, s.y1 + (s.y2 - s.y1) * p];
  return [s.x2, s.y1 + (s.y2 - s.y1) * p];
}
const OUTWARD = { N: [0, -1], S: [0, 1], W: [-1, 0], E: [1, 0] };

// ─────────────────────────────────────────────────────────────
// 층 빌드: 공간 · 연결(문/개구부) · 그래프
// ─────────────────────────────────────────────────────────────
const errors = [];
const fail = (msg) => errors.push(msg);

function buildFloor(F) {
  const spaces = LAYOUT[F.key].map((s, i) => ({
    ...s,
    id: `${F.key}-S${String(i + 1).padStart(3, '0')}`,
    open: !!s.open,
  }));

  // 1) 외곽·겹침
  for (const s of spaces) {
    if (s.x1 < F.fp.x - EPS || s.y1 < F.fp.y - EPS || s.x2 > F.fp.x + F.fp.w + EPS || s.y2 > F.fp.y + F.fp.h + EPS)
      fail(`${F.key} ${s.name}: 외곽 이탈`);
    if (s.x2 - s.x1 <= 0 || s.y2 - s.y1 <= 0) fail(`${F.key} ${s.name}: 크기 0`);
  }
  for (let i = 0; i < spaces.length; i++)
    for (let j = i + 1; j < spaces.length; j++)
      if (overlapArea(spaces[i], spaces[j]) > 0.01) fail(`${F.key} 겹침: ${spaces[i].name} ↔ ${spaces[j].name}`);

  // 2) 연결
  const conns = [];
  const addConn = (c) => { c.id = `${F.key}-C${String(conns.length + 1).padStart(3, '0')}`; conns.push(c); };

  for (const s of spaces) {
    for (const spec of s.d ?? []) {
      const d = parseDoor(spec);
      let at = doorPoint(s, d);
      // 기둥 회피: 문 폭 + 기둥 반폭(0.35)+여유 0.1 안에 격자 기둥이 있으면 비율을 옮긴다
      const onH = d.side === 'N' || d.side === 'S';
      const wallLen = onH ? s.x2 - s.x1 : s.y2 - s.y1;
      const hitsCol = (pt) => GX.some((gx) => F.gy.some((gy) =>
        onH ? Math.abs(gy - pt[1]) < EPS && Math.abs(gx - pt[0]) < d.w / 2 + 0.45
            : Math.abs(gx - pt[0]) < EPS && Math.abs(gy - pt[1]) < d.w / 2 + 0.45));
      if (hitsCol(at)) {
        const cands = [];
        for (let k = 1; k <= 40; k++) for (const sg of [1, -1]) cands.push(d.p + sg * k * 0.025);
        const ok = cands.find((p) => {
          const off = p * wallLen;
          if (off - d.w / 2 < 0.3 || off + d.w / 2 > wallLen - 0.3) return false;
          return !hitsCol(doorPoint(s, { ...d, p }));
        });
        if (ok == null) fail(`${F.key} ${s.name}: 문 ${spec} 이 기둥을 피할 자리가 없음`);
        else { d.p = ok; at = doorPoint(s, d); }
      }
      if (d.ext) {
        addConn({ kind: 'EXTERIOR', at, side: d.side, widthM: d.w, between: [s.id, null], owner: s.id, restricted: !!s.rx });
        continue;
      }
      const o = OUTWARD[d.side];
      const probe = [at[0] + o[0] * 0.3, at[1] + o[1] * 0.3];
      const nb = spaces.find((t) => t !== s && inside(t, probe[0], probe[1]));
      if (!nb) { fail(`${F.key} ${s.name}: 문 ${spec} 이 허공으로 열림`); continue; }
      // 문이 맞닿은 벽 안에 들어가는지
      const e = sharedEdge(s, nb);
      const along = e?.orient === 'H' ? at[0] : at[1];
      const lo = e ? (e.orient === 'H' ? e.x1 : e.y1) : 0, hi = e ? (e.orient === 'H' ? e.x2 : e.y2) : 0;
      if (!e || along - d.w / 2 < lo - EPS || along + d.w / 2 > hi + EPS) fail(`${F.key} ${s.name}: 문 ${spec} 이 벽 밖으로 나감`);
      addConn({ kind: 'DOOR', at, side: d.side, widthM: d.w, between: [s.id, nb.id], owner: s.id, restricted: !!(s.rx || nb.rx) });
    }
  }
  // 개구부: 벽 없는 공간끼리 맞닿으면 연결(출입 통제 경계는 문으로)
  for (let i = 0; i < spaces.length; i++)
    for (let j = i + 1; j < spaces.length; j++) {
      const a = spaces[i], b = spaces[j];
      if (!a.open || !b.open) continue;
      const e = sharedEdge(a, b);
      if (!e || e.len < 1.0) continue;
      const at = e.orient === 'H' ? [(e.x1 + e.x2) / 2, e.y] : [e.x, (e.y1 + e.y2) / 2];
      const rx = !!(a.rx || b.rx) !== !!(a.rx && b.rx); // 한쪽만 통제 = 경계 문
      addConn(rx
        ? { kind: 'DOOR', at, side: e.orient === 'H' ? 'S' : 'E', widthM: 1.8, between: [a.id, b.id], owner: a.id, restricted: true, boundary: e }
        : { kind: 'OPENING', at, widthM: r2(e.len), between: [a.id, b.id], restricted: !!(a.rx && b.rx), edge: e });
    }

  // 3) 그래프
  const nodes = new Map();
  const edges = [];
  const node = (id, at, kind, spaceId) => { if (!nodes.has(id)) nodes.set(id, { id, at: [r2(at[0]), r2(at[1])], kind, spaceId }); return id; };
  const edge = (a, b, kind, restricted) => {
    const d = dist(nodes.get(a).at, nodes.get(b).at);
    edges.push({ from: a, to: b, kind, distanceM: r2(d), accessible: true, restricted: !!restricted });
  };
  for (const c of conns) node(`${c.id}`, c.at, c.kind, null);
  for (const s of spaces) {
    const my = conns.filter((c) => c.between.includes(s.id));
    if (s.type === 'CORRIDOR') {
      const horiz = s.x2 - s.x1 >= s.y2 - s.y1;
      const cy = (s.y1 + s.y2) / 2, cx = (s.x1 + s.x2) / 2;
      const proj = (p) => (horiz ? [Math.min(Math.max(p[0], s.x1), s.x2), cy] : [cx, Math.min(Math.max(p[1], s.y1), s.y2)]);
      const pts = [];
      const endA = horiz ? [s.x1, cy] : [cx, s.y1], endB = horiz ? [s.x2, cy] : [cx, s.y2];
      pts.push({ at: endA, id: node(`${s.id}:a`, endA, 'CORRIDOR', s.id) });
      pts.push({ at: endB, id: node(`${s.id}:b`, endB, 'CORRIDOR', s.id) });
      for (const c of my) {
        const p = proj(c.at);
        const pid = node(`${s.id}:${c.id}`, p, 'CORRIDOR', s.id);
        pts.push({ at: p, id: pid });
        if (dist(p, c.at) > EPS) edge(c.id, pid, 'DOOR', c.restricted);
        else edge(c.id, pid, 'DOOR', c.restricted); // 0m — 통과 지점 표시
      }
      const key = (p) => (horiz ? p.at[0] : p.at[1]);
      const uniq = [...new Map(pts.sort((p, q) => key(p) - key(q)).map((p) => [p.id, p])).values()];
      for (let k = 1; k < uniq.length; k++) edge(uniq[k - 1].id, uniq[k].id, 'CORRIDOR', s.rx);
    } else {
      const c0 = [(s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2];
      const cid = node(`${s.id}:c`, c0, 'SPACE', s.id);
      for (const c of my) edge(cid, c.id, 'ROOM', s.rx || c.restricted);
    }
  }

  // 4) 층 연결성 — 엘리베이터 홀에서 모든 공간 중심/복도 도달
  const hall = spaces.find((s) => s.hall);
  const adj = new Map([...nodes.keys()].map((k) => [k, []]));
  for (const e of edges) { adj.get(e.from).push(e.to); adj.get(e.to).push(e.from); }
  const seen = new Set([`${hall.id}:c`]);
  const q = [`${hall.id}:c`];
  while (q.length) { const n = q.shift(); for (const m of adj.get(n)) if (!seen.has(m)) { seen.add(m); q.push(m); } }
  for (const s of spaces) {
    if (s.type === 'SHAFT') continue;
    const nid = s.type === 'CORRIDOR' ? `${s.id}:a` : `${s.id}:c`;
    if (!seen.has(nid)) fail(`${F.key} ${s.name}: 엘리베이터 홀에서 도달 불가(층 그래프 단절)`);
  }

  return { F, spaces, conns, nodes: [...nodes.values()], edges };
}

// ─────────────────────────────────────────────────────────────
// 자산 배치(가상 예시) — 방 용도별 흔한 장비·단말 구성. 종류 어휘는 shared ASSET_KINDS 정본.
//   🔴 DB 자산 행과 연결하지 않는다(가상 id `SYN-…`) — 실제 장비 목록이 아니다.
//   at: 층 좌표계(m). 'row' = 북측 벽 안쪽 한 줄 · 'bed' = 침상 머리 옆.
// ─────────────────────────────────────────────────────────────
const E = (label, n = 1, where = 'row') => ({ kind: 'EQUIPMENT', label, n, where });
const LI = (label, n = 1) => ({ kind: 'LAB_INSTRUMENT', label, n, where: 'row' });
const PC = (label = '업무 PC', n = 1) => ({ kind: 'TERMINAL', label, n, where: 'row' });
const WS = (label, n = 1) => ({ kind: 'WORKSTATION_PROFILE', label, n, where: 'row' });
const RX = (label, n = 1) => ({ kind: 'PHARMACY_DEVICE', label, n, where: 'row' });
const TV = (label = '대기 현황 전광판') => ({ kind: 'DISPLAY_BOX', label, n: 1, where: 'row' });
const QR = (label = 'QR 위치 스테이션') => ({ kind: 'LOCATION_STATION', label, n: 1, where: 'row' });
const ST = (label) => ({ kind: 'INVENTORY_STORAGE', label, n: 1, where: 'center' });
const SIGN = () => ({ kind: 'CONSENT_DEVICE', label: '동의서 서명 태블릿', n: 1, where: 'row' });

function assetRules(s) {
  const bedN = s.cap ?? 0;
  const byName = {
    '조제실': [RX('자동정제분포기(ATC)'), RX('산제 자동포장기'), RX('약포지 라벨프린터')],
    '검진 채혈실': [LI('혈구분석기'), PC('채혈 접수 PC', 2), QR()],
    '채혈실/검사실': [LI('혈구분석기'), LI('생화학분석기'), LI('면역분석기'), LI('소변분석기'), PC('채혈 접수 PC', 2), QR()],
    '심전도실': [E('12유도 심전도기')],
    '폐기능검사실': [E('폐기능검사기')],
    '청력검사실': [E('순음청력검사기')],
    '안과 검사실': [E('안저카메라'), E('비접촉 안압계')],
    '신체계측실': [E('체성분분석기'), E('자동혈압계')],
    '영상실 (X-ray/CT)': [E('일반촬영 X-ray'), E('CT')],
    '검진 X-ray': [E('흉부 X-ray')],
    '초음파실': [E('초음파 진단기', 3)],
    '영상 조정실': [WS('영상 촬영 워크스테이션', 2)],
    'X-ray 조정실': [WS('영상 촬영 워크스테이션')],
    '판독실': [WS('판독 워크스테이션', 2)],
    '내시경 세척실': [E('내시경 자동세척기', 2)],
    '방재실': [PC('중앙감시 PC', 2)],
    '의무기록·서류발급': [PC('서류발급 PC', 2)],
    '중앙공급실(CSSD)': [E('고압증기멸균기', 2), E('EO 가스멸균기'), ST('멸균물품 창고')],
    '멸균물품 준비실': [ST('수술 멸균물품 보관')],
    '린넨·물품 창고': [ST('중앙 물품 창고')],
    '비품 창고': [ST('병동 비품 창고')],
    '투약준비실': [ST('병동 상비약 보관')],
    '마취 준비실': [E('마취기(예비)')],
    '트리아지실': [PC('트리아지 PC'), E('자동혈압계')],
    '물리치료실': [E('전기치료기', 3), E('초음파치료기')],
    '재활치료실': [E('작업치료 장비세트')],
  };
  if (byName[s.name]) return byName[s.name];
  switch (s.type) {
    case 'CLINIC': return [PC('진료 PC')];
    case 'NURSE_STATION': return [PC('간호 PC', 3), WS('병동 간호 워크스테이션'), E('중앙감시 모니터'), E('응급카트 제세동기')];
    case 'ER': return s.code ? [PC('응급 PC', 4), E('환자감시장치', 6, 'bed'), E('제세동기', 2), E('이동형 X-ray'), E('휴대용 초음파')] : [E('제세동기'), E('인공호흡기'), E('환자감시장치', bedN || 1, 'bed')];
    case 'ICU': return s.name.includes('신생아')
      ? [E('인큐베이터', bedN, 'bed'), E('신생아 인공호흡기', 2), PC('NICU PC')]
      : [E('인공호흡기', bedN, 'bed'), E('환자감시장치', bedN, 'bed'), PC('ICU PC', 2)];
    case 'ISOLATION': return [E('환자감시장치', 1, 'bed'), E('음압 차압계')];
    case 'RECOVERY': return [E('환자감시장치', bedN || 2, 'bed')];
    case 'SURGERY': return [E('마취기'), E('전기수술기'), E('환자감시장치'), PC('수술실 PC')];
    case 'DELIVERY': return [E('태아감시장치', 2), E('신생아 보온기')];
    case 'ENDOSCOPY': return [E('내시경 시스템', s.cap ?? 1), PC('내시경 판독 PC')];
    case 'PHARMACY': return [PC('투약구 PC', 3)];
    case 'RECEPTION': return s.code === 'F1-RC' || s.code === 'B1-RC' ? [PC('원무 PC', 4), SIGN(), TV('호출 전광판')] : [PC('원무 PC', 2)];
    case 'CASHIER': return [PC('수납 PC', 3)];
    case 'WAITING': return s.open ? [TV(), QR()] : [TV()];
    case 'LOBBY': return [TV('종합 안내 전광판'), QR('QR 위치 스테이션(로비)')];
    case 'WARD_ROOM': return s.cap === 1 ? [E('환자감시장치', 1, 'bed')] : [];
    case 'TREATMENT': return [E('처치용 무영등')];
    default: return [];
  }
}

function placeAssets(b, kinds) {
  const out = [];
  let n = 0;
  for (const s of b.spaces) {
    const rules = assetRules(s);
    const W = s.x2 - s.x1, H = s.y2 - s.y1;
    const rowItems = rules.filter((r) => r.where === 'row').flatMap((r) => Array.from({ length: r.n }, () => r));
    const bedItems = rules.filter((r) => r.where === 'bed');
    // 북측 벽 안쪽 한 줄(문과 겹치지 않게 벽에서 0.9m)
    rowItems.forEach((r, i) => {
      const x = s.x1 + (W * (i + 0.5)) / rowItems.length;
      out.push({ r, s, at: [x, s.y1 + Math.min(0.9, H / 3)] });
    });
    // 침상 옆 — 침상 줄과 같은 규칙(fixtures 와 같은 간격)
    for (const r of bedItems) {
      const cnt = Math.max(1, r.n);
      for (let i = 0; i < cnt; i++) {
        const perRow = cnt > 4 && H >= 9 ? Math.ceil(cnt / 2) : cnt;
        const row = i < perRow ? 0 : 1;
        const k = row === 0 ? i : i - perRow;
        const inRow = row === 0 ? perRow : cnt - perRow;
        const gap = W / inRow;
        const off = r.label.includes('인공호흡기') || r.label.includes('인큐베이터') ? -0.55 : 0.75;
        const y = perRow === cnt ? s.y2 - 2.9 : row === 0 ? s.y1 + 3.0 : s.y2 - 3.1;
        out.push({ r, s, at: [s.x1 + gap * k + gap / 2 + off, y] });
      }
    }
    for (const r of rules.filter((q) => q.where === 'center')) out.push({ r, s, at: [s.x1 + W / 2, s.y1 + H * 0.72] });
  }
  return out.map(({ r, s, at }) => {
    if (!kinds.includes(r.kind)) fail(`자산 종류 ${r.kind} 는 shared ASSET_KINDS 에 없음`);
    if (!(at[0] > s.x1 && at[0] < s.x2 && at[1] > s.y1 && at[1] < s.y2)) fail(`${b.F.key} ${s.name}: 자산 ${r.label} 좌표가 공간 밖`);
    return {
      id: `SYN-${b.F.key}-${String(++n).padStart(3, '0')}`,
      kind: r.kind, label: r.label, floor: b.F.key, spaceId: s.id, spaceName: s.name,
      spaceNodeCode: s.code ?? null, at: [r2(at[0]), r2(at[1])],
    };
  });
}

// ─────────────────────────────────────────────────────────────
// 시드 대조 — seed.ts 의 SpaceNode ZONE 코드·층
// ─────────────────────────────────────────────────────────────
function seedZones() {
  const src = readFileSync(SEED, 'utf8');
  const start = src.indexOf('const spaceData = [');
  const end = src.indexOf('];', start);
  if (start < 0 || end < 0) throw new Error('seed.ts spaceData 블록을 찾지 못함 — 시드 구조가 바뀌었는지 확인');
  const block = src.slice(start, end);
  const re = /code: '([^']+)', nodeType: 'ZONE'[^\n]*?floor: (-?\d+)/g;
  const out = new Map();
  let m;
  while ((m = re.exec(block))) out.set(m[1], Number(m[2]));
  if (out.size < 50) throw new Error(`seed.ts ZONE 추출 ${out.size}건 — 정규식이 빗나갔을 가능성(기대 ~69)`);
  return out;
}

// ─────────────────────────────────────────────────────────────
// SVG
// ─────────────────────────────────────────────────────────────
const FONT = "Apple SD Gothic Neo, 'Noto Sans KR', 'Malgun Gothic', sans-serif";
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const X = (m) => MARGIN.l + m * PX;
const Y = (m) => MARGIN.t + m * PX;
const textW = (t, fs) => [...t].reduce((w, ch) => w + (/[ㄱ-힝]/.test(ch) ? fs : fs * 0.58), 0);

function label(s) {
  const w = (s.x2 - s.x1) * PX, h = (s.y2 - s.y1) * PX;
  const cx = X((s.x1 + s.x2) / 2), cy = Y((s.y1 + s.y2) / 2);
  const area = `${r2((s.x2 - s.x1) * (s.y2 - s.y1)).toFixed(1)}㎡`;
  let lines = [s.name];
  let fs = 12;
  while (fs > 8 && textW(s.name, fs) > w * 0.9) fs--;
  if (textW(s.name, fs) > w * 0.9) {
    const cut = s.name.search(/[ (/·]/) > 0 ? s.name.search(/[ (/·]/) : Math.ceil(s.name.length / 2);
    lines = [s.name.slice(0, cut).trim(), s.name.slice(cut).trim()];
    fs = 10;
    while (fs > 7 && Math.max(...lines.map((l) => textW(l, fs))) > w * 0.92) fs--;
  }
  const small = Math.max(7, fs - 3);
  const extra = [];
  if (s.num && !s.name.includes(s.num)) extra.push(s.num);
  if (s.type !== 'CORRIDOR' && s.type !== 'SHAFT' && h > 40) extra.push(area);
  const total = lines.length * (fs + 2) + extra.length * (small + 2);
  let y = cy - total / 2 + fs;
  const out = [];
  for (const l of lines) { out.push(`<text x="${cx}" y="${y}" font-size="${fs}" font-weight="600">${esc(l)}</text>`); y += fs + 2; }
  for (const l of extra) { y += small - fs + 2; out.push(`<text x="${cx}" y="${y}" font-size="${small}" fill="#444">${esc(l)}</text>`); y += fs; }
  return out.join('');
}

function fixtures(s) {
  const f = [];
  const L = (x1, y1, x2, y2, extra = '') => f.push(`<line x1="${X(x1)}" y1="${Y(y1)}" x2="${X(x2)}" y2="${Y(y2)}" ${extra}/>`);
  const R = (x, y, w, h, extra = '') => f.push(`<rect x="${X(x)}" y="${Y(y)}" width="${w * PX}" height="${h * PX}" ${extra}/>`);
  const C = (x, y, r, extra = '') => f.push(`<circle cx="${X(x)}" cy="${Y(y)}" r="${r * PX}" ${extra}/>`);
  const W = s.x2 - s.x1, H = s.y2 - s.y1;
  const bedRow = (n, yTop, bw = 1.0, bl = 2.1) => {
    const gap = W / n;
    for (let i = 0; i < n; i++) {
      const bx = s.x1 + gap * i + gap / 2 - bw / 2;
      R(bx, yTop, bw, bl, 'class="fx"');
      R(bx + 0.15, yTop + 0.1, bw - 0.3, 0.45, 'class="fx"');
    }
  };
  switch (s.type) {
    case 'WARD_ROOM': {
      // 병실 화장실(복도측 서쪽 모서리) + 침상(머리=외벽)
      R(s.x1 + 0.1, s.y1 + 0.1, 1.7, 2.2, 'class="fxw"');
      f.push(`<text x="${X(s.x1 + 0.95)}" y="${Y(s.y1 + 1.35)}" font-size="7" fill="#666">WC</text>`);
      bedRow(s.cap ?? 2, s.y2 - 2.4);
      break;
    }
    case 'ER': case 'ICU': case 'RECOVERY': case 'DELIVERY': case 'ISOLATION': {
      const n = s.cap ?? 2;
      if (n <= 4 || H < 9) bedRow(Math.min(n, Math.max(1, Math.floor(W / 2.2))), s.y2 - 2.5);
      else {
        const perRow = Math.ceil(n / 2);
        bedRow(perRow, s.y1 + 0.6);
        bedRow(n - perRow, s.y2 - 2.7);
        R(s.x1 + W / 2 - 2.5, s.y1 + H / 2 + 1.4, 5, 1.6, 'class="fxw"');
        f.push(`<text x="${X(s.x1 + W / 2)}" y="${Y(s.y1 + H / 2 + 2.2) + 3}" font-size="7" fill="#666">간호 데스크</text>`);
      }
      if (s.type === 'ISOLATION') f.push(`<text x="${X(s.x1 + W / 2)}" y="${Y(s.y1 + 0.9)}" font-size="7" fill="#b00">음압(−)</text>`);
      break;
    }
    case 'NURSERY': {
      // 인큐베이터 — 방 이름을 비켜 위·아래 두 줄
      for (let i = 0; i < (s.cap ?? 6); i++) R(s.x1 + 0.6 + (i % 4) * 1.9, i < 4 ? s.y1 + 0.8 : s.y2 - 1.6, 0.9, 0.6, 'class="fx"');
      break;
    }
    case 'SURGERY': {
      R(s.x1 + W / 2 - 0.3, s.y1 + H / 2 - 1.0, 0.6, 2.0, 'class="fx"');
      C(s.x1 + W / 2, s.y1 + H / 2, 1.1, 'class="fxd"');
      break;
    }
    case 'ELEVATOR': {
      R(s.x1 + 0.2, s.y1 + 0.2, W - 0.4, H - 0.4, 'class="fx"');
      L(s.x1 + 0.2, s.y1 + 0.2, s.x2 - 0.2, s.y2 - 0.2, 'class="fx"');
      L(s.x2 - 0.2, s.y1 + 0.2, s.x1 + 0.2, s.y2 - 0.2, 'class="fx"');
      break;
    }
    case 'STAIR': {
      const horizTreads = H > W;
      const midX = s.x1 + W / 2;
      if (horizTreads) {
        L(midX, s.y1 + 1.2, midX, s.y2 - 1.2, 'class="fx"');
        for (let y = s.y1 + 1.2; y <= s.y2 - 1.2 + EPS; y += 0.28) L(s.x1 + 0.15, y, s.x2 - 0.15, y, 'class="fxt"');
        f.push(`<text x="${X(midX)}" y="${Y(s.y1 + 0.8)}" font-size="7" fill="#666">UP ↑ / DN ↓</text>`);
      }
      break;
    }
    case 'TOILET': {
      if (W >= 3.5 && H >= 6) for (let i = 0; i < 3; i++) R(s.x1 + 0.1, s.y1 + 0.2 + i * 1.5, 1.4, 1.4, 'class="fxw"');
      break;
    }
    case 'CLINIC': {
      R(s.x1 + 0.4, s.y1 + H * 0.35, 1.4, 0.7, 'class="fx"');   // 진료 책상
      R(s.x2 - 1.1, s.y1 + 0.5, 0.7, 1.9, 'class="fx"');       // 진찰대
      break;
    }
    case 'LAB': case 'RECEPTION': case 'CASHIER': case 'PHARMACY': {
      const horizontal = W >= H;
      if (horizontal) R(s.x1 + 0.5, s.y2 - 1.6, W - 1.0, 0.6, 'class="fx"');
      else R(s.x1 + 0.5, s.y1 + 0.5, 0.6, H - 1.0, 'class="fx"');
      break;
    }
    case 'THERAPY': {
      for (let i = 0; i < Math.min(s.cap ?? 4, Math.floor(W / 2.4)); i++) R(s.x1 + 0.8 + i * 2.4, s.y1 + 3.0, 0.8, 1.9, 'class="fx"');
      break;
    }
  }
  if (s.shield) f.push(`<rect x="${X(s.x1) + 3}" y="${Y(s.y1) + 3}" width="${(W) * PX - 6}" height="${H * PX - 6}" class="shield"/>`);
  if (s.esc) {
    const [x1, y1, x2, y2] = s.esc;
    R(x1, y1, x2 - x1, y2 - y1, 'class="fx"');
    L((x1 + x2) / 2, y1, (x1 + x2) / 2, y2, 'class="fx"');
    for (let y = y1 + 0.4; y < y2; y += 0.5) { L(x1 + 0.1, y, (x1 + x2) / 2 - 0.1, y, 'class="fxt"'); L((x1 + x2) / 2 + 0.1, y, x2 - 0.1, y, 'class="fxt"'); }
    f.push(`<text x="${X((x1 + x2) / 2)}" y="${Y(y2) + 11}" font-size="8" fill="#444">에스컬레이터</text>`);
  }
  return f.join('');
}

function doorSvg(c, spaces) {
  const owner = spaces.find((s) => s.id === c.owner);
  const [x, y] = c.at;
  const w = c.widthM;
  const horiz = c.side === 'N' || c.side === 'S';
  const out = [];
  if (c.kind === 'OPENING') return ''; // 벽 없는 공간끼리 — 끊을 벽이 없다
  // 벽 끊기
  if (horiz) out.push(`<rect x="${X(x - w / 2)}" y="${Y(y) - 4}" width="${w * PX}" height="8" fill="#fff"/>`);
  else out.push(`<rect x="${X(x) - 4}" y="${Y(y - w / 2)}" width="8" height="${w * PX}" fill="#fff"/>`);
  // 문짝 — 소유 공간 안쪽으로 열림(외부 출입구는 바깥에서 안쪽)
  const inward = c.kind === 'EXTERIOR' ? { N: 1, S: -1, W: 1, E: -1 }[c.side] : { N: 1, S: -1, W: 1, E: -1 }[c.side];
  const leaves = w >= 1.5 ? [[-w / 2, w / 2], [w / 2, w / 2]] : [[-w / 2, w]];
  for (const [off, len] of leaves) {
    const sgn = off < 0 ? 1 : -1;
    if (horiz) {
      const hx = x + off, hy = y;
      const ex = hx, ey = hy + inward * len;
      const ax = hx + sgn * len;
      out.push(`<line x1="${X(hx)}" y1="${Y(hy)}" x2="${X(ex)}" y2="${Y(ey)}" class="leaf"/>`);
      out.push(`<path d="M ${X(ex)} ${Y(ey)} A ${len * PX} ${len * PX} 0 0 ${(sgn * inward > 0) ? 0 : 1} ${X(ax)} ${Y(hy)}" class="swing"/>`);
    } else {
      const hx = x, hy = y + off;
      const ex = hx + inward * len, ey = hy;
      const ay = hy + sgn * len;
      out.push(`<line x1="${X(hx)}" y1="${Y(hy)}" x2="${X(ex)}" y2="${Y(ey)}" class="leaf"/>`);
      out.push(`<path d="M ${X(ex)} ${Y(ey)} A ${len * PX} ${len * PX} 0 0 ${(sgn * inward > 0) ? 1 : 0} ${X(hx)} ${Y(ay)}" class="swing"/>`);
    }
  }
  if (c.restricted && c.boundary) out.push(`<text x="${X(x)}" y="${Y(y) - 8}" font-size="7" fill="#b00">관계자외 출입금지</text>`);
  void owner;
  return out.join('');
}

const ASSET_STYLE = {
  MEDICAL_DEVICE: { fill: '#d32f2f', shape: 'circle', name: '의료기기·장비' },
  IT: { fill: '#1565c0', shape: 'square', name: 'PC·단말·워크스테이션' },
  STORAGE: { fill: '#2e7d32', shape: 'triangle', name: '물품 보관 장소' },
  DISPLAY: { fill: '#6a1b9a', shape: 'diamond', name: '전광판' },
};
function assetMarker(a, meta) {
  const st = ASSET_STYLE[meta[a.kind].group];
  const x = X(a.at[0]), y = Y(a.at[1]), r = 5;
  const shape = {
    circle: `<circle cx="${x}" cy="${y}" r="${r}"/>`,
    square: `<rect x="${x - r}" y="${y - r}" width="${2 * r}" height="${2 * r}"/>`,
    triangle: `<path d="M ${x} ${y - r - 1} L ${x + r + 1} ${y + r} L ${x - r - 1} ${y + r} Z"/>`,
    diamond: `<path d="M ${x} ${y - r - 1} L ${x + r + 1} ${y} L ${x} ${y + r + 1} L ${x - r - 1} ${y} Z"/>`,
  }[st.shape];
  return `<g fill="${st.fill}" stroke="#fff" stroke-width="1.2">${shape}</g><text x="${x}" y="${y + 3}" font-size="6.5" fill="#fff" font-weight="700">${a.id.slice(-3).replace(/^0+/, '')}</text>`;
}

function renderSvg(fl, assets = null, meta = null) {
  const { F, spaces, conns } = fl;
  const Wpx = MARGIN.l + F.fp.w * PX + MARGIN.r;
  const Hpx = MARGIN.t + F.fp.h * PX + MARGIN.b;
  const o = [];
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${Wpx}" height="${Hpx}" viewBox="0 0 ${Wpx} ${Hpx}" font-family="${FONT}" text-anchor="middle">`);
  o.push(`<style>
    .wall{fill:none;stroke:#111;stroke-width:4}
    .ext{fill:none;stroke:#000;stroke-width:8}
    .col{fill:#111}
    .grid{stroke:#9aa;stroke-width:0.8;stroke-dasharray:10 4 2 4}
    .fx{fill:none;stroke:#555;stroke-width:1}
    .fxw{fill:#fff;stroke:#555;stroke-width:1}
    .fxt{stroke:#888;stroke-width:0.6}
    .fxd{fill:none;stroke:#888;stroke-width:0.8;stroke-dasharray:3 2}
    .leaf{stroke:#111;stroke-width:1.6}
    .swing{fill:none;stroke:#333;stroke-width:0.8}
    .shield{fill:none;stroke:#666;stroke-width:2;stroke-dasharray:6 3}
    .rx{fill:url(#hatch)}
    .zone{fill:none;stroke:#777;stroke-width:1;stroke-dasharray:2 3}
  </style>`);
  o.push(`<defs><pattern id="hatch" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="10" stroke="#ddd" stroke-width="2"/></pattern></defs>`);
  o.push(`<rect width="${Wpx}" height="${Hpx}" fill="#fff"/>`);

  // 격자
  for (let i = 0; i < GX.length; i++) {
    o.push(`<line x1="${X(GX[i])}" y1="${MARGIN.t - 40}" x2="${X(GX[i])}" y2="${Y(F.fp.h) + 20}" class="grid"/>`);
    o.push(`<circle cx="${X(GX[i])}" cy="${MARGIN.t - 55}" r="13" fill="#fff" stroke="#333"/><text x="${X(GX[i])}" y="${MARGIN.t - 51}" font-size="11">X${i + 1}</text>`);
    if (i < GX.length - 1) o.push(`<text x="${X((GX[i] + GX[i + 1]) / 2)}" y="${MARGIN.t - 76}" font-size="9" fill="#555">${(GX[i + 1] - GX[i]).toFixed(1)}</text>`);
  }
  F.gy.forEach((gy, i) => {
    o.push(`<line x1="${MARGIN.l - 40}" y1="${Y(gy)}" x2="${X(F.fp.w) + 20}" y2="${Y(gy)}" class="grid"/>`);
    o.push(`<circle cx="${MARGIN.l - 55}" cy="${Y(gy)}" r="13" fill="#fff" stroke="#333"/><text x="${MARGIN.l - 55}" y="${Y(gy) + 4}" font-size="11">Y${i + 1}</text>`);
    if (i < F.gy.length - 1) o.push(`<text x="${MARGIN.l - 85}" y="${Y((gy + F.gy[i + 1]) / 2) + 3}" font-size="9" fill="#555">${(F.gy[i + 1] - gy).toFixed(1)}</text>`);
  });

  // 통제 구역 빗금 → 벽 → 기둥
  for (const s of spaces) if (s.rx) o.push(`<rect x="${X(s.x1)}" y="${Y(s.y1)}" width="${(s.x2 - s.x1) * PX}" height="${(s.y2 - s.y1) * PX}" class="rx"/>`);
  // 벽 없는 구역(대기·홀·로비)은 실도면처럼 가는 점선으로 경계만 — 판독 시험이 경계를 알 수 있게
  for (const s of spaces) if (s.open && s.type !== 'CORRIDOR') o.push(`<rect x="${X(s.x1) + 2}" y="${Y(s.y1) + 2}" width="${(s.x2 - s.x1) * PX - 4}" height="${(s.y2 - s.y1) * PX - 4}" class="zone"/>`);
  for (const s of spaces) if (!s.open) o.push(`<rect x="${X(s.x1)}" y="${Y(s.y1)}" width="${(s.x2 - s.x1) * PX}" height="${(s.y2 - s.y1) * PX}" class="wall"/>`);
  // 통제 경계(개구부 대신 문)는 벽선을 그린다
  for (const c of conns) if (c.boundary) {
    const e = c.boundary;
    o.push(e.orient === 'H'
      ? `<line x1="${X(e.x1)}" y1="${Y(e.y)}" x2="${X(e.x2)}" y2="${Y(e.y)}" class="wall"/>`
      : `<line x1="${X(e.x)}" y1="${Y(e.y1)}" x2="${X(e.x)}" y2="${Y(e.y2)}" class="wall"/>`);
  }
  o.push(`<rect x="${X(F.fp.x)}" y="${Y(F.fp.y)}" width="${F.fp.w * PX}" height="${F.fp.h * PX}" class="ext"/>`);
  for (const gx of GX) for (const gy of F.gy) o.push(`<rect x="${X(gx) - 8}" y="${Y(gy) - 8}" width="16" height="16" class="col"/>`);

  for (const s of spaces) o.push(fixtures(s));
  for (const c of conns) o.push(doorSvg(c, spaces));
  // 외부 출입구 표시
  for (const c of conns) if (c.kind === 'EXTERIOR') {
    const o2 = OUTWARD[c.side];
    const tx = X(c.at[0] + o2[0] * 1.6), ty = Y(c.at[1] + o2[1] * 1.6) + 4;
    o.push(`<text x="${tx}" y="${ty}" font-size="9" font-weight="700">▲ 출입</text>`);
  }
  for (const s of spaces) o.push(label(s));
  if (assets) {
    for (const a of assets) o.push(assetMarker(a, meta));
    // 범례 + 목록(도면 아래)
    const lx = MARGIN.l + 20 * PX + 70, ly = Hpx - 125;
    o.push(`<g text-anchor="start">`);
    Object.entries(ASSET_STYLE).forEach(([, st], i) => {
      const cnt = assets.filter((a) => ASSET_STYLE[meta[a.kind].group] === st).length;
      o.push(assetMarker({ id: 'SYN-000', kind: Object.keys(meta).find((k) => ASSET_STYLE[meta[k].group] === st), at: [0, 0] }, meta)
        .replace(/cx="[^"]+" cy="[^"]+"/, `cx="${lx}" cy="${ly + i * 18}"`)
        .replace(/<rect x="[^"]+" y="[^"]+"/, `<rect x="${lx - 5}" y="${ly + i * 18 - 5}"`)
        .replace(/<path d="[^"]+"/, st.shape === 'triangle' ? `<path d="M ${lx} ${ly + i * 18 - 6} L ${lx + 6} ${ly + i * 18 + 5} L ${lx - 6} ${ly + i * 18 + 5} Z"` : `<path d="M ${lx} ${ly + i * 18 - 6} L ${lx + 6} ${ly + i * 18} L ${lx} ${ly + i * 18 + 6} L ${lx - 6} ${ly + i * 18} Z"`)
        .replace(/<text[^>]*>[^<]*<\/text>/, ''));
      o.push(`<text x="${lx + 12}" y="${ly + i * 18 + 4}" font-size="11">${st.name} ${cnt}</text>`);
    });
    o.push(`<text x="${lx}" y="${ly + 82}" font-size="10" fill="#b00">가상 배치 예시 — 실제 장비 목록 아님 · 번호 = 정답 JSON assets[].id 끝자리</text></g>`);
  }

  // 방위표 · 축척 · 표제란
  const nx = Wpx - 45, ny = 45;
  o.push(`<g><circle cx="${nx}" cy="${ny}" r="20" fill="none" stroke="#333"/><path d="M ${nx} ${ny - 18} L ${nx - 7} ${ny + 8} L ${nx} ${ny + 3} L ${nx + 7} ${ny + 8} Z" fill="#111"/><text x="${nx}" y="${ny - 24}" font-size="11" font-weight="700">N</text></g>`);
  const sx = MARGIN.l, sy = Hpx - 105;
  o.push(`<g>`);
  [0, 5, 10, 20].forEach((m, i, arr) => {
    if (i < arr.length - 1) o.push(`<rect x="${sx + m * PX}" y="${sy}" width="${(arr[i + 1] - m) * PX}" height="6" fill="${i % 2 ? '#fff' : '#111'}" stroke="#111"/>`);
    o.push(`<text x="${sx + m * PX}" y="${sy + 20}" font-size="10">${m}</text>`);
  });
  o.push(`<text x="${sx + 20 * PX + 18}" y="${sy + 20}" font-size="10">m</text></g>`);
  const tbw = 560, tbx = Wpx - MARGIN.r - tbw, tby = Hpx - 125;
  o.push(`<g text-anchor="start"><rect x="${tbx}" y="${tby}" width="${tbw}" height="105" fill="#fff" stroke="#111" stroke-width="1.5"/>`);
  o.push(`<text x="${tbx + 12}" y="${tby + 24}" font-size="15" font-weight="700">위루비병원 본관 · ${esc(F.title)}</text>`);
  o.push(`<text x="${tbx + 12}" y="${tby + 46}" font-size="11">바닥 표고 FL ${F.elev >= 0 ? '+' : ''}${F.elev.toFixed(1)}m · 층고 ${F.height.toFixed(1)}m · 기둥 격자 8.4m · 치수 단위 m</text>`);
  o.push(`<text x="${tbx + 12}" y="${tby + 66}" font-size="11">빗금 = 출입 통제 구역 · 굵은 점선 = 방사선 차폐 · 가는 점선 = 벽 없는 구역 경계</text>`);
  o.push(`<text x="${tbx + 12}" y="${tby + 90}" font-size="12" font-weight="700" fill="#b00">${esc(NOTICE)}</text></g>`);
  o.push(`<text x="${Wpx / 2}" y="30" font-size="13" fill="#b00" font-weight="700">SYNTHETIC FLOOR PLAN — NOT A REAL BUILDING${assets ? ' · 장비·단말 배치도' : ''}</text>`);
  o.push('</svg>');
  return o.join('\n');
}

// ─────────────────────────────────────────────────────────────
// 실행
// ─────────────────────────────────────────────────────────────
const built = FLOORS.map(buildFloor);

// 수직 연결: 같은 v 키를 가진 공간이 연속한 층에 있으면 잇는다
const vertical = [];
const vEdges = [];
const VKIND = { EV1: ['ELEVATOR', true, '비상용(침대)'], EV2: ['ELEVATOR', true, '침대용'], EV3: ['ELEVATOR', true, '승객용'], EV4: ['ELEVATOR', true, '승객용'],
  STA: ['STAIR', false, '특별피난계단'], STB: ['STAIR', false, '특별피난계단'], STC: ['STAIR', false, '피난계단'], STD: ['STAIR', false, '피난계단'] };
for (const [v, [kind, accessible, note]] of Object.entries(VKIND)) {
  const stops = built.flatMap((b) => b.spaces.filter((s) => s.v === v).map((s) => ({ floor: b.F.key, level: b.F.level, spaceId: s.id, nodeId: `${s.id}:c` })));
  vertical.push({ id: v, kind, accessible, note, stops: stops.map(({ floor, spaceId, nodeId }) => ({ floor, spaceId, nodeId })) });
  const order = FLOORS.map((f) => f.key);
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1], b = stops[i];
    if (order.indexOf(b.floor) - order.indexOf(a.floor) !== 1) fail(`${v}: ${a.floor}→${b.floor} 층 건너뜀`);
    const lower = FLOORS.find((f) => f.key === a.floor);
    vEdges.push({ from: a.nodeId, to: b.nodeId, kind, distanceM: r2(lower.height), accessible, restricted: false });
  }
}
// 에스컬레이터 1F 로비 ↔ 2F 에스컬레이터 홀
{
  const a = built[1].spaces.find((s) => s.esc), b = built[2].spaces.find((s) => s.esc);
  vertical.push({ id: 'ESC1', kind: 'ESCALATOR', accessible: false, note: '1F↔2F', stops: [{ floor: '1F', spaceId: a.id, nodeId: `${a.id}:c` }, { floor: '2F', spaceId: b.id, nodeId: `${b.id}:c` }] });
  vEdges.push({ from: `${a.id}:c`, to: `${b.id}:c`, kind: 'ESCALATOR', distanceM: r2(Math.hypot(5.0, 8.0)), accessible: false, restricted: false });
}

// 건물 전체 접근성 도달 — 1F 주출입구에서 엘리베이터·경사 없는 경로만으로 모든 공간
{
  const all = [...built.flatMap((b) => b.edges), ...vEdges].filter((e) => e.accessible);
  const adj = new Map();
  const add = (a, b) => { if (!adj.has(a)) adj.set(a, []); adj.get(a).push(b); };
  for (const e of all) { add(e.from, e.to); add(e.to, e.from); }
  const start = `${built[1].spaces.find((s) => s.name === '주출입구 풍제실').id}:c`;
  const seen = new Set([start]); const q = [start];
  while (q.length) { const n = q.shift(); for (const m of adj.get(n) ?? []) if (!seen.has(m)) { seen.add(m); q.push(m); } }
  for (const b of built) for (const s of b.spaces) {
    if (s.type === 'SHAFT' || s.type === 'CORRIDOR') continue;
    if (!seen.has(`${s.id}:c`)) fail(`${b.F.key} ${s.name}: 주출입구에서 접근성 경로(엘리베이터)로 도달 불가`);
  }
}

// 시드 대조
{
  const seed = seedZones();
  const mapped = new Map();
  for (const b of built) for (const s of b.spaces) if (s.code) {
    if (mapped.has(s.code)) fail(`SpaceNode 코드 중복: ${s.code}`);
    mapped.set(s.code, b.F.level);
  }
  for (const [code, fl] of seed) {
    if (!mapped.has(code)) fail(`시드 ZONE ${code} 가 도면에 없음`);
    else if (mapped.get(code) !== fl) fail(`시드 ZONE ${code}: 시드 ${fl}층 ↔ 도면 ${mapped.get(code)}층`);
  }
  for (const code of mapped.keys()) if (!seed.has(code)) fail(`도면 코드 ${code} 는 시드에 없음`);
  console.log(`시드 ZONE ${seed.size} · 도면 매핑 ${mapped.size} · 도면 공간 ${built.reduce((n, b) => n + b.spaces.length, 0)}`);
}

// 자산 배치(가상) — shared 정본 어휘로 검증
const shared = createRequire(join(ROOT, 'package.json'))(join(ROOT, 'packages/shared'));
const ASSETS = new Map(built.map((b) => [b.F.key, placeAssets(b, shared.ASSET_KINDS)]));

if (errors.length) {
  console.error(`\n❌ 검증 실패 ${errors.length}건`);
  for (const e of errors) console.error(' - ' + e);
  process.exit(1);
}

// 출력
mkdirSync(OUT, { recursive: true });
const noPng = process.argv.includes('--no-png');
const sharp = noPng ? null : createRequire(join(ROOT, 'package.json'))('sharp');
const truth = {
  schema: 'space-import.v1',
  synthetic: true,
  notice: NOTICE,
  generator: 'scripts/floorplan/generate-synthetic-floorplans.mjs',
  coordinateSystem: '미터 · 원점=건물 북서 모서리 · x=동쪽 · y=남쪽(도면 아래쪽)',
  drawing: { pxPerMeter: PX, originPx: [MARGIN.l, MARGIN.t] },
  hospitalCode: 'HOSP',
  building: { code: 'MAIN', name: '본관', gridX: GX, podium: PODIUM, tower: TOWER },
  floors: [],
  vertical,
  verticalEdges: vEdges,
  // 출입구 — 길안내 출발점(P3). main = 주출입구 · restricted = 직원·물류 전용(환자 경로 출발점으로 쓰지 않는다)
  entrances: built.flatMap((b) => b.conns.filter((c) => c.kind === 'EXTERIOR').map((c) => {
    const sp = b.spaces.find((x) => x.id === c.owner);
    return { id: c.id, floor: b.F.key, spaceId: sp.id, name: sp.name, nodeId: c.id, main: sp.name === '주출입구 풍제실', restricted: !!c.restricted };
  })),
};
for (const b of built) {
  const { F } = b;
  const svg = renderSvg(b);
  writeFileSync(join(OUT, `${F.key}.svg`), svg);
  if (sharp) await sharp(Buffer.from(svg)).png({ compressionLevel: 9, palette: true }).toFile(join(OUT, `${F.key}.png`));
  const svgA = renderSvg(b, ASSETS.get(F.key), shared.ASSET_KIND_META);
  writeFileSync(join(OUT, `${F.key}.assets.svg`), svgA);
  if (sharp) await sharp(Buffer.from(svgA)).png({ compressionLevel: 9, palette: true }).toFile(join(OUT, `${F.key}.assets.png`));
  truth.floors.push({
    key: F.key,
    spaceNodeCode: F.seedCode,
    level: F.level,
    title: F.title,
    elevationM: F.elev,
    heightM: F.height,
    footprint: F.fp,
    gridY: F.gy,
    files: { svg: `${F.key}.svg`, png: `${F.key}.png`, assetsSvg: `${F.key}.assets.svg`, assetsPng: `${F.key}.assets.png` },
    assets: ASSETS.get(F.key),
    spaces: b.spaces.map((s) => ({
      id: s.id,
      spaceNodeCode: s.code ?? null,
      name: s.name,
      number: s.num ?? null,
      type: s.type,
      rect: { x: s.x1, y: s.y1, w: r2(s.x2 - s.x1), h: r2(s.y2 - s.y1) },
      areaM2: r2((s.x2 - s.x1) * (s.y2 - s.y1)),
      capacity: s.cap ?? null,
      open: s.open,
      restricted: !!s.rx,
      radiationShielded: !!s.shield,
      verticalCore: s.v ?? null,
    })),
    connections: b.conns.map((c) => ({ id: c.id, kind: c.kind, at: c.at.map(r2), widthM: c.widthM, between: c.between, restricted: c.restricted })),
    graph: { nodes: b.nodes, edges: b.edges },
  });
}
writeFileSync(join(OUT, 'space-import.v1.json'), JSON.stringify(truth, null, 1) + '\n');
const nConn = truth.floors.reduce((n, f) => n + f.connections.length, 0);
const nEdge = truth.floors.reduce((n, f) => n + f.graph.edges.length, 0) + vEdges.length;
const nAsset = [...ASSETS.values()].reduce((n, a) => n + a.length, 0);
const byKind = {};
for (const a of [...ASSETS.values()].flat()) byKind[a.kind] = (byKind[a.kind] ?? 0) + 1;
console.log(`✅ ${FLOORS.length}개 층 · 연결 ${nConn} · 그래프 간선 ${nEdge}(수직 ${vEdges.length}) · 자산 ${nAsset} ${JSON.stringify(byKind)} → ${OUT}`);
