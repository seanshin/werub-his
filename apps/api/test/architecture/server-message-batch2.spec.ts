import { describe, it, expect, vi } from 'vitest';
import { renderServerMessageKo, serverMsg, type ServerMessage } from '@hospital-run/shared';
import { OpeningService, cyclePeriod } from '../../src/modules/opening/opening.service';
import { CodeImportService } from '../../src/modules/code-master/code-import.service';
import { CodeExportService } from '../../src/modules/code-master/code-export.service';
import { CodeDuplicateService } from '../../src/modules/code-master/code-duplicate.service';
import { CodeCategoryDeriveService } from '../../src/modules/code-master/code-category-derive.service';
import { AutoMapperService } from '../../src/modules/code-master/auto-mapper.service';
import {
  SERVER_MESSAGE_SOURCES, sourceKeysOf, enactmentLabels, unregisteredKeys, assertWellFormed, composedLines,
} from './server-message-sources';

/**
 * 🔴 서버 표시 문장 `{ k, params }` 계약 — 배치 2 (2026-09-15 I2) · `opening` + `code-master`.
 *
 * `/admin/opening` 의 파생 사유(`위원 3명 / 정족수 5 · 실제 임명 2명`)·주기 라벨(`2026년 3분기`)과
 * `/admin/codes` 의 고시 반영 미리보기·분류 유도·중복·내보내기 안내·자동 매핑 사유는 서버가 값을 끼워 조립해
 * 영어 화면에서도 한국어였다. 이제 서버는 `*Msg`(키+값)를 주고 화면 `<ServerText>` 가 조립한다.
 *
 * 못박는 것:
 *   (a) 두 모듈 소스의 키·조각 전부가 en·ja·ar 에 있다 · opening 이 옮기는 집행 라벨(결정 정본)도 등재.
 *   (b) 옮긴 자리가 조립 템플릿으로 되돌아가지 않았다 — 파일별 잔여 조립 줄 수 **정확 일치**
 *       (잔여 = 예외 message·감사/로그·AI 프롬프트·화면 소비처 없는 가져오기 응답 — 설계 §2·§6 분류).
 *   (c) 실제 반환 — `*Msg` 가 있고, 종전 문자열은 **같은 정본에서 파생**(글자 단위 동일) · 자리표시자↔params 일치.
 *   (d) opening 이 go-live 의 `detail` 문자열이 아니라 `detailMsg` 를 읽는다(§3.1 제거 조건의 한 축).
 */

describe('(a) 소스 키가 전부 카탈로그에 있다', () => {
  const opening = sourceKeysOf(SERVER_MESSAGE_SOURCES.opening);
  const codeMaster = sourceKeysOf(SERVER_MESSAGE_SOURCES.codeMaster);

  it('대조군 — 추출기가 실제로 두 모듈 키를 읽는다(0이면 아래 검사가 헛돈다)', () => {
    expect(opening.size).toBeGreaterThanOrEqual(13);
    expect(opening.has('위원 {위원}명 / 정족수 {정족수}')).toBe(true);
    expect(opening.has('{연}년 {분기}분기')).toBe(true);
    expect(codeMaster.size).toBeGreaterThanOrEqual(30);
    expect(codeMaster.has('명칭: {이전} → {이후}')).toBe(true);
    expect(codeMaster.has('자동 매핑을 수행하지 못했습니다: {오류}')).toBe(true);
  });

  it('🔴 한글이 든 키는 en·ja·ar 모두 등재(한글 자리 이름만 쓴 비번역 키도 0)', () => {
    const missing = unregisteredKeys([...opening, ...codeMaster]);
    expect(missing, `미등재 ${missing.length}건`).toEqual([]);
  });

  it('🔴 opening 이 조각으로 옮기는 집행 라벨(결정 정본 `enactmentStatusOf`)도 등재', () => {
    const labels = enactmentLabels();
    expect(labels.size, '추출 대조군 — 5상태 라벨').toBeGreaterThanOrEqual(5);
    expect(labels.has('결정·반영대기')).toBe(true);
    expect(unregisteredKeys(labels)).toEqual([]);
  });
});

