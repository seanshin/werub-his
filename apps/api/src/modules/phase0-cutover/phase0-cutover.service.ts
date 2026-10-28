import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';

/**
 * 재식별위험 검토 체크리스트 — 법무·CPO가 확인해야 승인 가능(전 항목 true 필수).
 * 🔴 mappingVerified 항목에는 "873/873·md5" 라는 **검증 결과가 이미 적혀 있었다**. 그런데 대사표 테이블도,
 *    그 수를 세는 쿼리도 시스템에 없다(환자 원장은 그 사이 874가 됐다). 법무·CPO 가 "시스템이 대사해 보니
 *    전건 일치" 로 읽고 서명하는 문구였다 — 시스템이 검증하지 않은 것을 검증했다고 적지 않는다.
 *    시스템이 셀 수 있는 것(환자 원장 행 수)만 실측해 참고값으로 보여주고, 양측 일치는 승인자가 외부에서 확인한다.
 */
export const CUTOVER_CHECKLIST = [
  { key: 'mappingVerified', label: '대사표(chartNo↔patientRef) 양측 이관·검증 일치 확인 — ⚠️시스템 자동 대사 없음(승인자가 외부 대사 결과·건수·해시를 확인하고 근거를 사유란에 기재)' },
  { key: 'keyCustody', label: '가명화 키 관리 주체·회전 절차(런북) 계약 확정' },
  { key: 'reidentRisk', label: '재식별 위험 평가 — patientRef 단독으로 개인 식별 불가(HMAC 16hex·역산 불가) 확인' },
  { key: 'erpTierBound', label: 'ERP 수신부(chartNo 소비) PHI-bound·원내 배치 확인' },
  { key: 'legalReview', label: '개인정보보호법상 가명처리 적정성 — 병원 법무/CPO 검토 완료' },
  { key: 'rollbackPlan', label: '롤백 절차(게이트 OFF 복귀·1초 무재시작) 및 병행 대사 확인' },
] as const;

export interface CutoverApproval {
  approvedBy?: string;
  approvedByName?: string;
  approvedAt?: string;
  reason?: string;
  checklist?: Record<string, boolean>;
  executedAt?: string;
  executedBy?: string;
}

