#!/usr/bin/env node
/**
 * scripts/rotate-encryption-key.mjs — **ENCRYPTION_KEY 재암호화(로테이션) 도구**
 *
 * 왜 있는가
 *   운영 `ENCRYPTION_KEY` 가 all-zeros 다(2026-08-25 확인 · 부팅 시 경고 출력 중).
 *   절차 정본 `docs/05-reference/backup-and-key-rotation.md` §2.3 ④ 가 **"재암호화 스크립트는
 *   저장소에 없다 — 만들어야 한다"** 고 적어둔 그 스크립트다. 방안 A(시드 정리와 함께)를 고르든
 *   B(지금)를 고르든 **키 교체 자체는 실환자 첫 등록 전에 반드시 끝나야 하고**, 어느 쪽이든 필요하다.
 *
 * 🔴 기본 동작은 **읽기 전용(dry-run)** 이다. 되돌릴 수 없는 변환이므로 쓰기는 `--apply` 로 명시한다.
 *
 * 이 도구가 하지 **못하는** 것 (출력에도 매번 찍는다)
 *   🔴 **복호되지 않는 행을 고치지 못한다.** 하나라도 있으면 **변환하지 않고 중단한다** —
 *      재암호화하면 손상이 확정된다(§2.3 ③).
 *   🔴 **평문으로 저장된 행을 암호화하지 않는다.** 그것은 로테이션이 아니라 백필이고 별개 결정이다.
 *      대신 **몇 건인지 그대로 보고한다**(이 저장소에 실제로 있다 — 아래 실측 ③).
 *   🔴 **파생 방식(derivation)을 통일하지 않는다.** 한 번에 한 변수만 바꾼다(키만).
 *      복호에 성공한 방식 그대로 다시 암호화한다 — 읽는 모듈의 동작이 바뀌지 않게.
 *   🔴 **평문을 절대 출력·기록하지 않는다.** 건수와 판정만 말한다(개발 편의로도 안 된다).
 *
 * 🔴 실측으로 드러난 것 — 절차 정본 §2.1 이 전제하지 않았던 3가지 (2026-08-25)
 *   ① **키 파생이 두 갈래다.** 같은 `ENCRYPTION_KEY` 인데
 *        · `PatientService`  = `Buffer.from(keyHex,'hex')` (원시 32바이트)
 *          — `apps/api/src/modules/patient/patient.service.ts:36-37`
 *        · 그 외 전부(field-encryption·patient-auth·terminal-draft·ess·onboarding·mobile identity)
 *          = `scrypt(secret, salt, 32)` — `apps/api/src/common/crypto/kdf.ts:13`
 *      두 갈래가 **같은 컬럼**(`patients.national_id`)에 쓴다 — 직원 등록은 원시, 포털 가입은 scrypt.
 *      → 행마다 **네 조합(신/구 × 두 파생)을 모두 시도**하고 어느 것이 통했는지 보고한다.
 *   ② **블라인드 인덱스가 키에 매여 있다.** `patients.national_id_hash`
 *      = `HMAC-SHA256(원시키, 'rrn:'+숫자)` — `patient.service.ts:1171-1173`.
 *      키를 바꾸면 **해시가 전부 어긋난다**(중복확인·병합 점수가 조용히 안 맞게 된다).
 *      → 변환한 행의 해시를 **같은 트랜잭션에서** 새 키로 다시 계산한다.
 *        단 **원래 NULL 이던 해시는 만들지 않는다**(로테이션은 없던 값을 만드는 일이 아니다 · 건수만 보고).
 *   ③ **`app_installation_keys.receipt_encrypted` 는 이름과 달리 암호화되어 있지 않다.**
 *      `mobile/app-key/app-key.service.ts:169` 가 `result.receipt.toString('base64')` 를 그대로 넣는다.
 *      → 로테이션 대상이 아니다. 목록에 남기되 `encrypted:false` 로 표시하고 건드리지 않는다.
 *
 * 사용법
 *   ROTATE_OLD_KEY=… ROTATE_NEW_KEY=… node scripts/rotate-encryption-key.mjs
 *                                              # 기본 = dry-run (읽기 전용 · 분류만)
 *   … node scripts/rotate-encryption-key.mjs --apply     # 🔴 실제 변환(한 트랜잭션 · 어긋나면 롤백)
 *   … node scripts/rotate-encryption-key.mjs --json      # 기계 판독용(평문·암호문 미포함)
 *   node scripts/rotate-encryption-key.mjs --targets     # 대상 컬럼 목록과 근거만
 *   node scripts/rotate-encryption-key.mjs --sql         # 조회 SQL 만 출력
 *   node scripts/rotate-encryption-key.mjs --selftest    # DB 없이 판정·변환 로직 자체를 검증
 *
 * 키 주입 (🔴 **argv 로 받지 않는다** — `ps`·셸 히스토리에 남는다)
 *   ROTATE_OLD_KEY / ROTATE_NEW_KEY            64자 hex (AES-256 · env.validation.ts 와 같은 규격)
 *   ROTATE_OLD_KDF_SALT / ROTATE_NEW_KDF_SALT  scrypt salt (기본 'salt' — kdf.ts LEGACY_SALT)
 *
 * DB 접속 (조회는 SELECT · 변환은 --apply 일 때만 BEGIN/UPDATE/COMMIT)
 *   기본값은 운영 HIS 로의 ssh + docker exec psql. 바꾸려면:
 *     ROTATE_PSQL='psql "$DATABASE_URL" -X -tA -v ON_ERROR_STOP=1 -f -' node scripts/rotate-encryption-key.mjs
 *
 * exit code — 0 정상 / 1 사람이 봐야 하는 것(복호 실패·평문 혼재) / 2 판정 불가(접속·입력)
 */

