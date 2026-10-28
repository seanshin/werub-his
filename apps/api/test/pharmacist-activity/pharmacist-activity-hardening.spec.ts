import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getMetadataStorage } from 'class-validator';
import { ValidationPipe, BadRequestException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { PharmacistActivityController } from '../../src/modules/pharmacist-activity/pharmacist-activity.controller';
import { PharmacistActivityService } from '../../src/modules/pharmacist-activity/pharmacist-activity.service';
import {
  CreateInterventionDto, CreateAdrReportDto, CreateAspRequestDto, CreateTdmRequestDto,
} from '../../src/modules/pharmacist-activity/dto/pharmacist-activity.dto';
import { ComputeNaranjoDto, CreateCounselDto } from '../../src/modules/pharmacy/dto/counsel.dto';
import { ROLES_KEY } from '../../src/common/decorators/roles.decorator';

/**
 * 약사 임상활동 하드닝 가드(2026-08-26).
 *
 * 되살아나면 안 되는 것:
 *  ① 인라인 `@Body()` — 런타임 metatype 이 `Object` 라 **ValidationPipe 가 통째로 스킵**된다
 *     (v4.3.0 처방 EP 와 같은 유형). 중재 유형·ADR 중증도에 아무 문자열이나 들어갔다.
 *  ② Naranjo 를 **빈 설문으로 계산** — 0점 = UNLIKELY(희박)라는 임상 판정이 나왔다.
 *  ③ Naranjo 점수를 계산하고도 **저장하지 않음**(컬럼은 개통 이래 전부 NULL).
 *  ④ 의사가 자기 처방의 중재에 **회신할 수 없음**(클래스 @Roles 가 PHARMACIST·ADMIN 뿐이었다).
 *
 * 🔴 각 항목에 "정상 입력은 통과한다" 대조군을 함께 둔다 — 무조건 실패하는 가드는 가드가 아니다.
 */

// 운영과 같은 설정(main.ts) — 이 파이프로 통과시켜야 "실제로 검증이 도는가"를 잰다
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: false, transform: true });
const asBody = (metatype: unknown) => ({ type: 'body' as const, metatype: metatype as never });

const PATIENT = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';

