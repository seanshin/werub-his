import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { canonicalJson } from '../../common/util/canonical-json';
import { CreateFormSchemaDto, UpdateFormSchemaDto } from './dto/create-form-schema.dto';

/** 문항이 담기는 최상위 키 — 양식은 `fields`(평면) 또는 `sections`(구획) 중 하나로 문항을 담는다. */
const QUESTION_KEYS = ['fields', 'sections'] as const;

type JsonObject = Record<string, unknown>;

function isPlainObject(v: unknown): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * 판을 가르는 내용 — 문항·채점 등 제목·설명을 뺀 전부(2026-10-21 P5 A7).
 * 🔴 관리 화면 편집기는 저장 때마다 `title`·`description` 을 schema 안에 다시 실어 보낸다 — 그것까지 비교하면
 *    아무것도 안 고친 저장도 새 판이 된다(판이 의미를 잃는다). 안내 문구는 판을 바꾸지 않는다.
 */
function revisionContent(schema: unknown): unknown {
  if (!isPlainObject(schema)) return schema;
  const { title: _title, description: _description, ...rest } = schema;
  return rest;
}

/** 문항 컨테이너에 실제 내용이 있는가 */
function hasQuestions(schema: unknown): boolean {
  if (!isPlainObject(schema)) return false;
  return QUESTION_KEYS.some((k) => Array.isArray(schema[k]) && (schema[k] as unknown[]).length > 0);
}

/**
 * 🔴 제출 때의 문항 판(2026-10-21 임상 규칙 P5 A7) — 제출을 쓰는 **모든 경로**(포털 문진·토큰 문진)가 이것으로 판 번호를 찍는다.
 *    판이 없으면 지난 제출을 어떤 문항으로 받았는지 알 수 없다(정의는 제자리에서 바뀌었다).
 *    폼을 못 찾으면 null — 판을 지어내지 않는다(제출 자체는 막지 않는다 · 막으면 환자가 문진을 못 낸다).
 */
export async function currentFormRevision(
  prisma: Pick<PrismaService, 'formSchema'>, formSchemaId: string,
): Promise<number | null> {
  const row = await prisma.formSchema.findUnique({ where: { id: formSchemaId }, select: { revision: true } });
  return row?.revision ?? null;
}

