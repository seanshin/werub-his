import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { dosageRouteIssues } from '@hospital-run/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { buildMedicationSearchWhere, MEDICATION_SEARCH_ORDER } from '../../common/medication-search';

@Injectable()
export class DoctorCodeService {
  constructor(private readonly prisma: PrismaService) {}

  // ── 의사 개인 코드 목록 ──

  /**
   * 🔴 제형과 투여 기본값이 모순인 항목을 표시한다 — 2026-08-14(W7).
   *
   * 진료과 카탈로그 실측 8건 중 둘이 임상적으로 불가능한 조합이었다:
   *   · 덱사메타손 **주사** 5mg → `1C 1일1회 **PO** 28일`
   *   · 신선동결혈장(FFP) **혈액제제** → `**1T** 1일1회 **PO** 30일`
   * 이 값들은 개인 약속처방(⭐고정·38회 사용)에 등재돼 **CPOE 처방 검색의 기본값을 프리필**한다.
   * 주사제를 경구로, 혈장제제를 정제로 "권장"하는 화면이 처방 입력의 출발점이었다.
   *
   * 🔴 안내문↔약품 불일치(고혈압 1차 약물 → 세파렉신=항생제)는 약효분류 온톨로지가 없어
   *    기계로 판정할 수 없다 — **임상 검토 이연**. 여기서는 확정 가능한 모순만 표시한다.
   */
  private withDosageCheck<T extends { defaultRoute?: string | null; defaultDosage?: string | null }>(
    row: T,
    codeDetail: Record<string, unknown> | null,
  ) {
    const issues = dosageRouteIssues({
      dosageForm: (codeDetail?.dosageForm as string | undefined) ?? null,
      defaultRoute: row.defaultRoute ?? null,
      defaultDosage: row.defaultDosage ?? null,
    });
    return { ...row, codeDetail, dosageIssues: issues, hasDosageIssue: issues.length > 0 };
  }

  async getMyCodes(doctorId: string, category?: string) {
    const where: Prisma.DoctorCodeListWhereInput = { doctorId };
    if (category) where.category = category;

    const codes = await this.prisma.doctorCodeList.findMany({
      where,
      orderBy: [{ isPinned: 'desc' }, { useCount: 'desc' }, { sortOrder: 'asc' }],
    });

    // 코드 상세 정보 조인 (codeType별)
    const enriched = await Promise.all(codes.map(async (c) => {
      let codeDetail: Record<string, unknown> | null = null;
      if (c.codeType === 'MEDICATION_CODE') {
        codeDetail = await this.prisma.medicationCode.findUnique({
          where: { id: c.codeId },
          select: { code: true, nameKo: true, nameEn: true, dosageForm: true, unit: true },
        });
      } else {
        codeDetail = await this.prisma.procedureCode.findUnique({
          where: { id: c.codeId },
          select: { code: true, nameKo: true, category: true },
        });
      }
      return this.withDosageCheck(c, codeDetail);
    }));

    return { data: enriched };
  }

  async addCode(doctorId: string, dto: {
    category: string; codeId: string; codeType: string;
    displayName?: string; defaultDosage?: string; defaultFrequency?: string;
    defaultDuration?: number; defaultRoute?: string; isPinned?: boolean;
  }) {
    try {
      const code = await this.prisma.doctorCodeList.create({
        data: {
          doctorId,
          category: dto.category,
          codeId: dto.codeId,
          codeType: dto.codeType,
          displayName: dto.displayName ?? null,
          defaultDosage: dto.defaultDosage ?? null,
          defaultFrequency: dto.defaultFrequency ?? null,
          defaultDuration: dto.defaultDuration ?? null,
          defaultRoute: dto.defaultRoute ?? null,
          isPinned: dto.isPinned ?? false,
        },
      });
      return { data: code };
    } catch (e: unknown) {
      if (e instanceof Object && 'code' in e && e.code === 'P2002') throw new ConflictException('이미 등록된 코드입니다.');
      throw e;
    }
  }

  /**
   * 🔴 개인 약속처방은 **본인 것만** 손댈 수 있다 — 2026-08-14(W7).
   *
   * 종전에는 `id` 만으로 수정·삭제·사용집계가 가능했다. 같은 모듈의 **처방 세트는
   * `assertSetOwnership` 으로 막혀 있는데**(주석에 IDOR 방지라고 적혀 있다) 코드 쪽만
   * 빠져 있었다 — 보호가 반쪽이었다. 약속처방은 CPOE 처방 검색에 우선 노출되고
   * 용량·경로·기간을 프리필하므로, 타인 것을 바꾸면 **그 의사의 처방 기본값이 바뀐다**.
   *
   * 없는 것과 남의 것은 똑같이 404 로 답한다(존재 여부를 알려주지 않는다).
   */
  private async assertCodeOwnership(doctorId: string, id: string) {
    const code = await this.prisma.doctorCodeList.findFirst({
      where: { id, doctorId },
      select: { id: true },
    });
    if (!code) throw new NotFoundException('코드를 찾을 수 없습니다.');
  }

