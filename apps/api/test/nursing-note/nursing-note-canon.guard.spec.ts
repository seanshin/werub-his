import { describe, it, expect } from 'vitest';
import { ValidationPipe, ArgumentMetadata, BadRequestException } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  UNIVERSAL_NURSING_CONTEXT_TYPES,
  ADMISSION_SCOPED_NURSING_CONTEXT_TYPES,
  UNIVERSAL_NURSING_NOTE_TYPES,
  UNIVERSAL_NURSING_SEVERITIES,
} from '@hospital-run/shared';
import { CreateNursingNoteDto, UpdateNursingNoteDto } from '../../src/modules/nursing-note/dto/nursing-note.dto';
import { NursingNoteService } from '../../src/modules/nursing-note/nursing-note.service';
import { IssuanceService } from '../../src/modules/medical-record-issuance/issuance.service';

/**
 * 간호기록 **정본 경계** 가드 (2026-08-18)
 *
 * 🔴 이 저장소의 간호기록은 정본이 둘이 아니라 **컨텍스트로 갈린 정본**이다.
 *    입원 = `NursingNote`(서명·정정·QA·미비기록·사본발급) · 그 밖 = `UniversalNursingNote`.
 *    경계가 코드로 강제되지 않아 `contextType:'INPATIENT'` 로 정본을 우회할 수 있었고
 *    (`127faa58` 에서 한 번 되돌렸지만 막는 코드가 없었다), 그렇게 샌 기록은
 *    서명·QA·미비기록·사본발급을 **전부 우회**한다.
 *
 * 🔴 그리고 FE↔DTO 는 **기계 대조만이 잡는다** — 전역 `whitelist:true` 는 DTO 에 없는 키를
 *    조용히 지우고 200 을 돌려준다(성공 응답 + 데이터 소실). 화면이 실제로 보내는 키를
 *    소스에서 뽑아 실제 파이프에 태운다.
 *
 * 파이프 옵션은 `main.ts` 와 같아야 한다 — 갈라지면 이 가드는 아무것도 보증하지 못한다.
 */
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: false, transform: true });
const meta = (m: unknown): ArgumentMetadata => ({ type: 'body', metatype: m as ArgumentMetadata['metatype'], data: '' });
const through = async <T extends object>(m: unknown, p: Record<string, unknown>): Promise<T> =>
  (await pipe.transform(p, meta(m))) as T;
const definedKeys = (o: Record<string, unknown>) =>
  Object.entries(o).filter(([, v]) => v !== undefined).map(([k]) => k).sort();

const UUID = '11111111-1111-4111-8111-111111111111';
const WEB = (...p: string[]) => resolve(__dirname, '../../../web/src', ...p);
const API = (...p: string[]) => resolve(__dirname, '../../', ...p);
const PANEL = WEB('components/nursing/NursingNotePanel.tsx');
const TAB = WEB('app/(main)/patients/[id]/components/NursingRecordTab.tsx');
const QUICK = WEB('app/(main)/patients/[id]/components/QuickClinicalEntry.tsx');

// ───────────────────────────── ① contextType = 정본 경계

