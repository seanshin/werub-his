import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ValidationPipe, ParseEnumPipe, ArgumentMetadata, BadRequestException } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { UpdateSurgicalChecklistDto } from '../../src/modules/surgery/dto/surgery-advanced.dto';
import { SurgeryAdvancedService, deriveCountStatus } from '../../src/modules/surgery/surgery-advanced.service';
import { SurgeryOpnoteService } from '../../src/modules/surgery-opnote/surgery-opnote.service';

/**
 * WHO 수술안전 체크리스트 계약 가드 — 2026-08-18.
 *
 * 의료기관 인증기준 Ver.5.0(2026-09-01 시행)에 수술 안전 단계별 확인(Sign-In/Time-Out/Sign-Out)이 들어간다.
 * 그런데 이 저장소에는 같은 사실을 말하는 화면이 **넷**이었고 셋이 죽어 있었다:
 *   ① SurgicalChecklistPanel(정본, 정상)
 *   ② `/surgery` 안전체크리스트 탭 — phase 를 `'sign-in'`(kebab)로 보내 **전건 400**,
 *      통과했더라도 본문 `{items:{signIn_0:…}}` 는 DTO 에 없는 키라 whitelist 가 통째로 지웠다
 *   ③ 수술준비 워크스테이션 — `useState` 전용·전송 코드 없음(가짜 게이트)
 *   ④ Op Note `whoChecklist` — 쓰는 FE 도 읽는 FE 도 없는 고아 EP
 *
 * 🔴 이 스펙은 컨트롤러가 아니라 **main.ts 와 같은 옵션의 실제 ValidationPipe/ParseEnumPipe** 에
 *    화면 페이로드를 태운다. 목만 통과하는 테스트는 아무것도 보증하지 않는다
 *    (수술기록 `ebl` 이 단위 테스트는 통과하는데 실 파이프에선 400 이라 개통 이래 저장 0건이었다).
 */

// main.ts 와 동일 — 옵션이 갈라지면 이 가드는 아무것도 보증하지 못한다.
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: false, transform: true });
const meta = (m: unknown): ArgumentMetadata => ({ type: 'body', metatype: m as never, data: '' });
const through = (p: Record<string, unknown>) =>
  pipe.transform(p, meta(UpdateSurgicalChecklistDto)) as Promise<Record<string, unknown>>;

/**
 * 값이 **실제로 실린** 키만 센다.
 * 🔴 클래스 필드는 컴파일 결과에서 `undefined` 로 선언되므로 `Object.keys()` 는 DTO 전 필드를 돌려준다 —
 *    그대로 세면 "아무것도 안 버려졌다"고 잘못 통과한다(가드가 다른 이유로 통과하는 전형).
 */
const definedKeys = (o: Record<string, unknown>) =>
  Object.entries(o).filter(([, v]) => v !== undefined).map(([k]) => k).sort();

const phasePipe = new ParseEnumPipe({ signIn: 'signIn', timeOut: 'timeOut', signOut: 'signOut' });
const phaseMeta = { type: 'param', data: 'phase' } as ArgumentMetadata;

const WEB = join(__dirname, '../../../web/src/app/(main)');
const read = (rel: string) => readFileSync(join(WEB, rel), 'utf8');

/* ────────────────────────────── ② phase 어휘 ────────────────────────────── */