  async updateCode(doctorId: string, id: string, updates: Partial<{
    displayName: string; defaultDosage: string; defaultFrequency: string;
    defaultDuration: number; defaultRoute: string; sortOrder: number; isPinned: boolean;
  }>) {
    await this.assertCodeOwnership(doctorId, id);
    const updated = await this.prisma.doctorCodeList.update({ where: { id }, data: updates });
    return { data: updated };
  }

  async removeCode(doctorId: string, id: string) {
    await this.assertCodeOwnership(doctorId, id);
    await this.prisma.doctorCodeList.delete({ where: { id } });
    return { data: { deleted: true } };
  }

  async useCode(doctorId: string, id: string) {
    await this.assertCodeOwnership(doctorId, id);
    const updated = await this.prisma.doctorCodeList.update({
      where: { id },
      data: { useCount: { increment: 1 } },
    });
    return { data: updated };
  }

  async getStats(doctorId: string) {
    const topMeds = await this.prisma.doctorCodeList.findMany({
      where: { doctorId, category: 'MEDICATION' },
      orderBy: { useCount: 'desc' },
      take: 20,
    });
    const topLabs = await this.prisma.doctorCodeList.findMany({
      where: { doctorId, category: 'LAB' },
      orderBy: { useCount: 'desc' },
      take: 20,
    });
    return { data: { medications: topMeds, labs: topLabs } };
  }

  // ── 진료과 코드 카탈로그 ──

  async getCatalog(department: string, subcategory?: string, codeType?: string) {
    const where: Prisma.DepartmentCodeCatalogWhereInput = { departmentName: department, isActive: true };
    if (subcategory) where.subcategory = subcategory;
    if (codeType) where.codeType = codeType;

    const items = await this.prisma.departmentCodeCatalog.findMany({
      where,
      orderBy: [{ subcategory: 'asc' }, { sortOrder: 'asc' }],
    });

    // 코드 상세 조인
    const enriched = await Promise.all(items.map(async (c) => {
      let codeDetail: Record<string, unknown> | null = null;
      if (c.codeType === 'MEDICATION_CODE') {
        codeDetail = await this.prisma.medicationCode.findUnique({
          where: { id: c.codeId },
          select: { code: true, nameKo: true, nameEn: true, dosageForm: true, unitPrice: true },
        });
      } else {
        codeDetail = await this.prisma.procedureCode.findUnique({
          where: { id: c.codeId },
          select: { code: true, nameKo: true, category: true, unitPrice: true },
        });
      }
      return this.withDosageCheck(c, codeDetail);
    }));

    return { data: enriched };
  }

  async addCatalogItem(dto: {
    departmentName: string; subcategory?: string; codeId: string; codeType: string;
    defaultDosage?: string; defaultFrequency?: string; defaultDuration?: number;
    defaultRoute?: string; maxDosage?: string; guideNote?: string; createdBy: string;
  }) {
    try {
      const item = await this.prisma.departmentCodeCatalog.create({
        data: {
          departmentName: dto.departmentName,
          subcategory: dto.subcategory ?? null,
          codeId: dto.codeId,
          codeType: dto.codeType,
          defaultDosage: dto.defaultDosage ?? null,
          defaultFrequency: dto.defaultFrequency ?? null,
          defaultDuration: dto.defaultDuration ?? null,
          defaultRoute: dto.defaultRoute ?? null,
          maxDosage: dto.maxDosage ?? null,
          guideNote: dto.guideNote ?? null,
          createdBy: dto.createdBy,
        },
      });
      return { data: item };
    } catch (e: unknown) {
      if (e instanceof Object && 'code' in e && e.code === 'P2002') throw new ConflictException('이미 등록된 코드입니다.');
      throw e;
    }
  }

  async updateCatalogItem(id: string, updates: Prisma.DepartmentCodeCatalogUpdateInput) {
    const item = await this.prisma.departmentCodeCatalog.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('카탈로그 항목을 찾을 수 없습니다.');
    const updated = await this.prisma.departmentCodeCatalog.update({ where: { id }, data: updates });
    return { data: updated };
  }

