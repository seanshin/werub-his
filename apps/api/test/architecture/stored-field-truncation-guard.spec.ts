/**
 * 🔴 (2026-09-15 U4) 사용자 입력 문자열을 저장 직전에 `slice(0, N)` 으로 **조용히 자르는** 자리 — 사용자는 입력한 사유·기록이
 * 온전히 남았다고 믿는다(판정 규칙: 자르면 잘랐다고 말한다). 청구 조정 사유(T2 기록)에서 시작해 api 전역을 훑었다.
 *
 * 지키는 것
 *  ① 저장 경로 자르기 자리 목록 동결(여유 0) — 자리마다 사유가 있어야 하고, 새 자리가 생기거나 사라지면 실패
 *     · DTO_GUARDED: 같은 길이의 DTO `@MaxLength` 가 먼저 400 을 돌려준다 — 서비스 slice 는 도달 불가 방어
 *     · SYSTEM: 사용자가 쓴 글이 아니다(요청 헤더·경로·스캐너 바코드·외부 웹훅)
 *     · DERIVED: 저장 원문은 따로 온전히 남고, 잘리는 것은 알림·결재 제목에 붙이는 요약이다
 *  ② 임상·법적 기록 자리는 DTO MaxLength 가 스키마 길이로 400 을 낸다(한도 안은 통과 — 대조군)
 *  ③ 운영 메모류는 잘라 저장하되 응답 `truncatedFields` 로 알린다(서비스 실호출 · 안 잘리면 빈 목록 — 대조군)
 *  ④ 파생 저장(ADR → 알레르기 반응)은 잘렸다는 표시가 저장값 안에 남는다
 *  ⑤ 스캐너 대조군 — 세 모양(`dto.x?.slice`·`String(dto.x).slice`·`(dto.x ?? '').slice`)을 실제로 읽는다
 */
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ClaimAdjustmentLineDto } from '../../src/modules/claim/dto/claim-body.dto';
import { TransferCareDto } from '../../src/modules/admission/dto/admission.dto';
import { ActivateRrtDto, CreateCodeBlueDto, RespondRrtDto } from '../../src/modules/code-blue/dto/code-blue.dto';
import { AssignIsolationDto, CreateResistanceSurveillanceDto } from '../../src/modules/infection-control/dto/resistance-isolation.dto';
import { CreatePatientFlagDto } from '../../src/modules/patient-flag/dto/patient-flag.dto';
import { DeliverDocumentRequestDto, RejectDocumentRequestDto, VerifyProxyDto } from '../../src/modules/medical-record-issuance/dto/staff-process.dto';
import { UpdatePortalProfileDto } from '../../src/modules/portal/dto/portal.dto';
import { TruncationRecorder, truncateWithNote } from '../../src/common/stored-truncation';
import { AccessControlService } from '../../src/modules/access-control/access-control.service';
import { FormularyService } from '../../src/modules/formulary/formulary.service';
import { TreatmentTemplateService } from '../../src/modules/treatment-template/treatment-template.service';

const SRC = path.resolve(__dirname, '../../src');
/** 다른 갈래 소관(U1·U2) — 이 가드는 보지 않는다 */
const EXCLUDED = /modules\/(medical-ai|code-master|transplant|education)\/|konis/i;

const PATTERNS = [
  /\b(dto|body|data|input|evidence|report|l|it|opts)\??\.([A-Za-z_]+)\??(?:\.trim\(\))?\??\.(?:slice|substring)\(0,\s*(\d+)\)/g,
  /String\(\s*(dto|body|data)\.([A-Za-z_]+)(?:\s*\?\?\s*'[^']*')?\s*\)\.(?:slice|substring)\(0,\s*(\d+)\)/g,
  // `String(x ?? '')` 안쪽 괄호를 두 번 세지 않는다
  /(?<!String)\(\s*(dto|body|data)\.([A-Za-z_]+)\s*\?\?\s*'[^']*'\s*\)\.(?:slice|substring)\(0,\s*(\d+)\)/g,
];

export function scanTruncations(src: string, rel: string): string[] {
  const code = src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  const keys: string[] = [];
  for (const re of PATTERNS) for (const m of code.matchAll(re)) keys.push(`${rel}#${m[1]}.${m[2]}@${m[3]}`);
  return keys;
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.ts$/.test(e.name) && !/\.spec\.ts$/.test(e.name)) acc.push(p);
  }
  return acc;
}

