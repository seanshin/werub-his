import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { judgeNestedRoutes } from './nested-route-judge';
import { NESTED_ROUTE_TOTAL, NESTED_SCOPE_EXEMPT } from './nested-route-ownership.baseline';

/**
 * 🔴 중첩 경로의 **소속 대조** — 경로가 `부모/:parentId/자식/:id` 인데 자식 id 만으로 조회·수정하면
 *    그 경로는 장식이 된다: 다른 환자·다른 입원의 기록을 남의 경로로 읽고 고칠 수 있다.
 *
 * 실측(2026-09-16 · 컨트롤러 306파일 · HTTP 핸들러 3,274 중 중첩 경로 55):
 *   알레르기 3 · 문제목록 3 · 간호기록 3 · 동의서 PDF 1 · 검사 워크시트 항목 1 · CMS 복원 1 = **12 자리**가
 *   부모 id 를 버리고 있었다. 나머지(청구 분납·환자 연락처·차트 템플릿 버전 등)는 이미 `findFirst({ id, 부모 })`
 *   로 대조하고 있었다 — 이 스펙은 **고친 자리가 되돌아가지 않는지**를 본다.
 *
 * 규약: 소속이 다르면 **존재를 알려주지 않는다(404)**. 403 은 "그 id 가 있다"를 알려준다.
 */

const API = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(join(API, p), 'utf8');

/** 소속 대조는 단건 조회를 `findFirst({ where: { id, <부모> } })` 로 한다 — findUnique 는 부모를 걸 수 없다 */
const scopedFindFirst = (src: string, model: string, parent: string) =>
  new RegExp(`${model}\\.findFirst\\(\\{[\\s\\S]{0,120}?where:\\s*\\{[^}]*${parent}`).test(src);