describe('① 쓰기 EP 는 DTO 로 검증된다(인라인 @Body 로 되돌리면 이 가드가 죽는다)', () => {
  it('중재 유형에 아무 문자열이나 넣으면 400 — 정상 유형(ROUTE)은 통과한다', async () => {
    await expect(pipe.transform(
      { patientId: PATIENT, type: '용량조절', reason: 'r', suggestion: 's' },
      asBody(CreateInterventionDto),
    )).rejects.toBeInstanceOf(BadRequestException);

    // 대조군 — 정상 입력을 실패로 말하지 않는다
    await expect(pipe.transform(
      { patientId: PATIENT, type: 'ROUTE', reason: 'r', suggestion: 's' },
      asBody(CreateInterventionDto),
    )).resolves.toMatchObject({ type: 'ROUTE' });
  });

  it('🔴 클라이언트가 보낸 주체(pharmacistId)는 whitelist 가 지운다', async () => {
    const out = await pipe.transform(
      { patientId: PATIENT, type: 'DOSE', reason: 'r', suggestion: 's', pharmacistId: 'ph-001', pharmacistName: '임약사' },
      asBody(CreateInterventionDto),
    );
    expect(out).not.toHaveProperty('pharmacistId');
    expect(out).not.toHaveProperty('pharmacistName');
  });

  it('환자 ID 가 UUID 가 아니면 400 — "pt-001" 같은 값이 조용히 흘러가지 않는다', async () => {
    await expect(pipe.transform(
      { patientId: 'pt-001', type: 'DOSE', reason: 'r', suggestion: 's' },
      asBody(CreateInterventionDto),
    )).rejects.toBeInstanceOf(BadRequestException);
  });

  it('ADR 중증도·결과·인과관계는 스키마 어휘만 받는다(어휘가 오염되면 라벨표가 빈 배지를 그린다)', async () => {
    const base = {
      patientId: PATIENT, suspectedDrug: 'Vancomycin', reaction: '두드러기',
      onsetDate: '2026-08-01', outcome: 'RECOVERED', causalityAssessment: 'POSSIBLE',
    };
    await expect(pipe.transform({ ...base, severity: '중등' }, asBody(CreateAdrReportDto)))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ ...base, severity: 'MODERATE', outcome: '회복' }, asBody(CreateAdrReportDto)))
      .rejects.toBeInstanceOf(BadRequestException);
    // 대조군
    await expect(pipe.transform({ ...base, severity: 'MODERATE' }, asBody(CreateAdrReportDto)))
      .resolves.toMatchObject({ severity: 'MODERATE', outcome: 'RECOVERED' });
  });

  it('ASP 사용기간은 음수·소수를 받지 않는다(종전 인라인 @Body 는 통과시켰다)', async () => {
    const base = { patientId: PATIENT, antimicrobialName: 'Meropenem', indication: 'HAP' };
    await expect(pipe.transform({ ...base, duration: -3 }, asBody(CreateAspRequestDto)))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ ...base, duration: 2.5 }, asBody(CreateAspRequestDto)))
      .rejects.toBeInstanceOf(BadRequestException);
    // 대조군 — 기간을 안 적은 요청은 여전히 통과한다(모르는 값을 강제로 채우지 않는다)
    await expect(pipe.transform(base, asBody(CreateAspRequestDto))).resolves.toMatchObject({ duration: undefined });
    await expect(pipe.transform({ ...base, duration: 7 }, asBody(CreateAspRequestDto))).resolves.toMatchObject({ duration: 7 });
  });

  it('TDM 목표범위는 숫자거나 아예 없다 — 빈 문자열이 0 으로 둔갑하지 않는다', async () => {
    await expect(pipe.transform(
      { patientId: PATIENT, drugName: 'Vancomycin', targetRangeMin: 'abc' },
      asBody(CreateTdmRequestDto),
    )).rejects.toBeInstanceOf(BadRequestException);
    const out = await pipe.transform({ patientId: PATIENT, drugName: 'Vancomycin' }, asBody(CreateTdmRequestDto));
    expect(out.targetRangeMin).toBeUndefined();
  });

  it('복약지도는 조제 UUID 와 내용을 요구한다(상담 시간 0분은 받지 않는다)', async () => {
    await expect(pipe.transform(
      { dispensingId: 'd-1', patientId: PATIENT, content: '설명함' },
      asBody(CreateCounselDto),
    )).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform(
      { dispensingId: PATIENT, patientId: PATIENT, content: '설명함', duration: 0 },
      asBody(CreateCounselDto),
    )).rejects.toBeInstanceOf(BadRequestException);
    // 대조군
    await expect(pipe.transform(
      { dispensingId: PATIENT, patientId: PATIENT, content: '설명함', counselType: 'INITIAL' },
      asBody(CreateCounselDto),
    )).resolves.toMatchObject({ counselType: 'INITIAL' });
  });
});

describe('② Naranjo 는 빈 설문을 판정하지 않는다', () => {
  it('🔴 답을 하나도 안 낸 설문은 400 — 종전에는 0점=UNLIKELY(희박)가 나왔다', async () => {
    await expect(pipe.transform({ answers: [] }, asBody(ComputeNaranjoDto)))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ answers: ['yes', 'no'] }, asBody(ComputeNaranjoDto)))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ answers: Array(10).fill('maybe') }, asBody(ComputeNaranjoDto)))
      .rejects.toBeInstanceOf(BadRequestException);
    // 대조군 — 10문항을 모두 '모름'으로 답한 것은 유효한 평가다(안 한 것과 다르다)
    await expect(pipe.transform({ answers: Array(10).fill('unknown') }, asBody(ComputeNaranjoDto)))
      .resolves.toMatchObject({ answers: Array(10).fill('unknown') });
  });
});

describe('④ 의사가 자기 처방의 중재에 회신할 수 있다', () => {
  it('🔴 PATCH interventions/:id 의 핸들러 @Roles 에 DOCTOR 가 있다', () => {
    const reflector = new Reflector();
    const roles = reflector.get<UserRole[]>(
      ROLES_KEY,
      PharmacistActivityController.prototype.updateIntervention,
    );
    expect(roles).toBeDefined();
    expect(roles).toContain(UserRole.DOCTOR);
    expect(roles).toContain(UserRole.PHARMACIST);
  });

  it('대조군 — 등록(POST)은 핸들러 단위로 넓히지 않았다(클래스 정책을 따른다)', () => {
    const reflector = new Reflector();
    const roles = reflector.get<UserRole[]>(
      ROLES_KEY,
      PharmacistActivityController.prototype.createIntervention,
    );
    expect(roles).toBeUndefined();
  });
});

