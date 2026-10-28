import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ConsentType, Prisma } from '@prisma/client';

/**
 * LIS 참조(read-only) 서비스 — LIS가 hub(HIS)를 통해 조직 게이트 결재·수혈 동의를 조회.
 * 정본은 HIS(EAS 결재·ConsentForm). LIS는 상태 참조만(변조 불가).
 */
@Injectable()
export class LisReferenceService {
  constructor(private readonly prisma: PrismaService) {}

  /** 조직 게이트 결재 참조 — gateKey(`{refModule}:{refId}` 또는 refId)로 EApprovalRelay 조회. */
  async getGateApproval(gateKey?: string) {
    if (!gateKey) throw new BadRequestException('gateKey가 필요합니다');
    // '{refModule}:{refId}' 형식이면 분리(refId에 ':' 없다고 가정하지 않도록 첫 ':'만 분리)
    const sep = gateKey.indexOf(':');
    const where = sep > 0
      ? { refModule: gateKey.slice(0, sep), refId: gateKey.slice(sep + 1) }
      : { refId: gateKey };
    const relay = await this.prisma.eApprovalRelay.findFirst({ where, orderBy: { createdAt: 'desc' } });
    if (!relay) return { gateKey, found: false };
    const line = (relay.approvalLine as Array<Record<string, unknown>> | null) ?? [];
    return {
      gateKey, found: true,
      docNumber: relay.id, // 결재문서번호
      docType: relay.docType,
      title: relay.title,
      status: relay.status,
      result: relay.result,
      decidedAt: relay.decidedAt,
      refModule: relay.refModule, refId: relay.refId,
      approvers: line.map((a) => ({ order: a.order, staffId: a.staffId, result: a.result, actedAt: a.actedAt })),
    };
  }

