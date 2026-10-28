/**
 * 약가마스터(의약품표준코드) 임포트 — 추가·멱등 standalone (메인 seed 비파괴).
 * 원천: 공공데이터포털 "건강보험심사평가원_약가마스터_의약품표준코드" CSV(UTF-8 변환본).
 *   - 약제급여목록 및 급여상한금액표에 고시된 제품코드(9자리) 누적 매핑, 포장단위별 행.
 *   - 상한금액(약가)은 미포함 → unitPrice는 null(추후 약제급여목록표/약가기준 API로 보강).
 * 매핑: 제품코드(개정후)→code·insuranceCode / 한글상품명→nameKo / 업체명→manufacturer
 *       약품규격→unit / 제형구분→dosageForm / 일반명코드→ingredientCode / 대표코드(KD)→barcode
 *       취소일자 존재→isActive=false / 품목허가일자→validFrom
 * 멱등: code 유니크 + createMany(skipDuplicates) — 재실행 시 기존 코드 스킵(기존 시드 51건 비파괴).
 * 실행(서버): npx ts-node --transpile-only prisma/import-drug-master.ts <utf8-csv-path>
 */
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';

const prisma = new PrismaClient();

/** RFC4180 CSV 파서(따옴표 필드·필드 내 콤마/개행 처리) */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const trunc = (s: string | undefined, n: number) => (s ?? '').trim().slice(0, n) || null;

async function main() {
  const path = process.argv[2];
  if (!path || !fs.existsSync(path)) {
    console.error('사용법: ts-node prisma/import-drug-master.ts <utf8-csv>');
    process.exit(1);
  }
  console.log('CSV 로드:', path);
  const rows = parseCsv(fs.readFileSync(path, 'utf-8'));
  const header = rows[0];
  const idx = (name: string) => header.findIndex((h) => h.trim() === name);
  const I = {
    name: idx('한글상품명'),
    maker: idx('업체명'),
    spec: idx('약품규격'),
    form: idx('제형구분'),
    permitDate: idx('품목허가일자'),
    repCode: idx('대표코드'),
    prodCode: idx('제품코드(개정후)'),
    ingrCode: idx('일반명코드(성분명코드)'),
    cancelDate: idx('취소일자'),
  };
  if (Object.values(I).some((v) => v < 0)) {
    console.error('헤더 불일치:', header.join('|'));
    process.exit(1);
  }

  // 보험 제품코드는 9자리 — 엑셀→CSV 변환에서 선행 0이 소실된 숫자 코드 복원
  // (미복원 시 약가 SQL이 정확일치 실패로 9자리 행을 중복 INSERT — 2026-07-07 유령 행 1,157쌍 원인)
  const normalizeCode = (c: string) => (/^\d{1,8}$/.test(c) ? c.padStart(9, '0') : c);

  // 제품코드별 대표 행 선정 — 취소 없는 행 우선, 그다음 규격 있는 행 우선
  const byCode = new Map<string, string[]>();
  for (const r of rows.slice(1)) {
    const code = normalizeCode((r[I.prodCode] ?? '').trim());
    if (!code) continue;
    const prev = byCode.get(code);
    if (!prev) { byCode.set(code, r); continue; }
    const prevCancel = (prev[I.cancelDate] ?? '').trim();
    const curCancel = (r[I.cancelDate] ?? '').trim();
    const prevSpec = (prev[I.spec] ?? '').trim();
    const curSpec = (r[I.spec] ?? '').trim();
    if ((prevCancel && !curCancel) || (!prevCancel === !curCancel && (prevSpec === '' || prevSpec === '없음') && curSpec && curSpec !== '없음')) {
      byCode.set(code, r);
    }
  }
  console.log('고유 제품코드:', byCode.size);

  const data = Array.from(byCode.entries()).map(([code, r]) => {
    const permit = (r[I.permitDate] ?? '').trim();
    const validFrom = /^\d{4}-\d{2}-\d{2}$/.test(permit) ? new Date(permit) : new Date('2026-01-01');
    return {
      code: code.slice(0, 20),
      nameKo: (r[I.name] ?? '').trim().slice(0, 500) || code,
      manufacturer: trunc(r[I.maker], 200),
      unit: trunc(r[I.spec] === '없음' ? '' : r[I.spec], 50),
      dosageForm: trunc(r[I.form], 100),
      ingredientCode: trunc(r[I.ingrCode], 20),
      barcode: trunc(r[I.repCode], 50),
      insuranceCode: code.slice(0, 20), // 급여목록 고시 제품코드
      isActive: !(r[I.cancelDate] ?? '').trim(),
      validFrom,
    };
  });

  let created = 0;
  const CHUNK = 1000;
  for (let i = 0; i < data.length; i += CHUNK) {
    const res = await prisma.medicationCode.createMany({ data: data.slice(i, i + CHUNK), skipDuplicates: true });
    created += res.count;
    if ((i / CHUNK) % 5 === 0) console.log(`  ${i + CHUNK}/${data.length}... (+${created})`);
  }
  const total = await prisma.medicationCode.count();
  console.log(`완료 — 신규 ${created}건 / 스킵 ${data.length - created}건 / 테이블 총 ${total}건`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