  async removeCatalogItem(id: string) {
    const updated = await this.prisma.departmentCodeCatalog.update({
      where: { id },
      data: { isActive: false },
    }).catch(() => { throw new NotFoundException('카탈로그 항목을 찾을 수 없습니다.'); });
    return { data: updated };
  }

  /** 처방 코드 검색 — 우선순위 적용 (내 목록 > 과 카탈로그 > 전체) */
  async searchCodes(doctorId: string, department: string, query: string, type: 'MEDICATION' | 'LAB' | 'IMAGING' | 'DIET') {
    // q 생략(브라우즈) 정규화 — FE apiClient가 빈 문자열 파라미터를 생략하면 undefined로 들어와
    // contains: undefined가 되어 약품 검색이 빈 배열을 반환하던 버그 방지. ''는 전체 매치(둘러보기).
    query = query ?? '';
    const ismed = type === 'MEDICATION';
    const codeType = ismed ? 'MEDICATION_CODE' : 'PROCEDURE_CODE';

    // 1. 내 코드 목록
    const myCodes = await this.prisma.doctorCodeList.findMany({
      where: { doctorId, codeType },
      orderBy: [{ isPinned: 'desc' }, { useCount: 'desc' }],
      take: 50,
    });
    const myCodeIds = myCodes.map(c => c.codeId);

    // 2. 코드 검색 — 빈 질의(둘러보기)는 카테고리·이름순 100건(카테고리 그룹 표시용)
    const browsing = query.trim() === '';
    let allCodes: any[];
    if (ismed) {
      // 한/영 병용 P1(D2): 매칭은 공용 빌더(nameKo·nameEn·ingredient·code) — 처방 주경로도 영문 검색 동작.
      // 정렬은 브라우징(카테고리 그룹 표시)만 category 우선, 질의 검색은 정본 규약(nameKo asc).
      allCodes = await this.prisma.medicationCode.findMany({
        where: { isActive: true, ...buildMedicationSearchWhere(query) },
        orderBy: browsing ? [{ category: 'asc' }, { nameKo: 'asc' }] : MEDICATION_SEARCH_ORDER,
        take: browsing ? 100 : 30,
      });
    } else {
      // 탭별 EDI 코드 접두 필터 — HIRA 수가 16.6만 건은 category가 비어 있어 코드 체계로 구분.
      // 검사: B(검증)·C(병리)·D(검체)·E(기능)·F(기능) / 영상: G(촬영)·H(조영·CT·MRI·방사선)·EB(초음파)
      // 식이: 6(기본식사·치료식·경관영양) — 7은 행정 수수료 혼재라 제외
      const PREFIXES: Record<string, string[]> = {
        LAB: ['B', 'C', 'D', 'E', 'F'],
        IMAGING: ['G', 'H', 'EB'],
        DIET: ['6'],
      };
      const prefixes = PREFIXES[type];
      allCodes = await this.prisma.procedureCode.findMany({
        where: {
          isActive: true,
          AND: [
            {
              OR: [
                { nameKo: { contains: query, mode: 'insensitive' } },
                { code: { contains: query, mode: 'insensitive' } },
              ],
            },
            ...(prefixes ? [{ OR: prefixes.map((p) => ({ code: { startsWith: p } })) }] : []),
          ],
        },
        orderBy: { nameKo: 'asc' }, // 임의 순서 방지(가나다) — 브라우즈 탐색성
        take: browsing ? 100 : 30,
      });
    }

    // 3. 과 카탈로그 코드 ID
    const catalogItems = await this.prisma.departmentCodeCatalog.findMany({
      where: { departmentName: department, codeType, isActive: true },
      select: { codeId: true, defaultDosage: true, defaultFrequency: true, defaultRoute: true, guideNote: true },
    });
    const catalogMap = new Map(catalogItems.map(c => [c.codeId, c]));

    // 3.5 원내 처방집(포뮬러리) 승인 상태 — FORMULARY 계층(비승인은 최하위 정렬·FE 배지)
    const fmRows = await this.prisma.formularyItem.findMany({
      // domain 필터 — LAB/IMAGING/DIET는 동일 수가 마스터 공유라 교차 도메인 오배지 방지(탭 도메인 = type)
      where: { codeId: { in: allCodes.map((c) => c.id) }, domain: type, status: { not: 'REMOVED' } },
      select: { codeId: true, status: true },
    });
    const fmMap = new Map(fmRows.map((r) => [r.codeId as string, r.status]));

    // 4. 우선순위 정렬
    const myCodeMap = new Map(myCodes.map(c => [c.codeId, c]));
    const results = allCodes.map(code => {
      const myCode = myCodeMap.get(code.id);
      const catItem = catalogMap.get(code.id);
      /**
       * 🔴 프리필 값이 제형과 모순이면 **처방 입력 출발점부터 틀린다** — 검색 결과에 함께 실어
       *    화면이 경고할 수 있게 한다(주사제 PO·혈액제제 1T 실측).
       */
      const form = (code as { dosageForm?: string | null }).dosageForm ?? null;
      const prefill = myCode ?? catItem ?? null;
      const dosageIssues = prefill
        ? dosageRouteIssues({
            dosageForm: form,
            defaultRoute: (prefill as { defaultRoute?: string | null }).defaultRoute ?? null,
            defaultDosage: prefill.defaultDosage ?? null,
          })
        : [];
      return {
        ...code,
        source: myCode ? 'MY_LIST' : catItem ? 'DEPT_CATALOG' : 'ALL',
        myDefaults: myCode ? {
          dosage: myCode.defaultDosage,
          frequency: myCode.defaultFrequency,
          duration: myCode.defaultDuration,
          route: myCode.defaultRoute,
        } : null,
        deptGuide: catItem ?? null,
        dosageIssues,
        hasDosageIssue: dosageIssues.length > 0,
        formularyStatus: fmMap.get(code.id) ?? null, // ACTIVE=원내 승인 / SUSPENDED=중지 / null=비승인
        sortPriority: myCode?.isPinned ? 0 : myCode ? 1 : catItem ? 2 : fmMap.get(code.id) === 'ACTIVE' ? 3 : 4,
      };
    });

    results.sort((a, b) => a.sortPriority - b.sortPriority);
    return { data: results };
  }