describe('(b) 옮긴 자리가 조립 템플릿으로 되돌아가지 않았다', () => {
  /**
   * 파일별 잔여 조립 줄 — 🔴 정확 일치(늘면 되돌아간 것, 줄면 여기를 내린다).
   *   opening 0 — 예외 message 9 는 예외 배치(I4 · `msgException`)에서 옮겼다(`server-message-exception.spec.ts`).
   *   auto-mapper 7 = 감사 2 · AI 프롬프트 3 · 예외 1 · 후보 사유 1(대기 매핑 JSON 에 저장 — 표시와 저장 겸용).
   *   code-import 5 = 예외 3 · 감사 2 · code-master 4 = 예외 3 · 감사 1 · code-synonym 4 = 예외 4 ·
   *   code-export 2 = 예외 1 · 로그 이어진 줄 1 · code-duplicate 1 = 예외 1 · code-category-derive 1 = 감사 1.
   */
  const EXPECTED: Record<string, number> = {
    'opening/opening.service.ts': 0,
    'code-master/auto-mapper.service.ts': 7,
    'code-master/code-category-derive.service.ts': 1,
    'code-master/code-duplicate.service.ts': 1,
    'code-master/code-export.service.ts': 2,
    'code-master/code-import.service.ts': 5,
    'code-master/code-master.service.ts': 4,
    'code-master/code-synonym.service.ts': 4,
  };
  const files = [...SERVER_MESSAGE_SOURCES.opening, ...SERVER_MESSAGE_SOURCES.codeMaster];

  it('대조군 — 대상 파일을 전부 센다', () => {
    expect(files.map((f) => f.split('/modules/')[1]).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  for (const f of files) {
    const rel = f.split('/modules/')[1];
    it(`🔴 ${rel} — 잔여 조립 줄 ${EXPECTED[rel]} · 연결(+) 우회 0`, () => {
      const { composed, concat } = composedLines(f);
      expect(composed.length, `조립 줄:\n${composed.join('\n')}`).toBe(EXPECTED[rel]);
      expect(concat).toEqual([]);
    });
  }

  it('🔴 opening 의 잔여는 전부 예외 message 다(표시 사유·라벨이 템플릿으로 남지 않았다)', () => {
    const { composed } = composedLines(SERVER_MESSAGE_SOURCES.opening[0]);
    const notException = composed.filter((l) => !/Exception\(/.test(l) && !/^\s*`[^`]*`,?\s*$/.test(l));
    expect(notException).toEqual([]);
  });
});

const check = (msg: ServerMessage | null | undefined, text: string | null | undefined) => {
  expect(msg, '구 응답 모양(문자열만)으로 되돌아갔다').toBeTruthy();
  assertWellFormed(msg!);
  expect(text).toBe(renderServerMessageKo(msg!));
};

describe('(c) opening — 실제 반환', () => {
  const AUG_28 = new Date(2026, 7, 28);

  it('주기 라벨 — 값(연·분기)은 params, label 은 파생', () => {
    for (const cyc of ['MONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'ANNUAL']) {
      const p = cyclePeriod(cyc, AUG_28)!;
      check(p.labelMsg, p.label);
    }
    const q = cyclePeriod('QUARTERLY', AUG_28)!;
    expect(q.labelMsg).toEqual({ k: '{연}년 {분기}분기', params: { 연: 2026, 분기: 3 } });
    expect(q.label).toBe('2026년 3분기');
    expect(cyclePeriod('SEMIANNUAL', AUG_28)!.label).toBe('2026년 하반기');
  });

  const svc = new OpeningService({} as never, {} as never, {} as never);
  const derive = (def: Record<string, unknown>, maps: { goLive?: Map<string, unknown>; decisions?: Map<string, unknown>; committees?: Map<string, unknown>; sameName?: Map<string, unknown> }) =>
    (svc as any).derive(def, maps.goLive ?? new Map(), maps.decisions ?? new Map(), maps.committees ?? new Map(), maps.sameName ?? new Map());

  it('🔴 (d) go-live 파생 — `detailMsg` 를 옮기고 `detail` 은 그 파생이다(종전 문자열을 읽지 않는다)', () => {
    const m = serverMsg('현재 {값}', { 값: 'BLOCK' });
    const d = derive({ goLiveKey: 'g' }, { goLive: new Map([['g', { status: 'READY', detail: '낡은 문자열', detailMsg: m }]]) });
    check(d.detailMsg, d.detail);
    expect(d.detail).toBe('현재 BLOCK');
    const none = derive({ goLiveKey: 'g' }, { goLive: new Map([['g', { status: 'NOT_READY', detailMsg: null }]]) });
    expect(none.detail).toBeNull();
    expect(none.detailMsg).toBeNull();
  });

  it('결정 파생 — 집행 라벨은 조각 { k }', () => {
    const d = derive({ decisionKey: 'x' }, { decisions: new Map([['x', { decided: true, enactment: { label: '결정·반영대기' } }]]) });
    check(d.detailMsg, d.detail);
    expect(d.detailMsg.params).toEqual({ 집행: { k: '결정·반영대기' } });
    expect(d.detail).toBe('결정됨 · 결정·반영대기');
    const u = derive({ decisionKey: 'x' }, { decisions: new Map([['x', { decided: false, enactment: { label: '미결' } }]]) });
    check(u.detailMsg, u.detail);
    expect(u.detail).toBe('미결정');
  });

  it('위원회 파생 — 조각을 `{head} · {tail}` 로 잇고, 한국어는 종전 문장과 글자 단위로 같다', () => {
    const c = { name: 'QI', quorum: 5, members: [{ source: 'SEED' }, { source: 'MANUAL' }, { source: 'MANUAL' }] };
    const twin = { code: null, name: 'QI', members: [{ source: 'MANUAL' }, { source: 'MANUAL' }, { source: 'MANUAL' }, { source: 'MANUAL' }] };
    const d = derive({ committeeCode: 'QPS' }, { committees: new Map([['QPS', c]]), sameName: new Map([['QI', [{ code: 'QPS', ...c }, twin]]]) });
    check(d.detailMsg, d.detail);
    expect(d.detail).toBe('위원 3명 / 정족수 5 · 실제 임명 2명 · ⚠ 같은 이름의 위원회가 따로 있다(코드 없음 · 위원 4명)');

    const seeded = { name: 'IC', quorum: null, members: [{ source: 'SEED' }, { source: 'SEED' }] };
    const s = derive({ committeeCode: 'ICC' }, { committees: new Map([['ICC', seeded]]) });
    check(s.detailMsg, s.detail);
    expect(s.detail).toBe('위원 2명 (정족수 미설정) · 전원 시드 구성(실제 임명 기록 없음)');

    const missing = derive({ committeeCode: 'NONE' }, {});
    check(missing.detailMsg, missing.detail);
    expect(missing.detail).toBe('위원회 없음');
  });
});

describe('(c) code-master — 실제 반환', () => {
  const importPrisma = (current: Record<string, unknown> | null) => ({
    procedureCode: { findFirst: vi.fn().mockResolvedValue(current), count: vi.fn().mockResolvedValue(10) },
    diagnosisCode: { findFirst: vi.fn().mockResolvedValue(current), count: vi.fn().mockResolvedValue(10) },
    medicationCode: { findFirst: vi.fn().mockResolvedValue(current), count: vi.fn().mockResolvedValue(10) },
  } as never);

  it('고시 반영 미리보기 — 행 변경·오류·안내가 `*Msg` 로, 문자열은 파생', async () => {
    const r = await new CodeImportService(importPrisma({ nameKo: '옛 이름', category: null, unitPrice: 900 }))
      .preview('procedure', 'code,nameKo,unitPrice,memo\nA100,검사 가,1000,x\nA200,검사 나,abc,y\n', '2026-09-01');
    const changed = r.rows.find((x) => x.verdict === 'CHANGED')!;
    expect(changed.changesMsg?.length).toBe(changed.changes?.length);
    changed.changesMsg!.forEach((m, i) => check(m, changed.changes![i]));
    expect(changed.changes).toContain('명칭: 옛 이름 → 검사 가');
    const err = r.rows.find((x) => x.verdict === 'ERROR')!;
    check(err.errorMsg, err.error);
    expect(err.errorMsg).toEqual({ k: 'unitPrice 를 숫자로 읽을 수 없습니다: {값}', params: { 값: 'abc' } });
    expect(r.notesMsg.length).toBe(r.notes.length);
    r.notesMsg.forEach((m, i) => check(m, r.notes[i]));
    expect(r.notes.join(' ')).toContain('반영하지 않는 열 1개: memo');
  });

  it('내보내기 — 자름 안내는 값(범위)만 params', async () => {
    const t = { findMany: vi.fn().mockResolvedValue([{ code: 'A' }]), count: vi.fn().mockResolvedValue(166744) };
    const r = await new CodeExportService({ diagnosisCode: t, procedureCode: t, medicationCode: t } as never).export('procedure', { page: 1 });
    r.notesMsg.forEach((m, i) => check(m, r.notes[i]));
    expect(r.notes[0]).toBe('🔴 전체 166,744건 중 1–1건입니다 — 다음 장이 있습니다(이대로 제출하면 일부만 제출됩니다).');
  });

  it('중복 후보 — 마스터 충돌 안내', async () => {
    const findMany = vi.fn().mockImplementation((a: { where?: { origin?: string } }) =>
      Promise.resolve(a?.where?.origin === 'LOCAL' ? [{ id: 'l', code: 'X1', nameKo: '흉부', origin: 'LOCAL' }] : [{ id: 'm', code: 'G1', nameKo: '흉부', origin: 'HIRA' }]));
    const t = { findMany };
    const r = await new CodeDuplicateService({ diagnosisCode: t, procedureCode: t, medicationCode: t } as never).report('DiagnosisCode');
    expect(r.notesMsg.length).toBeGreaterThanOrEqual(2);
    r.notesMsg.forEach((m, i) => check(m, r.notes[i]));
  });

  it('분류 유도 — 비율·건수는 params', async () => {
    const prisma = {
      $queryRawUnsafe: vi.fn()
        .mockResolvedValueOnce([{ prefix: 'AA', category: '검사료', n: 5n }, { prefix: 'BB', category: '처치료', n: 1n }, { prefix: 'BB', category: '수술료', n: 1n }])
        .mockResolvedValueOnce([{ prefix: 'AA', n: 3n }, { prefix: 'BB', n: 2n }, { prefix: 'ZZ', n: 5n }]),
    } as never;
    const r = await new CodeCategoryDeriveService(prisma).suggest();
    r.notesMsg.forEach((m, i) => check(m, r.notes[i]));
    expect(r.notes[0]).toBe('🔴 접두 2자리 증거로 채울 수 있는 것은 미분류 10건 중 3건(30%)입니다.');
    expect(r.notes.at(-1)).toContain('접두 1개(2건)는 제안하지 않았습니다');
  });

  it('자동 매핑 — 해당하지 않는 표준의 사유가 `reasonMsg`', async () => {
    const prisma = {
      systemConfig: { findUnique: vi.fn().mockResolvedValue(null) },
      diagnosisCode: { findUnique: vi.fn().mockResolvedValue({ code: '5A11', nameKo: '제2형 당뇨병' }) },
    } as never;
    const [r] = await new AutoMapperService(prisma, {} as never).mapSingle({ sourceTable: 'diagnosis_codes', sourceId: 'd', targetSystems: ['LOINC'] });
    expect(r.status).toBe('NOT_APPLICABLE');
    check(r.reasonMsg, r.reason);
    expect(r.reasonMsg?.params).toEqual({ 원천: 'diagnosis_codes', 표준: 'LOINC' });
  });
});
