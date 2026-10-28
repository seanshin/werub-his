/**
 * 결정 인쇄본 발급 원장(2026-10-12 기획 `decision-print-remaining` P0).
 *  · 🔴 G1 — 인쇄본 QR·sha256 이 브라우저에서만 계산돼 어디에도 남지 않았다 → 서버가 원장에서 줄을 만들어 동결
 *  · 🔴 G2·G13 — 범용 발급 EP 가 클라이언트 snapshot 을 그대로 해시 · 종류 허용 목록 없음 → 서버 생성 종류는 400
 *  · G12 — 발급번호 날짜가 UTC(한국 08:30 발급이 전날 번호) → 한국 날짜
 *  · G14 — 순번 열거 → 서버 생성 종류는 확인 코드가 맞을 때만 답한다(원장 조회 전)
 *  · 직원 대조 — 일치 / 이 판 이후 N건 바뀜 / 🔴 비교 불가(조회 실패를 일치로 접지 않는다)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import {
  decisionPrintCanonLine, isPrintCanonSafe, sortDecisionsForRegister, decisionDomainOf,
  ISSUED_DOCUMENT_TYPE_LABEL, SERVER_BUILT_DOCUMENT_TYPES, documentTypeOfIssueNo, joinPatientName,
  goLivePrintLines, dutyRosterPrintLines, qiReportPrintLines,
} from '@hospital-run/shared';
import { DocumentService, issueDateKey, CHECK_CODE_LENGTH } from '../../src/modules/document/document.service';
import { DecisionPrintService } from '../../src/modules/decision-registry/decision-print.service';
import { PrintIssuanceService, printLinesHash } from '../../src/modules/print-issuance/print-issuance.service';
import { PrintIssuanceController } from '../../src/modules/print-issuance/print-issuance.controller';
import { PrintIssueDto } from '../../src/modules/print-issuance/print-issuance.dto';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { DECISION_REGISTRY } from '../../src/modules/decision-registry/decision.registry';
import { ROLES_KEY } from '../../src/common/decorators/roles.decorator';

const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

function docPrisma(rows: Record<string, any> = {}) {
  const created: any[] = [];
  return {
    created,
    issuedDocument: {
      aggregate: vi.fn(async () => ({ _max: { seq: 0 } })),
      create: vi.fn(async ({ data }: any) => { created.push(data); return { ...data, issuedAt: new Date('2026-10-12T00:00:00Z') }; }),
      findUnique: vi.fn(async ({ where }: any) => rows[where.issueNo] ?? null),
    },
    systemConfig: { findUnique: vi.fn(async () => ({ value: '가상병원' })) },
    user: { findUnique: vi.fn(async () => ({ familyName: '김', givenName: '관리' })) },
  };
}

beforeEach(() => {
  process.env.DOC_VERIFY_SECRET = 'verify-secret-test';
  delete process.env.DOC_VERIFY_SECRET_PREVIOUS;
  process.env.FRONTEND_URL = 'https://his.example';
});
afterEach(() => { delete process.env.DOC_VERIFY_SECRET; delete process.env.DOC_VERIFY_SECRET_PREVIOUS; vi.restoreAllMocks(); });

describe('정본 줄 — 등록부 전 키·전 선택값에 구분자가 없다', () => {
  it('🔴 키·선택값에 | 나 줄바꿈이 있으면 줄이 깨진다', () => {
    const bad: string[] = [];
    for (const d of DECISION_REGISTRY) {
      if (!isPrintCanonSafe(d.key)) bad.push(d.key);
      for (const o of d.options) if (!isPrintCanonSafe(String(o.value))) bad.push(`${d.key}:${o.value}`);
    }
    expect(bad).toEqual([]);
    expect(DECISION_REGISTRY.length).toBeGreaterThan(200); // 대상이 0 이 되지 않게
  });
  it('줄 모양 v1 — 키|상태|선택값|결정시각 · 시드는 SEED · 미결은 빈 칸', () => {
    expect(decisionPrintCanonLine({ key: 'a.b', decided: true, seeded: false, record: { choice: 'ON', decidedAt: '2026-10-01T00:00:00.000Z' } })).toBe('a.b|REAL|ON|2026-10-01T00:00:00.000Z');
    expect(decisionPrintCanonLine({ key: 'a.b', decided: false, seeded: true, record: { choice: 'X', decidedAt: 't' } })).toBe('a.b|SEED|X|t');
    expect(decisionPrintCanonLine({ key: 'a.b', decided: false, seeded: false, record: null })).toBe('a.b|OPEN||');
  });
  it('🔴 대장 정렬은 로캘에 기대지 않는다(코드 포인트) — 같은 세부 분류 안에서 대문자·점·밑줄 순서 고정', () => {
    const mk = (key: string) => ({ key, track: 'X', layer: 'STAFF', domain: null });
    expect(sortDecisionsForRegister([mk('b_a'), mk('b.a'), mk('B.a')]).map((i) => i.key)).toEqual(['B.a', 'b.a', 'b_a']);
  });
});

describe('발급 원장 — 범용 EP 잠금·한국 날짜·확인 코드', () => {
  it('🔴 범용 발급에 서버 생성 종류를 보내면 400 DOCUMENT_TYPE_SERVER_BUILT · 원장에 쓰지 않는다', async () => {
    for (const t of SERVER_BUILT_DOCUMENT_TYPES) {
      const p = docPrisma();
      const svc = new DocumentService(p as any);
      const e = await svc.issue({ documentType: t, sourceId: 'register', snapshot: { lines: ['forged|REAL|X|'] } } as any, 'u1').catch((x) => x);
      expect(e).toBeInstanceOf(BadRequestException);
      expect((e as BadRequestException).getResponse()).toMatchObject({ code: 'DOCUMENT_TYPE_SERVER_BUILT' });
      expect(p.issuedDocument.create).not.toHaveBeenCalled();
    }
  });
  it('대조군 — 기존 종류는 종전대로 발급되고 확인 코드 없는 주소', async () => {
    const p = docPrisma();
    const r = await new DocumentService(p as any).issue({ documentType: 'RECEIPT', sourceId: 's', snapshot: { a: 1 } } as any, 'u1');
    expect(r.issueNo).toMatch(/^WRB-RECEIPT-\d{8}-0001$/);
    expect(r.qrUrl).not.toContain('?v=');
  });
  it('🔴 발급번호 날짜는 한국 날짜 — 한국 00:30(UTC 전날 15:30)이 그날 번호', () => {
    const tz = process.env.TZ;
    process.env.TZ = 'Asia/Seoul';
    try {
      expect(issueDateKey(new Date('2026-10-11T15:30:00Z'))).toBe('20261012');
      expect(issueDateKey(new Date('2026-10-11T14:59:00Z'))).toBe('20261011');
    } finally { if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz; }
  });
  it('구조 — 발급 경로에 UTC 날짜 절단이 남지 않았다', () => {
    const src = readFileSync(join(__dirname, '../../src/modules/document/document.service.ts'), 'utf8');
    expect(src).not.toMatch(/toISOString\(\)\.slice\(0,\s*10\)/);
  });

  it('🔴 서버 생성 종류 — 확인 코드 없거나 틀리면 원장을 보지 않고 CHECK_CODE(기록 없음과 다른 사유)', async () => {
    const no = 'WRB-DECISION_REGISTER-20261012-0001';
    const p = docPrisma({ [no]: { issueNo: no, documentType: 'DECISION_REGISTER', issuedAt: new Date(), status: 'ORIGINAL', hash: 'h' } });
    const svc = new DocumentService(p as any);
    for (const v of [undefined, '', 'AAAAAAAAAA']) {
      const r = await svc.verify(no, v);
      expect(r).toMatchObject({ valid: false, reason: 'CHECK_CODE' });
      expect(r).not.toHaveProperty('documentType');
    }
    expect(p.issuedDocument.findUnique).not.toHaveBeenCalled();
    const code = svc.checkCode(no);
    expect(code).toMatch(new RegExp(`^[A-Z2-7]{${CHECK_CODE_LENGTH}}$`));
    expect(await svc.verify(no, code)).toMatchObject({ valid: true, documentType: 'DECISION_REGISTER', hospital: '가상병원' });
    expect(await svc.verify(no, code.toLowerCase())).toMatchObject({ valid: true }); // 옮겨 적은 소문자
    // 없는 번호 + 맞는 코드 = 기록 없음
    const none = 'WRB-DECISION_REGISTER-20261012-0099';
    expect(await svc.verify(none, svc.checkCode(none))).toMatchObject({ valid: false, reason: 'NOT_FOUND' });
  });
  it('확인 코드는 번호마다 다르고 비밀이 바뀌면 다르다 · 회전 중엔 이전 비밀도 받는다', async () => {
    const no = 'WRB-DECISION_RECORD-20261012-0001';
    const svc = new DocumentService(docPrisma() as any);
    const old = svc.checkCode(no);
    expect(svc.checkCode('WRB-DECISION_RECORD-20261012-0002')).not.toBe(old);
    process.env.DOC_VERIFY_SECRET = 'rotated';
    expect(svc.checkCode(no)).not.toBe(old);
    expect(svc.checkCodeMatches(no, old)).toBe(false);
    process.env.DOC_VERIFY_SECRET_PREVIOUS = 'verify-secret-test';
    expect(svc.checkCodeMatches(no, old)).toBe(true);
  });
  it('대조군 — 기존 종류는 확인 코드 없이 종전대로 답한다(이미 찍힌 종이 호환) · 무효 사유', async () => {
    const no = 'WRB-RECEIPT-20261001-0001';
    const p = docPrisma({ [no]: { issueNo: no, documentType: 'RECEIPT', issuedAt: new Date(), status: 'VOID', hash: 'h' } });
    expect(await new DocumentService(p as any).verify(no)).toMatchObject({ valid: false, reason: 'VOID', documentType: 'RECEIPT' });
  });
  it('재발급은 원본 해시를 그대로 옮긴다(서버 생성 종류도 막지 않는다)', async () => {
    const no = 'WRB-DECISION_REGISTER-20261012-0001';
    const p = docPrisma({ [no]: { issueNo: no, documentType: 'DECISION_REGISTER', sourceId: 'register', patientId: null, snapshotJson: { lines: [] }, formVersion: 'v1', hash: 'orig-hash' } });
    (p.issuedDocument as any).update = vi.fn(async () => ({}));
    const r = await new DocumentService(p as any).reissue(no, 'u1');
    expect(p.created[0]).toMatchObject({ documentType: 'DECISION_REGISTER', hash: 'orig-hash' });
    expect(r.qrUrl).toContain('?v=');
  });
});

describe('종류 라벨 정본(G15)', () => {
  it('🔴 렌더러 종류·서버 생성 종류·운영 원장 종류를 모두 덮는다', () => {
    const page = readFileSync(join(__dirname, '../../../web/src/app/print/[issueNo]/page.tsx'), 'utf8');
    const rendered = [...page.matchAll(/documentType === '([A-Z_]+)'/g)].map((m) => m[1]);
    expect(rendered.length).toBeGreaterThanOrEqual(14);
    const ops = ['ERP_MEDICAL_CONTRACT', 'CONTRACT', 'CONSENT', 'MEDICAL_RECORD_COPY', 'CHECKUP_RESULT', 'CERTIFICATE', 'RECEIPT']; // 2026-10-12 운영 실측
    const missing = [...rendered, ...SERVER_BUILT_DOCUMENT_TYPES, ...ops].filter((t) => !ISSUED_DOCUMENT_TYPE_LABEL[t]);
    expect(missing).toEqual([]);
  });
  it('발급번호에서 종류', () => {
    expect(documentTypeOfIssueNo('WRB-DECISION_RECORD-20261012-0003')).toBe('DECISION_RECORD');
    expect(documentTypeOfIssueNo('nope')).toBeNull();
  });
});

describe('서버 발급 인쇄본 — 발급·대조(결정·개시 브리핑·당직표·QI 보고서)', () => {
  const items = [
    { key: 'z.one', track: 'OPS', layer: 'STAFF', goLive: 'REQUIRED_BEFORE', decided: true, seeded: false, record: { choice: 'ON', decidedAt: '2026-10-01T00:00:00.000Z' } },
    { key: 'a.two', track: 'OPS', layer: 'STAFF', goLive: 'CAN_FOLLOW', decided: false, seeded: true, record: { choice: 'OFF', decidedAt: '2026-10-02T00:00:00.000Z' } },
    { key: 'm.three', track: 'OPS', layer: 'STAFF', goLive: 'REQUIRED_BEFORE', decided: false, seeded: false, record: null },
  ].map((i) => ({ ...i, domain: decisionDomainOf(i.key, i.track) }));
  const golive = { items: [{ key: 'g.a', status: 'READY' }, { key: 'g.b', status: 'PENDING' }] };
  const days = [{ date: '2026-10-01', dayOfWeek: '목', shifts: [{ id: 'e2', shift: 'NIGHT', staffName: '이|간호' }, { id: 'e1', shift: 'DAY', staffName: '김간호' }], leaves: [{ userId: 'u9', name: 'x', type: 'ANNUAL' }] }];
  const mk = (rows: Record<string, any> = {}) => {
    const p: any = docPrisma(rows);
    p.qiReportSnapshot = { findUnique: vi.fn(async ({ where }: any) => (where.id === 'r1' ? { id: 'r1', sha256: 'b'.repeat(64), status: 'DRAFT' } : where.id === 'r0' ? { id: 'r0', sha256: null, status: 'DRAFT' } : null)) };
    const docs = new DocumentService(p);
    const decisions = { list: vi.fn(async () => ({ items, measuredAt: '2026-10-12T01:00:00.000Z' })) };
    const goLive = { rollup: vi.fn(async () => golive) };
    const duty = { getSchedule: vi.fn(async () => ({ month: '2026-10', department: '전체', schedules: days })) };
    const svc = new PrintIssuanceService(p, docs, new DecisionPrintService(decisions as any), decisions as any, goLive as any, duty as any);
    return { p, docs, decisions, goLive, duty, svc };
  };

  it('🔴 결정 대장 — 서버가 지금 원장에서 줄을 만들고 해시 = sha256(줄 join \\n) · 진위확인 주소에 확인 코드', async () => {
    const { svc, p, docs } = mk();
    const r = await svc.issue({ kind: 'DECISION_REGISTER' } as any, 'u1');
    const lines = sortDecisionsForRegister(items).map((i) => decisionPrintCanonLine(i));
    expect(p.created[0].snapshotJson.lines).toEqual(lines);
    expect(r.hash).toBe(sha(lines.join('\n')));
    expect(r).toMatchObject({ documentType: 'DECISION_REGISTER', lines: 3, counts: { REAL: 1, SEED: 1, OPEN: 1 } });
    expect(p.created[0]).toMatchObject({ documentType: 'DECISION_REGISTER', sourceId: 'register', patientId: null, issuedBy: 'u1' });
    expect(r.verifyUrl).toBe(`https://his.example/verify/document/${r.issueNo}?v=${docs.checkCode(r.issueNo)}`);
  });
  it('의사결정서 — 그 결정 한 줄 · 키 없으면 400 · 없는 키는 404', async () => {
    const { svc, p } = mk();
    const r = await svc.issue({ kind: 'DECISION_RECORD', key: 'z.one' } as any, 'u1');
    expect(p.created[0]).toMatchObject({ documentType: 'DECISION_RECORD', sourceId: 'z.one' });
    expect(r.hash).toBe(sha('z.one|REAL|ON|2026-10-01T00:00:00.000Z'));
    await expect(svc.issue({ kind: 'DECISION_RECORD' } as any, 'u1')).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.issue({ kind: 'DECISION_RECORD', key: 'no.such' } as any, 'u1')).rejects.toBeInstanceOf(NotFoundException);
  });
  it('개시 브리핑 — go-live 항목 + 개시 전 필수 결정만(코드 포인트 순)', async () => {
    const { svc, p } = mk();
    await svc.issue({ kind: 'GOLIVE_BRIEFING' } as any, 'u1');
    expect(p.created[0].snapshotJson.lines).toEqual(['D:m.three|OPEN||', 'D:z.one|REAL|ON|2026-10-01T00:00:00.000Z', 'G:g.a|READY', 'G:g.b|PENDING']);
    expect(p.created[0].snapshotJson.lines).toEqual(goLivePrintLines(golive.items, items));
  });
  it('🔴 당직표 — 화면과 같은 근무표 응답에서 · 이름의 구분자는 지운다 · 월 없으면 400 · 전체 = 전 부서', async () => {
    const { svc, p, duty } = mk();
    await svc.issue({ kind: 'DUTY_ROSTER', month: '2026-10', department: '전체' } as any, 'u1');
    expect(duty.getSchedule).toHaveBeenCalledWith('2026-10', undefined);
    expect(p.created[0].snapshotJson.lines).toEqual(['L:2026-10-01:u9|ANNUAL', 'S:e1|2026-10-01|DAY|김간호', 'S:e2|2026-10-01|NIGHT|이 간호']);
    expect(p.created[0].snapshotJson.lines).toEqual(dutyRosterPrintLines(days));
    expect(p.created[0].sourceId).toBe('2026-10:ALL');
    await expect(svc.issue({ kind: 'DUTY_ROSTER' } as any, 'u1')).rejects.toBeInstanceOf(BadRequestException);
  });
  it('🔴 QI 보고서 — 보존된 본문 sha256 으로 · 해시 없는 보고서는 발급하지 않는다(409) · 없는 보고서 404', async () => {
    const { svc, p } = mk();
    await svc.issue({ kind: 'QI_REPORT', reportId: 'r1' } as any, 'u1');
    expect(p.created[0].snapshotJson.lines).toEqual(qiReportPrintLines({ id: 'r1', sha256: 'b'.repeat(64), status: 'DRAFT' }));
    await expect(svc.issue({ kind: 'QI_REPORT', reportId: 'r0' } as any, 'u1')).rejects.toBeInstanceOf(ConflictException);
    await expect(svc.issue({ kind: 'QI_REPORT', reportId: 'rx' } as any, 'u1')).rejects.toBeInstanceOf(NotFoundException);
  });
  it('🔴 DTO — 본문의 snapshot·lines 는 whitelist 밖 · 종류는 서버 생성 종류만 · 발급은 관리자만', () => {
    const bad = validateSync(plainToInstance(PrintIssueDto, { kind: 'RECEIPT' }));
    expect(bad.length).toBeGreaterThan(0);
    const ok = validateSync(plainToInstance(PrintIssueDto, { kind: 'DUTY_ROSTER', month: '2026-10' }));
    expect(ok).toEqual([]);
    expect(Object.keys(new PrintIssueDto())).not.toContain('snapshot');
    expect(Reflect.getMetadata(ROLES_KEY, PrintIssuanceController.prototype.issue)).toEqual(['ADMIN']);
    expect(Reflect.getMetadata(ROLES_KEY, PrintIssuanceController.prototype.compare)).toEqual(['ADMIN', 'EXECUTIVE']);
  });

  async function issued(svc: PrintIssuanceService, p: any, dto: any) {
    const r = await svc.issue(dto, 'u1');
    const row = { ...p.created[p.created.length - 1], issuedAt: new Date() };
    p.issuedDocument.findUnique.mockImplementation(async ({ where }: any) => (where.issueNo === r.issueNo ? row : null));
    return { r, row };
  }
  it('대조 — 그대로면 일치 · 하나가 바뀌면 "이 판 이후 1건"(이전 줄 → 지금 줄)', async () => {
    const { svc, p, decisions } = mk();
    const { r } = await issued(svc, p, { kind: 'DECISION_REGISTER' });
    const same = await svc.compare(r.issueNo);
    expect(same.compare.state).toBe('MATCH');
    expect(same).toMatchObject({ hashIntact: true, issuedBy: joinPatientName('김', '관리'), lines: 3 });
    decisions.list.mockResolvedValueOnce({ items: items.map((i) => (i.key === 'm.three' ? { ...i, decided: true, record: { choice: 'ON', decidedAt: 't2' } } : i)), measuredAt: 'later' });
    const changed = await svc.compare(r.issueNo);
    expect(changed.compare).toMatchObject({ state: 'CHANGED', changed: [{ key: 'm.three', before: 'm.three|OPEN||', after: 'm.three|REAL|ON|t2' }] });
  });
  it('대조 — 당직표는 발급 때 조건(월·부서)으로 다시 만든다', async () => {
    const { svc, p, duty } = mk();
    const { r } = await issued(svc, p, { kind: 'DUTY_ROSTER', month: '2026-10', department: '간호부' });
    duty.getSchedule.mockClear();
    expect((await svc.compare(r.issueNo)).compare.state).toBe('MATCH');
    expect(duty.getSchedule).toHaveBeenCalledWith('2026-10', '간호부');
  });
  it('🔴 지금 원장을 못 읽으면 비교 불가 — 일치로 접지 않는다', async () => {
    const { svc, p, goLive } = mk();
    const { r } = await issued(svc, p, { kind: 'GOLIVE_BRIEFING' });
    goLive.rollup.mockRejectedValueOnce(new Error('db down'));
    const x = await svc.compare(r.issueNo);
    expect(x.compare.state).toBe('UNAVAILABLE');
    expect(x.compare.changed).toEqual([]);
  });
  it('🔴 동결된 줄이 원장 해시와 다르면 hashIntact false(원장 행 변조)', async () => {
    const { svc, p } = mk();
    const { r, row } = await issued(svc, p, { kind: 'DECISION_REGISTER' });
    row.snapshotJson = { ...row.snapshotJson, lines: [...row.snapshotJson.lines.slice(1), 'x|REAL|Y|'] };
    expect((await svc.compare(r.issueNo)).hashIntact).toBe(false);
    expect(printLinesHash(['a'])).toBe(sha('a'));
  });
  it('v4.71.0 결정 스냅샷(params 없이 key) 도 대조한다', async () => {
    const { svc, p } = mk();
    const no = 'WRB-DECISION_RECORD-20261012-0007';
    const lines = ['z.one|REAL|ON|2026-10-01T00:00:00.000Z'];
    p.issuedDocument.findUnique.mockImplementation(async () => ({ issueNo: no, documentType: 'DECISION_RECORD', status: 'ORIGINAL', issuedAt: new Date(), issuedBy: null, hash: sha(lines[0]), snapshotJson: { v: 1, kind: 'RECORD', key: 'z.one', measuredAt: 'x', counts: {}, lines } }));
    expect((await svc.compare(no)).compare.state).toBe('MATCH');
  });
  it('서버 발급 인쇄본이 아닌 발급번호는 404(다른 문서 내용을 이 경로로 열지 않는다)', async () => {
    const { svc } = mk({ 'WRB-RECEIPT-20261012-0001': { issueNo: 'WRB-RECEIPT-20261012-0001', documentType: 'RECEIPT', snapshotJson: {} } });
    await expect(svc.compare('WRB-RECEIPT-20261012-0001')).rejects.toBeInstanceOf(NotFoundException);
  });
});