  /** 수혈 동의 참조(FHIR Consent 매핑) — 환자·범주(기본 TRANSFUSION) 최신 동의. PHI 최소(본문 미노출). */
  async getConsent(patientId?: string, category = 'TRANSFUSION') {
    if (!patientId) throw new BadRequestException('patientId가 필요합니다');
    // MRN 폴백(LIS v1.4.12 요청) — uuid 형식이 아니면 MRN으로 해소. 대상토큰은 전달 식별자
    // 그대로 결속되므로(assertTargetAuth가 문자열 비교) MRN 서명 토큰도 S-3 보호 유지.
    let pid = patientId;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(patientId)) {
      const p = await this.prisma.patient.findUnique({ where: { mrn: patientId }, select: { id: true } });
      if (!p) return { resourceType: 'Consent', found: false, patient: { reference: `Patient/${patientId}` }, _derivedState: 'none' };
      pid = p.id;
    }
    const c = await this.prisma.consentForm.findFirst({
      where: { patientId: pid, consentType: category as ConsentType },
      orderBy: { createdAt: 'desc' },
    });
    if (!c) return { resourceType: 'Consent', found: false, patient: { reference: `Patient/${patientId}` }, _derivedState: 'none' };
    const now = Date.now();
    const expired = !!c.expiresAt && c.expiresAt.getTime() < now;
    const withdrawn = c.status === 'REVOKED' || !c.isValid;
    const active = !withdrawn && !expired && (c.status === 'SIGNED' || !!c.signedAt);
    const state = withdrawn ? 'withdrawn' : expired ? 'expired' : active ? 'active' : 'pending';
    return {
      resourceType: 'Consent',
      found: true,
      id: c.id,
      status: state === 'active' ? 'active' : 'inactive',
      _derivedState: state, // active | expired | withdrawn | pending
      category: [{ coding: [{ code: category }] }],
      patient: { reference: `Patient/${patientId}` },
      dateTime: c.signedAt ?? c.patientSignedAt ?? null,
      provision: { period: { end: c.expiresAt ?? null } },
      _revokedAt: c.revokedAt ?? null,
      _supersededBy: c.supersededBy ?? null,
    };
  }

  /**
   * H1: 검사코드 전체 카탈로그 — LIS 코드 매핑 유실 근절.
   * 정본: ProcedureCode(수가·temporal 최신판만) + LabTestCode를 edi_code로 그룹핑한 1:N 패널.
   * ?since=ISO 로 증분(코드 updatedAt 기준). received-code-trust 정책과 병행: 이 카탈로그가 사전 매핑 소스.
   *
   * 🔴 (2026-10-01) 증분이 **패널 변경을 싣지 못했다** — `since` 는 수가 코드(ProcedureCode.updatedAt)만 보았고, 패널 항목(LabTestCode)엔
   *    `updatedAt` 이 없었다. 결과 항목을 패널에 추가·수정·비활성해도 부모 코드가 다시 나가지 않아 **LIS 는 옛 패널을 계속 썼다**.
   *    이제 증분은 ① 코드 자체가 바뀐 것 + ② 패널 항목이 바뀐(비활성 포함) 코드를 함께 싣는다 — 실린 코드의 `panel` 은 **현재 전체**(교체용).
   *    ③ 수가 코드가 비활성된 것은 `deactivated` 로 따로 말한다(종전엔 활성만 실어 비활성 사실이 LIS 에 가지 않았다 — 추가 필드).
   *    한계: 결과 항목이 다른 패널로 **옮겨지면** 새 패널만 실린다(옛 소속은 이력이 없어 모른다) — 전체 동기화(since 없이)가 정본.
   */
  async getLabCodeCatalog(since?: string, page = 1, limit = 5000) {
    const now = new Date();
    const sinceDate = since ? new Date(since) : null;
    if (since && (sinceDate === null || isNaN(sinceDate.getTime()))) {
      throw new BadRequestException('since는 ISO 8601 형식이어야 합니다');
    }
    const take = Math.min(Math.max(limit, 1), 20000);
    const skip = (Math.max(page, 1) - 1) * take;

    // 검사 오더 코드 범위: HIRA 검사료 챕터 EDI 접두사 B/C/D(진단검사·유전자검사 등)
    // + 시드 카테고리(검사료/기초검사/수혈검사) + LOINC 매핑 보유(대량 임포트분 category NULL 실측 보정)
    const labScope: Prisma.ProcedureCodeWhereInput = {
      OR: [
        { code: { startsWith: 'B' } }, { code: { startsWith: 'C' } }, { code: { startsWith: 'D' } },
        { category: { in: ['검사료', '기초검사', '수혈검사'] } },
        { loincCode: { not: null } },
      ],
    };
    const where = {
      isActive: true,
      validFrom: { lte: now },
      OR: [{ validTo: null }, { validTo: { gte: now } }],
      AND: [labScope],
    } as Prisma.ProcedureCodeWhereInput;
    // 증분: 코드가 바뀌었거나, 그 코드의 패널 항목이 바뀌었거나(비활성 포함)
    let panelChangedCodes: string[] = [];
    if (sinceDate) {
      const changed = await this.prisma.labTestCode.findMany({
        where: { updatedAt: { gte: sinceDate }, ediCode: { not: null } },
        select: { ediCode: true },
        distinct: ['ediCode'],
      });
      panelChangedCodes = changed.map((r) => r.ediCode as string);
      (where.AND as Prisma.ProcedureCodeWhereInput[]).push({
        OR: [{ updatedAt: { gte: sinceDate } }, ...(panelChangedCodes.length ? [{ code: { in: panelChangedCodes } }] : [])],
      });
    }

    const [codes, totalCodes] = await Promise.all([
      this.prisma.procedureCode.findMany({
        where,
        // temporal 이력: DISTINCT ON(code) + validFrom desc → 코드당 최신 유효판 1건
        distinct: ['code'],
        orderBy: [{ code: 'asc' }, { validFrom: 'desc' }],
        skip, take,
        select: { code: true, nameKo: true, loincCode: true, category: true, updatedAt: true, validFrom: true },
      }),
      this.prisma.procedureCode.findMany({ where, distinct: ['code'], select: { code: true } }).then((r) => r.length),
    ]);
    const latest = new Map<string, (typeof codes)[number]>();
    for (const c of codes) if (!latest.has(c.code)) latest.set(c.code, c);

    // 1:N 패널 — 결과항목 마스터(LabTestCode)를 edi_code로 그룹핑(코드공간 확정 규격 v3.54)
    const panelRows = await this.prisma.labTestCode.findMany({
      where: { isActive: true, ediCode: { not: null } },
      select: { code: true, nameKo: true, nameEn: true, loincCode: true, specimen: true, unit: true, ediCode: true },
      orderBy: { code: 'asc' },
    });
    /**
     * 🔴 (2026-10-01) 결과 항목은 있는데 카탈로그에 실리지 않는 패널 — 실리지 않는다고 **말한다**(자르면 잘랐다고).
     *    운영 실측 25 패널 중 18: 11 은 처방 코드 행이 없고, 7 은 실제 수가 마스터에서 **다른 행위**(예: 일반혈액 결과 항목이 '심전도검사'
     *    코드에 붙음 — 시드가 만든 EDI 코드가 06-10 수가 마스터 반입으로 실코드에 덮였다)라 검사 범위 밖이다.
     *    범위를 "결과 항목이 붙은 코드"로 넓히면 LIS 가 '심전도검사 = CBC 패널'을 받는다 — 넓히지 않는다. 올바른 EDI 매핑은 코드 마스터 검수(사람).
     */
    const panelCodes = [...new Set(panelRows.map((r) => r.ediCode as string))];
    const [existingRows, inScopeRows] = panelCodes.length
      ? await Promise.all([
          this.prisma.procedureCode.findMany({ where: { code: { in: panelCodes }, isActive: true }, distinct: ['code'], select: { code: true } }),
          this.prisma.procedureCode.findMany({
            where: { code: { in: panelCodes }, isActive: true, validFrom: { lte: now }, OR: [{ validTo: null }, { validTo: { gte: now } }], AND: [labScope] },
            distinct: ['code'], select: { code: true },
          }),
        ])
      : [[], []];
    const existing = new Set(existingRows.map((r) => r.code));
    const inScope = new Set(inScopeRows.map((r) => r.code));
    const panelsOutOfCatalog = {
      missingProcedureCode: panelCodes.filter((c) => !existing.has(c)).sort(),
      outOfScope: panelCodes.filter((c) => existing.has(c) && !inScope.has(c)).sort(),
    };
    const panelMap = new Map<string, typeof panelRows>();
    for (const r of panelRows) {
      const k = r.ediCode as string;
      if (!panelMap.has(k)) panelMap.set(k, []);
      panelMap.get(k)!.push(r);
    }

    const items = [...latest.values()].map((c) => ({
      code: c.code, // = edi_code(처방코드) — LIS 매핑 키
      nameKo: c.nameKo,
      loincCode: c.loincCode,
      category: c.category,
      meta: { lastUpdated: c.updatedAt.toISOString() },
      panel: (panelMap.get(c.code) ?? []).map((r) => ({
        resultItemCode: r.code, nameKo: r.nameKo, nameEn: r.nameEn,
        loincCode: r.loincCode, specimen: r.specimen, unit: r.unit,
      })),
    }));

    // 증분에서만 — 기간 안에 비활성된 수가 코드(지금 활성판이 하나도 없는 것만 · 시점 이력의 옛 판 비활성은 제외)
    const deactivated = sinceDate
      ? await this.prisma.procedureCode.findMany({
          where: { isActive: false, updatedAt: { gte: sinceDate }, AND: [labScope] },
          distinct: ['code'], select: { code: true }, orderBy: { code: 'asc' },
        }).then(async (rows) => {
          const codes = rows.map((r) => r.code);
          if (!codes.length) return [];
          const stillActive = await this.prisma.procedureCode.findMany({ where: { code: { in: codes }, isActive: true }, distinct: ['code'], select: { code: true } });
          const active = new Set(stillActive.map((r) => r.code));
          return codes.filter((c) => !active.has(c));
        })
      : null;

    return {
      generatedAt: now.toISOString(),
      since: sinceDate?.toISOString() ?? null,
      /** 증분에서 패널 항목 변경 때문에 실린 코드 수(코드 자체 변경과 겹칠 수 있다) */
      ...(sinceDate ? { panelChangedCodes: panelChangedCodes.length, deactivated } : {}),
      page, limit: take,
      total: totalCodes, // 조건 전체(distinct code) — 페이지 순회 기준
      count: items.length,
      panelSource: 'lab_test_codes.edi_code', // 1:N 패널 정본(별도 패널 테이블 없음)
      /** 결과 항목은 있으나 이 카탈로그에 실리지 않는 패널 코드 — 처방 코드 없음 / 검사 범위 밖(다른 행위 코드) */
      panelsOutOfCatalog,
      items,
    };
  }
}
