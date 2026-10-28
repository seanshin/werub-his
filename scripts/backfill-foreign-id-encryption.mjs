#!/usr/bin/env node
/**
 * scripts/backfill-foreign-id-encryption.mjs
 *   patients.passport_number · alien_registration_no 를 **평문 → AES-256-GCM(원시 키) 암호화**하고
 *   블라인드 인덱스(passport_number_hash · alien_registration_no_hash)를 채운다.
 *
 * 왜 있는가
 *   census(rotate-encryption-key.mjs dry-run) 결과 이 두 컬럼이 스키마 주석과 달리 **평문**이었다
 *   (여권 12 · 외국인등록 3 = 15건). 로테이션 도구는 "평문 백필은 별개 결정"이라 하지 않는다 — 이 스크립트가 그 별개 결정이다.
 *   코드는 이미 원시 키 암호화·hash dedup·복호 읽기로 배포됨(평문 레거시는 읽기에서 그대로 통과).
 *
 * 🔴 안전 규약(rotate 도구와 동일)
 *   - 기본 **dry-run(읽기 전용)**. 쓰기는 `--apply` 로 명시.
 *   - **멱등**: 이미 암호화(iv:tag:cipher)면 값은 두지 않고, hash 만 비었으면 복호해서 채운다.
 *   - **평문을 절대 출력·기록하지 않는다**(건수만).
 *   - UPDATE 는 옛 값을 WHERE 로 못박는다(동시 수정 시 반영 안 됨). 한 트랜잭션.
 *   - 키는 env(`ENCRYPTION_KEY`, 64 hex) — argv 금지.
 *
 * 사용법
 *   ENCRYPTION_KEY=… node scripts/backfill-foreign-id-encryption.mjs           # dry-run
 *   ENCRYPTION_KEY=… node scripts/backfill-foreign-id-encryption.mjs --apply    # 실제 변환
 *   ENCRYPTION_KEY=… node scripts/backfill-foreign-id-encryption.mjs --selftest # DB 없이 로직 검증
 *   ROTATE_PSQL='psql "$DATABASE_URL" -X -tA -v ON_ERROR_STOP=1 -f -' … 로 접속 변경
 *
 * exit: 0 정상 / 1 사람이 봐야 함(복호 실패 등) / 2 판정 불가(접속·입력)
 */
import { execSync } from 'node:child_process';
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

const APPLY = process.argv.includes('--apply');
const SELFTEST = process.argv.includes('--selftest');
const ENC_RE = /^[0-9a-f]{32}:[0-9a-f]{32}:[0-9a-f]*$/i;

const DEFAULT_PSQL =
  'ssh -p 819 -o BatchMode=yes -o ConnectTimeout=20 deploy@198.51.100.73 ' +
  '"docker exec -i docker-postgres-1 psql -U hospital -d hospitalrun -X -tA -v ON_ERROR_STOP=1 -f -"';

function rawKey() {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || !/^[0-9a-f]{64}$/i.test(hex)) {
    console.error('🔴 ENCRYPTION_KEY(64 hex) 미설정/형식오류 — 중단');
    process.exit(2);
  }
  return Buffer.from(hex, 'hex');
}
const isEnc = (v) => typeof v === 'string' && ENC_RE.test(v);
function encrypt(text, key) {
  const iv = randomBytes(16);
  const c = createCipheriv('aes-256-gcm', key, iv);
  let e = c.update(text, 'utf8', 'hex');
  e += c.final('hex');
  return `${iv.toString('hex')}:${c.getAuthTag().toString('hex')}:${e}`;
}
function decrypt(v, key) {
  const [ivHex, tagHex, encHex] = v.split(':');
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  d.setAuthTag(Buffer.from(tagHex, 'hex'));
  let o = d.update(encHex, 'hex', 'utf8');
  o += d.final('utf8');
  return o;
}
const hashFid = (v, key) => createHmac('sha256', key).update('fid:' + (v || '').trim().toUpperCase()).digest('hex');
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";