describe('③ Naranjo 점수는 계산했을 때만 저장된다', () => {
  let prisma: any;
  let service: PharmacistActivityService;

  const adrRow = (naranjoScore: number | null) => ({
    id: 'a1', patientId: PATIENT, reporterId: USER,
    suspectedDrugName: 'Vancomycin', reactionDescription: '두드러기',
    severity: 'MODERATE', onsetDate: new Date('2026-08-01'), outcome: 'RECOVERED',
    causalityAssessment: 'PROBABLE', naranjoScore, kidsReportNumber: null,
    createdAt: new Date('2026-08-02T00:00:00Z'),
  });

  beforeEach(() => {
    prisma = {
      adverseReactionReport: {
        create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve(adrRow(data.naranjoScore ?? null))),
        findMany: vi.fn().mockResolvedValue([{ ...adrRow(6), patient: { familyName: '홍', givenName: '길동' } }]),
      },
    };
    service = new PharmacistActivityService(prisma as never);
  });

  const base = {
    patientId: PATIENT, patientName: '홍길동', suspectedDrug: 'Vancomycin', reaction: '두드러기',
    severity: 'MODERATE' as const, onsetDate: '2026-08-01', outcome: 'RECOVERED',
    causalityAssessment: 'PROBABLE', reportedBy: USER,
  };

  it('🔴 점수를 넘기면 컬럼에 저장된다(종전에는 넘길 경로 자체가 없어 전부 NULL 이었다)', async () => {
    const out = await service.createAdrReport({ ...base, naranjoScore: 6 });
    expect(prisma.adverseReactionReport.create.mock.calls[0][0].data.naranjoScore).toBe(6);
    expect(out.naranjoScore).toBe(6);
  });

  it('평가하지 않았으면 컬럼도 비운다 — 0 으로 채우면 "희박"이라는 판정이 붙는다', async () => {
    const out = await service.createAdrReport(base);
    expect(prisma.adverseReactionReport.create.mock.calls[0][0].data.naranjoScore).toBeUndefined();
    expect(out.naranjoScore).toBeNull();
  });

  it('목록도 점수를 그대로 실어 준다(화면이 미평가와 0점을 갈라 그릴 수 있게)', async () => {
    const rows = await service.getAdrReports();
    expect(rows[0].naranjoScore).toBe(6);
  });
});

