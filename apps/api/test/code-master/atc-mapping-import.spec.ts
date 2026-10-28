import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AtcMappingImportService } from '../../src/modules/code-master/atc-mapping-import.service';

/**
 * 🔴 ATC ↔ 제품코드(EDI) 매핑 반영 — 사람이 준 표준 파일(2026-08-26).
 *
 * 실측(25,187행): 한 제품코드에 ATC 둘 이상 = **0건**(결정적 1:1).
 * 우리 약품 마스터 24,022건과 **18,062건(75.2%)** 겹친다.
 * 운영 `terminology_mappings` 162건 중 **ATC 는 0건**이었다.
 */
const SVC = join(process.cwd(), 'src/modules/code-master/atc-mapping-import.service.ts');

const mk = (meds: { id: string; code: string }[] = [], existing: { sourceId: string; targetCode: string }[] = []) => ({
  medicationCode: { findMany: vi.fn().mockResolvedValue(meds) },
  terminologyMapping: {
    findMany: vi.fn().mockResolvedValue(existing),
    create: vi.fn().mockResolvedValue({}),
  },
}) as never;

const CSV = ['code,atc,atcName', '645302132,N05CC01,chloral hydrate'].join('\n');

describe('ATC 매핑 반영', () => {
  it('기준 버전이 없으면 받지 않는다 — 언제 기준인지 모르면 현재로 읽힌다', async () => {
    const svc = new AtcMappingImportService(mk());
    await expect(svc.preview(CSV, '2021')).rejects.toThrow(/YYYY-MM/);
  });

  it('엑셀 CSV 의 BOM 이 붙어도 헤더를 읽는다(`.trim()` 이 이미 지운다)', async () => {
    // 🔴 처음엔 BOM 제거 코드를 넣었는데 **재주입해도 이 테스트가 실패하지 않아** 없는 결함임을 알았다.
    //    ES 사양의 WhiteSpace 에 ZWNBSP 가 포함돼 `.trim()` 이 이미 지운다(실측 확인).
    //    코드는 되돌렸고 이 테스트는 **그 사실을 못박는 용도**로 남긴다.
    const svc = new AtcMappingImportService(mk([{ id: 'm1', code: '645302132' }]));
    const r = await svc.preview('\ufeff' + CSV, '2021-11');
    expect(r.counts.NEW).toBe(1);
  });

  it('열 이름을 추측하지 않는다 — 없으면 무엇이 필요한지 말한다', async () => {
    const svc = new AtcMappingImportService(mk());
    await expect(svc.preview('제품코드,ATC\n1,A10BA02', '2021-11')).rejects.toThrow(/필수 열이 없습니다/);
  });

  it('🔴 ATC 형태가 아니면 받지 않는다 — 오타가 표준 코드로 자리잡는다', async () => {
    const svc = new AtcMappingImportService(mk([{ id: 'm1', code: '645302132' }]));
    const r = await svc.preview('code,atc\n645302132,NOTATC', '2021-11');
    expect(r.counts.ERROR).toBe(1);
  });

  it('🔴 우리 마스터에 없는 코드는 오류가 아니다 — 파일이 우리보다 넓을 뿐이다', async () => {
    const svc = new AtcMappingImportService(mk([]));
    const r = await svc.preview(CSV, '2021-11');
    expect(r.counts.UNMATCHED).toBe(1);
    expect(r.counts.ERROR).toBe(0);
  });

  it('🔴 이미 다른 ATC 가 있으면 덮지 않고 CONFLICT 로 보고한다', async () => {
    const svc = new AtcMappingImportService(
      mk([{ id: 'm1', code: '645302132' }], [{ sourceId: 'm1', targetCode: 'A10BA02' }]),
    );
    const r = await svc.preview(CSV, '2021-11');
    expect(r.counts.CONFLICT).toBe(1);
    expect(r.notes.join(' ')).toMatch(/덮어쓰지 않습니다/);
  });

  it('같은 값이면 UNCHANGED — 다시 만들지 않는다', async () => {
    const svc = new AtcMappingImportService(
      mk([{ id: 'm1', code: '645302132' }], [{ sourceId: 'm1', targetCode: 'N05CC01' }]),
    );
    const r = await svc.preview(CSV, '2021-11');
    expect(r.counts.UNCHANGED).toBe(1);
  });

  it('🔴 오류가 하나라도 있으면 적용하지 않는다', async () => {
    const svc = new AtcMappingImportService(mk([{ id: 'm1', code: '645302132' }]));
    await expect(svc.apply('code,atc\n645302132,BAD', '2021-11', 'u1')).rejects.toThrow(/적용할 수 없습니다/);
  });

  it('적용 시 기준월과 출처를 남긴다 — "현재 유효"라고 말하지 않는다', async () => {
    const prisma = mk([{ id: 'm1', code: '645302132' }]);
    const svc = new AtcMappingImportService(prisma);
    await svc.apply(CSV, '2021-11', 'u1');
    const call = (prisma as unknown as { terminologyMapping: { create: { mock: { calls: unknown[][] } } } })
      .terminologyMapping.create.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(call.data.targetVersion).toBe('2021-11');
    expect(call.data.mapSource).toBe('FILE');
    expect(call.data.targetSystem).toBe('ATC');
  });

  it('🔴 정본이 둘이 되지 않는다 — MedicationCode 에 ATC 필드를 만들지 않았다', () => {
    const schema = readFileSync(join(process.cwd(), 'prisma/schema.prisma'), 'utf8');
    const model = schema.slice(schema.indexOf('model MedicationCode {'), schema.indexOf('model MedicationCode {') + 3000);
    expect(model).not.toMatch(/\batcCode\b/);
    // 대조군: 매핑 정본은 그대로 있다
    expect(schema).toMatch(/model TerminologyMapping \{/);
  });

  it('🔴 미리보기는 아무것도 저장하지 않는다', () => {
    const src = readFileSync(SVC, 'utf8');
    const preview = src.slice(src.indexOf('async preview('), src.indexOf('async apply('));
    expect(preview).not.toMatch(/\.create\(/);
    expect(preview).not.toMatch(/\.update\(/);
  });

  it('대조군 — 잘리면 잘랐다고 말한다', async () => {
    const many = ['code,atc', ...Array.from({ length: 250 }, (_, i) => `C${i},N05CC01`)].join('\n');
    const svc = new AtcMappingImportService(mk([]));
    const r = await svc.preview(many, '2021-11');
    expect(r.truncatedAt).toBe(200);
    expect(r.totalLines).toBe(250);
  });
});