/** 한 컬럼 값에 대한 판정: {action, enc?, hash?} — action: ENCRYPT | HASH_ONLY | ALREADY | NULL | UNDECRYPTABLE */
function plan(value, key) {
  if (value == null || value === '') return { action: 'NULL' };
  if (isEnc(value)) {
    // 이미 암호화 — hash 채우기 위해 복호(값은 반환 안 함)
    try {
      return { action: 'HASH_ONLY', hash: hashFid(decrypt(value, key), key) };
    } catch {
      return { action: 'UNDECRYPTABLE' };
    }
  }
  // 평문 → 암호화 + hash
  return { action: 'ENCRYPT', enc: encrypt(value, key), hash: hashFid(value, key) };
}

function runSql(sql) {
  const cmd = process.env.ROTATE_PSQL || DEFAULT_PSQL;
  try {
    return execSync(cmd, { input: sql, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    console.error('🔴 psql 접속/실행 실패:', e.message.split('\n')[0]);
    process.exit(2);
  }
}

function selftest() {
  const key = Buffer.from('a'.repeat(64), 'hex');
  let n = 0;
  const ok = (c, m) => { if (!c) { console.error('  ✗ ' + m); process.exit(1); } console.log('  ✓ ' + m); n++; };
  // 평문 → ENCRYPT, 왕복 복호
  const p = plan('M12345678', key);
  ok(p.action === 'ENCRYPT' && isEnc(p.enc), '평문은 ENCRYPT 로 판정·암호문 형식');
  ok(decrypt(p.enc, key) === 'M12345678', '암호문을 복호하면 원문');
  ok(p.hash === hashFid('m12345678', key), 'hash 는 대소문자 무시(정규화)');
  // 이미 암호화 → HASH_ONLY(값 안 바꿈), hash 는 원문 기준
  const already = encrypt('AB999', key);
  const p2 = plan(already, key);
  ok(p2.action === 'HASH_ONLY' && !p2.enc && p2.hash === hashFid('AB999', key), '이미 암호화면 HASH_ONLY(값 유지)');
  // 빈값/NULL
  ok(plan(null, key).action === 'NULL' && plan('', key).action === 'NULL', 'NULL/빈값은 건너뜀');
  // 복호 불가(다른 키로 암호화)
  const other = encrypt('X', Buffer.from('b'.repeat(64), 'hex'));
  ok(plan(other, key).action === 'UNDECRYPTABLE', '복호 불가는 UNDECRYPTABLE(손대지 않음)');
  console.log(`\n  ✅ selftest 통과 (${n}개 단언)`);
}

function main() {
  if (SELFTEST) return selftest();
  const key = rawKey();

  // id 와 두 컬럼만 — 평문이 파이프로 나오지만 Node 메모리에만 있고 출력하지 않는다
  // 🔴 psql -A 기본 구분자는 '|' — 여권/해시에 '|'는 없지만 유닛 세퍼레이터로 명시(안전).
  // 🔴 값은 SQL 에서 hex 인코딩 → 개행·구분자·제어문자가 불가능(파싱 안전). \pset 미사용(에코 없음).
  const raw = runSql(
    "SELECT id" +
    ", encode(convert_to(coalesce(passport_number,''),'UTF8'),'hex')" +
    ", encode(convert_to(coalesce(alien_registration_no,''),'UTF8'),'hex')" +
    ", coalesce(passport_number_hash,'')" +
    ", coalesce(alien_registration_no_hash,'')" +
    " FROM patients WHERE passport_number IS NOT NULL OR alien_registration_no IS NOT NULL;",
  );
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const hexToStr = (h) => (h ? Buffer.from(h, 'hex').toString('utf8') : '');
  const records = raw.split('\n').map((l) => l.trim()).filter((l) => UUID.test((l.split('|')[0] || '')));

  const stat = { rows: 0, passEncrypt: 0, passHashOnly: 0, alienEncrypt: 0, alienHashOnly: 0, undecryptable: 0, skip: 0 };
  const updates = [];
  if (records.length) {
    for (const line of records) {
      const [id, ppHex, alienHex, ppHash, alienHash] = line.split('|');
      const pp = hexToStr(ppHex);
      const alien = hexToStr(alienHex);
      stat.rows++;
      const sets = [];
      const pPlan = plan(pp, key);
      if (pPlan.action === 'ENCRYPT') { stat.passEncrypt++; sets.push(`passport_number = ${q(pPlan.enc)}`, `passport_number_hash = ${q(pPlan.hash)}`); }
      else if (pPlan.action === 'HASH_ONLY' && !ppHash) { stat.passHashOnly++; sets.push(`passport_number_hash = ${q(pPlan.hash)}`); }
      else if (pPlan.action === 'UNDECRYPTABLE') stat.undecryptable++;
      const aPlan = plan(alien, key);
      if (aPlan.action === 'ENCRYPT') { stat.alienEncrypt++; sets.push(`alien_registration_no = ${q(aPlan.enc)}`, `alien_registration_no_hash = ${q(aPlan.hash)}`); }
      else if (aPlan.action === 'HASH_ONLY' && !alienHash) { stat.alienHashOnly++; sets.push(`alien_registration_no_hash = ${q(aPlan.hash)}`); }
      else if (aPlan.action === 'UNDECRYPTABLE') stat.undecryptable++;
      if (sets.length === 0) { stat.skip++; continue; }
      // WHERE 로 옛 평문값을 못박는다(동시 수정 방지). 평문 컬럼만 가드(hash-only 는 id 로 충분).
      const guard = [`id = ${q(id)}`];
      if (pPlan.action === 'ENCRYPT') guard.push(`passport_number = ${q(pp)}`);
      if (aPlan.action === 'ENCRYPT') guard.push(`alien_registration_no = ${q(alien)}`);
      updates.push(`UPDATE patients SET ${sets.join(', ')} WHERE ${guard.join(' AND ')};`);
    }
  }

  console.log(`\n■ 외국인 식별자 암호화 백필 (${APPLY ? 'APPLY · 쓰기' : 'dry-run · 읽기 전용'})\n`);
  console.log(`  대상 행: ${stat.rows}`);
  console.log(`  여권    → 암호화 ${stat.passEncrypt} · hash만 ${stat.passHashOnly}`);
  console.log(`  외국인번호 → 암호화 ${stat.alienEncrypt} · hash만 ${stat.alienHashOnly}`);
  console.log(`  변경 없음(이미 완료): ${stat.skip}`);
  if (stat.undecryptable) console.log(`  🔴 복호 불가(손대지 않음): ${stat.undecryptable} — 사람이 확인해야 한다`);
  console.log(`  UPDATE 문: ${updates.length}`);

  if (!APPLY) {
    console.log('\n  dry-run — 쓰지 않았다. 적용하려면 --apply.');
    return;
  }
  if (updates.length === 0) { console.log('\n  변경할 것 없음.'); return; }

  const tx = 'BEGIN;\n' + updates.join('\n') + '\nCOMMIT;\n';
  runSql(tx);
  console.log(`\n  ✅ 적용 완료 — ${updates.length} 행 갱신(한 트랜잭션).`);
  // 검증: 평문 잔존 0 확인
  const left = runSql(
    "SELECT count(*) FROM patients WHERE (passport_number IS NOT NULL AND passport_number !~ '^[0-9a-f]{32}:[0-9a-f]{32}:') " +
    "OR (alien_registration_no IS NOT NULL AND alien_registration_no !~ '^[0-9a-f]{32}:[0-9a-f]{32}:');",
  ).trim();
  console.log(`  검증 — 평문 잔존: ${left}건 (0 이어야 정상)`);
}

main();