@Injectable()
export class FormEngineService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Schema CRUD ──

  /**
   * 🔴 W8 — 목록에 `schema`(문항)·`category`·`estimatedMinutes` 가 없어서 관리 화면이
   * **모르는 것을 빈 값으로 표시**했다: 미리보기는 항상 "필드가 정의되지 않았습니다",
   * 카테고리는 전부 '문진표', 예상시간은 전부 '-'. 편집 모달은 그 빈 값을 초기값으로 삼아
   * 저장 시 문항 0개를 PUT 했다(13개 양식 전부 해당 — PHQ-9 9문항·scoring 키 동시 소실).
   * 목록이 화면이 쓰는 필드를 전부 담게 한다(양식 13건 규모 — 페이로드 부담 없음).
   */
  async findAllSchemas() {
    return this.prisma.formSchema.findMany({
      where: { isActive: true },
      select: {
        id: true, name: true, version: true, revision: true, locale: true, isActive: true, createdAt: true,
        schema: true, category: true, estimatedMinutes: true, description: true,
      },
      orderBy: { name: 'asc' },
    });
  }

  async findSchemaByName(name: string) {
    const schema = await this.prisma.formSchema.findUnique({ where: { name } });
    if (!schema) throw new NotFoundException(`Form schema '${name}' not found`);
    return schema;
  }

  /** 만들 때 판 1 을 원장에 함께 남긴다(한 트랜잭션) */
  async createSchema(dto: CreateFormSchemaDto, userId: string) {
    const existing = await this.prisma.formSchema.findUnique({ where: { name: dto.name } });
    if (existing) throw new ConflictException(`Form schema '${dto.name}' already exists`);

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.formSchema.create({
      data: {
        name: dto.name,
        version: dto.version,
        locale: dto.locale ?? 'ko',
        schema: dto.schema as unknown as Prisma.InputJsonValue,
        ...(dto.category ? { category: dto.category } : {}),
        ...(dto.estimatedMinutes !== undefined ? { estimatedMinutes: dto.estimatedMinutes } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        createdBy: userId,
      },
      });
      await tx.formSchemaRevision.create({
        data: { formSchemaId: created.id, revision: created.revision, version: created.version, schema: created.schema as Prisma.InputJsonValue, origin: 'CREATE', changedBy: userId },
      });
      return created;
    });
  }

  /**
   * 🔴 W8 최우선 결함 — **편집→저장이 문항을 전부 삭제했다.**
   * 목록 응답에 `schema` 가 없어 관리 화면이 문항을 `[]` 로 초기화한 뒤 그대로 PUT 했고,
   * 서버는 받은 `schema` 로 원장을 **통째 치환**했다(`...(dto.schema && { schema })`).
   * 13개 양식 전부가 한 번의 저장으로 복구 불가 손실 대상이었다(PHQ-9 9문항 + `scoring` 키).
   *
   * 화면을 고치는 것만으로는 부족하다 — **다른 클라이언트(스크립트·모바일·구버전 FE)도 같은 짓을
   * 할 수 있다.** 그래서 서버가 정본을 지킨다:
   *   ① **부분 갱신** — 보내지 않은 최상위 키(`scoring`·`ui` 등)는 병합해 보존한다(치환 금지).
   *   ② **문항 소거 거부** — 기존에 문항이 있는데 들어온 payload 의 문항 컨테이너가 전부 비었으면
   *      400 으로 **거부**한다(조용히 무시하면 "저장됐다"는 거짓말이 된다 — P16).
   *   ③ 병합 결과에서 **빈 컨테이너 키는 제거**한다 — `fields: []` 가 남으면 렌더러의
   *      `fields ?? sections` 가 빈 배열을 택해 문항이 있는데도 화면이 비어 보인다(그림자 결함).
   *
   * 🔴 판(2026-10-21 P5 A7) — 문항(schema)이 실제로 바뀌면 판 번호를 올리고 새 판을 원장에 남긴다(한 트랜잭션).
   *    그 폼의 첫 수정이면 **직전 문항**을 BEFORE_LEDGER 판으로 먼저 남긴다(원장 시작 전 내용 — 언제 만들어졌는지는 모른다).
   *    제목·설명·예상 시간만 고치면 판은 그대로다(문항이 같으면 같은 판).
   *    판 번호는 조건부 갱신(지금 판일 때만) — 동시에 두 사람이 고치면 늦은 쪽이 409 `FORM_REVISION_RACE`.
   */
  async updateSchema(id: string, dto: UpdateFormSchemaDto, userId?: string) {
    const existing = await this.prisma.formSchema.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Form schema not found');

    let nextSchema: Prisma.InputJsonValue | undefined;
    if (dto.schema !== undefined) {
      nextSchema = this.mergeSchema(existing.schema, dto.schema, existing.name);
    }

    const meta = {
      ...(dto.version && { version: dto.version }),
      ...(dto.locale && { locale: dto.locale }),
      ...(dto.category && { category: dto.category }),
      ...(dto.estimatedMinutes !== undefined ? { estimatedMinutes: dto.estimatedMinutes } : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
    };
    const questionsChanged = nextSchema !== undefined && canonicalJson(revisionContent(nextSchema)) !== canonicalJson(revisionContent(existing.schema));
    if (!questionsChanged) {
      return this.prisma.formSchema.update({ where: { id }, data: { ...meta, ...(nextSchema !== undefined ? { schema: nextSchema } : {}) } });
    }

    return this.prisma.$transaction(async (tx) => {
      // 원장 시작 전 내용 — 이 판이 원장에 없으면 직전 문항을 남긴다(있으면 그대로 · 덧붙이기만)
      await tx.formSchemaRevision.createMany({
        data: [{ formSchemaId: id, revision: existing.revision, version: existing.version, schema: existing.schema as Prisma.InputJsonValue, origin: 'BEFORE_LEDGER', changedBy: null }],
        skipDuplicates: true,
      });
      const next = existing.revision + 1;
      const moved = await tx.formSchema.updateMany({
        where: { id, revision: existing.revision },
        data: { ...meta, schema: nextSchema, revision: next },
      });
      if (moved.count !== 1) {
        throw new ConflictException({ code: 'FORM_REVISION_RACE', message: '다른 사람이 먼저 이 폼의 문항을 고쳤습니다 — 다시 불러온 뒤 고치세요' });
      }
      const saved = await tx.formSchema.findUniqueOrThrow({ where: { id } });
      await tx.formSchemaRevision.create({
        data: { formSchemaId: id, revision: next, version: saved.version, schema: nextSchema as Prisma.InputJsonValue, origin: 'EDIT', changedBy: userId ?? null },
      });
      return saved;
    });
  }

  /**
   * 판 기록(2026-10-21 P5 A7) — 판마다 그 판으로 받은 제출 수 · 판 원장 시작 전 제출(판 모름) 수를 따로.
   * 🔴 원장에 없는 판(아직 한 번도 안 고친 폼의 현재 판)은 `currentRecorded: false` — 판이 없는 게 아니라 원장에 안 올라간 것이다.
   */
  async revisions(id: string) {
    const form = await this.prisma.formSchema.findUnique({ where: { id }, select: { id: true, name: true, revision: true, version: true } });
    if (!form) throw new NotFoundException('Form schema not found');
    const [rows, byRev] = await Promise.all([
      this.prisma.formSchemaRevision.findMany({
        where: { formSchemaId: id }, orderBy: { revision: 'desc' },
        select: { id: true, revision: true, version: true, origin: true, changedBy: true, createdAt: true },
      }),
      this.prisma.formSubmission.groupBy({ by: ['formSchemaRevision'], where: { formSchemaId: id }, _count: { _all: true } }),
    ]);
    const counts = new Map(byRev.map((g) => [g.formSchemaRevision, g._count._all]));
    const currentRecorded = rows.some((r) => r.revision === form.revision);
    return {
      form,
      currentRecorded,
      revisions: rows.map((r) => ({ ...r, submissions: counts.get(r.revision) ?? 0 })),
      // 판 원장 시작 전 제출 — 어떤 문항으로 받았는지 모른다
      submissionsBeforeLedger: counts.get(null) ?? 0,
      // 원장에 아직 없는 현재 판으로 받은 제출(한 번도 안 고친 폼)
      submissionsOnUnrecordedCurrent: currentRecorded ? 0 : counts.get(form.revision) ?? 0,
    };
  }

  /** 한 판의 문항 그대로 */
  async revision(id: string, revision: number) {
    const row = await this.prisma.formSchemaRevision.findUnique({ where: { formSchemaId_revision: { formSchemaId: id, revision } } });
    if (!row) throw new NotFoundException('이 판은 원장에 없습니다');
    return row;
  }

  /** 부분 갱신 병합 — 위 updateSchema 주석의 ①②③ 규칙 */
  private mergeSchema(current: unknown, incoming: unknown, name: string): Prisma.InputJsonValue {
    if (!isPlainObject(incoming)) {
      throw new BadRequestException('schema 는 객체여야 합니다');
    }
    // ② 문항 컨테이너를 **명시적으로 비워서** 보냈는데 기존에 문항이 있으면 거부.
    //    (컨테이너를 아예 보내지 않은 요청 = 제목·설명만 고치는 정상 부분 갱신 → ①에서 보존된다.)
    const declaresQuestions = QUESTION_KEYS.some((k) => k in incoming);
    if (declaresQuestions && hasQuestions(current) && !hasQuestions(incoming)) {
      throw new BadRequestException(
        `문항이 비어 있는 저장 요청입니다 — '${name}' 의 기존 문항을 지울 수 없습니다. ` +
          '양식 상세를 먼저 불러온 뒤 저장하세요(목록 응답에는 문항이 없을 수 있습니다).',
      );
    }

    // ① 최상위 키 병합 — 보내지 않은 키(scoring 등)는 보존
    const merged: JsonObject = { ...(isPlainObject(current) ? current : {}), ...incoming };

    // ③ 빈 컨테이너 제거 — `fields: []` 가 `sections` 를 가리는 그림자 방지
    for (const k of QUESTION_KEYS) {
      const v = merged[k];
      if (v === undefined || v === null || (Array.isArray(v) && v.length === 0)) delete merged[k];
    }

    return merged as Prisma.InputJsonValue;
  }

  // ── Form Submission ──
  // 🔴 2026-10-21 P5 A7 — 직원 제출 `POST forms/:name/submit`·환자 폼 데이터 `GET patients/:patientId/form-data` 회수.
  //    부르는 화면이 0 이었고(웹·모바일 grep 0), 실제 제출 경로는 포털 문진·토큰 문진 둘이다(둘 다 `currentFormRevision` 으로 판을 찍는다).
  //    직원이 문진 결과를 보는 정본은 `GET patients/:patientId/questionnaires`(문진 모듈).
}