function current(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of walk(SRC)) {
    const rel = path.relative(SRC, f).split(path.sep).join('/');
    if (EXCLUDED.test(rel)) continue;
    for (const k of scanTruncations(fs.readFileSync(f, 'utf8'), rel)) out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

type Reason = 'DTO_GUARDED' | 'SYSTEM' | 'DERIVED';
type Frozen = { n: number; reason: Reason; why: string };
const g = (why: string, n = 1): Frozen => ({ n, reason: 'DTO_GUARDED', why });
const s = (why: string): Frozen => ({ n: 1, reason: 'SYSTEM', why });
const d = (why: string): Frozen => ({ n: 1, reason: 'DERIVED', why });

/** 동결 목록(2026-09-15 실측 43자리) — 늘거나 줄면 사람이 사유와 함께 고친다 */
const FROZEN: Record<string, Frozen> = {
  'modules/admission/admission.service.ts#dto.reason@200': g('TransferCareDto.reason MaxLength 195(해제 행 접두 "[전과] " 포함 200) — U4'),
  'modules/claim/claim.service.ts#l.lineRef@120': g('ClaimAdjustmentLineDto.lineRef MaxLength 120 — U4'),
  'modules/claim/claim.service.ts#l.itemName@200': g('ClaimAdjustmentLineDto.itemName MaxLength 200 — U4'),
  'modules/claim/claim.service.ts#l.adjustCode@20': g('ClaimAdjustmentLineDto.adjustCode MaxLength 20 — U4'),
  'modules/claim/claim.service.ts#l.adjustReason@300': g('ClaimAdjustmentLineDto.adjustReason MaxLength 300(청구 조정 사유 — 자르지 않고 400) — U4'),
  'modules/code-blue/code-blue.service.ts#dto.location@100': g('CreateCodeBlueDto.location MaxLength 100 — U4'),
  'modules/code-blue/code-blue.service.ts#dto.responderTeam@100': g('ActivateRrtDto·RespondRrtDto.responderTeam MaxLength 100 — U4', 2),
  'modules/consent/consent-device.service.ts#data.name@100': g('ConsentDeviceEnrollDto.name Length(1,100) — 종전부터'),
  'modules/consent/consent.service.ts#data.guardianName@100': g('공개 서명 DTO guardianName MaxLength 100 — 종전부터'),
  'modules/consent/consent.service.ts#data.guardianRelation@30': g('공개 서명 DTO guardianRelation MaxLength 30 — 종전부터'),
  'modules/consent/consent.service.ts#data.guardianLegalBasis@50': g('공개 서명 DTO guardianLegalBasis MaxLength 50 — 종전부터'),
  'modules/consult/consult.service.ts#opts.reason@300': g('RouteDto.reason MaxLength 300(부서 큐 이관) — 종전부터'),
  'modules/infection-control/infection-control.service.ts#data.resistanceType@20': g('CreateResistanceSurveillanceDto.resistanceType MaxLength 20 — U4'),
  'modules/infection-control/infection-control.service.ts#data.specimen@50': g('CreateResistanceSurveillanceDto.specimen MaxLength 50 — U4'),
  'modules/infection-control/infection-control.service.ts#data.ward@50': g('CreateResistanceSurveillanceDto.ward MaxLength 50 — U4'),
  'modules/infection-control/infection-control.service.ts#data.reason@500': g('AssignIsolationDto.reason MaxLength 500(격리 사유 — 자르지 않고 400) — U4'),
  'modules/infection-control/infection-control.service.ts#data.organism@200': g('AssignIsolationDto.organism MaxLength 200 — U4'),
  'modules/infection-control/infection-control.service.ts#data.roomNumber@30': g('AssignIsolationDto.roomNumber MaxLength 30 — U4'),
  'modules/infection-control/infection-control.service.ts#dto.organism@200': g('MDRO 등록 DTO organism Length(1,200) — 종전부터'),
  'modules/integration-gate/integration-gate.service.ts#evidence.evidenceRef@120': g('ConfirmGateDto.evidenceRef MaxLength 120 — 종전부터'),
  'modules/integration-gate/integration-gate.service.ts#evidence.approverName@50': g('ConfirmGateDto.approverName MaxLength 50 — 종전부터'),
  'modules/integration-gate/integration-gate.service.ts#evidence.evidenceUrl@300': g('ConfirmGateDto.evidenceUrl MaxLength 300 — 종전부터'),
  'modules/integration-gate/integration-gate.service.ts#evidence.note@500': g('ConfirmGateDto.note MaxLength 500 — 종전부터'),
  'modules/medical-record-issuance/issuance.service.ts#dto.purpose@200': g('StaffCreateRequestDto.purpose MaxLength 200 — 종전부터'),
  'modules/medical-record-issuance/issuance.service.ts#dto.note@500': g('StaffCreateRequestDto.note MaxLength 500 — 종전부터'),
  'modules/medical-record-issuance/issuance.service.ts#dto.requesterRelation@30': g('StaffCreateRequestDto.requesterRelation MaxLength 30 — 종전부터'),
  'modules/medical-record-issuance/issuance.service.ts#dto.legalBasis@20': g('StaffCreateRequestDto.legalBasis IsIn(최장 14자) — 종전부터'),
  'modules/medical-record-issuance/issuance.service.ts#dto.ref@120': g('DeliverDocumentRequestDto.ref MaxLength 120 — U4(종전 인라인 @Body)'),
  'modules/medical-record-issuance/issuance.service.ts#dto.note@300': g('VerifyProxyDto.note MaxLength 300 — U4(종전 인라인 @Body)'),
  'modules/patient-flag/patient-flag.service.ts#data.reason@1000': g('CreatePatientFlagDto.reason MaxLength 1000(upsert create·update 두 자리) — U4(종전 인라인 @Body)', 2),
  'modules/portal/portal.service.ts#data.phone@20': g('UpdatePortalProfileDto.phone MaxLength 20(종전 slice 30 > 컬럼 20 → 21~30자 500) — U4'),
  'modules/portal/portal.service.ts#data.email@200': g('UpdatePortalProfileDto.email MaxLength 200 — U4'),
  'modules/portal/portal.service.ts#data.address@500': g('UpdatePortalProfileDto.address MaxLength 500 — U4'),
  'modules/portal/portal.service.ts#data.occupation@100': g('UpdatePortalProfileDto.occupation MaxLength 100 — U4'),
  'modules/portal/portal.service.ts#data.maritalStatus@20': g('UpdatePortalProfileDto.maritalStatus MaxLength 20 — U4'),
  'modules/portal/portal.service.ts#data.religion@50': g('UpdatePortalProfileDto.religion MaxLength 50 — U4'),
  'modules/portal/portal.service.ts#data.preferredLanguage@10': g('UpdatePortalProfileDto.preferredLanguage MaxLength 10 — U4'),
  'modules/audit/smart-access-entry.ts#input.path@300': s('SMART 요청 경로(URL) — 사람이 쓴 글이 아니다'),
  'modules/consent/consent-device.service.ts#data.userAgent@300': s('요청 헤더 user-agent(컨트롤러가 이미 300 절단)'),
  'modules/device-usage/device-usage.service.ts#input.barcode@200': s('스캐너 원시 바코드 — 판독값 보존용 보조 칸'),
  'modules/pacs-proxy/pacs-webhook.controller.ts#body.radiologist_name@100': s('외부 PACS 웹훅이 보낸 판독의 이름'),
  'modules/ess/ess.service.ts#dto.reason@40': d('근태 정정 결재 제목 요약 — 정정 사유 원문은 정정 요청 행에 온전히 저장'),
  'modules/remote-consultation/remote-consultation.service.ts#data.content@40': d('알림 문장 요약 — 메시지 원문은 content 에 온전히 저장'),
};

const DTO_CONTRACT: { name: string; cls: new () => object; field: string; max: number }[] = [
  { name: '청구 조정 사유', cls: ClaimAdjustmentLineDto, field: 'adjustReason', max: 300 },
  { name: '청구 조정 코드', cls: ClaimAdjustmentLineDto, field: 'adjustCode', max: 20 },
  { name: '청구 조정 항목명', cls: ClaimAdjustmentLineDto, field: 'itemName', max: 200 },
  { name: '청구 조정 라인', cls: ClaimAdjustmentLineDto, field: 'lineRef', max: 120 },
  { name: '전과 사유', cls: TransferCareDto, field: 'reason', max: 195 },
  { name: 'Code Blue 위치', cls: CreateCodeBlueDto, field: 'location', max: 100 },
  { name: 'RRT 출동팀', cls: ActivateRrtDto, field: 'responderTeam', max: 100 },
  { name: 'RRT 응답팀', cls: RespondRrtDto, field: 'responderTeam', max: 100 },
  { name: '내성균 감시 균명', cls: CreateResistanceSurveillanceDto, field: 'organism', max: 200 },
  { name: '격리 사유', cls: AssignIsolationDto, field: 'reason', max: 500 },
  { name: '환자 마킹 사유', cls: CreatePatientFlagDto, field: 'reason', max: 1000 },
  { name: '발급 반려 상세', cls: RejectDocumentRequestDto, field: 'detail', max: 250 },
  { name: '교부 송장·수신번호', cls: DeliverDocumentRequestDto, field: 'ref', max: 120 },
  { name: '대리인 검증 메모', cls: VerifyProxyDto, field: 'note', max: 300 },
  { name: '포털 전화번호', cls: UpdatePortalProfileDto, field: 'phone', max: 20 },
  { name: '포털 주소', cls: UpdatePortalProfileDto, field: 'address', max: 500 },
];

function errorProps(cls: new () => object, plain: Record<string, unknown>): string[] {
  return validateSync(plainToInstance(cls, plain)).map((e) => e.property);
}

describe('저장 경로 조용한 자르기 — U4', () => {
  it('⑤ 대조군 — 스캐너가 세 모양을 읽고 String(x ?? "") 을 두 번 세지 않는다', () => {
    const fixture = [
      "data: { reason: dto.reason?.slice(0, 300) }",
      "location: dto.location ? String(dto.location).slice(0, 100) : '미상'",
      "guardianName: (data.guardianName ?? '').slice(0, 100)",
      "mdroType: String(data.resistanceType ?? 'OTHER').slice(0, 20)",
      "const msg = `${x}`.slice(0, 80)",
      "// note: dto.note?.slice(0, 500) 주석은 세지 않는다",
    ].join('\n');
    expect(scanTruncations(fixture, 'x.ts').sort()).toEqual([
      'x.ts#data.guardianName@100', 'x.ts#data.resistanceType@20', 'x.ts#dto.location@100', 'x.ts#dto.reason@300',
    ]);
  });

  it('① 자리 목록이 동결과 같고(여유 0) 자리마다 사유가 있다', () => {
    const now = current();
    const frozen = Object.fromEntries(Object.entries(FROZEN).map(([k, v]) => [k, v.n]));
    expect(now, `저장 경로 자르기 자리가 바뀌었다 — 새 자리는 DTO MaxLength(400) 또는 TruncationRecorder(truncatedFields)로:\n${JSON.stringify(now, null, 1)}`).toEqual(frozen);
    for (const [k, v] of Object.entries(FROZEN)) expect(v.why.trim().length, k).toBeGreaterThan(0);
  });

  it.each(DTO_CONTRACT)('② $name — 한도 초과는 400(검증 오류), 한도 안은 그 필드 오류 없음', ({ cls, field, max }) => {
    expect(errorProps(cls, { [field]: 'x'.repeat(max + 1) })).toContain(field);
    expect(errorProps(cls, { [field]: 'x'.repeat(max) })).not.toContain(field);
  });

  describe('③ 운영 메모류 — 잘라 저장하되 truncatedFields 로 알린다', () => {
    it('커스텀 페이지 제목 200', async () => {
      const upsert = vi.fn().mockResolvedValue({});
      const svc = new AccessControlService({ systemConfig: { upsert } } as never);
      const cut = await svc.setCustomPage('guide', { title: 'T'.repeat(201), content: 'body' }, 'u1');
      expect(cut.truncatedFields).toEqual([{ field: 'title', max: 200, receivedLength: 201 }]);
      expect((upsert.mock.calls[0][0] as { update: { value: { title: string } } }).update.value.title).toHaveLength(200);
      const ok = await svc.setCustomPage('guide', { title: 'T', content: 'body' }, 'u1');
      expect(ok.truncatedFields).toEqual([]);
    });

    it('처방집 체크리스트 이름 120·설명 300', async () => {
      const create = vi.fn().mockImplementation(async ({ data }: { data: object }) => ({ id: 'l1', ...data }));
      const svc = new FormularyService({ formularyList: { create } } as never);
      const res = await svc.createList('u1', { domain: 'MEDICATION', name: 'N'.repeat(121), description: 'D'.repeat(301), items: [] });
      expect(res.truncatedFields.map((f) => f.field)).toEqual(['name', 'description']);
      expect(res.name).toHaveLength(120);
      const ok = await svc.createList('u1', { domain: 'MEDICATION', name: '당뇨', items: [] });
      expect(ok.truncatedFields).toEqual([]);
    });

    it('치료일정 변경 사유 150 · 누적 메모 300 은 최신을 남긴다', async () => {
      const item = { id: 'i1', status: 'PLANNED', notes: 'A'.repeat(290), refId: null, refType: null, scheduleId: 's1', plannedAt: new Date('2026-09-01T00:00:00Z') };
      const update = vi.fn().mockImplementation(async ({ data }: { data: object }) => ({ ...item, ...data }));
      // 🔴 정본은 항목 이동과 후속 일괄이동을 한 트랜잭션에서 한다(K1) — 목도 그 모양이라야 콜백이 실제로 돈다
      const prisma: Record<string, unknown> = { patientScheduleItem: { findUnique: vi.fn().mockResolvedValue(item), update, findMany: vi.fn().mockResolvedValue([]) } };
      prisma.$transaction = vi.fn().mockImplementation((arg: unknown) =>
        typeof arg === 'function' ? (arg as (c: unknown) => unknown)(prisma) : Promise.all(arg as unknown[]),
      );
      const svc = new TreatmentTemplateService(prisma as never);
      const res = await svc.updateScheduleItem('i1', { plannedAt: '2026-09-08T00:00:00Z', reason: `${'R'.repeat(150)}끝` });
      expect(res.truncatedFields.map((f) => f.field)).toEqual(['reason', 'notes']);
      expect(res.notes).toHaveLength(300);
      expect(res.notes!.startsWith('…')).toBe(true);
      expect(res.notes!.endsWith(`[변경]: ${'R'.repeat(150)}`)).toBe(true); // 최신 사유가 남는다(종전엔 이 부분이 잘렸다)
      // 대조군 — 짧은 이력 + 짧은 사유는 아무것도 자르지 않는다
      item.notes = '[변경]: 검사 일정 조정';
      const ok = await svc.updateScheduleItem('i1', { plannedAt: '2026-09-08T00:00:00Z', reason: '환자 요청' });
      expect(ok.truncatedFields).toEqual([]);
      expect(ok.notes).toBe('[변경]: 검사 일정 조정 | [변경]: 환자 요청');
    });

    it('TruncationRecorder — null/undefined 는 그대로, 한도 안은 기록하지 않는다', () => {
      const rec = new TruncationRecorder();
      expect(rec.clip('a', undefined, 3)).toBeUndefined();
      expect(rec.clip('b', null, 3)).toBeNull();
      expect(rec.clip('c', 'abc', 3)).toBe('abc');
      expect(rec.truncatedFields).toEqual([]);
      expect(rec.clip('d', 'abcd', 3)).toBe('abc');
      expect(rec.truncatedFields).toEqual([{ field: 'd', max: 3, receivedLength: 4 }]);
    });
  });

  it('④ ADR → 알레르기 반응 파생은 잘렸다는 표시가 저장값에 남는다(길이는 한도 이내)', () => {
    const note = ' …(전문: ADR 보고)';
    const cut = truncateWithNote('가'.repeat(600), 500, note);
    expect(cut).toHaveLength(500);
    expect(cut.endsWith(note)).toBe(true);
    expect(truncateWithNote('짧은 반응', 500, note)).toBe('짧은 반응');
    const pharmacy = fs.readFileSync(path.join(SRC, 'modules/pharmacy/pharmacy.service.ts'), 'utf8');
    expect(pharmacy).toMatch(/reaction:\s*truncateWithNote\(report\.reactionDescription,\s*500,/);
  });
});