  // ── 처방 세트 (DoctorPrescriptionSet) ──

  async getMySets(doctorId: string) {
    return this.prisma.doctorPrescriptionSet.findMany({
      where: { doctorId, isActive: true },
      orderBy: [{ useCount: 'desc' }, { sortOrder: 'asc' }],
    });
  }

  async createSet(doctorId: string, dto: {
    name: string;
    description?: string;
    category?: string;
    items: Array<{ codeId: string; codeType: string; name: string; dosage?: string; frequency?: string; duration?: number; route?: string }>;
  }) {
    return this.prisma.doctorPrescriptionSet.create({
      data: {
        doctorId,
        name: dto.name,
        description: dto.description,
        category: dto.category,
        items: dto.items as any,
      },
    });
  }

  async updateSet(doctorId: string, id: string, updates: { name?: string; description?: string; category?: string; items?: object[]; sortOrder?: number }) {
    await this.assertSetOwnership(doctorId, id);
    // 🔴 (B5) 읽는 필드만 옮긴다 — 종전 `...updates` 는 본문의 doctorId·useCount·isActive 까지 Prisma 로 보냈다
    return this.prisma.doctorPrescriptionSet.update({
      where: { id },
      data: {
        name: updates.name,
        description: updates.description,
        category: updates.category,
        sortOrder: updates.sortOrder,
        items: updates.items ? (updates.items as any) : undefined,
      },
    });
  }

  async deleteSet(doctorId: string, id: string) {
    await this.assertSetOwnership(doctorId, id);
    return this.prisma.doctorPrescriptionSet.update({
      where: { id },
      data: { isActive: false },
    });
  }

  /** 처방 세트 소유 검증 — 타 의사 세트 접근 시 404 (존재 여부 비노출, IDOR 방지) */
  private async assertSetOwnership(doctorId: string, id: string) {
    const set = await this.prisma.doctorPrescriptionSet.findFirst({
      where: { id, doctorId },
      select: { id: true },
    });
    if (!set) throw new NotFoundException('처방 세트를 찾을 수 없습니다');
  }

  async useSet(doctorId: string, id: string) {
    await this.assertSetOwnership(doctorId, id);
    return this.prisma.doctorPrescriptionSet.update({
      where: { id },
      data: { useCount: { increment: 1 } },
    });
  }

  async importFromCatalog(doctorId: string, department: string, codeIds: string[]) {
    const catalogItems = await this.prisma.departmentCodeCatalog.findMany({
      where: { departmentName: department, codeId: { in: codeIds }, isActive: true },
    });

    const results = [];
    for (const item of catalogItems) {
      try {
        const code = await this.prisma.doctorCodeList.create({
          data: {
            doctorId,
            category: item.codeType === 'MEDICATION_CODE' ? 'MEDICATION' : 'LAB',
            codeId: item.codeId,
            codeType: item.codeType,
            defaultDosage: item.defaultDosage,
            defaultFrequency: item.defaultFrequency,
            defaultDuration: item.defaultDuration,
            defaultRoute: item.defaultRoute,
          },
        });
        results.push(code);
      } catch {
        // Skip duplicates
      }
    }
    return results;
  }
}
