import { Injectable, BadRequestException, ForbiddenException, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { gateMode, GateMode } from '../../common/gate-mode';
import { recordGateViolation } from '../../common/gate-violation-record';

/**
 * 원내 처방집(포뮬러리) 시행 게이트 — 순수 서비스(Prisma·ConfigRuntime만 의존, 모듈 순환 차단용).
 * 처방 발행 경로(prescription create·copy·repeat)가 이 서비스를 주입해 발행 직전 위원회 승인 여부를 확인한다.
 * PreAuthGateService(사전승인)와 동일 패턴 — 정책은 SystemConfig `formulary.enforce` 영역별 맵.
 *
 * 🔴 W8-R2 F1(2026-08-14) — 종전에는 이 게이트의 유일한 집행이 **FE 한 화면**
 *   (`app/(main)/patients/[id]/encounter/new/page.tsx`)의 4영역뿐이었다.
 *   서버(prescription.service create/copy/repeat)에는 검사가 0건이라 모바일·워크스테이션·
 *   API 직접 호출은 전부 통과했는데, 관리 화면은 "시행 게이트 BLOCK/WARN"이라 말하고 있었다.
 *   집행은 서버가 한다 — FE 확인창은 UX 보조일 뿐이다.
 *
 * 🔴 W8-R2 F2 — 게이트 3상 해석을 로컬 함수(`v==='WARN'||v==='BLOCK' ? v : 'OFF'`)로 두어
 *   오타·미상값이 조용히 OFF(=무통제)로 떨어졌다. 저장소 정본은 `common/gate-mode.ts` 의
 *   `gateMode()`(미지값=BLOCK·fail-closed) 하나다. 여기서는 그것만 쓴다.
 *   맵형 게이트라 **부재(키 없음)=OFF**(등록 기본), **존재하는 미지값=BLOCK**.
 */

export const FORMULARY_DOMAINS = ['MEDICATION', 'LAB', 'IMAGING', 'THERAPY', 'DIET', 'ACTIVITY', 'NURSING'] as const;
export type FormularyDomain = (typeof FORMULARY_DOMAINS)[number];

/** SystemConfig 키 = 관제(/admin/safety-gates)·go-live(gate.formulary.enforce)·거버넌스 매핑과 동일 문자열 */
export const FORMULARY_GATE_KEY = 'formulary.enforce';

/** 영역 → 마스터 코드 타입(프리셋 영역은 PRESET) — 등재(FormularyItem.codeType) 정본 */
export const FORMULARY_CODE_TYPE: Record<FormularyDomain, string> = {
  MEDICATION: 'MEDICATION_CODE',
  LAB: 'PROCEDURE_CODE',
  IMAGING: 'PROCEDURE_CODE',
  DIET: 'PROCEDURE_CODE',
  THERAPY: 'PRESET',
  ACTIVITY: 'PRESET',
  NURSING: 'NURSING_CODE',
};

/**
 * 🔴 W8-R2 F3 — 영역별로 **처방 레코드에서 무엇을 대조 키로 쓸 수 있는가**.
 * `null` = prescriptions 테이블에 그 영역의 조인 키 컬럼이 아예 없어서 발행 경로에서 대조가 불가능하다.
 *  - THERAPY·ACTIVITY: 등재는 presetKey(프리셋 문자열)인데 처방은 `instructions` 자유기재로만 남는다.
 *  - NURSING: 등재는 nursingCodeId 인데 prescriptions 에 nursingCodeId 컬럼이 없다.
 * 이 세 영역은 모드를 WARN/BLOCK 으로 올려도 **막히는 것이 없다**. 화면이 그 사실을 말해야 한다
 * (관리 /admin/formulary 는 `enforcement()` 를 읽어 '집행점 없음'을 표기한다).
 */
export const FORMULARY_ORDER_KEY: Record<FormularyDomain, 'medicationCodeId' | 'procedureCodeId' | null> = {
  MEDICATION: 'medicationCodeId',
  LAB: 'procedureCodeId',
  IMAGING: 'procedureCodeId',
  DIET: 'procedureCodeId',
  THERAPY: null,
  ACTIVITY: null,
  NURSING: null,
};

/** 집행점이 없는 영역의 사유(화면 표기 문구) — 없으면 집행됨 */
export const FORMULARY_UNENFORCEABLE_REASON: Partial<Record<FormularyDomain, string>> = {
  THERAPY: '등재는 프리셋 키인데 처방은 자유기재로 저장됩니다(prescriptions 에 presetKey 컬럼 없음) — 발행 경로에서 대조 불가',
  ACTIVITY: '등재는 프리셋 키인데 처방은 자유기재로 저장됩니다(prescriptions 에 presetKey 컬럼 없음) — 발행 경로에서 대조 불가',
  NURSING: '등재는 간호코드(nursingCodeId)인데 prescriptions 에 해당 컬럼이 없습니다 — 발행 경로에서 대조 불가',
};

/**
 * 아직 이 게이트를 부르지 않는 **처방 발행 경로**(실측 grep: `prisma.prescription.create`).
 * "서버 집행됨"이라고만 쓰면 화면이 실제보다 안전해 보이므로 남은 구멍을 같이 말한다.
 *
 * 🔴 **2026-08-14 전량 봉합 — 지금은 비어 있다.**
 *    처음 이 목록을 만들 때는 `pre-order.service.ts`(사전 오더 승인 발행)와
 *    `remote-consultation.service.ts`(비대면 처방)가 Prisma 로 직접 처방을 만들어 게이트를 우회했다.
 *    같은 날 두 경로 모두 정본 `assertOrderAllowed` 를 부르도록 배선했고,
 *    `test/formulary/formulary-gate.bypass-paths.spec.ts` 의 **구조 가드**가
 *    `prescription.create` 를 쓰는 모든 파일이 게이트를 import 하는지 검사해 새 우회를 차단한다.
 *
 * 🔴 목록을 비우는 것도 정직화의 일부다 — **화면이 실제보다 덜 안전하게 말하는 것도 사실이 아니다.**
 *    (`workstation.service.ts` 는 THERAPY 만 만들며 그 영역은 애초에 집행 불가(위 F3) → 여기가 아니라
 *     `FORMULARY_UNENFORCEABLE` 이 사유를 말한다. 포털·개발 데모 생성기는 발행 경로가 아니다.)
 * ⚠️ 새 발행 경로를 만들고 게이트를 못 붙였다면 **여기에 적을 것**. 비어 있음 = 전 경로 배선됨.
 */
export const FORMULARY_UNWIRED_PATHS: Partial<Record<FormularyDomain, string[]>> = {};

export type FormularyGateOutcome =
  | 'SKIPPED'        // 포뮬러리 영역이 아닌 처방 타입
  | 'UNENFORCEABLE'  // 집행점 부재(F3) — 모드와 무관하게 막지 않는다
  | 'UNCHECKED'      // 코드 없는 자유기재 오더 — 승인 여부 '판정 불가'(0건/준수 아님)
  | 'APPROVED'       // 위원회 승인(ACTIVE)
  | 'OFF'            // 미승인이지만 게이트 OFF — 통과(승격 판단용 기록만)
  | 'WARN'           // 미승인 — 통과하되 위반 기록
  | 'BLOCK';         // 미승인 — 차단(예외를 던지므로 반환되지 않음)

export interface FormularyGateResult {
  outcome: FormularyGateOutcome;
  domain?: FormularyDomain;
  mode?: GateMode;
  itemStatus?: string | null; // ACTIVE | SUSPENDED | null(미등재)
}

@Injectable()
export class FormularyGateService {
  private readonly logger = new Logger(FormularyGateService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly config?: ConfigRuntimeService,
  ) {}

  /** 저장된 원값(맵) — ConfigRuntime 정본 경유, 미주입 시 SystemConfig 직접 */
  private async rawPolicy(): Promise<Record<string, unknown>> {
    const raw = this.config
      // 🔴 조회 실패를 삼키면 `{}` → 7영역 전부 OFF. 아래 주석이 "미지값은 fail-closed BLOCK"이라
      //    적어둔 규칙을 **실패 경로가 어기고 있었다.** 키 부재(null)와 조회 실패는 다른 사실이다.
      ? await this.config.get(FORMULARY_GATE_KEY)
      : (await this.prisma.systemConfig.findUnique({ where: { key: FORMULARY_GATE_KEY } }))?.value;
    return (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  }

  /**
   * 영역별 시행 모드 — 정본 `gateMode()` 만 사용(F2).
   * 키 부재 = OFF(맵형 게이트 등록 기본) · 존재하는 미지값(오타·'BLOCKED'·'차단') = **BLOCK**(fail-closed).
   */
  async getPolicy(): Promise<Record<FormularyDomain, GateMode>> {
    const raw = await this.rawPolicy();
    const out = {} as Record<FormularyDomain, GateMode>;
    for (const d of FORMULARY_DOMAINS) out[d] = gateMode(raw[d], 'OFF');
    return out;
  }

  async setPolicy(userId: string, patch: Record<string, string>): Promise<Record<FormularyDomain, GateMode>> {
    const current = await this.getPolicy();
    for (const [d, v] of Object.entries(patch ?? {})) {
      if (!(FORMULARY_DOMAINS as readonly string[]).includes(d)) throw new BadRequestException(`잘못된 영역: ${d}`);
      if (!['OFF', 'WARN', 'BLOCK'].includes(v)) throw new BadRequestException(`잘못된 모드: ${v}`);
      current[d as FormularyDomain] = v as GateMode;
    }
    if (this.config) {
      await this.config.set(FORMULARY_GATE_KEY, current, userId);
    } else {
      await this.prisma.systemConfig.upsert({
        where: { key: FORMULARY_GATE_KEY },
        update: { value: current, updatedBy: userId },
        create: { key: FORMULARY_GATE_KEY, value: current, category: 'formulary', label: '원내 처방집 시행 모드(영역별 OFF/WARN/BLOCK)', updatedBy: userId },
      });
    }
    return current;
  }

  /**
   * 영역별 **실제 집행 여부** — 화면이 "적용 중"이라고 말해도 되는지의 근거(F3·P17).
   * enforced=false 인 영역은 모드를 올려도 서버가 막지 않는다.
   */
  async enforcement(): Promise<Record<FormularyDomain, {
    mode: GateMode; enforced: boolean; enforcedAt: string[]; notEnforcedAt: string[]; reason: string | null; codeType: string; rawValue: unknown;
  }>> {
    const raw = await this.rawPolicy();
    const policy = await this.getPolicy();
    const out = {} as Awaited<ReturnType<FormularyGateService['enforcement']>>;
    for (const d of FORMULARY_DOMAINS) {
      const enforced = FORMULARY_ORDER_KEY[d] !== null;
      out[d] = {
        mode: policy[d],
        enforced,
        // 서버 집행점 — 처방 서비스 발행 3경로 공유(prescription.service). FE 확인창은 보조.
        enforcedAt: enforced ? ['처방 서비스 발행(create · copy · repeat)'] : [],
        // 아직 게이트를 부르지 않는 발행 경로 — 집행됨(true)이어도 여기가 비어야 '전부'다
        notEnforcedAt: enforced ? FORMULARY_UNWIRED_PATHS[d] ?? [] : [],
        reason: enforced ? null : FORMULARY_UNENFORCEABLE_REASON[d] ?? '집행점 없음',
        codeType: FORMULARY_CODE_TYPE[d],
        rawValue: raw[d] ?? null,
      };
    }
    return out;
  }

  /** 위반/판정불가 기록 — 정본 GateViolationLog(관제 /admin/safety-gates). tx 밖 best-effort(차단 롤백에도 보존). */
  private record(severity: string, message: string, refId?: string | null) {
    // 🔴 기록 실패를 삼키지 않는다(정본 `common/gate-violation-record`) — 유실되면 관제가 "위반 0"으로 그린다
    void recordGateViolation(this.prisma, this.logger, {
      gateKey: FORMULARY_GATE_KEY, severity, message, refType: 'ENCOUNTER', refId: refId ?? undefined,
    });
  }

  /** 차단/경고 메시지용 코드 표기 — 미승인 경로에서만 1회 조회 */
  private async codeLabel(domain: FormularyDomain, codeId: string): Promise<string> {
    try {
      const row =
        FORMULARY_ORDER_KEY[domain] === 'medicationCodeId'
          ? await this.prisma.medicationCode.findUnique({ where: { id: codeId }, select: { code: true, nameKo: true } })
          : await this.prisma.procedureCode.findUnique({ where: { id: codeId }, select: { code: true, nameKo: true } });
      return row ? `${row.nameKo}(${row.code})` : codeId;
    } catch {
      return codeId;
    }
  }

  /**
   * 처방 발행 게이트 — 발행 직전 위원회 승인 여부 확인(create·copy·repeat 공유 choke point).
   * - OFF(기본): 통과. 미승인이면 승격 판단용으로만 기록.
   * - WARN: **막지 않되 기록**(GateViolationLog severity=WARN).
   * - BLOCK: 미승인 시 ForbiddenException(FORMULARY_NOT_APPROVED) — 등재 요청으로 유도.
   * - 코드 없는 오더/집행점 없는 영역: **막지 않고 '판정 불가'로 기록**(모르는 것을 준수로 세지 않는다).
   */
  /**
   * 코드 묶음의 처방집 상태(읽기 전용 · 2026-10-21 임상 규칙 P4 A8) — 세트 편집기가 저장 전에 보이려고 쓴다.
   * 🔴 판정 규칙은 `assertOrderAllowed` 와 같다(같은 영역·같은 코드·REMOVED 제외·가장 최근 행) — 편집기와 처방 게이트가 다르게 말하지 않게.
   */
  async statusOf(domain: FormularyDomain, codeIds: string[]) {
    const mode = (await this.getPolicy())[domain];
    const ids = [...new Set(codeIds)];
    const rows = ids.length
      ? await this.prisma.formularyItem.findMany({ where: { domain, codeId: { in: ids }, status: { not: 'REMOVED' } }, select: { codeId: true, status: true }, orderBy: { createdAt: 'desc' } })
      : [];
    const latest = new Map<string, string>();
    for (const r of rows) if (r.codeId && !latest.has(r.codeId)) latest.set(r.codeId, r.status);
    const statuses: Record<string, 'LISTED' | 'SUSPENDED' | 'NOT_LISTED'> = {};
    for (const id of ids) { const st = latest.get(id); statuses[id] = st === 'ACTIVE' ? 'LISTED' : st === 'SUSPENDED' ? 'SUSPENDED' : 'NOT_LISTED'; }
    return { domain, mode, enforceable: FORMULARY_ORDER_KEY[domain] !== null, statuses };
  }

  async assertOrderAllowed(
    item: { type: string; medicationCodeId?: string | null; procedureCodeId?: string | null },
    ctx: { encounterId?: string | null; path: 'CREATE' | 'COPY' | 'REPEAT' },
  ): Promise<FormularyGateResult> {
    if (!(FORMULARY_DOMAINS as readonly string[]).includes(item.type)) return { outcome: 'SKIPPED' };
    const domain = item.type as FormularyDomain;
    const mode = (await this.getPolicy())[domain];
    const tag = `[${ctx.path}/${domain}]`;

    const orderKey = FORMULARY_ORDER_KEY[domain];
    if (orderKey === null) {
      // 모드가 켜져 있는데 집행할 수단이 없다 — 침묵하면 화면이 "적용 중"이라고 거짓말한다(F3)
      if (mode !== 'OFF') this.record('UNCHECKED', `${tag} 게이트 ${mode} 이지만 집행점 없음 — ${FORMULARY_UNENFORCEABLE_REASON[domain] ?? ''}`, ctx.encounterId);
      return { outcome: 'UNENFORCEABLE', domain, mode };
    }

    const codeId = item[orderKey];
    if (!codeId) {
      // 코드 없는 자유기재 오더 — 승인 여부를 '알 수 없다'. 준수(0건)로 세지 않는다.
      if (mode !== 'OFF') this.record('UNCHECKED', `${tag} 코드 없는 자유기재 오더 — 원내 처방집 대조 불가(판정 불가)`, ctx.encounterId);
      return { outcome: 'UNCHECKED', domain, mode };
    }

    const entry = await this.prisma.formularyItem.findFirst({
      where: { domain, codeId, status: { not: 'REMOVED' } },
      select: { status: true },
      orderBy: { createdAt: 'desc' },
    });
    if (entry?.status === 'ACTIVE') return { outcome: 'APPROVED', domain, mode, itemStatus: 'ACTIVE' };

    const itemStatus = entry?.status ?? null;
    const label = await this.codeLabel(domain, codeId);
    const why = itemStatus === 'SUSPENDED' ? '위원회 사용중지(SUSPENDED)' : '원내 처방집 미등재';
    const summary = `${tag} ${why}: ${label}`;

    if (mode === 'OFF') {
      this.record('OFF', summary, ctx.encounterId);
      return { outcome: 'OFF', domain, mode, itemStatus };
    }
    if (mode === 'WARN') {
      this.record('WARN', summary, ctx.encounterId);
      this.logger.warn(`포뮬러리 게이트 WARN 통과 — ${summary}`);
      return { outcome: 'WARN', domain, mode, itemStatus };
    }
    this.record('BLOCK', summary, ctx.encounterId);
    throw new ForbiddenException({
      code: 'FORMULARY_NOT_APPROVED',
      message: `원내 처방집 ${why} 항목입니다: ${label} — 처방집 등재 요청(위원회 심의) 후 발행할 수 있습니다.`,
      domain,
      codeId,
      itemStatus,
    });
  }
}
