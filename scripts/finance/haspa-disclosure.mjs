#!/usr/bin/env node
/**
 * 의료기관 회계정보공시(한국보건산업진흥원 HASPA · https://haspa.khidi.or.kr/total-public-inq) 손익계산서 → 경영성과 벤치마크 가져오기 CSV.
 *
 *   node scripts/finance/haspa-disclosure.mjs fetch <캐시폴더> [--years 2016-2024] [--concurrency 4]
 *   node scripts/finance/haspa-disclosure.mjs csv   <캐시폴더> <출력.csv> [--coords <institutions.json>...]
 *
 * - fetch: 공개 목록 페이지(10곳씩)에서 기관 코드를 모으고 기관별 손익 JSON(`/api/total-is/<코드>?y=<연도>`)을 캐시에 저장한다.
 *   이어받기 가능(이미 받은 파일은 건너뜀) · 동시 요청 기본 4(공공 사이트 — 더 올리지 않는다).
 * - csv: 캐시를 가져오기 CSV(shared `DISCLOSURE_COLUMN_MAP` 열 이름)로 바꾼다. 계정은 **계정 코드**로 맞춘다(이름 표기가 연도마다 다를 수 있다).
 *   🔴 공시에는 좌표가 없다 — 좌표를 지어내지 않는다. `--coords` 로 준 기존 적재분(같은 기관명·같은 시도)의 좌표만 이어 쓰고,
 *      나머지는 비워 둔다(화면이 주소 시군구 중심에 "위치 근사"로 그린다).
 */
import fs from 'node:fs';
import path from 'node:path';
import { DISCLOSURE_ACCOUNT_TREE } from '../../packages/shared/dist/index.js';

/** 세목 코드(shared 트리) — `세목` 열에는 이 코드만 싣는다 */
const TREE_CODES = new Set(DISCLOSURE_ACCOUNT_TREE.map((n) => n.code));

const BASE = 'https://haspa.khidi.or.kr';
const UA = { 'User-Agent': 'Mozilla/5.0 (HIS finance-benchmark; public disclosure fetch)' };

/** 계정 코드 → 가져오기 열 이름(shared DISCLOSURE_COLUMN_MAP 의 키) */
const ACC = {
  '60100000': 'Ⅰ.의료수익', '60101000': 'Ⅰ-1.입원수익', '60102000': 'Ⅰ-2.외래수익', '60103000': 'Ⅰ-3.기타의료수익',
  '60200000': 'Ⅱ.의료비용', '60201000': 'Ⅱ-1.인건비', '60202000': 'Ⅱ-2.재료비', '60203000': 'Ⅱ-3.관리운영비', '60204000': 'Ⅱ-4.기타의료비용',
  '60300000': 'Ⅲ.의료이익(손실)',
  '60400000': 'Ⅳ.의료외수익', '60415000': 'Ⅳ-7.연구수익', '60412000': 'Ⅳ-13.기부금수익',
  '60500000': 'Ⅴ.의료외비용', '60502000': 'Ⅴ-2.이자비용',
  '60600000': 'Ⅵ.법인세차감전순이익(순손실)', '61100000': '당기순이익(순손실)',
};
const META = ['연도', '기관명', '병상수', '종별', '설립형태', '주소', '위도', '경도', '시도', '시군구', '기관코드', '세목'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url, accept = () => true) {
  for (let t = 0; t < 5; t++) {
    try {
      const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(40_000) });
      if (r.ok) { const body = await r.text(); if (accept(body)) return body; }
    } catch { /* 재시도 */ }
    await sleep(2000 + t * 3000);
  }
  throw new Error(`fetch failed: ${url}`);
}
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const j = i++; await fn(items[j], j); } }));
}
const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : dflt; };

async function cmdFetch(dir) {
  const [y0, y1] = (arg('--years', '2016-2024')).split('-').map(Number);
  const conc = Number(arg('--concurrency', '4'));
  fs.mkdirSync(path.join(dir, 'is'), { recursive: true });
  const listFile = path.join(dir, 'list.json');
  const list = fs.existsSync(listFile) ? JSON.parse(fs.readFileSync(listFile, 'utf8')) : {};
  for (let y = y1; y >= y0; y--) {
    if (list[y]) continue;
    // 🔴 과부하 때 사이트가 **빈 목록 페이지**를 준다 — 첫 빈 페이지에서 멈추면 목록이 잘린다(2026-09-29 실측: 2022 가 300곳에서 끊겨
    //    서울아산이 빠졌다). 빈 페이지는 다시 요청하고, 연속 3쪽이 비어야 끝으로 본다.
    const codes = new Set();
    const listPage = async (pg) => {
      for (let t = 0; t < 3; t++) {
        const h = await get(`${BASE}/total-public-inq?p=${pg}&y=${y}&hn=&bn=&en=&a1=&a2=`);
        const c = [...h.matchAll(/name="pi" value="(\d+)" data-year="(\d+)"/g)].filter((m) => m[2] === String(y)).map((m) => m[1]);
        if (c.length) return c;
        await sleep(1500);
      }
      return [];
    };
    for (let p = 1, empty = 0; empty < 3; p++) {
      const c = await listPage(p);
      if (c.length) { c.forEach((x) => codes.add(x)); empty = 0; } else empty++;
    }
    list[y] = [...codes].sort();
    fs.writeFileSync(listFile, JSON.stringify(list));
    console.log(y, list[y].length);
  }
  const done = (y, c) => { const f = path.join(dir, 'is', `${y}_${c}.json`); return fs.existsSync(f) && fs.readFileSync(f, 'utf8').includes('"result":"ok"'); };
  const jobs = Object.entries(list).flatMap(([y, cs]) => cs.map((c) => [y, c])).filter(([y, c]) => !done(y, c));
  console.log('손익 받을 기관·연도', jobs.length);
  // 한 기관이 재시도를 다 써도 전체를 멈추지 않는다(2026-09-29 FY2016 1건에 12곳에서 전체가 죽었다) — 실패는 세어 끝에 밝히고, 다시 돌리면 그 기관만 이어받는다
  const failed = [];
  await pool(jobs, conc, async ([y, c], k) => {
    // 🔴 과부하 때 사이트가 200 + 오류 HTML 을 준다(2026-09-28 실측 22건 — 재요청하면 전부 정상) → JSON 이 올 때까지 재시도
    try {
      fs.writeFileSync(path.join(dir, 'is', `${y}_${c}.json`), await get(`${BASE}/api/total-is/${c}?y=${y}`, (b) => b.includes('"result":"ok"')));
    } catch { failed.push(`${y}_${c}`); }
    if (k % 200 === 0) console.log('…', k);
  });
  console.log('완료', jobs.length - failed.length, '/', jobs.length, failed.length ? `· 실패 ${failed.length}: ${failed.join(' ')} (다시 실행하면 이어받는다)` : '');
}