describe('중첩 경로 소속 대조 — 부모 id 를 버리지 않는다', () => {
  it('대조군 — 이미 대조하던 자리는 그대로다(분납 회차·환자 연락처·차트 템플릿 버전)', () => {
    expect(read('src/modules/inpatient/inpatient.service.ts')).toContain('id: billingId, admissionId');
    expect(scopedFindFirst(read('src/modules/patient/patient.service.ts'), 'patientContact', 'patientId')).toBe(true);
    expect(read('src/modules/chart-template/chart-template.service.ts')).toContain('id: versionId, templateId');
  });

  it('🔴 알레르기 — 환자 소속을 대조한다(DUR 이 읽는 안전 데이터)', () => {
    const src = read('src/modules/allergy/allergy.service.ts');
    expect(scopedFindFirst(src, 'allergy', 'patientId')).toBe(true);
    // 세 핸들러가 모두 환자 id 를 받는다
    expect(src).toMatch(/async findById\(patientId: string, id: string\)/);
    expect(src).toMatch(/async update\(patientId: string, id: string/);
    expect(src).toMatch(/async verify\(patientId: string, id: string/);
    const ctrl = read('src/modules/allergy/allergy.controller.ts');
    expect((ctrl.match(/@Param\('patientId', ParseUUIDPipe\)/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });

  it('🔴 문제목록 — 환자 소속을 대조한다', () => {
    const src = read('src/modules/problem-list/problem-list.service.ts');
    expect(scopedFindFirst(src, 'problemList', 'patientId')).toBe(true);
    expect(src).toMatch(/async findById\(patientId: string, id: string\)/);
    expect(src).toMatch(/async resolve\(patientId: string, id: string/);
  });

  it('🔴 간호기록 — 입원 소속을 대조한다(서명·정정·품질검사)', () => {
    const src = read('src/modules/nursing/nursing.service.ts');
    expect(scopedFindFirst(src, 'nursingNote', 'admissionId')).toBe(true);
    expect(src).toMatch(/async signNote\(admissionId: string, noteId: string/);
    expect(src).toMatch(/async amendNote\(admissionId: string, noteId: string/);
    expect(src).toMatch(/async nursingNoteQa\(admissionId: string, noteId: string/);
    // 체크리스트(2026-09-15 봉합)도 같은 규약을 유지한다
    expect(src).toContain('id: checklistId, admissionId');
  });

  it('🔴 동의서 PDF — 환자 경로면 그 환자의 동의서만 낸다(이름·MRN·생년월일 전문)', () => {
    const pdf = read('src/modules/medical-record-copy/pdf-generation.service.ts');
    expect(pdf).toMatch(/generateConsentFormPdf\(consentId: string, scopePatientId\?: string(, opts[^)]*)?\)/); // 2026-10-12 서명용 옵션 추가
    expect(pdf).toContain('scopePatientId ? { patientId: scopePatientId } : {}');
    expect(read('src/modules/consent/consent.controller.ts')).toContain('generateConsentFormPdf(consentId, patientId)');
  });

  it('🔴 검사 워크시트 항목 — 워크시트 소속을 대조한다(종전: 항목 id 만으로 삭제)', () => {
    const src = read('src/modules/lab/lab.service.ts');
    expect(scopedFindFirst(src, 'labWorksheetItem', 'worksheetId')).toBe(true);
  });

  it('🔴 CMS 복원 — 그 콘텐츠의 스냅샷만 복원한다(공개 사이트 본문)', () => {
    expect(read('src/modules/hospital-info/hospital-info.service.ts'))
      .toContain('hospitalInfoAudit.findFirst({ where: { id: auditId, contentId } })');
  });
});

/**
 * 🔴 (2026-09-16 E2) 위 스펙은 **고친 12자리**를 이름으로 못박는다 — 새로 생기는 중첩 경로는 보지 못한다.
 *    여기서 전수를 판정한다: 부모 id 가 조회 조건에 닿지 않으면 실패.
 */
describe('중첩 경로 재고 — 새 경로가 부모를 버리면 실패한다', () => {
  const MODULES = resolve(__dirname, '../../src/modules');
  const judged = judgeNestedRoutes(MODULES);
  const key = (j: (typeof judged)[number]) => `${j.route.method} ${j.route.path}`;

  it('대조군 — 판정기가 실제로 돌았다(중첩 경로를 찾고, 대부분을 scoped 로 판정한다)', () => {
    expect(judged.length).toBe(NESTED_ROUTE_TOTAL);
    expect(judged.filter((j) => j.verdict === 'scoped').length).toBeGreaterThan(30);
    // 판정기가 풀지 못한 자리를 조용히 통과시키지 않는다
    expect(judged.filter((j) => j.verdict === 'unresolved').map(key)).toEqual([]);
  });

  it('🔴 부모 id 가 조회 조건에 닿지 않는 중첩 경로는 면제 목록에 적힌 것뿐이다', () => {
    const unscoped = judged.filter((j) => j.verdict === 'unscoped').map(key).sort();
    expect(unscoped).toEqual(Object.keys(NESTED_SCOPE_EXEMPT).sort());
  });

  it('면제 목록에 죽은 항목이 없다(경로가 사라졌으면 지운다)', () => {
    const all = new Set(judged.map(key));
    expect(Object.keys(NESTED_SCOPE_EXEMPT).filter((k) => !all.has(k))).toEqual([]);
  });

  /**
   * 🔴 면제를 이름으로만 두면 **그 자리의 대조를 지워도 가드가 침묵한다** — 재주입에서 실제로 통과했다.
   *    면제마다 대조가 코드에 실재한다는 표식을 확인한다.
   */
  it('🔴 면제된 자리의 대조가 코드에 실재한다(표식이 사라지면 실패)', () => {
    const gone = Object.entries(NESTED_SCOPE_EXEMPT)
      .filter(([, ex]) => !readFileSync(join(API, 'src/modules', ex.file), 'utf8').includes(ex.evidence))
      .map(([route, ex]) => `${route} — 사라진 표식: ${ex.evidence}`);
    expect(gone).toEqual([]);
  });
});

describe('소속이 다르면 존재를 알려주지 않는다 — 실제 호출', () => {
  it('알레르기: 다른 환자의 id 로는 404 · 같은 환자면 통과(대조군)', async () => {
    const { AllergyService } = await import('../../src/modules/allergy/allergy.service');
    const { AllergyNotFoundError } = await import('../../src/domain/errors/domain-error');
    const rows = [{ id: 'a-1', patientId: 'p-1', allergen: '페니실린' }];
    const update = vi.fn(({ data }: any) => Promise.resolve({ ...rows[0], ...data }));
    /**
     * 🔴 목은 **정본이 실제로 부르는 모양**을 준다 — `findUnique` 를 비워두면 되돌린 구현이 TypeError 로
     *    죽고 `rejects.toThrow()` 가 그대로 통과한다(다른 이유로 통과 · 재주입에서 실제로 겪었다).
     *    여기서는 둘 다 주되 `findUnique` 는 **환자를 가리지 않는다** — 소속 대조를 지우면 남의 기록이 나온다.
     */
    const prisma = {
      allergy: {
        findUnique: vi.fn(({ where }: any) => Promise.resolve(rows.find((r) => r.id === where.id) ?? null)),
        findFirst: vi.fn(({ where }: any) =>
          Promise.resolve(rows.find((r) => r.id === where.id && r.patientId === where.patientId) ?? null)),
        update,
      },
    } as never;
    const svc = new AllergyService(prisma);

    // 남의 환자 경로 — 존재를 알려주지 않는다(404). 오류 종류를 못박아야 TypeError 가 대신 통과하지 않는다.
    await expect(svc.findById('p-2', 'a-1')).rejects.toThrow(AllergyNotFoundError);
    await expect(svc.update('p-2', 'a-1', { severity: 'HIGH' } as never)).rejects.toThrow(AllergyNotFoundError);
    await expect(svc.verify('p-2', 'a-1', { verificationStatus: 'CONFIRMED' } as never)).rejects.toThrow(AllergyNotFoundError);
    expect(update).not.toHaveBeenCalled(); // 남의 기록에 쓰기가 닿지 않았다

    const ok = await svc.findById('p-1', 'a-1'); // 제 환자 경로는 통과한다
    expect(ok.id).toBe('a-1');
    await svc.update('p-1', 'a-1', { severity: 'HIGH' } as never);
    expect(update).toHaveBeenCalledTimes(1);
  });

  /**
   * 🔴 (2026-09-16 E2) D2 가 "부모가 입원이 아니라 평가 id" 라 분류에서 뺀 간호 사슬 8자리를 읽다 나온 것.
   *    경로에 부모가 없어 **소속 대조 대상은 아니었지만**, 같은 `assessmentId` 에 POST 는 404 인데
   *    GET 만 `[]` 였다 — 화면은 "그런 평가 없음"을 "진단 0건"으로 그린다.
   */
  it('간호진단 목록: 없는 평가면 404 · 있는 평가면 목록(진단 0건은 그대로 빈 목록)', async () => {
    const { NursingService } = await import('../../src/modules/nursing/nursing.service');
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      nursingAssessment: {
        findUnique: vi.fn(({ where }: any) => Promise.resolve(where.id === 'as-1' ? { id: 'as-1' } : null)),
      },
      nursingDiagnosis: { findMany },
    } as never;
    const svc = new NursingService(prisma, { emit: vi.fn() } as never, { get: vi.fn() } as never);

    await expect(svc.getDiagnoses('as-404')).rejects.toThrow(/assessment/i);
    expect(findMany).not.toHaveBeenCalled(); // 없는 평가에는 조회조차 가지 않는다

    await expect(svc.getDiagnoses('as-1')).resolves.toEqual([]); // 실재하는 평가의 진단 0건은 빈 목록(대조군)
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it('검사 워크시트 항목: 다른 워크시트의 항목은 지워지지 않는다 · 제 워크시트면 삭제(대조군)', async () => {
    const { LabService } = await import('../../src/modules/lab/lab.service');
    const del = vi.fn().mockResolvedValue({ id: 'it-1' });
    const prisma = {
      labWorksheetItem: {
        findFirst: vi.fn(({ where }: any) =>
          Promise.resolve(where.id === 'it-1' && where.worksheetId === 'ws-1' ? { id: 'it-1' } : null)),
        delete: del,
      },
    } as never;
    const svc = new LabService(prisma);

    await expect(svc.removeWorksheetItem('ws-2', 'it-1')).rejects.toThrow();
    expect(del).not.toHaveBeenCalled(); // 남의 워크시트 항목은 건드리지 않았다

    await svc.removeWorksheetItem('ws-1', 'it-1');
    expect(del).toHaveBeenCalledWith({ where: { id: 'it-1' } });
  });
});
