#!/usr/bin/env node
/**
 * e-sign #6 다자(多者) 봉투 — HIS↔ERP↔sign 합동 E2E (Track 1: HIS 중계).
 *
 * 검증 대상(HIS 소유 계약):
 *  A. erp/request-sign 인증 게이트 — 무키/오키 401, 정키 진입(항상 실행 가능, sign 무관)
 *  B. 다자 relay 계약 — 응답 data.signers[] 가
 *     · 입력 서명자 수만큼 반환되고
 *     · externalSignerRef 키 보존(인덱스 비의존·완료 webhook 매칭 키)
 *     · STAFF 원소 portalUrl=null(발송 제외) · PORTAL 원소 portalUrl 존재(deep-link)
 *     · signOrder 보존
 *  C. 단일 회귀 — signers[] 미동봉 시 data.signers=null + 단일 portalUrl 경로 무변경
 *
 * B/C 는 sign.mode=EXTERNAL + sign 서비스 가동이 전제. SIMULATION/미가동이면 SKIP(사유 출력).
 * ⚠️ 부작용: B 실행 시 IssuedDocument + sign 요청이 실제 생성됨(테스트 sourceId 로 식별).
 *
 * 사용:
 *   ESIGN6_ORIGINATION_KEY=<erp.signOriginationKey> \
 *   [API_BASE=http://localhost:4000] [ADMIN_EMAIL=admin@hospital.example.org] [ADMIN_PASS=staff1234!] \
 *   [STAFF_REF=erp:staff:BF-2026-0001] \
 *   node infra/scripts/esign6-multisig-e2e.mjs
 *
 * 서버에서 실행 권장(sign 은 내부 127.0.0.1). 키는 system_configs erp.signOriginationKey.
 */

const API = (process.env.API_BASE || 'http://localhost:4000').replace(/\/$/, '');
const KEY = process.env.ESIGN6_ORIGINATION_KEY || '';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@hospital.example.org';
const ADMIN_PASS = process.env.ADMIN_PASS || 'staff1234!';
const STAFF_REF = process.env.STAFF_REF || 'erp:staff:BF-2026-0001';
const SOURCE_ID = `E2E-ESIGN6-${process.env.RUN_TAG || 'manual'}`;

let pass = 0, fail = 0, skip = 0;
const ok = (m) => { console.log(`  ✅ ${m}`); pass++; };
const no = (m) => { console.log(`  ❌ ${m}`); fail++; };
const sk = (m) => { console.log(`  ⏭️  SKIP ${m}`); skip++; };