describe('① contextType 화이트리스트 — 정본 우회 차단', () => {
  it('허용 컨텍스트는 전부 통과한다', async () => {
    for (const ct of UNIVERSAL_NURSING_CONTEXT_TYPES) {
      const out = await through<{ contextType?: string }>(CreateNursingNoteDto,
        { patientId: UUID, contextType: ct, contextId: UUID, noteType: 'OBSERVATION', content: 'x' });
      expect(out.contextType, `${ct} 가 거부됐다`).toBe(ct);
    }
  });

  it('🔴 재원(입원) 컨텍스트는 거부한다 — 여기로 새면 서명·QA·미비기록·사본발급을 전부 우회한다', async () => {
    for (const ct of ADMISSION_SCOPED_NURSING_CONTEXT_TYPES) {
      await expect(
        through(CreateNursingNoteDto, { patientId: UUID, contextType: ct, contextId: UUID, noteType: 'OBSERVATION', content: 'x' }),
        `${ct} 가 통과했다 — 정본 우회가 열려 있다`,
      ).rejects.toThrow();
    }
  });

  it('거부 메시지는 어디로 가야 하는지 말한다(그냥 400 이 아니다)', async () => {
    const err = await through(CreateNursingNoteDto,
      { patientId: UUID, contextType: 'INPATIENT', contextId: UUID, noteType: 'OBSERVATION', content: 'x' })
      .catch((e: BadRequestException) => e);
    expect(JSON.stringify((err as BadRequestException).getResponse())).toMatch(/admissions\/:admissionId\/nursing-notes/);
  });

  it('모르는 컨텍스트(오타·신설)도 거부한다 — 어느 탭에도 안 나오는 유령 행을 만들지 않는다', async () => {
    for (const bad of ['inpatient', 'WARD_A', 'ER', '외래', '']) {
      await expect(
        through(CreateNursingNoteDto, { patientId: UUID, contextType: bad, contextId: UUID, noteType: 'OBSERVATION', content: 'x' }),
      ).rejects.toThrow();
    }
  });

  it('PATCH 로도 컨텍스트를 입원으로 바꿔치기할 수 없다', async () => {
    await expect(through(UpdateNursingNoteDto, { contextType: 'INPATIENT' })).rejects.toThrow();
  });

  it('서비스 층도 fail-closed — ValidationPipe 가 스킵돼도(인라인 @Body·교차타입) 경계는 선다', async () => {
    const prisma = { universalNursingNote: { create: async () => ({}) } } as never;
    const svc = new NursingNoteService(prisma);
    await expect(svc.create({ patientId: UUID, contextType: 'INPATIENT', contextId: UUID, noteType: 'OBSERVATION', content: 'x' } as never, 'n1'))
      .rejects.toThrow(BadRequestException);
  });
});

// ───────────────────────────── ④ FE↔DTO 기계 대조