describe('중재 워크리스트 — 상태 필터는 서버에서 건다', () => {
  let prisma: any;
  let service: PharmacistActivityService;

  beforeEach(() => {
    prisma = {
      pharmacistIntervention: { findMany: vi.fn().mockResolvedValue([]) },
      patient: { findMany: vi.fn().mockResolvedValue([]) },
      user: { findMany: vi.fn().mockResolvedValue([]) },
    };
    service = new PharmacistActivityService(prisma as never);
  });

  it('PENDING 필터가 where 에 실린다 — 클라이언트가 200건을 받아 거르면 절단분이 사라진다', async () => {
    await service.getInterventions({ status: 'PENDING' });
    expect(prisma.pharmacistIntervention.findMany.mock.calls[0][0].where).toMatchObject({ status: 'PENDING' });
  });

  it('모르는 상태 어휘는 400 으로 막는다(조용히 전체를 돌려주지 않는다)', async () => {
    await expect(service.getInterventions({ status: 'DONE' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('대조군 — 필터가 없으면 where 는 비어 있다(임의 조건을 끼워 넣지 않는다)', async () => {
    await service.getInterventions();
    expect(prisma.pharmacistIntervention.findMany.mock.calls[0][0].where).toEqual({});
  });
});

/**
 * 🔴 FE↔DTO 기계 대조 — whitelist:true 는 DTO 에 없는 키를 **성공 응답과 함께 조용히 지운다**
 * (v4.1.0: 비뇨 IPSS/PSA·신경외과 GCS·산부인과 입력이 전부 이렇게 사라졌다).
 * 눈으로 맞추면 갈라진다. 화면이 실제로 보내는 키를 읽어 DTO 속성과 집합 비교한다.
 */
describe('FE 가 보내는 키가 DTO 에 전부 있다(whitelist 소실 방지)', () => {
  const WEB = join(process.cwd(), '..', 'web', 'src', 'app', '(main)', 'pharmacist-activity');
  const pageSrc = readFileSync(join(WEB, 'page.tsx'), 'utf8');
  const counselSrc = readFileSync(join(WEB, 'components', 'CounselTab.tsx'), 'utf8');

  /** `apiClient.post('<path>', { … })` 의 객체 리터럴에서 최상위 키를 뽑는다(중괄호 균형으로 자른다). */
  function payloadKeys(src: string, method: 'post' | 'patch', pathFragment: string): string[] {
    const idx = src.indexOf(`apiClient.${method}(`, src.indexOf(pathFragment) - 200);
    expect(idx, `${pathFragment} 호출을 찾지 못했다`).toBeGreaterThan(-1);
    const braceStart = src.indexOf('{', src.indexOf(pathFragment, idx));
    expect(braceStart).toBeGreaterThan(-1);
    let depth = 0, end = -1;
    for (let i = braceStart; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    expect(end, '객체 리터럴의 끝을 찾지 못했다').toBeGreaterThan(braceStart);
    const body = src.slice(braceStart + 1, end);
    // 최상위 키만 — 중첩 객체 안의 키는 세지 않는다
    const keys: string[] = [];
    let d = 0;
    for (const line of body.split('\n')) {
      const m = d === 0 ? line.match(/^\s*([A-Za-z_][\w]*)\s*:/) : null;
      if (m) keys.push(m[1]);
      for (const ch of line) { if (ch === '{' || ch === '[' || ch === '(') d++; else if (ch === '}' || ch === ']' || ch === ')') d--; }
    }
    expect(keys.length, `${pathFragment} 의 payload 키를 하나도 못 읽었다 — 스캐너가 거짓말한다`).toBeGreaterThan(0);
    return keys;
  }

  /** DTO 클래스가 선언한 속성(class-validator 메타데이터) */
  function dtoProps(dto: new () => unknown): string[] {
    const metas = getMetadataStorage().getTargetValidationMetadatas(dto, '', false, false);
    const props = [...new Set(metas.map((m) => m.propertyName))];
    expect(props.length, 'DTO 메타데이터를 읽지 못했다').toBeGreaterThan(0);
    return props;
  }

  const cases: Array<[string, 'post' | 'patch', string, new () => unknown, string]> = [
    ['중재 등록', 'post', "'/api/v1/pharmacist/interventions'", CreateInterventionDto, 'page'],
    ['TDM 요청', 'post', "'/api/v1/pharmacist/tdm'", CreateTdmRequestDto, 'page'],
    ['ADR 보고', 'post', "'/api/v1/pharmacist/adr'", CreateAdrReportDto, 'page'],
    ['ASP 요청', 'post', "'/api/v1/pharmacist/asp'", CreateAspRequestDto, 'page'],
    ['복약지도 등록', 'post', "'/api/v1/pharmacy/counsel'", CreateCounselDto, 'counsel'],
  ];

  for (const [label, method, frag, dto, where] of cases) {
    it(`${label} — 화면이 보내는 키가 전부 DTO 에 있다`, () => {
      const src = where === 'page' ? pageSrc : counselSrc;
      const sent = payloadKeys(src, method, frag);
      const declared = new Set(dtoProps(dto));
      const dropped = sent.filter((k) => !declared.has(k));
      expect(dropped, `whitelist 가 지울 키: ${dropped.join(', ')}`).toEqual([]);
    });
  }

  it('대조군 — 없는 키를 넣으면 이 대조가 실제로 잡는다', () => {
    const declared = new Set(dtoProps(CreateInterventionDto));
    expect(declared.has('pharmacistId')).toBe(false); // 주체는 서버가 채운다
    expect([...['patientId', 'bogusKey']].filter((k) => !declared.has(k))).toEqual(['bogusKey']);
  });
});
