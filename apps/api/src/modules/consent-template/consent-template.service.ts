import { Injectable, Logger, Optional, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { TranslationService } from '../i18n/translation.service';

@Injectable()
export class ConsentTemplateService {
  private readonly logger = new Logger(ConsentTemplateService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly translation?: TranslationService,
  ) {}

  async create(data: {
    type: string; name: string; version: string; content: Prisma.JsonValue;
    requiredFields: Prisma.JsonValue; description?: string; components?: Prisma.JsonValue;
    variables?: Prisma.JsonValue; lastEditedBy?: string; language?: string;
  }) {
    const legalChecks = this.validateLegalRequirements(data.components ?? data.content);
    // (name, language) 활성 최신판 중복 방지 — DB는 부분 unique(is_latest=true)로 이중 방어
    const dup = await this.prisma.consentTemplate.findFirst({
      where: { name: data.name, language: data.language ?? 'ko', isLatest: true },
      select: { id: true },
    });
    if (dup) throw new BadRequestException(`동일 이름·언어의 템플릿이 이미 있습니다: ${data.name} (${data.language ?? 'ko'})`);
    return this.prisma.consentTemplate.create({
      data: {
        type: data.type,
        name: data.name,
        language: data.language ?? 'ko',
        version: data.version,
        content: data.content as unknown as Prisma.InputJsonValue,
        requiredFields: data.requiredFields as unknown as Prisma.InputJsonValue,
        description: data.description,
        components: data.components ? (data.components as unknown as Prisma.InputJsonValue) : undefined,
        variables: data.variables ? (data.variables as unknown as Prisma.InputJsonValue) : undefined,
        legalChecks: legalChecks as unknown as Prisma.InputJsonValue,
        lastEditedBy: data.lastEditedBy,
      },
    });
  }

  async findAll(type?: string, search?: string, includeInactive?: boolean, language?: string) {
    const where: Prisma.ConsentTemplateWhereInput = {};
    if (!includeInactive) where.isActive = true;
    if (type) where.type = type;
    if (language) where.language = language;
    if (search) where.name = { contains: search, mode: 'insensitive' };
    where.isLatest = true;

    const templates = await this.prisma.consentTemplate.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { consentForms: true } } },
    });

    return templates.map(t => ({
      ...t,
      usageCount: t._count.consentForms,
      _count: undefined,
    }));
  }

  async findById(id: string) {
    const template = await this.prisma.consentTemplate.findUnique({
      where: { id },
      include: { _count: { select: { consentForms: true } } },
    });
    if (!template) throw new NotFoundException('Consent template not found');
    return { ...template, usageCount: template._count.consentForms, _count: undefined };
  }

  async update(id: string, data: {
    type?: string; name?: string; content?: Prisma.JsonValue; requiredFields?: Prisma.JsonValue;
    description?: string; components?: Prisma.JsonValue; variables?: Prisma.JsonValue; lastEditedBy?: string;
  }) {
    const existing = await this.findById(id);

    // 버전 자동 증가 (minor)
    const [major, minor] = existing.version.split('.').map(Number);
    const newVersion = `${major}.${(minor || 0) + 1}`;

    const legalChecks = this.validateLegalRequirements(data.components ?? data.content ?? existing.components ?? existing.content);

    // 🔴 (2026-09-16 J1) 종전엔 **isLatest 해제를 먼저 커밋하고** 새 버전 생성을 나중에 했다.
    //    사이에 실패하면 그 서식은 **isLatest=true 인 판이 하나도 없는 상태**로 남는다 —
    //    최신본으로 조회하는 동의서 발급 화면에서 그 유형이 통째로 사라진다(법정 서식).
    //    해제와 생성을 한 트랜잭션에.
    return this.prisma.$transaction(async (tx) => {
      // 이전 버전을 isLatest=false로
      await tx.consentTemplate.update({
        where: { id },
        data: { isLatest: false },
      });

      // 새 버전 생성
      return tx.consentTemplate.create({
      data: {
        type: data.type ?? existing.type,
        name: data.name ?? existing.name,
        language: existing.language, // 언어는 버전업 시 불변(언어판 전환은 clone-to-language)
        version: newVersion,
        content: (data.content ?? existing.content) as unknown as Prisma.InputJsonValue,
        requiredFields: (data.requiredFields ?? existing.requiredFields) as unknown as Prisma.InputJsonValue,
        description: data.description ?? existing.description,
        components: (data.components ?? existing.components) as unknown as Prisma.InputJsonValue,
        variables: (data.variables ?? existing.variables) as unknown as Prisma.InputJsonValue,
        legalChecks: legalChecks as unknown as Prisma.InputJsonValue,
        lastEditedBy: data.lastEditedBy,
        parentId: id,
        isLatest: true,
        changeLog: `v${existing.version} → v${newVersion}`,
      },
      });
    });
  }

  /** 복제. targetLanguage 지정 시 동일 이름의 언어판(번역용 사본)을 생성 — 내용은 원본 그대로 담겨 번역·수정 대상. */
  async clone(id: string, targetLanguage?: string) {
    const original = await this.findById(id);
    const language = targetLanguage?.trim() || original.language;
    const isLangClone = language !== original.language;
    const cloneName = isLangClone ? original.name : `${original.name} (사본)`;

    // 이름+언어 중복 체크(name 단독 unique 해제됨)
    const exists = await this.prisma.consentTemplate.findFirst({ where: { name: cloneName, language } });
    const finalName = exists ? `${cloneName} ${Date.now()}` : cloneName;

    return this.prisma.consentTemplate.create({
      data: {
        type: original.type,
        name: finalName,
        language,
        version: '1.0',
        content: original.content as unknown as Prisma.InputJsonValue,
        requiredFields: original.requiredFields as unknown as Prisma.InputJsonValue,
        description: original.description,
        components: original.components as unknown as Prisma.InputJsonValue,
        variables: original.variables as unknown as Prisma.InputJsonValue,
        legalChecks: original.legalChecks as unknown as Prisma.InputJsonValue,
        changeLog: isLangClone
          ? `${original.name} v${original.version}(${original.language})에서 ${language} 언어판 생성 — 번역 필요`
          : `${original.name} v${original.version}에서 복제`,
      },
    });
  }

  /* ── AI 번역 초안(언어판) — 법적 문서라 자동 활성화 금지: isActive=false + 검토 필수 마킹 ── */

  /** 번역 대상 문자열 키(컴포넌트 빌더 규격) */
  private static readonly TRANSLATABLE_KEYS = ['text', 'label', 'placeholder', 'title', 'description'];

  /** components 배열의 표시 문자열을 번역(순차·캐시 우선·실패 시 원문 폴백). 반환: {components, fallbacks} */
  private async translateComponents(components: unknown, target: string): Promise<{ components: unknown; fallbacks: number }> {
    if (!this.translation || !Array.isArray(components)) return { components, fallbacks: 0 };
    let fallbacks = 0;
    const out = [] as Record<string, unknown>[];
    for (const raw of components as Record<string, unknown>[]) {
      const comp: Record<string, unknown> = { ...raw };
      for (const key of ConsentTemplateService.TRANSLATABLE_KEYS) {
        if (typeof comp[key] === 'string' && (comp[key] as string).trim()) {
          const r = await this.translation.translate(comp[key] as string, target, 'ko');
          if (r.fallback) fallbacks += 1;
          comp[key] = r.translated;
        }
      }
      if (Array.isArray(comp.options)) {
        const opts = [] as unknown[];
        for (const o of comp.options as unknown[]) {
          if (typeof o === 'string' && o.trim()) {
            const r = await this.translation.translate(o, target, 'ko');
            if (r.fallback) fallbacks += 1;
            opts.push(r.translated);
          } else opts.push(o);
        }
        comp.options = opts;
      }
      out.push(comp);
    }
    return { components: out, fallbacks };
  }

  /**
   * 언어판 생성 + AI 번역 초안 — 행을 즉시 생성(원문 내용·번역 진행중 마킹)하고
   * 번역은 백그라운드로 채움(LLM 지연으로 인한 HTTP 타임아웃 회피). 완료 시 같은 행 update.
   * 법적 문서 원칙: isActive=false로 생성 — 관리자가 검토·수정 후 직접 활성화.
   */
  async cloneWithTranslation(id: string, targetLanguage: string, userId?: string) {
    const original = await this.findById(id);
    const language = targetLanguage?.trim();
    if (!language) throw new BadRequestException('targetLanguage가 필요합니다');
    if (language === original.language) throw new BadRequestException('원본과 같은 언어입니다 — 일반 복제를 사용하세요');

    const exists = await this.prisma.consentTemplate.findFirst({ where: { name: original.name, language, isLatest: true } });
    if (exists) throw new BadRequestException(`이미 ${language} 언어판이 있습니다: ${original.name}`);

    const draft = await this.prisma.consentTemplate.create({
      data: {
        type: original.type,
        name: original.name,
        language,
        version: '1.0',
        content: original.content as unknown as Prisma.InputJsonValue,
        requiredFields: original.requiredFields as unknown as Prisma.InputJsonValue,
        description: original.description,
        components: original.components as unknown as Prisma.InputJsonValue,
        variables: ({ ...((original.variables as object) ?? {}), aiDraft: 'PENDING', aiDraftFrom: original.language }) as Prisma.InputJsonValue,
        legalChecks: original.legalChecks as unknown as Prisma.InputJsonValue,
        lastEditedBy: userId,
        isActive: false, // 검토 전 비활성 — 활성화는 관리자 검토 후
        changeLog: `${original.name} v${original.version}(${original.language}) → ${language} AI 번역 초안 — 검토 후 활성화 필요`,
      },
    });

    // 백그라운드 번역 충전 — 실패해도 행은 남음(원문 폴백·재시도 가능)
    void this.fillTranslation(draft.id, original, language).catch((e) =>
      this.logger.warn(`AI 번역 초안 실패(${original.name}→${language}): ${e instanceof Error ? e.message : String(e)}`),
    );

    return { ...draft, aiDraftQueued: true };
  }

  private async fillTranslation(draftId: string, original: { name: string; components: unknown; content: unknown; variables: unknown }, language: string) {
    const sourceComponents = (original.components as unknown[]) ?? (original.content as { sections?: unknown[] })?.sections ?? [];
    const { components, fallbacks } = await this.translateComponents(sourceComponents, language);
    await this.prisma.consentTemplate.update({
      where: { id: draftId },
      data: {
        components: components as Prisma.InputJsonValue,
        content: ({ sections: components }) as Prisma.InputJsonValue,
        variables: ({
          ...((original.variables as object) ?? {}),
          aiDraft: true, aiDraftFrom: 'ko', aiDraftAt: new Date().toISOString(),
          ...(fallbacks > 0 ? { aiDraftFallbacks: fallbacks } : {}), // 번역 실패로 원문(한국어)이 남은 문자열 수
        }) as Prisma.InputJsonValue,
      },
    });
    this.logger.log(`AI 번역 초안 완료: ${original.name} → ${language}${fallbacks ? ` (원문 폴백 ${fallbacks}건)` : ''}`);
  }

  /** 일괄 초안 생성 — 대상 언어판이 없는 활성·최신 한국어 템플릿 전체. 백그라운드 순차 처리. */
  async bulkCloneLanguage(language: string, userId?: string) {
    const lang = language?.trim();
    if (!lang || lang === 'ko') throw new BadRequestException('대상 언어를 지정하세요(ko 제외)');

    const koTemplates = await this.prisma.consentTemplate.findMany({
      where: { language: 'ko', isLatest: true, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    const existing = await this.prisma.consentTemplate.findMany({
      where: { language: lang, isLatest: true, name: { in: koTemplates.map((t) => t.name) } },
      select: { name: true },
    });
    const existingNames = new Set(existing.map((e) => e.name));
    const targets = koTemplates.filter((t) => !existingNames.has(t.name));

    // 백그라운드 순차 처리(LLM 과부하 방지) — 각 건은 즉시 행 생성 후 번역 충전
    void (async () => {
      for (const t of targets) {
        try {
          const original = await this.findById(t.id);
          const draft = await this.prisma.consentTemplate.create({
            data: {
              type: original.type, name: original.name, language: lang, version: '1.0',
              content: original.content as unknown as Prisma.InputJsonValue,
              requiredFields: original.requiredFields as unknown as Prisma.InputJsonValue,
              description: original.description,
              components: original.components as unknown as Prisma.InputJsonValue,
              variables: ({ ...((original.variables as object) ?? {}), aiDraft: 'PENDING', aiDraftFrom: 'ko' }) as Prisma.InputJsonValue,
              legalChecks: original.legalChecks as unknown as Prisma.InputJsonValue,
              lastEditedBy: userId, isActive: false,
              changeLog: `${original.name} v${original.version}(ko) → ${lang} AI 번역 초안(일괄) — 검토 후 활성화 필요`,
            },
          });
          await this.fillTranslation(draft.id, original, lang);
        } catch (e) {
          this.logger.warn(`일괄 초안 실패(${t.name}→${lang}): ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      this.logger.log(`일괄 AI 초안 완료: ${lang} — 대상 ${targets.length}건`);
    })();

    return { queued: targets.length, language: lang, targets: targets.map((t) => t.name), skippedExisting: existingNames.size };
  }

  async getVersionHistory(id: string) {
    const versions: Array<Record<string, unknown>> = [];
    let currentId: string | null = id;

    while (currentId) {
      const found: { id: string; parentId: string | null; [k: string]: unknown } | null =
        await this.prisma.consentTemplate.findUnique({ where: { id: currentId } }) as { id: string; parentId: string | null; [k: string]: unknown } | null;
      if (!found) break;
      versions.push(found as unknown as Record<string, unknown>);
      currentId = found.parentId;
    }

    return versions;
  }

  async toggleActive(id: string) {
    const template = await this.findById(id);
    return this.prisma.consentTemplate.update({
      where: { id },
      data: { isActive: !template.isActive },
    });
  }

  /** 목표 상태 지정(멱등) — 거버넌스 집행(P3)은 토글이 아니라 이 경로만 쓴다(재시도에 안전) */
  async setActive(id: string, active: boolean) {
    await this.findById(id); // 존재 검증(NotFound 위임)
    return this.prisma.consentTemplate.update({
      where: { id },
      data: { isActive: active },
    });
  }

  async softDelete(id: string) {
    return this.prisma.consentTemplate.update({
      where: { id },
      data: { isActive: false, isLatest: false },
    });
  }

  async restoreVersion(id: string) {
    const oldVersion = await this.findById(id);
    // 현재 latest 찾기
    const latest = await this.prisma.consentTemplate.findFirst({
      where: { name: oldVersion.name, language: oldVersion.language, isLatest: true },
    });

    const [major] = oldVersion.version.split('.').map(Number);
    const newVersion = `${major + 1}.0`;

    // 🔴 (2026-09-16 J1) `update` 와 같은 쌍둥이 — 해제를 먼저 커밋하고 복원본 생성을 나중에 했다.
    //    사이에 실패하면 최신본이 없는 서식이 남는다. 해제와 생성을 한 트랜잭션에.
    return this.prisma.$transaction(async (tx) => {
      if (latest) {
        await tx.consentTemplate.update({
          where: { id: latest.id },
          data: { isLatest: false },
        });
      }

      return tx.consentTemplate.create({
      data: {
        type: oldVersion.type,
        name: oldVersion.name,
        language: oldVersion.language,
        version: newVersion,
        content: oldVersion.content as unknown as Prisma.InputJsonValue,
        requiredFields: oldVersion.requiredFields as unknown as Prisma.InputJsonValue,
        description: oldVersion.description,
        components: oldVersion.components as unknown as Prisma.InputJsonValue,
        variables: oldVersion.variables as unknown as Prisma.InputJsonValue,
        legalChecks: oldVersion.legalChecks as unknown as Prisma.InputJsonValue,
        parentId: latest?.id ?? id,
        isLatest: true,
        changeLog: `v${oldVersion.version}에서 복원 → v${newVersion}`,
      },
      });
    });
  }

  async exportTemplate(id: string) {
    const template = await this.findById(id);
    const { usageCount, ...exportData } = template as typeof template & { usageCount: number };
    return exportData;
  }

  async importTemplate(data: Record<string, unknown>) {
    const { id, createdAt, updatedAt, consentForms, ...importData } = data;
    const importName = importData.name as string;
    const importLang = (importData.language as string | undefined) ?? 'ko';
    // 이름+언어 중복 처리(name 단독 unique 해제됨)
    const exists = await this.prisma.consentTemplate.findFirst({ where: { name: importName, language: importLang, isLatest: true } });
    if (exists) importData.name = `${importName} (가져오기 ${new Date().toISOString().split('T')[0]})`;
    importData.language = importLang;

    return this.prisma.consentTemplate.create({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: {
        ...(importData as any),
        content: importData.content as unknown as Prisma.InputJsonValue,
        requiredFields: importData.requiredFields as unknown as Prisma.InputJsonValue,
        components: importData.components as unknown as Prisma.InputJsonValue,
        variables: importData.variables as unknown as Prisma.InputJsonValue,
        legalChecks: importData.legalChecks as unknown as Prisma.InputJsonValue,
        isLatest: true,
        version: (importData.version as string | undefined) ?? '1.0',
      },
    });
  }

  // 법적 요구사항 자동 검증
  private validateLegalRequirements(contentOrComponents: Prisma.JsonValue): Record<string, boolean> {
    const json = JSON.stringify(contentOrComponents ?? {}).toLowerCase();
    return {
      hasPatientSignature: json.includes('서명') && (json.includes('환자') || json.includes('patient')),
      hasDoctorSignature: json.includes('서명') && (json.includes('의사') || json.includes('doctor') || json.includes('설명')),
      hasDateField: json.includes('날짜') || json.includes('date') || json.includes('일시'),
      hasComplicationInfo: json.includes('합병증') || json.includes('부작용') || json.includes('위험'),
      hasAlternativeInfo: json.includes('대안') || json.includes('alternative'),
      hasVoluntaryConsent: json.includes('자발') || json.includes('거부') || json.includes('동의'),
    };
  }
}
