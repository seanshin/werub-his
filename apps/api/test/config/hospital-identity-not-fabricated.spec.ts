import { describe, it, expect, vi } from 'vitest';
import { ReferralLetterService } from '../../src/modules/referral-letter/referral-letter.service';
import { ForeignPatientService } from '../../src/modules/foreign-patient/foreign-patient.service';
import { VoucherService } from '../../src/modules/voucher/voucher.service';
import { CrmAiService } from '../../src/modules/crm/crm-ai.service';
import { makeSerial } from '../../src/modules/voucher/voucher-serial';
import { readHospitalConfig, readSmsHeader, requireHospitalIdentityForSubmission } from '../../src/modules/config/hospital-facts';

/**
 * 🔴 기관 정체(이름·주소·대표전화·요양기관기호)를 **지어내지 않는다** — 2026-09-11 회수분의 계약.
 *
 * 배경: `ConfigRuntimeService.get()` 은 DB 행이 없으면 DEFAULTS 로 떨어지는데, `hospital.*` 의 DEFAULTS 는
 *   개발 플레이스홀더다('Hospital RUN 병원'·'서울시 강남구'·'02-1234-5678'·'12345678' — go-live 가 이 값들을
 *   "미확정"으로 센다). 그 값이 회송서·영문 진단서·영수증·검진권 진위검증·환자 SMS 로 **기관 사실인 척** 나갔다.
 *   그래서 이 축의 소비처는 전부 정본 판독기(`config/hospital-facts.ts`)로 수렴한다 — DB 행만 읽고,
 *   없으면 `null`(호출부가 "미설정"이라 말하거나 그 문장을 뺀다), 조회 실패는 전파한다.
 *
 * 목은 정본의 **실제 반환 모양**을 쓴다:
 *   `systemConfig.findMany({ where: { key: { in } }, select: { key, value } })` → `[{ key, value }]`
 *   (내가 가정한 모양을 테스트하면 가드가 헛돈다 — 이 저장소에서 실제로 겪은 함정이다.)
 */

/** 정본이 실제로 부르는 그 호출 모양으로 응답하는 목 — 등록된 행만 돌려준다 */
function configRows(rows: Record<string, string> = {}) {
  return {
    findMany: vi.fn(async ({ where, select }: { where?: { key?: { in?: string[] } }; select?: Record<string, boolean> }) => {
      // 정본은 반드시 키를 좁혀서·key/value 만 골라 읽는다(전건 스캔이면 이 단언이 깨진다)
      expect(Array.isArray(where?.key?.in)).toBe(true);
      expect(select).toEqual({ key: true, value: true });
      return (where!.key!.in as string[]).filter((k) => k in rows).map((k) => ({ key: k, value: rows[k] }));
    }),
  };
}

const FAKE_DEFAULTS = ['Hospital RUN 병원', 'Hospital RUN', '서울시 강남구', '02-1234-5678', '12345678'];

describe('정본 판독기 — DB 행만 읽는다', () => {
  it('미설정 키는 null 이고, 빈 문자열·공백도 null 이다(그럴듯한 값으로 메우지 않는다)', async () => {
    const prisma = { systemConfig: configRows({ 'hospital.name': '  위루비병원  ', 'hospital.address': '   ' }) };
    const got = await readHospitalConfig(prisma as never, ['hospital.name', 'hospital.address', 'hospital.phone'] as const);
    expect(got).toEqual({ 'hospital.name': '위루비병원', 'hospital.address': null, 'hospital.phone': null });
  });

  it('🔴 조회 실패는 "미설정"으로 번역하지 않는다 — 전파한다', async () => {
    const prisma = { systemConfig: { findMany: vi.fn().mockRejectedValue(new Error('DB down')) } };
    await expect(readHospitalConfig(prisma as never, ['hospital.name'] as const)).rejects.toThrow('DB down');
    await expect(readSmsHeader(prisma as never)).rejects.toThrow('DB down');
    await expect(requireHospitalIdentityForSubmission(prisma as never, ['hospital.name'] as const)).rejects.toThrow('DB down');
  });

  it('🔴 대외 제출물은 미설정이면 만들지 않는다(422) — 표지조차 싣지 않고, 무엇이 비었는지 말한다', async () => {
    const prisma = { systemConfig: configRows({ 'hospital.code': '99887766' }) };
    const e: any = await requireHospitalIdentityForSubmission(prisma as never, ['hospital.code', 'hospital.name'] as const).catch((x) => x);
    expect(e.getStatus()).toBe(422);
    expect(e.getResponse()).toMatchObject({ code: 'HOSPITAL_IDENTITY_UNSET', missing: ['hospital.name'] });
  });
});

describe('회송서 HTML — 다른 기관에 건네는 문서', () => {
  const letter = {
    id: 'l1', type: 'TRANSFER', letterNumber: 'RL-1', urgency: 'ROUTINE', content: '경과 양호', createdAt: new Date('2026-09-01'), signedAt: null,
    patient: { familyName: '홍', givenName: '길동', mrn: 'HR-1', dateOfBirth: new Date('1980-01-01'), gender: 'MALE' },
    fromDoctor: { familyName: '김', givenName: '의사', department: '내과' },
    toDoctor: null,
  };
  const svc = (rows: Record<string, string>) =>
    new ReferralLetterService(
      { referralLetter: { findUnique: vi.fn().mockResolvedValue(letter) }, systemConfig: configRows(rows) } as never,
      {} as never, {} as never, {} as never,
    );

  it('기관 정체는 설정 정본에서 온다 — 코드에 박힌 사본이 아니다', async () => {
    const html = await svc({
      'hospital.name': '위루비병원', 'hospital.address': '가상 가상시 가상로 126', 'hospital.phone': '02-000-0000',
    }).generateHtml('l1');
    expect(html).toContain('위루비병원');
    expect(html).toContain('가상 가상시 가상로 126');
    expect(html).toContain('02-000-0000');
  });

  it('🔴 미설정이면 "미설정"이라고 찍는다 — 빈칸(누락으로 읽힘)도, 지어낸 값도 아니다', async () => {
    const html = await svc({}).generateHtml('l1');
    expect(html).toContain('(기관명 미설정)');
    expect(html).toContain('(주소 미설정)');
    expect(html).toContain('(대표전화 미설정)');
    for (const fake of FAKE_DEFAULTS) expect(html).not.toContain(fake);
  });
});