import { execFileSync } from 'node:child_process';
import { createCipheriv, createDecipheriv, createHmac, randomBytes, scryptSync } from 'node:crypto';

// ── 대상 레지스트리 ───────────────────────────────────────────────────────────
// 🔴 `source` 는 **추측이 아니라 읽은 자리**다. 컬럼을 추가할 땐 암호화하는 코드를 먼저 찾아 적는다.
const TARGETS = [
  {
    table: 'patients', id: 'id', col: 'national_id', encrypted: true,
    writers: 'PatientService.encrypt(원시) · patient-auth EncryptionService(scrypt) — 🔴 한 컬럼에 두 파생',
    source: 'patient/patient.service.ts:47 · patient-auth/patient-auth.service.ts:149',
    blindIndex: { col: 'national_id_hash', kind: 'RRN_HMAC' },
  },
  {
    table: 'patients', id: 'id', col: 'insurance_number', encrypted: true,
    writers: 'PatientService.encrypt(원시)',
    source: 'patient/patient.service.ts:44',
  },
  {
    table: 'patients', id: 'id', col: 'ci', encrypted: true,
    writers: 'patient-auth EncryptionService(scrypt)',
    source: 'patient-auth/patient-auth.service.ts:157',
  },
  {
    table: 'patients', id: 'id', col: 'passport_number', encrypted: true,
    writers: '🔴 foreign-patient.service.ts:91 는 **평문으로 저장**한다(스키마 주석은 "암호화")',
    source: 'foreign-patient/foreign-patient.service.ts:91,193',
  },
  {
    table: 'patients', id: 'id', col: 'alien_registration_no', encrypted: true,
    writers: '🔴 foreign-patient.service.ts:92 는 **평문으로 저장**한다(스키마 주석은 "암호화")',
    source: 'foreign-patient/foreign-patient.service.ts:92,196',
  },
  {
    table: 'patient_accounts', id: 'id', col: 'ci', encrypted: true,
    writers: 'patient-auth EncryptionService(scrypt)',
    source: 'patient-auth/patient-auth.service.ts:148',
  },
  {
    table: 'identity_verifications', id: 'id', col: 'ci_encrypted', encrypted: true,
    writers: 'mobile identity EncryptionService(scrypt)',
    source: 'mobile/identity/identity.service.ts:150',
  },
  {
    // 🔴 2026-09-22 — RS256 **개인키**가 여기 들어간다. 종전엔 평문 PEM 이었다.
    //    값이 JSONB 문자열이라 다른 대상과 읽고 쓰는 모양이 다르다(`#>> '{}'` / `to_jsonb`).
    //    🔴 이 대상을 빼면 키 교체가 **직원 서명을 조용히 죽인다**(풀지 못하는 개인키가 남는다).
    table: 'system_configs', id: 'id', col: 'value', encrypted: true, jsonText: true,
    where: "x.key LIKE '%PrivateSecret'",
    writers: 'KeyCustodyService.wrapPrivatePem(scrypt 파생 · field-encryption)',
    source: 'common/crypto/key-custody.service.ts (ensureRs256·rotateRs256)',
  },
  {
    // 🔴 이름만 encrypted 다 — 실제로는 base64. 대상이 아니라는 사실을 목록에 남긴다.
    table: 'app_installation_keys', id: 'id', col: 'receipt_encrypted', encrypted: false,
    writers: 'app-key.service.ts:169 — `result.receipt.toString("base64")` (암호화 아님)',
    source: 'mobile/app-key/app-key.service.ts:169',
  },
];