@Injectable()
export class Phase0CutoverService {
  private readonly logger = new Logger(Phase0CutoverService.name);
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigRuntimeService) {}

  private async approval(): Promise<CutoverApproval> {
    // 🔴 (2026-10-01 .catch 비리터럴 판정) 종전 `.catch(() => ({}))` — 조회 실패가 "승인 없음"이 되어 관리 화면이 장애를 "법무 승인 대기"로 말했다.
    //    실행 경로는 어차피 승인이 있어야 진행되므로, 전파해도 덜 안전해지지 않는다(실패 = 실행 안 함 · 화면은 오류).
    const raw = await this.config.get('integration.cutoverApproval');
    return (raw && typeof raw === 'object' ? raw : {}) as CutoverApproval;
  }

  /**
   * 대사(reconciliation) 실측 — 시스템이 **실제로 셀 수 있는 것만** 센다.
   * 대사표(chartNo↔patientRef 매핑 원장)는 존재하지 않으므로 자동 일치 판정은 불가능하다.
   * 환자 원장 행 수는 대사 대상 건수의 기준값이므로 실측해 보여준다(고정 숫자를 문구에 박지 않는다).
   */
  private async reconciliation() {
    // 실측 실패는 null(모름)로 — 숫자를 지어내지도, 화면을 죽이지도 않는다
    let patientCount: number | null = null;
    try { patientCount = await this.prisma.patient.count(); } catch { patientCount = null; }
    return {
      autoVerifiable: false,
      patientCount,
      capturedAt: new Date().toISOString(),
      note: patientCount === null
        ? '환자 원장 건수 실측 실패 — 대사 기준값을 확인할 수 없습니다.'
        : `시스템에는 대사표(chartNo↔patientRef)가 없어 양측 일치를 자동 검증할 수 없습니다. 현재 환자 원장 ${patientCount}건이 대사 대상 기준값이며, 상대 시스템과의 일치 여부는 승인자가 외부에서 확인해 사유란에 근거를 남겨야 합니다.`,
    };
  }

  /** 현황 — 기술 준비·승인·게이트 상태 종합(관리 화면) */
  async status() {
    const [gateOn, keySet, appr, reconcile] = await Promise.all([
      // (2026-10-01) 종전 `.catch(() => false)`·`.catch(() => '')` — 조회 실패가 "게이트 꺼짐·키 미설정"으로 보였다. 전파한다
      this.config.get('integration.pseudonymizeChartNo'),
      this.config.get('integration.pseudonymKey'),
      this.approval(),
      this.reconciliation(),
    ]);
    const approved = !!appr.approvedAt && CUTOVER_CHECKLIST.every((c) => appr.checklist?.[c.key] === true);
    return {
      checklist: CUTOVER_CHECKLIST,
      reconcile, // 🔴 자동 검증되지 않는다는 사실 자체를 화면에 노출(체크박스가 검증으로 읽히지 않게)
      technicalReady: { pseudonymKeySet: !!keySet, gateEnabled: String(gateOn) === 'true' },
      approval: appr,
      approved,
      executed: !!appr.executedAt,
      canExecute: approved && !appr.executedAt && String(gateOn) !== 'true',
    };
  }

  /** 승인 기록 — 체크리스트 전항 확인 필수. 승인권자·사유·항목 저장(감사) */
  async approve(userId: string, userName: string, dto: { reason?: string; checklist?: Record<string, boolean> }) {
    // 승인 원장에는 정본 체크리스트 키의 확인 여부만 남긴다 — 본문 객체를 통째로 저장하면 임의 키·값이 승인 기록에 섞인다(B10)
    const checklist: Record<string, boolean> = Object.fromEntries(CUTOVER_CHECKLIST.map((c) => [c.key, dto.checklist?.[c.key] === true]));
    const missing = CUTOVER_CHECKLIST.filter((c) => checklist[c.key] !== true);
    if (missing.length) throw new BadRequestException(`체크리스트 미확인: ${missing.map((m) => m.label).join(' / ')}`);
    if (!dto.reason?.trim()) throw new BadRequestException('승인 근거(사유)는 필수입니다');
    const rec: CutoverApproval = {
      approvedBy: userId, approvedByName: userName, approvedAt: new Date().toISOString(),
      reason: dto.reason.trim(), checklist,
    };
    await this.config.set('integration.cutoverApproval', rec as never);
    await this.audit(userId, 'CUTOVER_APPROVE', { reason: rec.reason });
    this.logger.log(`Phase0 컷오버 승인 기록: ${userName}`);
    return { approved: true, approvedAt: rec.approvedAt };
  }

  /** 승인 철회 — 실행 전만(플립 되돌림은 별도) */
  async revoke(userId: string) {
    const appr = await this.approval();
    if (appr.executedAt) throw new BadRequestException('이미 실행된 승인은 철회할 수 없습니다(게이트 OFF로 롤백하세요)');
    await this.config.set('integration.cutoverApproval', {} as never);
    await this.audit(userId, 'CUTOVER_REVOKE', {});
    return { revoked: true };
  }

  /** 컷오버 실행 — 승인 게이팅 통과 시에만 pseudonymizeChartNo 플립(법무 승인 없이 플립 차단) */
  async execute(userId: string) {
    const st = await this.status();
    if (!st.approved) throw new BadRequestException('법무 승인이 완료되지 않았습니다(체크리스트 전항 확인+승인 필요)');
    if (st.executed) throw new BadRequestException('이미 실행되었습니다');
    if (!st.technicalReady.pseudonymKeySet) throw new BadRequestException('가명화 키 미설정 — 실행 불가');
    const appr = await this.approval();
    // 직무분리(4-eyes) — 승인자와 실행자 분리(MRN egress 전환은 2인 통제). 단일 관리자 환경은 config로 완화
    const requireSoD = String((await this.config.get('integration.cutoverRequireSeparation').catch(() => 'true')) ?? 'true') !== 'false';
    if (requireSoD && appr.approvedBy === userId) {
      throw new BadRequestException('승인자와 다른 관리자가 실행해야 합니다(직무분리 — integration.cutoverRequireSeparation)');
    }
    await this.config.set('integration.pseudonymizeChartNo', true as never);
    await this.config.set('integration.cutoverApproval', { ...appr, executedAt: new Date().toISOString(), executedBy: userId } as never);
    await this.audit(userId, 'CUTOVER_EXECUTE', { flipped: 'pseudonymizeChartNo=true' });
    this.logger.warn(`🔴 Phase0 컷오버 실행 — 가명화 게이트 ON(chartNo→patientRef). ERP에 실측 통지 필요`);
    return { executed: true, gate: 'pseudonymizeChartNo=true' };
  }

  /** 롤백 — 게이트 OFF 복귀(1초·무재시작). 실행 후 문제 시 */
  async rollback(userId: string) {
    await this.config.set('integration.pseudonymizeChartNo', false as never);
    const appr = await this.approval();
    await this.config.set('integration.cutoverApproval', { ...appr, executedAt: undefined, executedBy: undefined } as never);
    await this.audit(userId, 'CUTOVER_ROLLBACK', { flipped: 'pseudonymizeChartNo=false' });
    this.logger.warn(`Phase0 컷오버 롤백 — 가명화 게이트 OFF`);
    return { rolledBack: true };
  }

  private async audit(userId: string, action: string, meta: object) {
    await this.prisma.auditLog.create({
      data: { userId, action: 'UPDATE', resourceType: `PHASE0_${action}`, resourceId: userId, changes: meta as never },
    }).catch(() => undefined);
  }
}