describe('영문 진단서(외국인) — 기관 밖으로 나가는 증명서', () => {
  const prismaFor = (rows: Record<string, string>) => ({
    systemConfig: configRows(rows),
    patient: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'p1', mrn: 'HR-1', familyName: '홍', givenName: '길동', nameEn: 'Hong Gildong',
        dateOfBirth: new Date('1980-01-01'), gender: 'MALE', nationality: 'US', passportNumber: null,
      }),
    },
    encounter: { findMany: vi.fn().mockResolvedValue([]) },
  });

  it('영문 키가 있으면 영문을, 없으면 국문을 쓴다(설정 설명이 정한 규칙)', async () => {
    const svc = new ForeignPatientService(prismaFor({
      'hospital.name': '위루비병원', 'hospital.addressEn': 'Example, Korea', 'hospital.phone': '02-000-0000',
    }) as never);
    const r: any = await svc.generateEnglishCertificate('p1');
    expect(r.hospital.name).toBe('위루비병원'); // nameEn 미설정 → 국문
    expect(r.hospital.address).toBe('Example, Korea');
    expect(r.hospital.unconfigured).toEqual(['licenseNo']);
  });

  it('🔴 전부 미설정이면 DEFAULTS 플레이스홀더가 아니라 "미설정" 표지가 찍히고, 무엇이 비었는지 밝힌다', async () => {
    const svc = new ForeignPatientService(prismaFor({}) as never);
    const r: any = await svc.generateEnglishCertificate('p1');
    expect(r.hospital.name).toBe('[Institution name not configured]');
    expect(r.hospital.unconfigured).toEqual(['name', 'address', 'phone', 'licenseNo']);
    for (const fake of FAKE_DEFAULTS) expect(JSON.stringify(r.hospital)).not.toContain(fake);
  });

  it('🔴 설정 조회 실패를 빈 값으로 삼키지 않는다 — 전파한다(종전 `.catch(() => "")`)', async () => {
    const prisma = { ...prismaFor({}), systemConfig: { findMany: vi.fn().mockRejectedValue(new Error('DB down')) } };
    await expect(new ForeignPatientService(prisma as never).generateEnglishCertificate('p1')).rejects.toThrow('DB down');
  });
});

describe('검진권 공개 진위검증 — 무인증 공개 응답', () => {
  // 시리얼은 정본 생성기로 만든다(체크값이 SERIAL_SECRET 파생이라 손으로 적으면 형식 검증에서 먼저 걸린다)
  const SERIAL = makeSerial({ prefix: 'WGV', group: 'AA', year2: '26', batchSeq: 1, serialNo: 1 });
  const voucher = {
    serial: SERIAL, form: 'DIGITAL', programId: null, faceValue: 100000, balance: 100000,
    status: 'ACTIVE', expiresAt: new Date('2099-01-01'), batch: { merkleRoot: null, anchorId: null },
  };
  const svc = (rows: Record<string, string>) =>
    new VoucherService(
      { checkupVoucher: { findUnique: vi.fn().mockResolvedValue(voucher) }, systemConfig: configRows(rows) } as never,
      {} as never, {} as never, {} as never, {} as never,
    );

  it('발행 기관은 설정 정본에서 온다', async () => {
    expect((await svc({ 'hospital.name': '위루비병원' }).publicVerify(SERIAL)).issuer).toBe('위루비병원');
  });

  it('🔴 미설정이면 발행자를 지어내지 않는다(null) — 공개 응답이 근거로 쓰인다', async () => {
    const r = await svc({}).publicVerify(SERIAL);
    expect(r.issuer).toBeNull();
    expect(r.valid).toBe(true); // 진위 판정 자체는 그대로다(동작을 바꾸지 않는다)
  });
});

describe('CRM 캠페인 초안 — 환자에게 나갈 문구', () => {
  const svc = (rows: Record<string, string>) => new CrmAiService({ systemConfig: configRows(rows) } as never);

  it('대표전화는 설정 정본으로 채운다 — 자리표시자를 남기지 않는다', async () => {
    const r = await svc({ 'hospital.phone': '02-000-0000' }).generateContent({ campaignType: 'REMINDER', channel: 'EMAIL' });
    expect(r.content).toContain('☎ 02-000-0000로');
    expect(r.content).not.toContain('{{hospitalPhone}}');
    expect(r.variables).not.toContain('hospitalPhone'); // 캠페인 변수가 아니다(치환 주체가 다르다)
  });

  it('🔴 미설정이면 번호를 지어내지 않고 그 문장을 뺀다 — 자리표시자도 남기지 않는다', async () => {
    for (const [campaignType, channel] of [['REMINDER', 'EMAIL'], ['REENGAGEMENT', 'SMS']] as const) {
      const r = await svc({}).generateContent({ campaignType, channel });
      expect(r.content).not.toContain('{{hospitalPhone}}');
      expect(r.content).not.toContain('02-1234-5678');
      expect(r.content).not.toMatch(/\d{2,4}-\d{3,4}-\d{4}/);
    }
  });
});