/** 공시 주소의 HTML 엔티티(`& #40;` 처럼 깨진 것 포함)를 되돌린다 */
const decode = (s) => (s ?? '').replace(/&\s*#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const q = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

function cmdCsv(dir, out) {
  // 기존 적재분 좌표(같은 기관명·같은 시도일 때만 이어 쓴다)
  const coords = new Map();
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] !== '--coords') continue;
    const j = JSON.parse(fs.readFileSync(process.argv[i + 1], 'utf8'));
    for (const r of (j.data ?? j).rows ?? []) if (r.lat != null && r.lng != null) coords.set(r.name, { lat: r.lat, lng: r.lng, sido: r.sido });
  }
  const header = [...META, ...Object.values(ACC)];
  const lines = [header.join(',')];
  const stat = { rows: 0, skipped: 0, errorPage: [], coordReused: 0, byType: {} };
  for (const f of fs.readdirSync(path.join(dir, 'is')).sort()) {
    // 🔴 재시도를 다 써도 오류 페이지(HTML · 200)면 그 기관은 건너뛰고 센다(지어내지 않는다) — fetch 를 다시 돌리면 이어받는다
    let j;
    try { j = JSON.parse(fs.readFileSync(path.join(dir, 'is', f), 'utf8')); } catch { stat.errorPage.push(f.replace('.json', '')); continue; }
    const info = j?.json?.info, one = j?.json?.one;
    if (j?.result !== 'ok' || !info || !Array.isArray(one) || !one.length) { stat.skipped++; continue; }
    const amt = Object.fromEntries(one.map((r) => [r.accCode, r.profitAmt]));
    const address = decode(info.addressFull);
    const sido = address.split(' ')[0] ?? ''; // 좌표 이음 대조용(원 저장소 행은 주소 첫 어절이 시도)
    const c = coords.get(info.hosName);
    const reuse = c && c.sido === sido;
    if (reuse) stat.coordReused++;
    // 시도·시군구는 공시의 구조화 칸(addressLevel1·2) — 주소 칸에 병원명·층수만 온 기관이 있다(FY2024 172곳)
    const row = [info.fyYyyy, info.hosName.trim(), info.bsNum, info.kindName, info.foundName, address, reuse ? c.lat : '', reuse ? c.lng : '',
      (info.addressLevel1 ?? '').trim(), (info.addressLevel2 ?? '').trim(),
      // 기관 코드 — 연도마다 이름 표기가 달라도 같은 기관(가져오기가 이것으로 식별한다)
      String(info.hosCode ?? '').trim(),
      // 세목(드릴다운) — 트리 코드의 금액 JSON(0 도 싣는다: 0 과 "없음"은 다른 사실)
      JSON.stringify(Object.fromEntries(one.filter((r) => TREE_CODES.has(r.accCode) && typeof r.profitAmt === 'number').map((r) => [r.accCode, r.profitAmt]))),
      ...Object.keys(ACC).map((k) => (typeof amt[k] === 'number' ? amt[k] : ''))];
    lines.push(row.map(q).join(','));
    stat.rows++;
    stat.byType[`${info.fyYyyy} ${info.kindName}`] = (stat.byType[`${info.fyYyyy} ${info.kindName}`] ?? 0) + 1;
  }
  fs.writeFileSync(out, `${lines.join('\n')}\n`);
  console.log(JSON.stringify(stat, null, 1));
}

const [cmd, dir, out] = process.argv.slice(2);
if (cmd === 'fetch' && dir) await cmdFetch(dir);
else if (cmd === 'csv' && dir && out) cmdCsv(dir, out);
else { console.error('사용법: fetch <캐시폴더> | csv <캐시폴더> <출력.csv> [--coords <institutions.json>]'); process.exit(2); }
