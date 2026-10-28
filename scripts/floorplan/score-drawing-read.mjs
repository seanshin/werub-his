#!/usr/bin/env node
// 도면 판독 채점 — 판독 결과(read-<층>.json)를 합성 도면 정답(space-import.v1.json)과 대조한다(기획 spatial-flow-vision-3d P1 수용 시험).
//
// 🔴 판독자는 **생성기·정답을 보지 않은 새 에이전트**(같은 모델 계열)에게 PNG 한 장만 주고 받았다
//    (도면을 만든 쪽이 직접 읽으면 답을 아는 채 푸는 것이라 측정이 아니다). 그래도 이것은
//    **합성 도면**(깨끗한 벡터 렌더·격자·면적 표기가 있다)에 대한 결과다 — 실제 병원 CAD/스캔 도면의 정확도가 아니다.
//
// 방: 이름(공백 제거) 일치 · 동명이면 IoU 최대로 1:1 · 재현율/정밀도 · IoU · 모서리 최대 오차(m)
// 문: 정답의 DOOR·EXTERIOR(개구부 제외) ↔ 판독 문 — 두 공간 이름 쌍 + 거리 ≤ 1.5m · 개구부를 문으로 읽은 수 따로
//
// 실행: node scripts/floorplan/score-drawing-read.mjs [--json]
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DIR = join(ROOT, 'apps/api/prisma/fixtures/floorplans-synthetic');
const truth = JSON.parse(readFileSync(join(DIR, 'space-import.v1.json'), 'utf8'));
const norm = (s) => String(s).replace(/\s+/g, '');
const iou = (a, b) => {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy;
  return inter / (a.w * a.h + b.w * b.h - inter);
};
const edgeErr = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.x + a.w - b.x - b.w), Math.abs(a.y + a.h - b.y - b.h));
const pct = (n, d) => (d ? Math.round((1000 * n) / d) / 10 : null);
const q = (arr, p) => { if (!arr.length) return null; const s = [...arr].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]; };

export function scoreFloor(F, read) {
  const spaces = F.spaces;
  const nameOf = new Map(spaces.map((s) => [s.id, s.name]));
  // 방 1:1 매칭
  const used = new Set();
  const pairs = [];
  const unmatchedRead = [];
  for (const r of read.rooms) {
    const cands = spaces.filter((s) => !used.has(s.id) && norm(s.name) === norm(r.name));
    if (!cands.length) { unmatchedRead.push(r.name); continue; }
    const best = cands.reduce((m, s) => (iou(s.rect, r.rect) > iou(m.rect, r.rect) ? s : m));
    used.add(best.id);
    pairs.push({ truth: best, read: r, iou: iou(best.rect, r.rect), err: edgeErr(best.rect, r.rect) });
  }
  const missed = spaces.filter((s) => !used.has(s.id)).map((s) => s.name);
  // 문
  const tDoors = F.connections.filter((c) => c.kind !== 'OPENING').map((c) => ({
    c, names: [nameOf.get(c.between[0]), c.between[1] ? nameOf.get(c.between[1]) : 'EXTERIOR'].map(norm).sort().join('|'),
  }));
  const tOpen = F.connections.filter((c) => c.kind === 'OPENING').map((c) => ({
    c, names: [nameOf.get(c.between[0]), nameOf.get(c.between[1])].map(norm).sort().join('|'),
  }));
  const dUsed = new Set();
  let dMatch = 0, openingAsDoor = 0;
  const dMissFalse = [];
  for (const d of read.doors) {
    const key = d.between.map(norm).sort().join('|');
    const hit = tDoors.find((t) => !dUsed.has(t.c.id) && t.names === key && Math.hypot(t.c.at[0] - d.at[0], t.c.at[1] - d.at[1]) <= 1.5);
    if (hit) { dUsed.add(hit.c.id); dMatch++; continue; }
    if (tOpen.some((t) => t.names === key)) openingAsDoor++;
    else dMissFalse.push(`${d.between.join('↔')}@${d.at.join(',')}`);
  }
  const missedDoors = tDoors.filter((t) => !dUsed.has(t.c.id)).map((t) => `${nameOf.get(t.c.between[0])}↔${t.c.between[1] ? nameOf.get(t.c.between[1]) : '외부'}`);
  const ious = pairs.map((p) => p.iou);
  const errs = pairs.map((p) => p.err);
  return {
    floor: F.key,
    rooms: {
      truth: spaces.length, read: read.rooms.length, matched: pairs.length,
      recallPct: pct(pairs.length, spaces.length), precisionPct: pct(pairs.length, read.rooms.length),
      iouMean: ious.length ? Math.round((1000 * ious.reduce((a, b) => a + b, 0)) / ious.length) / 1000 : null,
      iouP10: q(ious, 0.1) == null ? null : Math.round(1000 * q(ious, 0.1)) / 1000,
      iouGe09Pct: pct(ious.filter((x) => x >= 0.9).length, ious.length),
      edgeErrP90M: q(errs, 0.9) == null ? null : Math.round(10 * q(errs, 0.9)) / 10,
      edgeErrMaxM: errs.length ? Math.round(10 * Math.max(...errs)) / 10 : null,
      missed, unmatchedRead,
      worst: pairs.filter((p) => p.iou < 0.9).map((p) => `${p.truth.name} IoU ${Math.round(100 * p.iou) / 100}`),
    },
    doors: {
      truth: tDoors.length, read: read.doors.length, matched: dMatch,
      recallPct: pct(dMatch, tDoors.length), precisionPct: pct(dMatch, read.doors.length),
      openingReadAsDoor: openingAsDoor, falseDoors: dMissFalse, missed: missedDoors,
    },
  };
}

const reads = readdirSync(join(DIR, 'read-test')).filter((f) => /^read-.*\.json$/.test(f)).sort();
const results = reads.map((f) => {
  const read = JSON.parse(readFileSync(join(DIR, 'read-test', f), 'utf8'));
  const F = truth.floors.find((x) => x.key === read.floor);
  if (!F) throw new Error(`정답에 층 ${read.floor} 없음`);
  return scoreFloor(F, read);
});
if (process.argv.includes('--json')) console.log(JSON.stringify(results, null, 1));
else for (const r of results) {
  console.log(`\n■ ${r.floor}  방 재현 ${r.rooms.recallPct}% (${r.rooms.matched}/${r.rooms.truth}) · 정밀 ${r.rooms.precisionPct}% · IoU 평균 ${r.rooms.iouMean} · IoU≥0.9 ${r.rooms.iouGe09Pct}% · 모서리 오차 p90 ${r.rooms.edgeErrP90M}m 최대 ${r.rooms.edgeErrMaxM}m`);
  console.log(`   문 재현 ${r.doors.recallPct}% (${r.doors.matched}/${r.doors.truth}) · 정밀 ${r.doors.precisionPct}% · 개구부를 문으로 ${r.doors.openingReadAsDoor}`);
  if (r.rooms.missed.length) console.log(`   놓친 공간: ${r.rooms.missed.join(', ')}`);
  if (r.rooms.unmatchedRead.length) console.log(`   정답에 없는 판독: ${r.rooms.unmatchedRead.join(', ')}`);
  if (r.rooms.worst.length) console.log(`   IoU<0.9: ${r.rooms.worst.join(', ')}`);
  if (r.doors.falseDoors.length) console.log(`   틀린 문: ${r.doors.falseDoors.join(' · ')}`);
  console.log(`   놓친 문 ${r.doors.missed.length}: ${r.doors.missed.join(' · ')}`);
}