describe('phase 어휘 — 서버는 camelCase 다', () => {
  it('camelCase 3종은 통과한다', async () => {
    for (const p of ['signIn', 'timeOut', 'signOut']) {
      await expect(phasePipe.transform(p, phaseMeta)).resolves.toBe(p);
    }
  });

  it('🔴 kebab-case 는 400 이다 — 화면이 이 어휘를 쓰면 전건 실패한다', async () => {
    for (const p of ['sign-in', 'time-out', 'sign-out']) {
      await expect(phasePipe.transform(p, phaseMeta)).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('🔴 체크리스트 화면 어느 것도 kebab phase·인덱스 키를 쓰지 않는다', () => {
    const sources = [
      read('surgery/components/SurgicalChecklistPanel.tsx'),
      read('surgery/components/SurgeryAdvanced.tsx'),
      read('workstation/surgery-prep/page.tsx'),
    ];
    for (const src of sources) {
      // 주석이 과거 결함을 설명하고 있으므로 **코드 라인만** 본다(주석을 코드로 오독하지 않는다).
      const code = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
        .join('\n');
      expect(code).not.toMatch(/checklist\/\$\{[^}]*\}['"`]?\s*,?\s*\{\s*items\s*[:}]/);
      expect(code).not.toMatch(/['"]sign-in['"]|['"]time-out['"]|['"]sign-out['"]/);
      expect(code).not.toMatch(/signIn_\$?\{?\d|`signIn_\$\{/);
    }
  });
});

/* ────────────────────────── FE ↔ DTO 기계 대조 ────────────────────────── */

describe('화면 페이로드가 실제 파이프를 지난다 (FE↔DTO 기계 대조)', () => {
  it('정본 패널의 토글 1건이 살아남는다 — whitelist 는 조용히 지운다', async () => {
    for (const phase of ['signIn', 'timeOut', 'signOut'] as const) {
      for (const it of SurgeryAdvancedService.CHECKLIST_ITEMS[phase]) {
        const out = await through({ [it.key]: true });
        expect(definedKeys(out), `${phase}.${it.key} 가 버려졌다`).toEqual([it.key]);
      }
    }
  });

  it('🔴 서버 항목 정본(CHECKLIST_ITEMS)의 키가 DTO 에 하나도 빠짐없이 있다', async () => {
    const allKeys = (['signIn', 'timeOut', 'signOut'] as const)
      .flatMap((p) => SurgeryAdvancedService.CHECKLIST_ITEMS[p].map((i) => i.key));
    const payload = Object.fromEntries(allKeys.map((k) => [k, true]));
    const out = await through(payload);
    expect(definedKeys(out)).toEqual([...allKeys].sort());
  });

  it('🔴 필수 항목 procedure(수술명)·site(수술 부위)가 정본에 살아 있다 — 이 둘이 빠졌던 이력이 있다', async () => {
    const timeOutKeys = SurgeryAdvancedService.CHECKLIST_ITEMS.timeOut.filter((i) => i.required).map((i) => i.key);
    expect(timeOutKeys).toContain('procedure');
    expect(timeOutKeys).toContain('site');
    const out = await through({ procedure: true, site: true });
    expect(definedKeys(out)).toEqual(['procedure', 'site']);
  });

  it('🔴 정본 패널이 화면에 그 둘을 그린다 — 항목은 서버 items 로만 그린다(로컬 재정의 금지)', () => {
    const src = read('surgery/components/SurgicalChecklistPanel.tsx');
    expect(src).toMatch(/items\?\.\[phase\]/);        // 서버가 준 정의로 렌더
    expect(src).not.toMatch(/const\s+(SIGN_IN|TIME_OUT|SIGN_OUT)_ITEMS/); // 로컬 사본 금지
  });

  it('계수 입력 페이로드(countItems·countStatus·해소기록)가 전부 살아남는다', async () => {
    const screenPayload = {
      countItems: [
        { item: 'GAUZE', initial: 20, final: 20, status: 'MATCH' },
        { item: 'NEEDLE', initial: 8, final: 7, status: 'MISMATCH' },
      ],
      countStatus: 'MISMATCH',
      countDiscrepancyNote: '재계수 2회 · 이동형 X-ray 확인 — 잔류물 없음',
    };
    const out = await through(screenPayload);
    expect(definedKeys(out)).toEqual(Object.keys(screenPayload).sort());
    const items = out.countItems as Array<Record<string, unknown>>;
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ item: 'GAUZE', initial: 20, final: 20, status: 'MATCH' });
    expect(typeof items[0].initial).toBe('number');
  });

  it('🔴 게이트가 보는 어휘 밖의 countStatus 는 400 으로 막는다 — 자유문자열은 게이트를 조용히 연다', async () => {
    for (const bad of ['mismatch', '불일치', 'OK', '']) {
      await expect(through({ countStatus: bad })).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('체크값이 boolean 이 아니면 저장 직전에 400 — 마취 유도 직전 화면에서 500 은 원인을 못 읽는다', async () => {
    await expect(through({ patientId: 'true' })).rejects.toBeInstanceOf(BadRequestException);
  });
});

/* ──────────────────── "완료"의 정의 — 부분 저장 vs 완료 ──────────────────── */

function makeService(existing: Record<string, unknown>) {
  const update = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'cl', ...data }));
  const prisma = {
    surgicalChecklist: { findUnique: vi.fn(async () => existing), update },
    surgery: { findUnique: vi.fn() },
    preAnesthesiaEvaluation: { findUnique: vi.fn(async () => ({ status: 'COMPLETED' })) },
    user: { findMany: vi.fn(async () => []) },
  };
  const cfg = { get: vi.fn(async () => 'OFF') };
  return { svc: new SurgeryAdvancedService(prisma as never, cfg as never), update };
}

const SIGN_IN_REQUIRED_FIELDS = SurgeryAdvancedService.CHECKLIST_ITEMS.signIn
  .filter((i) => i.required)
  .map((i) => i.field);

describe('"완료"의 정의 = 그 단계 필수항목 전량 충족', () => {
  it('🔴 항목 하나만 눌러도 저장은 되지만 완료 스탬프는 찍히지 않는다', async () => {
    const { svc, update } = makeService({ surgeryId: 's1' });
    await svc.updateChecklist('s1', 'signIn', { patientId: true }, 'u1');
    const data = update.mock.calls[0][0].data;
    expect(data.signInPatientId).toBe(true);              // 부분 저장은 막지 않는다
    expect(data.signInCompletedAt).toBeUndefined();        // 완료라고 말하지 않는다
    expect(data.signInCompletedBy).toBeUndefined();
  });

  it('필수 항목이 마지막 하나까지 차는 순간 완료 시각·확인자가 찍힌다', async () => {
    const existing: Record<string, unknown> = { surgeryId: 's1' };
    for (const f of SIGN_IN_REQUIRED_FIELDS.slice(0, -1)) existing[f] = true;
    const { svc, update } = makeService(existing);
    const lastKey = SurgeryAdvancedService.CHECKLIST_ITEMS.signIn.filter((i) => i.required).at(-1)!.key;
    await svc.updateChecklist('s1', 'signIn', { [lastKey]: true }, 'u1');
    const data = update.mock.calls[0][0].data;
    expect(data.signInCompletedAt).toBeInstanceOf(Date);
    expect(data.signInCompletedBy).toBe('u1');
  });

  it('이미 완료된 뒤 선택 항목을 눌러도 완료 시각이 뒤로 밀리지 않는다', async () => {
    const existing: Record<string, unknown> = { surgeryId: 's1', signInCompletedAt: new Date('2026-08-18T01:00:00Z'), signInCompletedBy: 'u1' };
    for (const f of SIGN_IN_REQUIRED_FIELDS) existing[f] = true;
    const { svc, update } = makeService(existing);
    await svc.updateChecklist('s1', 'signIn', { pulseOximeter: true }, 'u2');
    const data = update.mock.calls[0][0].data;
    expect(data.signInCompletedAt).toBeUndefined();
    expect(data.signInCompletedBy).toBeUndefined();
  });

  it('🔴 필수 항목이 다시 꺼지면 완료 스탬프를 지운다 — 성립하지 않는 완료를 원장에 남기지 않는다', async () => {
    const existing: Record<string, unknown> = { surgeryId: 's1', signInCompletedAt: new Date(), signInCompletedBy: 'u1' };
    for (const f of SIGN_IN_REQUIRED_FIELDS) existing[f] = true;
    const { svc, update } = makeService(existing);
    await svc.updateChecklist('s1', 'signIn', { patientId: false }, 'u2');
    const data = update.mock.calls[0][0].data;
    expect(data.signInCompletedAt).toBeNull();
    expect(data.signInCompletedBy).toBeNull();
  });

  it('단계는 서로를 오염시키지 않는다 — Sign-In 을 눌러도 Time-Out 스탬프는 손대지 않는다', async () => {
    const { svc, update } = makeService({ surgeryId: 's1' });
    await svc.updateChecklist('s1', 'signIn', { patientId: true }, 'u1');
    const data = update.mock.calls[0][0].data;
    expect('timeOutCompletedAt' in data).toBe(false);
    expect('signOutCompletedAt' in data).toBe(false);
  });
});

/* ───────────────────────── 계수 판정 — 숫자가 정본 ───────────────────────── */

describe('수술 계수 판정 — 숫자가 어긋나면 화면이 뭐라 하든 MISMATCH', () => {
  it('초기≠최종 이면 MISMATCH', () => {
    expect(deriveCountStatus([{ item: 'GAUZE', initial: 20, final: 19, status: 'MATCH' }])).toBe('MISMATCH');
  });

  it('🔴 화면이 MATCH 를 보내도 숫자가 어긋나면 서버가 MISMATCH 로 덮는다 (잔류이물 게이트 우회 차단)', async () => {
    const { svc, update } = makeService({ surgeryId: 's1' });
    await svc.updateChecklist('s1', 'signOut', {
      countItems: [{ item: 'GAUZE', initial: 20, final: 18 }],
      countStatus: 'MATCH',
    } as never, 'u1');
    expect(update.mock.calls[0][0].data.countStatus).toBe('MISMATCH');
  });

  it('사람이 MISMATCH 라고 한 것을 숫자가 같다는 이유로 MATCH 로 바꾸지 않는다', () => {
    expect(deriveCountStatus([{ item: 'GAUZE', initial: 20, final: 20, status: 'MISMATCH' }])).toBe('MISMATCH');
    expect(deriveCountStatus([{ item: 'GAUZE', initial: 20, final: 20, status: 'MATCH' }], 'MISMATCH')).toBe('MISMATCH');
  });

  it('🔴 숫자가 같다는 것만으로 자동 MATCH 하지 않는다 — 사람이 확인해야 확인이다', () => {
    expect(deriveCountStatus([{ item: 'GAUZE', initial: 20, final: 20 }])).toBe('UNRESOLVED');
    expect(deriveCountStatus([{ item: 'GAUZE', initial: 20, final: 20, status: 'MATCH' }])).toBe('MATCH');
    expect(deriveCountStatus([{ item: 'GAUZE', initial: 0, final: 0, status: 'NA' }])).toBe('MATCH');
  });

  it('한 품목이라도 확인이 안 끝났으면 전체는 MATCH 가 아니다', () => {
    expect(deriveCountStatus([
      { item: 'GAUZE', initial: 20, final: 20, status: 'MATCH' },
      { item: 'NEEDLE', initial: 8, final: 8 },
    ])).toBe('UNRESOLVED');
  });

  it('계수 기록이 없으면 MATCH 가 아니라 UNRESOLVED — 표본 부재를 안전으로 읽지 않는다', () => {
    expect(deriveCountStatus([], 'MATCH')).toBe('UNRESOLVED');
  });

  it('🔴 잔류이물 게이트는 서버가 정한 MISMATCH 를 그대로 본다', async () => {
    const prisma = { surgicalChecklist: { findUnique: vi.fn(async () => ({ countStatus: 'MISMATCH', countDiscrepancyNote: null })) } };
    const svc = new SurgeryAdvancedService(prisma as never, { get: vi.fn(async () => 'OFF') } as never);
    await expect(svc.assertCountReconciled('s1')).rejects.toThrow(/계수 불일치|MISMATCH/);
  });

  it('화면 미리보기 규칙이 서버 규칙과 같은 어휘를 쓴다', () => {
    const src = read('surgery/components/SurgicalChecklistPanel.tsx');
    expect(src).toMatch(/previewCountStatus/);
    expect(src).toMatch(/'MATCH'|'MISMATCH'|'UNRESOLVED'/);
    // 숫자 불일치를 사람이 MATCH 로 되돌릴 수 없어야 한다
    expect(src).toMatch(/rowMismatch/);
  });
});

/* ────────── 목록 표 진행도 — EP 를 만들면 부르는 화면까지가 한 벌 ────────── */

describe('체크리스트 진행도 일괄 조회', () => {
  it('수술별 단계 진행도를 돌려준다', async () => {
    const cl: Record<string, unknown> = { surgeryId: 's1', signInCompletedAt: new Date(), timeOutCompletedAt: null, signOutCompletedAt: null, countStatus: null };
    for (const i of SurgeryAdvancedService.CHECKLIST_ITEMS.signIn) if (i.required) cl[i.field] = true;
    const prisma = { surgicalChecklist: { findMany: vi.fn(async () => [cl]) } };
    const svc = new SurgeryAdvancedService(prisma as never, { get: vi.fn() } as never);
    const out = await svc.getChecklistProgressBatch(['s1']);
    expect(out[0].progress.signIn.requiredComplete).toBe(true);
    expect(out[0].progress.timeOut.requiredComplete).toBe(false);
  });

  it('빈 목록이면 DB 를 때리지 않는다', async () => {
    const findMany = vi.fn();
    const svc = new SurgeryAdvancedService({ surgicalChecklist: { findMany } } as never, { get: vi.fn() } as never);
    expect(await svc.getChecklistProgressBatch([])).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('🔴 체크리스트 목록 화면이 실제로 이 EP 를 부른다 — 안 부르면 표는 늘 "미작성"이다', () => {
    const code = read('surgery/components/SurgeryAdvanced.tsx');
    expect(code).toMatch(/\/api\/v1\/surgery\/checklist-progress\?surgeryIds=/);
    // 존재한 적 없는 `surgery.checklist.signIn` 을 다시 읽지 않는다
    expect(code.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/cl\?\.signIn/);
  });
});

/* ─────────────────── ④ Op Note 고아 EP — 정본에서 파생 ─────────────────── */

describe('Op Note whoChecklist 는 더 이상 두 번째 정본이 아니다', () => {
  const complete: Record<string, unknown> = { surgeryId: 's1', signInCompletedAt: new Date(), timeOutCompletedAt: null, signOutCompletedAt: null, countStatus: null };
  beforeEach(() => {
    for (const p of ['signIn', 'timeOut', 'signOut'] as const) {
      for (const i of SurgeryAdvancedService.CHECKLIST_ITEMS[p]) if (i.required) complete[i.field] = true;
    }
  });

  it('🔴 Op Note 의 JSON 이 아니라 SurgicalChecklist 에서 파생한다', async () => {
    const prisma = {
      surgeryOpNote: { findUnique: vi.fn(async () => ({ whoChecklist: { signIn: false, timeOut: false, signOut: false } })) },
      surgicalChecklist: { findUnique: vi.fn(async () => complete) },
    };
    const svc = new SurgeryOpnoteService(prisma as never);
    const out = await svc.getWhoChecklist('s1');
    expect(out.source).toBe('SurgicalChecklist');
    // 레거시 JSON 은 전부 false 인데 정본은 전 단계 충족 — 정본을 따른다
    expect(out.signIn).toBe(true);
    expect(out.timeOut).toBe(true);
    expect(out.signOut).toBe(true);
    expect(out.complete).toBe(true);
    // 어긋나는 레거시 사본을 숨기지 않는다
    expect(out.legacyOpNoteBlob).toEqual({ signIn: false, timeOut: false, signOut: false });
  });

  it('Op Note 가 없어도 체크리스트가 있으면 답한다 — 수술기록보다 체크리스트가 먼저 쓰인다', async () => {
    const prisma = {
      surgeryOpNote: { findUnique: vi.fn(async () => null) },
      surgicalChecklist: { findUnique: vi.fn(async () => complete) },
    };
    const svc = new SurgeryOpnoteService(prisma as never);
    await expect(svc.getWhoChecklist('s1')).resolves.toMatchObject({ complete: true, legacyOpNoteBlob: null });
  });

  it('🔴 체크리스트가 없으면 "전부 false" 가 아니라 404 다 — 미작성을 미충족으로 말하지 않는다', async () => {
    const prisma = {
      surgeryOpNote: { findUnique: vi.fn(async () => ({ whoChecklist: null })) },
      surgicalChecklist: { findUnique: vi.fn(async () => null) },
    };
    const svc = new SurgeryOpnoteService(prisma as never);
    await expect(svc.getWhoChecklist('s1')).rejects.toThrow(/체크리스트/);
  });
});

/* ───────────────────── ③ 워크스테이션 가짜 게이트 ───────────────────── */

describe('수술준비 워크스테이션은 더 이상 기록되지 않는 게이트를 걸지 않는다', () => {
  const src = read('workstation/surgery-prep/page.tsx');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
    .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');

  it('🔴 로컬 state 로 완료 버튼을 잠그지 않는다', () => {
    expect(code).not.toMatch(/disabled=\{checklistDone/);
    expect(code).not.toMatch(/const\s+CHECKLIST_ITEMS\s*=/);
  });

  it('WHO 기록은 정본 패널을 부른다 — 부르는 화면까지가 한 벌이다', () => {
    expect(code).toMatch(/<SurgicalChecklistPanel/);
  });

  // 2026-09-30 — 큐 한 줄이 곧 수술(surgeries)이 되어 "연결된 수술 없음" 분기는 도달할 수 없어졌다.
  //   대신 모든 줄이 수술 id 로 정본 패널을 연다는 것을 본다.
  it('큐의 한 줄이 곧 수술이다 — 체크리스트 패널이 그 수술 id 로 열린다', () => {
    expect(code).toMatch(/<SurgicalChecklistPanel surgeryId=\{selected\.surgeryId\}/);
    expect(code).not.toMatch(/workstation\/order\/\$\{/);
  });
});