const ROTATABLE = TARGETS.filter((t) => t.encrypted);

// ── 암호 원시 연산 (정본 두 갈래를 그대로 재현한다) ───────────────────────────
const ENC_RE = /^[0-9a-f]{32}:[0-9a-f]{32}:[0-9a-f]*$/i; // iv(16B):tag(16B):cipher — field-encryption.ts 와 동일

/** scrypt 파생 — common/crypto/kdf.ts `deriveAesKey` 와 같은 산식. */
function keyScrypt(secretHex, salt) {
  return scryptSync(secretHex, salt, 32);
}
/** 원시 파생 — patient.service.ts `Buffer.from(keyHex,'hex')` 와 같은 산식. */
function keyRaw(secretHex) {
  return Buffer.from(secretHex, 'hex');
}

/**
 * 🔴 실패를 삼키지 않는다. 복호되면 문자열, 아니면 null.
 * (정본 `decryptField` 는 실패 시 **원본을 그대로 돌려준다** — 그 관용구를 여기서 쓰면
 *  손상된 행을 "복호 성공"으로 읽고 재암호화해 손상을 확정시킨다. 절대 쓰지 않는다.)
 */
function tryDecrypt(value, key) {
  if (typeof value !== 'string' || !ENC_RE.test(value)) return null;
  const [ivHex, tagHex, encHex] = value.split(':');
  try {
    const d = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
    d.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([d.update(Buffer.from(encHex, 'hex')), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}

function encrypt(plain, key) {
  const iv = randomBytes(16);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `${iv.toString('hex')}:${c.getAuthTag().toString('hex')}:${enc.toString('hex')}`;
}

/** 주민번호 블라인드 인덱스 — patient.service.ts:1171-1173 과 같은 산식(원시키 · 'rrn:'+숫자만). */
function rrnHash(plain, rawKey) {
  return createHmac('sha256', rawKey).update('rrn:' + String(plain).replace(/\D/g, '')).digest('hex');
}

// ── 행 판정 ──────────────────────────────────────────────────────────────────
// 한 행이 가질 수 있는 상태는 **넷**이다. 셋으로 줄이면 사실이 아니게 된다.
const VERDICT = {
  ALREADY_NEW: 'ALREADY_NEW',     // 이미 새 키 — 건너뛴다(멱등)
  CONVERT: 'CONVERT',             // 옛 키로 복호됨 — 변환 대상
  PLAINTEXT: 'PLAINTEXT',         // 🔴 암호문 형식이 아니다 — 이 도구는 만들지 않는다
  UNDECRYPTABLE: 'UNDECRYPTABLE', // 🔴 형식은 맞는데 어떤 키·파생으로도 복호 안 됨 — **중단 사유**
};

/**
 * 한 값의 판정. 파생 4조합을 모두 시도하고, **복호에 성공한 파생 그대로** 다시 암호화한다.
 * @returns {{verdict:string|null, derivation:string|null, next:string|null, hash:string|null}}
 */
function classify(value, keys, opts = {}) {
  if (value == null || value === '') return { verdict: null, derivation: null, next: null, hash: null };
  if (!ENC_RE.test(value)) return { verdict: VERDICT.PLAINTEXT, derivation: null, next: null, hash: null };

  // ① 이미 새 키인가 — 멱등. 중복 실행이 손상을 만들지 않게 **가장 먼저** 본다.
  for (const [derivation, k] of [['SCRYPT', keys.newScrypt], ['RAW', keys.newRaw]]) {
    if (tryDecrypt(value, k) !== null) {
      return { verdict: VERDICT.ALREADY_NEW, derivation, next: null, hash: null };
    }
  }
  // ② 옛 키로 복호되는가 — 성공한 파생을 그대로 유지한다(한 번에 한 변수만 바꾼다).
  for (const [derivation, oldK, newK] of [
    ['SCRYPT', keys.oldScrypt, keys.newScrypt],
    ['RAW', keys.oldRaw, keys.newRaw],
  ]) {
    const plain = tryDecrypt(value, oldK);
    if (plain !== null) {
      return {
        verdict: VERDICT.CONVERT,
        derivation,
        next: encrypt(plain, newK),
        // 블라인드 인덱스는 **원래 값이 있던 행만** 다시 계산한다(없던 것을 만들지 않는다).
        hash: opts.rehashRrn ? rrnHash(plain, keys.newRaw) : null,
      };
    }
  }
  // ③ 🔴 어느 것으로도 안 된다 — 재암호화하면 손상이 확정된다.
  return { verdict: VERDICT.UNDECRYPTABLE, derivation: null, next: null, hash: null };
}

// ── SQL ──────────────────────────────────────────────────────────────────────
// 구분자는 chr(31)(US) — 암호문·평문 어디에도 나오지 않게 **SQL 쪽에서** 만든다.
const SEP = String.fromCharCode(31);

/** 값을 텍스트로 읽는 식 — JSONB 문자열 컬럼은 `#>> '{}'` 로 벗긴다(따옴표가 값에 섞이지 않게). */
function readExpr(t) {
  return t.jsonText ? `(x.${t.col} #>> '{}')` : `x.${t.col}`;
}

function buildSelectSql() {
  const parts = ROTATABLE.map((t) => {
    const bi = t.blindIndex ? `COALESCE(x.${t.blindIndex.col}, '')` : `''`;
    const v = readExpr(t);
    const extra = t.where ? ` AND ${t.where}` : '';
    return (
      `SELECT '${t.table}.${t.col}' || chr(31) || x.${t.id}::text || chr(31) || ${v} || chr(31) || ${bi}\n` +
      `  FROM ${t.table} x WHERE ${v} IS NOT NULL AND ${v} <> ''${extra}`
    );
  });
  return parts.join('\nUNION ALL\n') + ';\n';
}

/**
 * 변환 SQL — 한 트랜잭션. 옛 값을 WHERE 로 못박아 **동시 수정이 있으면 반영되지 않고**,
 * 마지막 검증에서 건수가 어긋나면 예외 → 롤백된다(psql `ON_ERROR_STOP=1`).
 */
function buildUpdateSql(rows) {
  const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
  const used = ROTATABLE.filter((t) => rows.some((r) => r.tgt === `${t.table}.${t.col}`));

  const values = rows
    .map((r) => `(${lit(r.tgt)}, ${lit(r.id)}, ${lit(r.val)}, ${lit(r.next)}, ${lit(r.hash ?? '')})`)
    .join(',\n    ');

  const updates = used
    .map((t) => {
      const tgt = lit(`${t.table}.${t.col}`);
      const setHash = t.blindIndex
        // 🔴 새 해시가 빈 문자열이면(=원래 NULL 이었던 행) 손대지 않는다.
        ? `, ${t.blindIndex.col} = CASE WHEN r.newbi = '' THEN x.${t.blindIndex.col} ELSE r.newbi END`
        : '';
      const setVal = t.jsonText ? `to_jsonb(r.newv)` : `r.newv`;
      return (
        `UPDATE ${t.table} x SET ${t.col} = ${setVal}${setHash}\n` +
        `  FROM _rot r WHERE r.tgt = ${tgt} AND x.${t.id}::text = r.id AND ${readExpr(t)} = r.oldv;`
      );
    })
    .join('\n');

  const verifies = used
    .map(
      (t) =>
        `    SELECT count(*) FROM _rot r JOIN ${t.table} x ON x.${t.id}::text = r.id\n` +
        `      WHERE r.tgt = ${lit(`${t.table}.${t.col}`)} AND ${readExpr(t)} = r.newv`,
    )
    .join('\n    UNION ALL\n');

  return `\\set ON_ERROR_STOP on
BEGIN;
CREATE TEMP TABLE _rot(tgt text, id text, oldv text, newv text, newbi text) ON COMMIT DROP;
INSERT INTO _rot(tgt, id, oldv, newv, newbi) VALUES
    ${values};
${updates}
DO $$
DECLARE expected int; applied int;
BEGIN
  SELECT count(*) INTO expected FROM _rot;
  SELECT sum(c) INTO applied FROM (
${verifies}
  ) s(c);
  IF applied IS DISTINCT FROM expected THEN
    -- 🔴 한 건이라도 어긋나면 전부 되돌린다. 부분 성공은 "일부만 새 키"라는 최악의 상태를 만든다.
    RAISE EXCEPTION '재암호화 검증 실패 — 기대 % 건, 반영 % 건. 전부 롤백합니다.', expected, applied;
  END IF;
  RAISE NOTICE '재암호화 검증 통과 — % 건', applied;
END $$;
COMMIT;
`;
}

// ── DB 실행 ──────────────────────────────────────────────────────────────────
const DEFAULT_PSQL =
  'ssh -p 819 -o BatchMode=yes -o ConnectTimeout=20 deploy@198.51.100.73 ' +
  '"docker exec -i docker-postgres-1 psql -U hospital -d hospitalrun -X -tA -v ON_ERROR_STOP=1 -f -"';

function runPsql(sql) {
  const cmd = process.env.ROTATE_PSQL || DEFAULT_PSQL;
  try {
    return execFileSync('/bin/sh', ['-c', cmd], {
      input: sql,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (e) {
    console.error('DB 실행 실패 — 판정하지 않는다(모르면 침묵한다).');
    console.error(`  명령: ${cmd}`);
    console.error(`  ${(e.stderr || e.message || '').toString().trim().split('\n').slice(0, 8).join('\n  ')}`);
    console.error('  ROTATE_PSQL 로 접속 명령을 바꿀 수 있다(stdin 으로 SQL 을 받는다).');
    process.exit(2);
  }
}

function parseRows(raw) {
  return raw
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.includes(SEP))
    .map((l) => {
      const [tgt, id, val, bi] = l.split(SEP);
      return { tgt, id, val, bi };
    });
}

// ── 판정 집계 ────────────────────────────────────────────────────────────────
function judge(rows, keys) {
  const byTarget = new Map();
  const convert = [];
  for (const t of TARGETS) {
    byTarget.set(`${t.table}.${t.col}`, {
      target: `${t.table}.${t.col}`, encrypted: t.encrypted, writers: t.writers, source: t.source,
      total: 0, ALREADY_NEW: 0, CONVERT: 0, PLAINTEXT: 0, UNDECRYPTABLE: 0,
      derivations: {}, blindIndexRehash: 0, blindIndexMissing: 0,
    });
  }
  for (const r of rows) {
    const t = ROTATABLE.find((x) => `${x.table}.${x.col}` === r.tgt);
    if (!t) continue;
    const agg = byTarget.get(r.tgt);
    agg.total += 1;
    const rehashRrn = Boolean(t.blindIndex && r.bi);
    const c = classify(r.val, keys, { rehashRrn });
    if (!c.verdict) continue;
    agg[c.verdict] += 1;
    if (c.derivation) agg.derivations[c.derivation] = (agg.derivations[c.derivation] ?? 0) + 1;
    if (c.verdict === VERDICT.CONVERT) {
      if (t.blindIndex) {
        if (r.bi) agg.blindIndexRehash += 1;
        else agg.blindIndexMissing += 1;
      }
      convert.push({ tgt: r.tgt, id: r.id, val: r.val, next: c.next, hash: c.hash });
    }
  }
  const targets = [...byTarget.values()];
  return {
    targets,
    convert,
    counts: {
      total: targets.reduce((a, b) => a + b.total, 0),
      convert: targets.reduce((a, b) => a + b.CONVERT, 0),
      alreadyNew: targets.reduce((a, b) => a + b.ALREADY_NEW, 0),
      plaintext: targets.reduce((a, b) => a + b.PLAINTEXT, 0),
      undecryptable: targets.reduce((a, b) => a + b.UNDECRYPTABLE, 0),
    },
  };
}

// ── 출력 ─────────────────────────────────────────────────────────────────────
function printTargets() {
  console.log('대상 컬럼 — `근거` 는 추측이 아니라 암호화하는 코드를 읽은 자리다.\n');
  for (const t of TARGETS) {
    console.log(`${t.encrypted ? '●' : '○'} ${t.table}.${t.col}${t.encrypted ? '' : '   (암호화 아님 — 대상 제외)'}`);
    console.log(`    쓰는 곳: ${t.writers}`);
    console.log(`    근거   : ${t.source}`);
    if (t.blindIndex) console.log(`    🔴 블라인드 인덱스: ${t.blindIndex.col} — 키에 매여 있어 함께 다시 계산한다`);
  }
}

function printReport(res, { apply }) {
  const { counts } = res;
  console.log(`\n■ ENCRYPTION_KEY 재암호화 ${apply ? '(--apply · 실제 변환)' : '(dry-run · 읽기 전용)'}\n`);
  const w = (s, n) => String(s).padEnd(n);
  console.log(`  ${w('대상', 34)} ${w('행', 5)} ${w('변환', 5)} ${w('이미새키', 9)} ${w('평문', 5)} ${w('복호실패', 9)} 파생`);
  console.log('  ' + '-'.repeat(92));
  for (const t of res.targets) {
    if (!t.encrypted) {
      console.log(`  ${w(t.target, 34)} ${w('-', 5)} ${w('-', 5)} ${w('-', 9)} ${w('-', 5)} ${w('-', 9)} 암호화 아님(대상 제외)`);
      continue;
    }
    const der = Object.entries(t.derivations).map(([k, v]) => `${k}:${v}`).join(' ') || '-';
    console.log(`  ${w(t.target, 34)} ${w(t.total, 5)} ${w(t.CONVERT, 5)} ${w(t.ALREADY_NEW, 9)} ${w(t.PLAINTEXT, 5)} ${w(t.UNDECRYPTABLE, 9)} ${der}`);
  }
  console.log('  ' + '-'.repeat(92));
  console.log(`  합계: 행 ${counts.total} · 변환대상 ${counts.convert} · 이미새키 ${counts.alreadyNew} · 평문 ${counts.plaintext} · 복호실패 ${counts.undecryptable}\n`);

  for (const t of res.targets.filter((x) => x.blindIndexRehash || x.blindIndexMissing)) {
    console.log(`  🔴 ${t.target} 블라인드 인덱스: 재계산 ${t.blindIndexRehash}건 · 원래 없음 ${t.blindIndexMissing}건(만들지 않는다)`);
  }
  if (counts.plaintext > 0) {
    console.log(`\n  🔴 평문 ${counts.plaintext}건 — 이 도구는 **암호화하지 않는다**(로테이션이 아니라 백필이고 별개 결정이다).`);
    console.log(`     스키마 주석이 "암호화"인데 평문인 컬럼이 있다(--targets 의 🔴 표시).`);
  }
  if (counts.undecryptable > 0) {
    console.log(`\n  🔴 복호 실패 ${counts.undecryptable}건 — **변환하지 않는다.** 이미 손상된 행이고,`);
    console.log(`     재암호화하면 손상이 확정된다(절차 정본 §2.3 ③ "하나라도 있으면 중단").`);
  }
  console.log('\n  이 도구가 못 하는 것: 평문 백필 · 손상 복구 · 파생 방식 통일(한 번에 한 변수만 바꾼다).');
}

// ── 셀프테스트 ───────────────────────────────────────────────────────────────
// 🔴 가드는 결함을 재주입해 실패해야 가드다 — "성공을 실패로 말하지 않는다" 대조군을 함께 둔다.
function selftest() {
  const OLD = 'a'.repeat(64);
  const NEW = 'b'.repeat(64);
  const keys = {
    oldScrypt: keyScrypt(OLD, 'salt'), oldRaw: keyRaw(OLD),
    newScrypt: keyScrypt(NEW, 'salt'), newRaw: keyRaw(NEW),
  };
  const fail = [];
  let n = 0;
  const ok = (name, cond) => { n += 1; console.log(`  ${cond ? '✓' : '✗'} ${name}`); if (!cond) fail.push(name); };

  // ① 옛 키(scrypt) → 변환 · 파생 유지 · 새 키로 복호됨 · 평문 보존
  const a = encrypt('860513-1234567', keys.oldScrypt);
  const ca = classify(a, keys);
  ok('옛 키(scrypt) 값은 CONVERT 로 판정된다', ca.verdict === VERDICT.CONVERT);
  ok('복호에 성공한 파생(SCRYPT)을 유지한다', ca.derivation === 'SCRYPT');
  ok('변환 결과가 새 키(scrypt)로 복호되고 평문이 보존된다', tryDecrypt(ca.next, keys.newScrypt) === '860513-1234567');
  ok('🔴 변환 결과가 새 키(RAW)로는 복호되지 않는다(파생을 바꾸지 않았다)', tryDecrypt(ca.next, keys.newRaw) === null);

  // ② 옛 키(원시) → 변환 · RAW 유지
  const b = encrypt('M12345678', keys.oldRaw);
  const cb = classify(b, keys);
  ok('옛 키(원시) 값도 CONVERT 로 판정된다', cb.verdict === VERDICT.CONVERT);
  ok('원시 파생이 유지된다', cb.derivation === 'RAW' && tryDecrypt(cb.next, keys.newRaw) === 'M12345678');

  // ③ 멱등 — 이미 새 키면 건드리지 않는다(중복 실행이 손상을 만들지 않게)
  const c2 = classify(ca.next, keys);
  ok('이미 새 키인 값은 ALREADY_NEW(변환하지 않는다)', c2.verdict === VERDICT.ALREADY_NEW && c2.next === null);

  // ④ 🔴 대조군 — 손상된 암호문을 "성공"으로 읽지 않는다(정본 decryptField 의 관용구 재주입)
  const broken = a.replace(/.$/, (ch) => (ch === '0' ? '1' : '0'));
  ok('🔴 복호 안 되는 값은 UNDECRYPTABLE(원본을 돌려주며 성공으로 읽지 않는다)',
    classify(broken, keys).verdict === VERDICT.UNDECRYPTABLE);

  // ⑤ 평문은 암호화하지 않는다
  const cp = classify('880101-2345678', keys);
  ok('평문은 PLAINTEXT 로 분류되고 변환하지 않는다', cp.verdict === VERDICT.PLAINTEXT && cp.next === null);

  // ⑥ 블라인드 인덱스 — 새 원시키 산식과 일치 · 요청하지 않으면 만들지 않는다
  const withHash = classify(a, keys, { rehashRrn: true });
  ok('블라인드 인덱스를 새 키 산식으로 다시 계산한다',
    withHash.hash === createHmac('sha256', keys.newRaw).update('rrn:8605131234567').digest('hex'));
  ok('🔴 요청하지 않으면(원래 NULL) 해시를 만들지 않는다', ca.hash === null);
  ok('🔴 새 해시가 옛 해시와 다르다(키를 바꾸면 인덱스가 어긋난다는 사실 자체를 검증)',
    withHash.hash !== createHmac('sha256', keys.oldRaw).update('rrn:8605131234567').digest('hex'));

  // ⑦ 🔴 대조군 — 성공을 실패로 말하지 않는다(무조건 UNDECRYPTABLE 을 내는 가드 방지)
  ok('🔴 정상 변환을 UNDECRYPTABLE 로 말하지 않는다', ca.verdict !== VERDICT.UNDECRYPTABLE);

  // ⑧ 변환 SQL — 옛 값 가드와 롤백 검증이 들어 있는가
  const sql = buildUpdateSql([
    { tgt: 'patients.national_id', id: '11111111-1111-4111-8111-111111111111', val: a, next: ca.next, hash: '' },
  ]);
  ok('UPDATE 가 옛 값을 WHERE 로 못박는다(동시 수정 시 반영 안 됨)', sql.includes('x.national_id = r.oldv'));
  ok('검증 건수가 어긋나면 예외를 던진다(=롤백)', sql.includes('RAISE EXCEPTION'));
  ok('🔴 빈 해시는 기존 값을 유지한다(없던 해시를 만들지 않는다)', sql.includes("WHEN r.newbi = '' THEN"));

  // ⑨ 🔴 평문이 집계·출력에 섞이지 않는가 — 이 도구의 가장 위험한 실수
  const agg = judge([{ tgt: 'patients.national_id', id: 'x', val: a, bi: 'deadbeef' }], keys);
  ok('🔴 집계 결과에 평문이 담기지 않는다', !JSON.stringify(agg.targets).includes('860513'));
  ok('🔴 --json 이 암호문을 싣지 않는다', !JSON.stringify({ counts: agg.counts, targets: agg.targets }).includes(a));

  // ⑩ 조회 SQL 이 대상 전부를 덮는가(레지스트리와 SQL 이 갈라지지 않게)
  const sel = buildSelectSql();
  ok('조회 SQL 이 암호화 대상 전부를 포함한다', ROTATABLE.every((t) => sel.includes(`FROM ${t.table} x`) && sel.includes(`x.${t.col}`)));
  ok('🔴 암호화 아닌 컬럼(receipt_encrypted)은 조회하지 않는다', !sel.includes('receipt_encrypted'));

  // ⑪ 🔴 JSONB 문자열 대상(system_configs.value — RS256 개인키) — 읽고 쓰는 모양이 다르다
  ok("JSONB 대상은 `#>> '{}'` 로 읽는다(따옴표째 읽으면 전건 복호 실패로 보인다)", sel.includes("(x.value #>> '{}')"));
  ok('JSONB 대상은 개인키 행만 본다(설정 전체를 훑지 않는다)', sel.includes("x.key LIKE '%PrivateSecret'"));
  const jsonUpd = buildUpdateSql([{ tgt: 'system_configs.value', id: 'cfg-1', val: 'old', next: 'new', hash: null }]);
  ok('JSONB 대상은 to_jsonb 로 쓴다(문자열을 그대로 넣으면 타입 오류로 전부 롤백된다)', jsonUpd.includes('SET value = to_jsonb(r.newv)'));
  ok("JSONB 대상의 WHERE 도 `#>> '{}'` 로 옛 값을 못박는다", jsonUpd.includes("(x.value #>> '{}') = r.oldv"));

  console.log(`\n  ${fail.length === 0 ? `✅ selftest 통과 (${n}개 단언)` : `❌ ${fail.length}/${n} 실패`}`);
  return fail.length === 0 ? 0 : 1;
}

// ── main ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);

if (has('--targets')) { printTargets(); process.exit(0); }
if (has('--selftest')) { process.exit(selftest()); }
if (has('--sql')) { console.log(buildSelectSql()); process.exit(0); }

const OLD_KEY = process.env.ROTATE_OLD_KEY;
const NEW_KEY = process.env.ROTATE_NEW_KEY;
if (!OLD_KEY || !NEW_KEY) {
  console.error('🔴 ROTATE_OLD_KEY / ROTATE_NEW_KEY 가 필요하다(argv 로 받지 않는다 — ps·셸 히스토리에 남는다).');
  console.error('   예: ROTATE_OLD_KEY=… ROTATE_NEW_KEY=$(openssl rand -hex 32) node scripts/rotate-encryption-key.mjs');
  console.error('   DB 없이 로직만 보려면: node scripts/rotate-encryption-key.mjs --selftest | --targets | --sql');
  process.exit(2);
}
for (const [name, k] of [['ROTATE_OLD_KEY', OLD_KEY], ['ROTATE_NEW_KEY', NEW_KEY]]) {
  if (!/^[0-9a-f]{64}$/i.test(k)) {
    console.error(`🔴 ${name} 는 64자 hex 여야 한다(env.validation.ts 와 같은 규격).`);
    process.exit(2);
  }
}
if (OLD_KEY === NEW_KEY) {
  console.error('🔴 옛 키와 새 키가 같다 — 로테이션이 아니다.');
  process.exit(2);
}

const keys = {
  oldScrypt: keyScrypt(OLD_KEY, process.env.ROTATE_OLD_KDF_SALT || 'salt'),
  oldRaw: keyRaw(OLD_KEY),
  newScrypt: keyScrypt(NEW_KEY, process.env.ROTATE_NEW_KDF_SALT || 'salt'),
  newRaw: keyRaw(NEW_KEY),
};

const apply = has('--apply');
const res = judge(parseRows(runPsql(buildSelectSql())), keys);

if (has('--json')) {
  // 🔴 평문도, 암호문도 담지 않는다 — 건수와 판정만.
  console.log(JSON.stringify({ apply, counts: res.counts, targets: res.targets }, null, 2));
} else {
  printReport(res, { apply });
}

if (res.counts.undecryptable > 0) {
  console.error('\n🔴 복호 실패 행이 있어 변환하지 않는다(§2.3 ③). 원인을 먼저 확인한다.');
  process.exit(1);
}

if (apply) {
  if (res.convert.length === 0) {
    console.log('\n변환할 것이 없다(이미 새 키이거나 대상 행이 없다).');
  } else {
    console.log(`\n▶ ${res.convert.length}건을 한 트랜잭션으로 변환한다 — 백업(.gpg)을 먼저 확인했는가?(§2.3 ②)`);
    const out = runPsql(buildUpdateSql(res.convert));
    console.log(out.trim() || '(psql 무출력)');
    console.log('\n✅ COMMIT 됨. 다음: .env 의 ENCRYPTION_KEY 를 새 값으로 → `pm2 restart api --update-env`');
    console.log('   🔴 그리고 **환자 상세 화면을 눌러** 주민번호·여권번호가 정상 표시되는지 확인한다(200 만으로는 부족하다).');
  }
}

process.exit(res.counts.plaintext > 0 ? 1 : 0);