/** 화면 소스에서 실제로 보내는 키를 뽑는다 — 손으로 옮겨 적으면 다음 수정에서 갈라진다 */
function payloadKeysFromPanel(src: string): string[] {
  const start = src.indexOf('const handleSubmit');
  const end = src.indexOf('createMutation.mutate(payload)');
  expect(start, 'handleSubmit 을 찾지 못했다 — 추출기가 먼저 거짓말한다').toBeGreaterThan(-1);
  expect(end, 'mutate(payload) 를 찾지 못했다').toBeGreaterThan(start);
  const body = src.slice(start, end);
  const keys = new Set<string>();
  for (const m of body.matchAll(/(?:^|[{,])\s*([A-Za-z_$][\w$]*)\s*:/gm)) keys.add(m[1]);            // key: value
  for (const m of body.matchAll(/^\s{4,}([A-Za-z_$][\w$]*),\s*$/gm)) keys.add(m[1]);                  // 축약(shorthand) 한 줄
  for (const m of body.matchAll(/\{\s*([A-Za-z_$][\w$]*)\s*\}/g)) keys.add(m[1]);                    // { shorthand }
  for (const local of ['body', 'payload', 'mode']) keys.delete(local);                               // 지역 변수는 페이로드가 아니다
  return [...keys].sort();
}

/** 키별 그럴듯한 값 — 실제 파이프에 태우기 위한 최소 표본 */
function sampleFor(key: string): unknown {
  if (key === 'patientId' || key === 'contextId') return UUID;
  if (key === 'contextType') return 'EMERGENCY';
  if (key === 'noteType') return 'OBSERVATION';
  if (key === 'severity') return 'NORMAL';
  if (key === 'shiftType') return 'DAY';
  if (key === 'vitalSigns') return { bp: '120/80', hr: 72 };
  return `${key}-값`;
}

describe('④ NursingNotePanel ↔ CreateNursingNoteDto 기계 대조', () => {
  const src = readFileSync(PANEL, 'utf8');

  it('추출기 자체 점검 — 화면이 보내는 키를 실제로 뽑아냈다', () => {
    const keys = payloadKeysFromPanel(src);
    expect(keys.length, `추출 결과가 비었다(${keys.join(',')})`).toBeGreaterThanOrEqual(9);
    for (const must of ['patientId', 'contextType', 'contextId', 'noteType', 'severity']) {
      expect(keys, `${must} 를 못 뽑았다`).toContain(must);
    }
  });

  it('🔴 화면이 보내는 키가 하나도 whitelist 에 지워지지 않는다', async () => {
    const keys = payloadKeysFromPanel(src);
    const payload = Object.fromEntries(keys.map((k) => [k, sampleFor(k)]));
    const out = await through<Record<string, unknown>>(CreateNursingNoteDto, payload);
    const survived = definedKeys(out);
    const dropped = keys.filter((k) => !survived.includes(k));
    expect(dropped, `화면이 보내는 키가 조용히 지워진다: ${dropped.join(', ')} — 본문 유실`).toEqual([]);
  });

  it('🔴 화면은 응답에 없는 필드를 읽지 않는다(spi*·mode·nurseName 은 UniversalNursingNote 에 없다)', () => {
    // 주석은 지운다 — 결함을 설명하는 문장이 결함으로 잡히면 가드가 다른 이유로 실패한다
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const deadReads = [...code.matchAll(/\bnote\.(spi[A-Za-z]+|mode|nurseName)\b/g)].map((m) => m[0]);
    expect(deadReads, `서버에 없는 필드를 읽는다: ${deadReads.join(', ')}`).toEqual([]);
    // 응답 타입 선언에도 없어야 한다(있으면 다음 사람이 다시 읽는다)
    expect(code.slice(code.indexOf('interface NursingNote'), code.indexOf('const noteAt')))
      .not.toMatch(/spi[A-Za-z]+|nurseName\?|\bmode\b/);
  });

  it('화면이 아는 어휘는 shared 정본에서 온다(로컬 목록 재정의 금지)', () => {
    expect(src).toMatch(/UNIVERSAL_NURSING_NOTE_TYPES/);
    expect(src).toMatch(/UNIVERSAL_NURSING_SEVERITIES/);
  });
});

// ───────────────────────────── 본문 소실 차단

describe('본문 없는 간호기록은 저장되지 않는다', () => {
  it('🔴 옛 화면 페이로드(spi*)는 400 이다 — 예전엔 200 + 본문 없는 빈 행이었다', async () => {
    await expect(through(CreateNursingNoteDto, {
      patientId: UUID, contextType: 'EMERGENCY', contextId: UUID, noteType: 'OBSERVATION', severity: 'NORMAL',
      mode: 'SBAR', spiSituation: '호흡곤란', spiBackground: 'COPD', spiAssessment: 'SpO2 저하', spiRecommendation: 'O2 증량',
    })).rejects.toThrow();
  });

  it('공백만 채운 본문도 본문이 아니다', async () => {
    await expect(through(CreateNursingNoteDto, {
      patientId: UUID, contextType: 'EMERGENCY', contextId: UUID, noteType: 'OBSERVATION', content: '   ',
    })).rejects.toThrow();
  });

  it('SBAR 한 칸만 채워도 통과한다(전부 요구하지 않는다)', async () => {
    const out = await through<{ background?: string }>(CreateNursingNoteDto, {
      patientId: UUID, contextType: 'PACU', contextId: UUID, noteType: 'OBSERVATION', background: '수술 후 2일차',
    });
    expect(out.background).toBe('수술 후 2일차');
  });

  it('수정으로 본문을 통째로 비울 수 없다', async () => {
    const prisma = {
      universalNursingNote: {
        findUnique: async () => ({ id: 'x', situation: 'S', background: null, assessment: null, recommendation: null, content: null }),
        update: async () => ({}),
      },
    } as never;
    await expect(new NursingNoteService(prisma).update('x', { situation: '' } as never)).rejects.toThrow(BadRequestException);
  });
});

// ───────────────────────────── ③ 집계는 두 정본을 모두 센다

describe('③ 집계 — 어느 쪽도 전체를 세지 않던 곳', () => {
  it('🔴 /nursing-notes/stats 는 병동(NursingNote) 기록도 센다 — 예전엔 0으로 보고했다', async () => {
    const prisma = {
      universalNursingNote: { groupBy: async () => [{ contextType: 'OUTPATIENT', _count: { id: 3 } }] },
      nursingNote: { count: async () => 7 },
    } as never;
    const rows = await new NursingNoteService(prisma).getStats();
    expect(rows.find((r) => r.contextType === 'INPATIENT')?.count, '병동 기록이 통계에서 빠졌다').toBe(7);
    expect(rows.find((r) => r.contextType === 'OUTPATIENT')?.count).toBe(3);
    // 합쳐서 감추지 않는다 — 어느 정본에서 왔는지 남긴다
    expect(new Set(rows.map((r) => r.source))).toEqual(new Set(['UNIVERSAL', 'ADMISSION']));
  });

  it('🔴 의무기록 사본(NURSING)은 외래 간호기록을 빠뜨리지 않는다 — 법정 기록 누락', () => {
    const src = readFileSync(API('src/modules/medical-record-issuance/issuance.service.ts'), 'utf8');
    const block = src.slice(src.indexOf("if (type === 'NURSING')"), src.indexOf("if (type === 'DISCHARGE')"));
    expect(block, '사본 동결이 universal 간호기록을 읽지 않는다').toMatch(/universalNursingNote\.findMany/);
    expect(block, '입원 이력이 없으면 조기 반환해 외래분이 통째로 빠진다')
      .not.toMatch(/if \(!admissionIds\.length\) return \{ sourceIds: \[\], snapshot: \[\] \};/);
    // 서명 체계가 없는 기록을 서명된 척하지 않는다
    expect(block).toMatch(/signatureModel/);
    // 발급 가능 건수도 같은 분모를 쓴다
    expect(src.slice(src.indexOf('availableRecordCounts'), src.indexOf('private range(')))
      .toMatch(/universalNursingNote\.count/);
  });

  it('🔴 입원 이력이 없는 환자도 간호기록 사본이 동결된다 — 예전엔 조기 반환으로 0건이었다', async () => {
    const created: Record<string, unknown>[] = [];
    const prisma = {
      documentRequest: {
        findUnique: async () => ({ id: 'r1', patientId: UUID, issuedDocumentId: null, status: 'REQUESTED',
          requesterType: 'SELF', proxyVerifyStatus: null, periodFrom: null, periodTo: null, recordTypes: [] }),
        update: (a: unknown) => a,
      },
      issuanceArtifact: { deleteMany: (a: unknown) => a, create: (a: { data: Record<string, unknown> }) => { created.push(a.data); return a; } },
      admission: { findMany: async () => [] },                       // 입원 이력 없음
      nursingNote: { findMany: async () => [] },
      universalNursingNote: { findMany: async () => [
        { id: 'u1', recordedAt: new Date('2026-03-04'), contextType: 'OUTPATIENT', noteType: 'EDUCATION',
          severity: 'NORMAL', situation: '당뇨 교육', background: null, assessment: null, recommendation: null, content: null },
      ] },
      $transaction: async (ops: unknown[]) => ops,
    } as never;
    const svc = new IssuanceService(prisma, { issue: async () => ({}) } as never,
      { safeLog: async () => undefined } as never, { emit: () => undefined } as never, {} as never);
    const r = await svc.createSnapshot('r1', { recordTypes: ['NURSING'] }, 'u1');
    expect(r.artifacts, '입원 이력이 없다고 간호기록 사본이 0건이 된다').toEqual([{ recordType: 'NURSING', count: 1 }]);
    const snap = (created[0]?.snapshotJson as { source: string; signed: boolean; signatureModel: string }[]) ?? [];
    expect(snap[0]?.source).toBe('UNIVERSAL');
    // 🔴 서명 체계가 없는 기록을 서명된 척하지 않는다
    expect(snap[0]?.signed).toBe(false);
    expect(snap[0]?.signatureModel).toBe('NONE');
  });
});

// ───────────────────────────── ② 타임라인

describe('② 입원 타임라인 — 새어나간 기록이 영구히 안 보이던 곳', () => {
  const src = readFileSync(API('src/modules/record-timeline/record-timeline.service.ts'), 'utf8');
  const block = src.slice(src.indexOf("if (want('NURSING'))"), src.indexOf("if (want('LAB'))"));

  it('🔴 admissionId 가 있어도 universal 트랙을 건너뛰지 않는다', () => {
    expect(block).toMatch(/universalNursingNote\.findMany/);
    expect(block, 'admissionId 가 있으면 universal 을 통째로 건너뛴다 — 새어나간 기록이 영구 은닉된다')
      .not.toMatch(/if \(!q\.admissionId\) \{/);
  });

  it('입원 범위 판정은 (컨텍스트 직결 OR 재원 기간) — ENCOUNTER 트랙과 같은 규칙', () => {
    expect(block).toMatch(/contextId: q\.admissionId/);
    expect(block).toMatch(/rangeForWindowed\('recordedAt'\)/);
  });

  it('SBAR 을 SOAP·DAR 칸에 밀어 넣지 않는다(서식을 거짓말하지 않는다)', () => {
    expect(block).toMatch(/sbar: \{ S: n\.situation/);
  });

  it('정본 우회 기록은 그렇다고 표시한다', () => {
    expect(block).toMatch(/canonBypass/);
  });
});

// ───────────────────────────── ⑤ 환자 차트 본문

describe('⑤ 환자 상세 간호기록 탭', () => {
  const src = readFileSync(TAB, 'utf8');

  it('🔴 입원분만 읽지 않는다 — 외래·응급 간호기록도 차트 본문에서 보인다', () => {
    expect(src).toMatch(/nursing-notes\/patient\//);
  });

  it('조회 실패를 "없음"이라 말하지 않는다', () => {
    expect(src).toMatch(/uniError/);
  });

  it('"입원 환자의 간호기록만 조회됩니다" 라는 옛 안내가 남아 있지 않다', () => {
    expect(src).not.toContain('입원 환자의 간호기록만 조회됩니다');
  });
});

// ───────────────────────────── 어휘는 시드에서 갈라진다

describe('어휘 정본 — 화면·DTO·시드가 같은 목록을 본다', () => {
  const seed = readFileSync(API('prisma/seeds/clinical-volume-nursing.ts'), 'utf8');
  const listOf = (name: string) => {
    const m = seed.match(new RegExp(`${name}\\s*=\\s*\\[([^\\]]*)\\]`));
    expect(m, `${name} 를 시드에서 찾지 못했다 — 대조기가 먼저 거짓말한다`).toBeTruthy();
    return [...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  };

  it('🔴 시드 noteType 은 shared 정본의 부분집합이다', () => {
    const seeded = listOf('NURSING_NOTE_TYPES');
    expect(seeded.length).toBeGreaterThan(0);
    const outside = seeded.filter((v) => !(UNIVERSAL_NURSING_NOTE_TYPES as readonly string[]).includes(v));
    expect(outside, `시드가 정본에 없는 유형을 만든다: ${outside.join(', ')}`).toEqual([]);
  });

  it('🔴 시드 severity 는 shared 정본의 부분집합이다', () => {
    const outside = listOf('NURSING_SEVERITIES').filter((v) => !(UNIVERSAL_NURSING_SEVERITIES as readonly string[]).includes(v));
    expect(outside, `시드가 정본에 없는 중증도를 만든다: ${outside.join(', ')}`).toEqual([]);
  });

  it('🔴 시드 contextType 은 허용 컨텍스트만 쓴다(입원을 universal 에 넣지 않는다)', () => {
    const used = [...seed.matchAll(/type:\s*'([A-Z_]+)'\s+as\s+const/g)].map((m) => m[1]);
    expect(used.length, 'contextType 사용처를 못 찾았다').toBeGreaterThan(0);
    for (const v of used) {
      expect(UNIVERSAL_NURSING_CONTEXT_TYPES as readonly string[], `시드 contextType='${v}' 가 정본 밖`).toContain(v);
    }
  });

  it('환자 차트 빠른 입력도 정본 어휘를 쓴다', () => {
    const quick = readFileSync(QUICK, 'utf8');
    const m = quick.match(/noteType:\s*'([A-Z_]+)'/);
    expect(m, 'QuickClinicalEntry 의 noteType 을 찾지 못했다').toBeTruthy();
    expect(UNIVERSAL_NURSING_NOTE_TYPES as readonly string[]).toContain(m![1]);
    const c = quick.match(/contextType:\s*'([A-Z_]+)'/);
    expect(UNIVERSAL_NURSING_CONTEXT_TYPES as readonly string[]).toContain(c![1]);
  });
});