async function req(path, { method = 'GET', headers = {}, body, token } = {}) {
  const h = { 'Content-Type': 'application/json', ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  let json = null;
  try { json = await res.json(); } catch { /* non-json */ }
  return { status: res.status, json };
}

function eq(cond, msg) { cond ? ok(msg) : no(msg); return cond; }

async function main() {
  console.log(`\n── e-sign #6 다자 봉투 E2E ── ${API}\n`);

  // ── 사전: sign.mode 확인(관리자 JWT) ─────────────────────────────
  let mode = 'UNKNOWN';
  {
    const login = await req('/api/v1/auth/login', { method: 'POST', body: { email: ADMIN_EMAIL, password: ADMIN_PASS } });
    const token = login.json?.data?.accessToken;
    if (!token) {
      console.log('  ⚠️  관리자 로그인 실패 — sign.mode 미확인(B/C 는 시도 후 판단)');
    } else {
      const m = await req('/api/v1/sign-integration/mode', { token });
      mode = m.json?.data?.mode || 'UNKNOWN';
      console.log(`  ℹ️  sign.mode = ${mode}`);
    }
  }

  // ── A. 인증 게이트(sign 무관·항상 실행) ───────────────────────────
  console.log('\n[A] erp/request-sign 인증 게이트');
  {
    const noKey = await req('/api/v1/sign-integration/erp/request-sign', { method: 'POST', body: { sourceId: SOURCE_ID } });
    eq(noKey.status === 401, `무키 → 401 (실제 ${noKey.status})`);

    const badKey = await req('/api/v1/sign-integration/erp/request-sign', {
      method: 'POST', headers: { 'x-integration-key': 'wrong-key-xxxxxxxx' }, body: { sourceId: SOURCE_ID },
    });
    eq(badKey.status === 401, `오키 → 401 (실제 ${badKey.status})`);
  }

  if (!KEY) {
    console.log('\n[B][C] ESIGN6_ORIGINATION_KEY 미제공 → relay 계약 검증 SKIP');
    sk('정키 relay (키 필요)');
    sk('단일 회귀 (키 필요)');
    return report();
  }

  // 정키가 documentType 검증을 통과하는지(비ERP_*면 400) — 키 인증 자체는 통과 확인
  console.log('\n[A2] 정키 진입(키 인증 통과 — documentType 가드까지 도달)');
  {
    const badType = await req('/api/v1/sign-integration/erp/request-sign', {
      method: 'POST', headers: { 'x-integration-key': KEY },
      body: { sourceId: SOURCE_ID, documentType: 'NOT_ERP_PREFIX' },
    });
    // 키 통과 → documentType 가드(400) 또는 mode 가드(501). 401 이 아니어야 키 인증 통과.
    eq(badType.status !== 401, `정키는 401 아님 → 키 인증 통과 (실제 ${badType.status})`);
  }

  if (mode !== 'EXTERNAL') {
    console.log('\n[B][C] sign.mode≠EXTERNAL → 실 relay 검증 SKIP (SIMULATION 은 501)');
    sk(`다자 relay (mode=${mode})`);
    sk(`단일 회귀 (mode=${mode})`);
    return report();
  }

  // ── B. 다자 relay 계약(PORTAL + PORTAL — 현행 동작 경로) ────────────
  // PORTAL 다자는 sign 임시 인증서 자동발급으로 cert 불요 → 즉시 동작(문서: STAFF 다자는 #2 cert 의존).
  // STAFF 원소를 섞으려면 certSerial 필수 → 실 enroll 직원 필요(아래 [B2] 옵션 참고).
  console.log('\n[B] 다자 봉투 relay 계약 (PORTAL + PORTAL — cert 불요·현행)');
  const signers = [
    { displayName: '환자', channel: 'PORTAL', signOrder: 1, signerType: 'PATIENT', requiredIdentityLevel: 'NONE', externalSignerRef: 'erp:patient:1' },
    { displayName: '보호자(공동서명)', channel: 'PORTAL', signOrder: 2, signerType: 'WITNESS_EXTERNAL', requiredIdentityLevel: 'NONE', externalSignerRef: 'erp:cosigner:2' },
  ];
  {
    const r = await req('/api/v1/sign-integration/erp/request-sign', {
      method: 'POST', headers: { 'x-integration-key': KEY },
      body: { sourceId: `${SOURCE_ID}-multi`, documentType: 'ERP_MEDICAL_CONTRACT', channel: 'PORTAL', snapshot: { title: 'E2E 다자 계약', items: [] }, signers },
    });
    if (r.status !== 200 && r.status !== 201) {
      no(`다자 발의 2xx (실제 ${r.status}) — sign 미가동/오류 가능: ${JSON.stringify(r.json?.error ?? r.json)?.slice(0, 160)}`);
    } else {
      const d = r.json?.data ?? {};
      const relay = d.signers;
      if (!eq(Array.isArray(relay), `data.signers 배열 반환 (실제 ${typeof relay})`)) return report();
      eq(relay.length === signers.length, `서명자 ${signers.length}건 relay (실제 ${relay.length})`);

      const byRef = Object.fromEntries(relay.map((s) => [s.externalSignerRef, s]));
      eq(relay.every((s) => 'externalSignerRef' in s), '모든 원소 externalSignerRef 키 보존');
      eq(relay.every((s) => typeof s.signOrder === 'number'), '모든 원소 signOrder 보존');
      eq(byRef['erp:patient:1'] != null && byRef['erp:cosigner:2'] != null, '입력 ref 2종 모두 relay에 존재(인덱스 비의존)');
      eq(relay.every((s) => typeof s.portalUrl === 'string' && s.portalUrl.length > 0), '모든 PORTAL 원소 portalUrl 존재(deep-link)');
      const orders = relay.map((s) => s.signOrder).sort();
      eq(orders[0] === 1 && orders[1] === 2, `signOrder 1·2 보존 (실제 ${orders})`);
    }
  }

  // ── B2. (옵션) STAFF 다자 — 실 enroll 직원 ref 제공 시에만 ──────────
  // STAFF_REF 가 resolvable+enroll 가능한 직원이면 HIS 가 certSerial 주입 → sign 수용.
  // 부작용: 해당 직원에 sign 인증서 enroll(비멱등). 기본 스킵.
  if (process.env.STAFF_E2E === '1') {
    console.log('\n[B2] STAFF 다자 (실 enroll·부작용)');
    const r = await req('/api/v1/sign-integration/erp/request-sign', {
      method: 'POST', headers: { 'x-integration-key': KEY },
      body: { sourceId: `${SOURCE_ID}-staff`, documentType: 'ERP_MEDICAL_CONTRACT', channel: 'DIRECT', snapshot: { title: 'E2E STAFF 다자' },
        signers: [
          { displayName: '의료진', channel: 'STAFF', signOrder: 1, signerType: 'STAFF', requiredIdentityLevel: 'STAFF_SSO', externalSignerRef: STAFF_REF },
          { displayName: '환자', channel: 'PORTAL', signOrder: 2, signerType: 'PATIENT', requiredIdentityLevel: 'NONE', externalSignerRef: 'erp:patient:2' },
        ] },
    });
    if (r.status === 200 || r.status === 201) {
      const relay = r.json?.data?.signers ?? [];
      const staffEl = relay.find((s) => s.channel === 'STAFF' || s.signOrder === 1);
      const portalEl = relay.find((s) => s.channel === 'PORTAL' || s.signOrder === 2);
      if (staffEl) eq(staffEl.portalUrl === null, `STAFF 원소 portalUrl=null (발송 제외) (실제 ${JSON.stringify(staffEl?.portalUrl)})`);
      if (portalEl) eq(typeof portalEl.portalUrl === 'string', 'PORTAL 원소 portalUrl 존재');
    } else {
      no(`STAFF 다자 2xx (실제 ${r.status}) — STAFF_REF enroll 불가 가능: ${JSON.stringify(r.json?.error)?.slice(0, 120)}`);
    }
  } else {
    sk('STAFF 다자 (STAFF_E2E=1 + 실 직원 STAFF_REF 필요·enroll 부작용)');
  }

  // ── C. 단일 회귀(signers 미동봉 → data.signers=null) ──────────────
  console.log('\n[C] 단일 서명자 회귀 (signers 미동봉)');
  {
    const r = await req('/api/v1/sign-integration/erp/request-sign', {
      method: 'POST', headers: { 'x-integration-key': KEY },
      body: { sourceId: `${SOURCE_ID}-single`, documentType: 'ERP_MEDICAL_CONTRACT', channel: 'PORTAL', snapshot: { title: 'E2E 단일 계약' } },
    });
    if (r.status !== 200 && r.status !== 201) {
      no(`단일 발의 2xx (실제 ${r.status})`);
    } else {
      const d = r.json?.data ?? {};
      eq(d.signers === null || d.signers === undefined, `단일은 data.signers null/부재 (실제 ${JSON.stringify(d.signers)?.slice(0, 40)})`);
    }
  }

  return report();
}

function report() {
  console.log('\n─────────────────────────────');
  console.log(`결과: ✅ ${pass}  ❌ ${fail}  ⏭️ ${skip}`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error('실행 오류:', e); process.exit(2); });
