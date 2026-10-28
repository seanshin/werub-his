import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import { FormEngineService } from '../../src/modules/form-engine/form-engine.service';

/**
 * W8 가드 — **목록 응답으로 상세를 덮어쓸 수 없다.**
 *
 * 🔴 원 결함: `/admin/forms` 목록 select 에 `schema` 가 없어 편집 모달이 문항을 `[]` 로 초기화하고,
 *    저장(PUT)이 그 빈 문항으로 원장을 통째 치환했다. 13개 양식 전부(PHQ-9 9문항·`scoring` 키 포함)가
 *    한 번의 저장으로 복구 불가 손실 대상이었다. 화면만 고치면 다른 클라이언트가 같은 짓을 하므로
 *    **서버가 부분 갱신만 허용**한다.
 */
describe('W8 가드 — 폼 스키마 부분 갱신(문항 소거 불가)', () => {
  let service: FormEngineService;
  let prisma: any;

  const phq9 = {
    id: 'schema-phq9',
    name: 'scoring-phq9',
    revision: 1,
    version: '1.0',
    schema: {
      title: 'PHQ-9',
      fields: Array.from({ length: 9 }, (_, i) => ({ id: `q${i + 1}`, type: 'radio', label: `문항${i + 1}` })),
      scoring: { ranges: [{ min: 0, max: 4, label: '정상' }] },
    },
  };

  beforeEach(() => {
    // 문항이 바뀌면 판을 올리는 조건부 갱신(2026-10-21 P5 A7) — 저장된 행 = 마지막 갱신 데이터
    let saved: any = null;
    prisma = {
      formSchema: {
        findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(async ({ data }: any) => data),
        updateMany: vi.fn(async ({ data }: any) => { saved = data; return { count: 1 }; }),
        findUniqueOrThrow: vi.fn(async () => saved),
      },
      formSchemaRevision: { create: vi.fn(), createMany: vi.fn() },
    };
    prisma.$transaction = vi.fn(async (fn: any) => fn(prisma));
    service = new FormEngineService(prisma);
  });

  it('🔴 문항이 빈 payload 는 거부된다 — 조용히 무시하면 "저장됐다"는 거짓말이 된다', async () => {
    prisma.formSchema.findUnique.mockResolvedValue(phq9);

    await expect(
      service.updateSchema('schema-phq9', { version: '1.0', schema: { title: 'PHQ-9', description: '', fields: [] } }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.formSchema.update).not.toHaveBeenCalled();
  });

  it('🔴 문항 컨테이너를 아예 보내지 않아도 기존 문항은 남는다(치환 금지)', async () => {
    prisma.formSchema.findUnique.mockResolvedValue(phq9);

    const data: any = await service.updateSchema('schema-phq9', { schema: { title: 'PHQ-9 개정' } });

    expect(data.schema.fields).toHaveLength(9);
    expect(data.schema.title).toBe('PHQ-9 개정');
  });

  it('🔴 보내지 않은 최상위 키(scoring)는 보존된다 — 채점 규칙이 같이 사라지던 것', async () => {
    prisma.formSchema.findUnique.mockResolvedValue(phq9);

    const data: any = await service.updateSchema('schema-phq9', {
      schema: { title: 'PHQ-9', fields: [{ id: 'q1', type: 'radio', label: '문항1' }] },
    });

    expect(data.schema.scoring).toBeDefined();
    expect(data.schema.fields).toHaveLength(1); // 실제 편집은 반영된다
  });

  it('sections 양식도 같은 규칙 — 빈 fields 로 sections 를 지울 수 없다', async () => {
    prisma.formSchema.findUnique.mockResolvedValue({
      id: 's', name: 'dept-obgyn',
      schema: { title: '산부인과', sections: [{ title: '월경력', fields: [{ id: 'a', type: 'text', label: 'a' }] }] },
    });

    await expect(
      service.updateSchema('s', { schema: { title: '산부인과', fields: [] } }),
    ).rejects.toThrow(BadRequestException);
  });

  it('빈 컨테이너는 병합 결과에 남기지 않는다 — `fields: []` 가 sections 를 가리는 그림자 방지', async () => {
    prisma.formSchema.findUnique.mockResolvedValue({ id: 's', name: 'x', schema: { title: 'x' } });

    const data: any = await service.updateSchema('s', {
      schema: { title: 'x', sections: [{ title: 'A', fields: [{ id: 'a', type: 'text', label: 'a' }] }], fields: [] },
    });

    expect(data.schema).not.toHaveProperty('fields');
    expect(data.schema.sections).toHaveLength(1);
  });

  it('🔴 목록 응답이 화면이 쓰는 필드를 전부 담는다 — 없는 필드를 화면이 빈 값으로 만들지 않도록', async () => {
    prisma.formSchema.findMany.mockResolvedValue([]);

    await service.findAllSchemas();

    const select = prisma.formSchema.findMany.mock.calls[0][0].select;
    for (const key of ['schema', 'category', 'estimatedMinutes']) {
      expect(select[key]).toBe(true);
    }
  });

  it('🔴 수정 DTO 는 클래스여야 한다 — `Partial<>` 은 ValidationPipe 가 통째로 스킵된다', () => {
    const src = readFileSync(join(__dirname, '../../src/modules/form-engine/form-engine.controller.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(src).not.toMatch(/@Body\(\)\s*\w+\s*:\s*Partial</);
    expect(src).toMatch(/@Body\(\)\s*dto\s*:\s*UpdateFormSchemaDto/);
  });
});
