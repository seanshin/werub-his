import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { settingValueInvalidReason } from '@hospital-run/shared';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { AuditService } from '../audit/audit.service';
import { NotificationService } from '../notification/notification.service';
import { FormularyService } from '../formulary/formulary.service';
import { ReferenceRangeService } from '../reference-range/reference-range.service';
import { CdssService } from '../cdss/cdss.service';
import { TriageService } from '../triage/triage.service';
import { CodeMasterService } from '../code-master/code-master.service';
import { DutyScheduleService } from '../duty-schedule/duty-schedule.service';
import { DurRulesRepo } from '../prescription/dur/dur-rules.repo';
import { ConsentTemplateService } from '../consent-template/consent-template.service';
import { ChartTemplateService } from '../chart-template/chart-template.service';
import { AccessControlService } from '../access-control/access-control.service';
import { FeatureAccessService } from '../access-control/feature-access.service';
import { ProtocolService } from '../protocol/protocol.service';
import { ClinicalPathwayService } from '../clinical-pathway/clinical-pathway.service';
import { OrderSetService } from '../order-set/order-set.service';
import { RetentionService } from '../retention/retention.service';
import { NursingService } from '../nursing/nursing.service';
import { QualityService } from '../quality/quality.service';
import { ENACTABLE_KINDS, AUTO_ENACT_KINDS } from '../../common/enactment-kinds';

/**
 * 거버넌스 집행 엔진 P1→P3 (2026-08-04) — 기획 D2·D6·D8·D11·D15.
 *
 * 원칙:
 *  - 엔진은 **배선함**: 임의 코드 실행 없이 기존 정본 서비스 메서드만 호출(D2)
 *  - 개방 kind 9종: MANUAL·CONFIG_CHANGE·GATE_MODE + (P3) FORMULARY·MASTER_DATA·TEMPLATE·ACCESS·PUBLISH·RETENTION
 *  - 의결 시점 + 집행 시점 이중 검증 — 잘못된 바인딩이 대장에 박히기 전에 거른다
 *  - 집행 전 snapshotBefore 기록 — **자동 롤백 없음**(D8·복원은 REVOKE 의결로)
 *  - 비멱등 정본(toggle류)은 바인딩 금지 — 집행은 항상 **목표 상태 지정**(재시도 안전)
 *  - RETENTION 은 정책 등록만 — **파기 실행은 바인딩 제외**(기존 4-eyes 경로 존중)
 *  - 실패는 FAILED+error+간사 알림(탐지≠상신 분리 불가) — 조용히 넘어가지 않는다
 *  - 게이트: config `governance.enactment.enabled`(기본 false) — OFF 면 크론 무동작·수동 집행 거부
 *  - 크론 집행(행위 주체 없음)은 enactedBy=null·도메인 updatedBy/decidedBy 도 비운다(주체 날조 금지) —
 *    귀속은 AuditLog 의 decisionNo 와 committee 필드가 진다
 */

/** 보호 키 — config-runtime.controller 와 동일 선언(전용 승인 워크플로 전용) */
const PROTECTED_KEYS = new Set<string>(['integration.pseudonymizeChartNo', 'integration.cutoverApproval']);

// 🔴 어휘 정본은 `common/enactment-kinds.ts` — 결정 등록부도 같은 것을 쓴다(순환 회피).
//    여기서 다시 export 하는 것은 기존 소비처(import 경로)를 깨지 않기 위해서다.
export { ENACTABLE_KINDS, AUTO_ENACT_KINDS } from '../../common/enactment-kinds';

const FORMULARY_DOMAINS = ['MEDICATION', 'LAB', 'IMAGING', 'THERAPY', 'DIET', 'ACTIVITY', 'NURSING'];
const TRI_MODES = ['OFF', 'WARN', 'BLOCK'];

/** MASTER_DATA 서브바인딩 등록제(D11) — 여기 없는 마스터는 의결 시점에 거부 */
const MASTER_BINDINGS: Record<string, { ops: string[]; model: string }> = {
  'reference-range': { ops: ['create', 'update', 'deactivate'], model: 'referenceRange' },
  'cdss-rule': { ops: ['create', 'update', 'deactivate'], model: 'cdssRule' },
  'triage-rule': { ops: ['create', 'update', 'deactivate'], model: 'triageRule' },
  'medication-code': { ops: ['create', 'update', 'deactivate'], model: 'medicationCode' },
  'staffing-rule': { ops: ['upsert', 'delete'], model: 'dutyStaffingRule' },
  'dur-rules': { ops: ['create', 'update', 'delete'], model: 'durRule' },
  'nursing-checklist': { ops: ['upsert'], model: 'nursingChecklistTemplate' }, // §7 P2 — code 키 upsert 전용
  // 2026-10-07 질 지표 원장 — CPOE 지표 등록·목표 변경은 위원회(질향상·환자안전) 의결로만(화면이 직접 정하지 않는다)
  'quality-indicator': { ops: ['create', 'update'], model: 'qualityIndicator' },
};

/** 질 지표 원장 허용 필드 — create 는 정의 전부 · update 는 판정에 쓰는 값만(이름·분류·산식은 바꾸지 않는다 — 바꾸면 다른 지표다) */
const QI_CREATE_FIELDS = new Set(['name', 'category', 'formula', 'targetValue', 'direction', 'unit', 'valueScale']);
const QI_UPDATE_FIELDS = new Set(['targetValue', 'direction', 'unit', 'valueScale']);
const QI_DIRECTIONS = ['LOWER_IS_BETTER', 'HIGHER_IS_BETTER'];

/** 약품마스터 허용 필드 — UpdateMedicationInput 의 인덱스 시그니처로 임의 필드가 흘러드는 것 차단 */
const MEDICATION_FIELDS = new Set([
  'nameKo', 'nameEn', 'ingredient', 'manufacturer', 'dosageForm', 'unit', 'unitPrice', 'insuranceCode',
  'controlSchedule', 'narcoticType', 'psychotropicGroup', 'maxSingleDose', 'maxDailyDose', 'isActive',
]);

/**
 * 표면 키 산출 — 역추적(provenance)·⚖배지가 액션을 표면에 귀속시키는 단일 규칙.
 * CONFIG/GATE 는 하위호환(배지 소비처가 bare 키)으로 bare, 신규 kind 는 네임스페이스 프리픽스.
 */
export function surfaceKeyOf(kind: string, target: Record<string, unknown>): string | null {
  switch (kind) {
    case 'CONFIG_CHANGE': return target.key ? String(target.key) : null;
    case 'GATE_MODE': return target.gateKey ? String(target.gateKey) : null;
    case 'FORMULARY': return `formulary:${String(target.domain ?? 'request')}`;
    case 'MASTER_DATA': return target.master ? `master:${String(target.master)}` : null;
    case 'TEMPLATE': return target.templateType ? `template:${String(target.templateType).toLowerCase()}` : null;
    case 'ACCESS': return target.scope ? `access:${String(target.scope)}:${String(target.key ?? '')}` : null;
    case 'PUBLISH': return target.docType ? `publish:${String(target.docType).toLowerCase()}:${String(target.id ?? '')}` : null;
    case 'RETENTION': return target.resourceType ? `retention:${String(target.resourceType)}` : null;
    default: return null;
  }
}

@Injectable()
export class GovernanceEnactmentService {
  private readonly logger = new Logger(GovernanceEnactmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigRuntimeService,
    @Optional() private readonly audit?: AuditService,
    @Optional() private readonly notifications?: NotificationService,
    @Optional() private readonly formulary?: FormularyService,
    @Optional() private readonly referenceRange?: ReferenceRangeService,
    @Optional() private readonly cdss?: CdssService,
    @Optional() private readonly triage?: TriageService,
    @Optional() private readonly codeMaster?: CodeMasterService,
    @Optional() private readonly duty?: DutyScheduleService,
    @Optional() private readonly durRules?: DurRulesRepo,
    @Optional() private readonly consentTemplate?: ConsentTemplateService,
    @Optional() private readonly chartTemplate?: ChartTemplateService,
    @Optional() private readonly accessControl?: AccessControlService,
    @Optional() private readonly featureAccess?: FeatureAccessService,
    @Optional() private readonly protocol?: ProtocolService,
    @Optional() private readonly pathway?: ClinicalPathwayService,
    @Optional() private readonly orderSet?: OrderSetService,
    @Optional() private readonly retention?: RetentionService,
    @Optional() private readonly nursing?: NursingService,
    @Optional() private readonly quality?: QualityService,
  ) {}

  /** kind 별 집행 서비스 배선 여부 — 의결 시점에 미배선 바인딩을 거른다(조용한 no-op 방지) */
  private wiredService(kind: string, target: Record<string, unknown>): { ok: boolean; missing?: string } {
    const need = (svc: unknown, name: string) => (svc ? { ok: true } : { ok: false, missing: name });
    switch (kind) {
      case 'FORMULARY': return need(this.formulary, 'FormularyService');
      case 'MASTER_DATA': {
        const master = String(target.master ?? '');
        const map: Record<string, [unknown, string]> = {
          'reference-range': [this.referenceRange, 'ReferenceRangeService'],
          'cdss-rule': [this.cdss, 'CdssService'],
          'triage-rule': [this.triage, 'TriageService'],
          'medication-code': [this.codeMaster, 'CodeMasterService'],
          'staffing-rule': [this.duty, 'DutyScheduleService'],
          'dur-rules': [this.durRules, 'DurRulesRepo'],
          'nursing-checklist': [this.nursing, 'NursingService'],
          'quality-indicator': [this.quality, 'QualityService'],
        };
        const hit = map[master];
        return hit ? need(hit[0], hit[1]) : { ok: true };
      }
      case 'TEMPLATE':
        return String(target.templateType) === 'CONSENT' ? need(this.consentTemplate, 'ConsentTemplateService') : need(this.chartTemplate, 'ChartTemplateService');
      case 'ACCESS':
        return String(target.scope) === 'feature' ? need(this.featureAccess, 'FeatureAccessService') : need(this.accessControl, 'AccessControlService');
      case 'PUBLISH': {
        const map: Record<string, [unknown, string]> = {
          PROTOCOL: [this.protocol, 'ProtocolService'],
          PATHWAY: [this.pathway, 'ClinicalPathwayService'],
          ORDER_SET: [this.orderSet, 'OrderSetService'],
        };
        const hit = map[String(target.docType ?? '')];
        return hit ? need(hit[0], hit[1]) : { ok: true };
      }
      case 'RETENTION': return need(this.retention, 'RetentionService');
      default: return { ok: true };
    }
  }

  /** 의결 시점 액션 검증 — 잘못된 바인딩이 대장에 박히기 전에 거른다(집행 시점에도 재검증) */
  validateAction(kind: string, target: Record<string, unknown>) {
    if (!ENACTABLE_KINDS.has(kind)) {
      throw new BadRequestException({ code: 'ACTION_KIND_NOT_OPEN', message: `집행 kind '${kind}' 는 아직 개방되지 않았습니다(개방: ${[...ENACTABLE_KINDS].join('·')})` });
    }
    if (kind === 'MANUAL') return;

    const bad = (msg: string, code = 'INVALID_BINDING') => new BadRequestException({ code, message: `${kind}: ${msg}` });

    if (kind === 'CONFIG_CHANGE' || kind === 'GATE_MODE') {
      const key = kind === 'CONFIG_CHANGE' ? String(target.key ?? '') : String(target.gateKey ?? '');
      const value = kind === 'CONFIG_CHANGE' ? target.newValue : target.mode;
      if (!key) throw bad('대상 키가 필요합니다');
      if (value === undefined) throw bad('적용 값이 필요합니다');
      if (PROTECTED_KEYS.has(key)) {
        throw new BadRequestException({ code: 'PROTECTED_KEY', message: `'${key}' 는 전용 승인 워크플로 전용 — 거버넌스 집행 바인딩 불가` });
      }
      if (!this.config.hasDefault(key)) {
        throw new BadRequestException({ code: 'KEY_NOT_IN_CATALOG', message: `'${key}' 는 DEFAULTS 카탈로그에 없습니다 — 등재 후 바인딩하세요(드리프트 방지)` });
      }
      // 값 규칙이 있는 설정은 의결 시점에 거른다 — 기능이 모르는 값을 "반영됨"으로 집행하지 않는다(범용 설정 저장과 같은 규칙)
      if (kind === 'CONFIG_CHANGE' && settingValueInvalidReason(key, value)) {
        throw new BadRequestException({ code: 'CONFIG_VALUE_INVALID', message: '이 설정이 받는 값이 아닙니다', details: { key, reason: settingValueInvalidReason(key, value) } });
      }
      if (kind === 'GATE_MODE') {
        // D15 — Map형 게이트 부분 키 집행: {gateKey, mapKey, mode}. mapKey 있으면 mode 는 3상만
        if (target.mapKey !== undefined && (typeof target.mapKey !== 'string' || !target.mapKey)) throw bad('mapKey 는 비어있지 않은 문자열이어야 합니다');
        const allowed = target.mapKey ? TRI_MODES : [...TRI_MODES, true, false, 'true', 'false'];
        if (!allowed.includes(value as never)) throw bad(`값은 ${target.mapKey ? 'OFF/WARN/BLOCK' : 'OFF/WARN/BLOCK 또는 boolean'} 이어야 합니다`);
      }
      return;
    }

    // ── P3 신규 kind — 구조 검증 + 배선 검증 ──
    const wired = this.wiredService(kind, target);
    if (!wired.ok) {
      throw new BadRequestException({ code: 'BINDING_NOT_WIRED', message: `${kind}: 집행 서비스 미배선(${wired.missing}) — GldModule imports 확인` });
    }

    if (kind === 'FORMULARY') {
      const op = String(target.op ?? '');
      if (op === 'toggle') throw bad(`toggle 은 비멱등이라 바인딩 금지 — op:'setStatus' 로 목표 상태를 지정하세요`, 'NON_IDEMPOTENT_OP');
      if (op === 'add') {
        if (!FORMULARY_DOMAINS.includes(String(target.domain))) throw bad(`domain 은 ${FORMULARY_DOMAINS.join('/')} 중 하나여야 합니다`);
        if (!Array.isArray(target.items) || !target.items.length) throw bad('items 배열(codeId/presetKey)이 필요합니다');
      } else if (op === 'setStatus') {
        if (!target.id) throw bad('id(포뮬러리 항목)가 필요합니다');
        if (!['ACTIVE', 'SUSPENDED', 'REMOVED'].includes(String(target.status))) throw bad('status 는 ACTIVE/SUSPENDED/REMOVED 여야 합니다');
      } else if (op === 'decide') {
        if (!target.requestId) throw bad('requestId(등재 요청)가 필요합니다');
        if (typeof target.approve !== 'boolean') throw bad('approve(boolean)가 필요합니다');
      } else {
        throw bad(`op 는 add/setStatus/decide 중 하나여야 합니다(받음: '${op}')`);
      }
      return;
    }

    if (kind === 'MASTER_DATA') {
      const master = String(target.master ?? '');
      const binding = MASTER_BINDINGS[master];
      if (!binding) throw bad(`등재되지 않은 마스터 '${master}' — 서브바인딩 등록제(허용: ${Object.keys(MASTER_BINDINGS).join('/')})`, 'MASTER_NOT_REGISTERED');
      const op = String(target.op ?? '');
      if (!binding.ops.includes(op)) throw bad(`'${master}' 의 op 는 ${binding.ops.join('/')} 중 하나여야 합니다(받음: '${op}')`);
      if (['update', 'deactivate', 'delete'].includes(op) && !target.id) throw bad('id 가 필요합니다');
      if (master === 'nursing-checklist' && (!target.code || typeof target.code !== 'string')) throw bad('code(템플릿 코드)가 필요합니다');
      if (['create', 'update', 'upsert'].includes(op)) {
        if (!target.payload || typeof target.payload !== 'object' || Array.isArray(target.payload)) throw bad('payload(객체)가 필요합니다');
        if (master === 'medication-code') {
          const strange = Object.keys(target.payload as object).filter((k) => !MEDICATION_FIELDS.has(k));
          if (strange.length) throw bad(`약품마스터 허용 밖 필드: ${strange.join(', ')}`, 'FIELD_NOT_ALLOWED');
        }
        if (master === 'quality-indicator') {
          const p = target.payload as Record<string, unknown>;
          const allowed = op === 'create' ? QI_CREATE_FIELDS : QI_UPDATE_FIELDS;
          const strange = Object.keys(p).filter((k) => !allowed.has(k));
          if (strange.length) throw new BadRequestException({ code: 'FIELD_NOT_ALLOWED', message: 'MASTER_DATA: 질 지표 허용 밖 필드', fields: strange });
          if (op === 'create') {
            for (const k of ['name', 'category', 'formula']) {
              if (typeof p[k] !== 'string' || !(p[k] as string).trim()) throw new BadRequestException({ code: 'INVALID_BINDING', message: 'MASTER_DATA: 질 지표 필수 문자열 누락', field: k });
            }
          }
          if ('targetValue' in p || op === 'create') {
            const t = p.targetValue;
            // 저장 컬럼 Decimal(5,2) — 한도 밖은 의결 시점에 거른다(집행 때 500 으로 터지지 않게)
            if (typeof t !== 'number' || !Number.isFinite(t) || t < 0 || t > 999.99) throw new BadRequestException({ code: 'INVALID_BINDING', message: 'MASTER_DATA: 목표값은 0~999.99 숫자여야 합니다', field: 'targetValue' });
          }
          if (p.direction != null && !QI_DIRECTIONS.includes(String(p.direction))) throw new BadRequestException({ code: 'INVALID_BINDING', message: 'MASTER_DATA: 방향은 LOWER_IS_BETTER/HIGHER_IS_BETTER', field: 'direction' });
          if (p.valueScale != null && !(Number.isInteger(p.valueScale) && (p.valueScale as number) >= 1)) throw new BadRequestException({ code: 'INVALID_BINDING', message: 'MASTER_DATA: 배율은 1 이상 정수', field: 'valueScale' });
        }
      }
      return;
    }

    if (kind === 'TEMPLATE') {
      const tt = String(target.templateType ?? '');
      if (!['CONSENT', 'CHART'].includes(tt)) throw bad('templateType 은 CONSENT/CHART 여야 합니다');
      if (!target.id) throw bad('id(템플릿)가 필요합니다');
      const op = String(target.op ?? '');
      if (op === 'toggle') throw bad(`toggle 은 비멱등이라 바인딩 금지 — op:'setActive'+active 로 목표 상태를 지정하세요`, 'NON_IDEMPOTENT_OP');
      if (tt === 'CONSENT') {
        if (!['setActive', 'restore'].includes(op)) throw bad(`CONSENT op 는 setActive/restore 여야 합니다(받음: '${op}')`);
        if (op === 'setActive' && typeof target.active !== 'boolean') throw bad('setActive 는 active(boolean)가 필요합니다');
      } else {
        if (!['rollback', 'deactivate'].includes(op)) throw bad(`CHART op 는 rollback/deactivate 여야 합니다(받음: '${op}')`);
        if (op === 'rollback' && !target.versionId) throw bad('rollback 은 versionId 가 필요합니다');
      }
      return;
    }

    if (kind === 'ACCESS') {
      const scope = String(target.scope ?? '');
      if (!['feature', 'role-data', 'dept', 'pacs'].includes(scope)) throw bad('scope 는 feature/role-data/dept/pacs 여야 합니다');
      if (!target.key || typeof target.key !== 'string') throw bad('key(대상 기능/역할/부서)가 필요합니다');
      if (scope === 'dept') {
        if (!Array.isArray(target.value) || (target.value as unknown[]).some((p) => typeof p !== 'string')) throw bad('dept 의 value 는 경로 문자열 배열이어야 합니다');
      } else if (!target.value || typeof target.value !== 'object' || Array.isArray(target.value)) {
        throw bad(`${scope} 의 value 는 권한 객체여야 합니다`);
      }
      return;
    }

    if (kind === 'PUBLISH') {
      const dt = String(target.docType ?? '');
      if (!['PROTOCOL', 'PATHWAY', 'ORDER_SET'].includes(dt)) throw bad('docType 은 PROTOCOL/PATHWAY/ORDER_SET 여야 합니다');
      if (!target.id) throw bad('id 가 필요합니다');
      const op = String(target.op ?? '');
      if (dt === 'PROTOCOL') {
        // 프로토콜 정본에는 retire 단독 경로가 없다(publish 가 동일 code 의 기존 ACTIVE 를 RETIRED 로 대체)
        if (op !== 'publish') throw bad(`PROTOCOL op 는 publish 만 가능합니다 — 은퇴는 후속판 publish 로(정본 경로 부재)`);
      } else if (!['publish', 'retire'].includes(op)) {
        throw bad(`${dt} op 는 publish/retire 여야 합니다(받음: '${op}')`);
      }
      return;
    }

    if (kind === 'RETENTION') {
      if (!target.resourceType || typeof target.resourceType !== 'string') throw bad('resourceType 이 필요합니다');
      const days = Number(target.retentionDays);
      if (!Number.isFinite(days) || days < 0) throw bad('retentionDays 는 0 이상 숫자여야 합니다');
      if (target.action !== undefined && !['REPORT_ONLY', 'SOFT_DELETE', 'ANONYMIZE', 'HARD_PURGE'].includes(String(target.action))) {
        throw bad('action 은 REPORT_ONLY/SOFT_DELETE/ANONYMIZE/HARD_PURGE 여야 합니다');
      }
      // 파기 실행은 바인딩 제외(D2) — 정책 등록 외 어떤 op 도 받지 않는다
      if (target.op !== undefined || target.purge !== undefined) {
        throw new BadRequestException({ code: 'PURGE_NOT_BINDABLE', message: 'RETENTION: 파기 실행은 거버넌스 바인딩 대상이 아닙니다 — 기존 4-eyes 경로(3중 안전장치)만 유효' });
      }
      return;
    }
  }

  /** DEFAULTS 등재 여부 프록시 — 헬스체크(D13)용 */
  hasDefaultKey(key: string): boolean { return this.config.hasDefault(key); }

  /**
   * 🔴 (2026-09-17 L2) 조회 실패를 **"꺼져 있다"** 로 번역하지 않는다.
   *    종전 `.catch(() => false)` 는 DB 실패를 설정 상태로 바꿔, 수동 [지금 집행] 이
   *    "자동 집행이 비활성 상태입니다(governance.enactment.enabled)" 라고 **설정을 단정**했다.
   *    `config.get()` 은 미설정 키에 `null` 을 돌려주므로(=여기서 false) 이 catch 는 실패만 삼켰다.
   */
  private async enabled(): Promise<boolean> {
    const v = await this.config.get('governance.enactment.enabled');
    return v === true || v === 'true';
  }

  /** 매 10분 — effectiveFrom 도래한 RESOLVED 결정의 PENDING 자동 집행분 */
  @Cron('0 */10 * * * *', { name: 'governance-enactment', timeZone: 'Asia/Seoul' })
  async cron() {
    // 스위치를 못 읽으면 이번 주기는 건너뛴다 — 다만 **조용히** 건너뛰지 않는다(꺼짐과 확인 불가는 다른 사실)
    let on: boolean;
    try {
      on = await this.enabled();
    } catch (e) {
      this.logger.error(`집행 스위치(governance.enactment.enabled) 조회 실패 — 이번 주기 건너뜀: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    if (!on) return;
    const due = await this.prisma.committeeDecision.findMany({
      where: {
        status: { in: ['RESOLVED', 'PARTIALLY_ENACTED'] },
        OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: new Date() } }],
        actions: { some: { status: 'PENDING', kind: { in: AUTO_ENACT_KINDS } } },
      },
      select: { id: true, decisionNo: true },
      take: 20,
    });
    for (const d of due) {
      await this.enactDecision(d.id, null).catch((e) =>
        this.logger.warn(`집행 실패 ${d.decisionNo}: ${e instanceof Error ? e.message : e}`));
    }

    /**
     * 🔴 결정 등록부 출처의 미집행분(2026-08-27).
     *    허가권자 결정은 기록 시점에 즉시 집행되지만, **그때 게이트가 꺼져 있었으면**
     *    액션이 `PENDING` 으로 남는다 — 크론이 집어가지 않으면 그대로 영원히 남는다
     *    ("기록됐고 반영은 보류 중"이 영구 상태가 된다).
     *    🔴 `PENDING` 만 본다 — `FAILED` 를 자동 재시도하면 같은 실패를 조용히 반복한다.
     */
    const pendingRows = await this.prisma.decisionAction.findMany({
      where: { registryKey: { not: null }, status: 'PENDING', kind: { in: AUTO_ENACT_KINDS } },
      select: { registryKey: true },
      take: 200,
    });
    for (const key of [...new Set(pendingRows.map((r) => r.registryKey).filter((k): k is string => !!k))].slice(0, 20)) {
      await this.enactRegistryDecision(key, null).catch((e) =>
        this.logger.warn(`등록부 집행 실패 ${key}: ${e instanceof Error ? e.message : e}`));
    }
  }

  /**
   * 결정 단위 집행 — 수동 [지금 집행](userId)과 크론(null)이 같은 경로(D6).
   * MANUAL 은 건드리지 않는다(간사 이행 확인 전용).
   */
  async enactDecision(decisionId: string, userId: string | null) {
    if (!(await this.enabled())) {
      throw new BadRequestException({ code: 'ENACTMENT_OFF', message: '자동 집행이 비활성 상태입니다(governance.enactment.enabled)' });
    }
    const decision = await this.prisma.committeeDecision.findUnique({
      where: { id: decisionId },
      include: { actions: true, committee: { select: { code: true } } },
    });
    if (!decision) throw new NotFoundException('결정이 없습니다');
    if (!['RESOLVED', 'PARTIALLY_ENACTED'].includes(decision.status)) {
      throw new BadRequestException(`집행 대상 상태가 아닙니다(${decision.status})`);
    }
    if (decision.effectiveFrom && decision.effectiveFrom > new Date()) {
      throw new BadRequestException({ code: 'NOT_EFFECTIVE_YET', message: `시행일 전입니다(${decision.effectiveFrom.toISOString()})` });
    }

    let enacted = 0, failed = 0;
    for (const action of decision.actions) {
      const r = await this.runAction(action, {
        label: decision.decisionNo,
        committeeCode: decision.committee?.code ?? null,
        userId,
        auditResourceId: decision.id,
        auditFallbackUserId: decision.committeeId,
        notifyRefId: decision.id,
        notifyRefType: 'GOVERNANCE_DECISION',
      });
      if (r === 'ENACTED') enacted++;
      else if (r === 'FAILED') failed++;
    }

    // 상태 승격 — 남은 미결(PENDING/SKIPPED)과 실패 여부로
    const remaining = await this.prisma.decisionAction.count({ where: { decisionId, status: { in: ['PENDING', 'SKIPPED'] } } });
    const anyFailed = await this.prisma.decisionAction.count({ where: { decisionId, status: 'FAILED' } });
    const next = remaining === 0 && anyFailed === 0 ? 'ENACTED' : (enacted > 0 || anyFailed > 0) ? 'PARTIALLY_ENACTED' : decision.status;
    if (next !== decision.status) {
      await this.prisma.committeeDecision.update({ where: { id: decisionId }, data: { status: next } });
    }
    this.logger.log(`집행 ${decision.decisionNo}: 성공 ${enacted}·실패 ${failed}·잔여 ${remaining}`);
    return { decisionNo: decision.decisionNo, enacted, failed, remaining, status: next };
  }

  /**
   * 🔴 **액션 하나를 집행한다 — 위원회 경로와 등록부 경로가 같은 코드를 지난다.**
   *
   *    2026-08-27 에 결정 등록부(허가권자 결정)를 이 엔진에 붙이면서 뽑아냈다.
   *    복제하지 않은 이유는 단순하다 — 복제하면 한쪽에만 스냅샷이 빠지거나
   *    한쪽만 `FAILED` 를 안 남기게 되고, 그 차이는 **아무도 모르는 채로 오래 산다.**
   *    (이 저장소에서 반복된 유형: 정본이 둘이면 갈라진다)
   */
  private async runAction(
    action: { id: string; kind: string; status: string; target: unknown },
    ctx: {
      label: string;                    // 로그·알림에 쓰는 이름(결정번호 또는 등록부 키)
      committeeCode: string | null;
      userId: string | null;
      auditResourceId: string;
      auditFallbackUserId: string;
      notifyRefId: string;
      notifyRefType: string;
    },
  ): Promise<'ENACTED' | 'FAILED' | 'SKIP'> {
    if (action.status !== 'PENDING' || !AUTO_ENACT_KINDS.includes(action.kind)) return 'SKIP';
    const target = (action.target ?? {}) as Record<string, unknown>;
    try {
      this.validateAction(action.kind, target);
      const snapshotBefore = await this.executeAction(action.kind, target, {
        decisionNo: ctx.label, committeeCode: ctx.committeeCode, userId: ctx.userId,
      });
      await this.prisma.decisionAction.update({
        where: { id: action.id },
        data: { status: 'ENACTED', enactedAt: new Date(), enactedBy: ctx.userId, snapshotBefore: (snapshotBefore ?? { note: '집행 전 상태 없음(신규)' }) as never },
      });
      await this.audit?.log({
        action: 'UPDATE', resourceType: 'GovernanceEnactment', resourceId: ctx.auditResourceId,
        userId: ctx.userId ?? ctx.auditFallbackUserId,
        changes: { enactment: { old: snapshotBefore ?? null, new: { kind: action.kind, target, decisionNo: ctx.label } } },
      }).catch(() => undefined);
      return 'ENACTED';
    } catch (e) {
      const reason = (e instanceof Error ? e.message : String(e)).slice(0, 500);
      await this.prisma.decisionAction.update({ where: { id: action.id }, data: { status: 'FAILED', error: reason } }).catch(() => undefined);
      // 간사 알림 — ADMIN 전원(활성)에게
      try {
        const admins = await this.prisma.user.findMany({ where: { role: 'ADMIN', isActive: true }, select: { id: true }, take: 5 });
        for (const a of admins) {
          await this.notifications?.notify(a.id, {
            type: 'GOVERNANCE_ENACT_FAILED', severity: 'WARNING',
            title: `거버넌스 집행 실패 — ${ctx.label}`,
            message: reason, refType: ctx.notifyRefType, refId: ctx.notifyRefId,
          });
        }
      } catch { /* 알림 실패는 집행 상태에 영향 없음 */ }
      return 'FAILED';
    }
  }

  /**
   * 🔴 액션 원장의 **불변식** — `decisionId` 와 `registryKey` 중 정확히 하나.
   *    Prisma 가 CHECK 제약을 표현하지 못해 여기서 강제한다.
   *    둘 다 비면 그 액션은 **어느 결정에서 왔는지 알 수 없고**,
   *    둘 다 차면 **두 결정이 같은 집행을 주장한다.**
   */
  static assertSingleSource(src: { decisionId?: string | null; registryKey?: string | null }) {
    const has = [!!src.decisionId, !!src.registryKey].filter(Boolean).length;
    if (has !== 1) {
      throw new BadRequestException({
        code: 'ACTION_SOURCE_INVALID',
        message: `집행 액션의 출처는 위원회 결정(decisionId) 또는 결정 등록부(registryKey) 중 정확히 하나여야 합니다(지금 ${has}개)`,
      });
    }
  }

  /**
   * 결정 등록부(허가권자·코드변경) 집행 — 위원회 경로와 **같은 `runAction`** 을 지난다.
   *
   * 🔴 위원회 결정을 만들지 않는다. 만들면 원장이 "위원회가 의결했다"고 말하게 된다.
   * 🔴 상태 승격도 하지 않는다 — 승격시킬 위원회 결정이 없다.
   *    등록부 쪽 이행 상태는 **액션 상태 자체**가 정본이다.
   */
  async enactRegistryDecision(registryKey: string, userId: string | null) {
    if (!(await this.enabled())) {
      throw new BadRequestException({ code: 'ENACTMENT_OFF', message: '자동 집행이 비활성 상태입니다(governance.enactment.enabled)' });
    }
    const actions = await this.prisma.decisionAction.findMany({
      where: { registryKey, status: 'PENDING' },
      select: { id: true, kind: true, status: true, target: true },
    });
    let enacted = 0, failed = 0;
    for (const action of actions) {
      const r = await this.runAction(action, {
        label: `결정등록부:${registryKey}`,
        committeeCode: null,
        userId,
        auditResourceId: registryKey,
        auditFallbackUserId: registryKey,
        notifyRefId: registryKey,
        notifyRefType: 'DECISION_REGISTRY',
      });
      if (r === 'ENACTED') enacted++;
      else if (r === 'FAILED') failed++;
    }
    const remaining = await this.prisma.decisionAction.count({ where: { registryKey, status: { in: ['PENDING', 'SKIPPED'] } } });
    this.logger.log(`등록부 집행 ${registryKey}: 성공 ${enacted}·실패 ${failed}·잔여 ${remaining}`);
    return { registryKey, enacted, failed, remaining };
  }

  /**
   * kind 별 집행 디스패치 — 스냅샷 채취 후 정본 서비스 호출. 반환값 = snapshotBefore.
   * 크론 집행은 actor 미상: 도메인 서비스의 updatedBy/decidedBy 파라미터에는 undefined 를 흘려
   * null 저장을 유도한다(문자열 시그니처는 캐스트 — 주체 날조 금지 원칙).
   */
  private async executeAction(
    kind: string,
    target: Record<string, unknown>,
    ctx: { decisionNo: string; committeeCode: string | null; userId: string | null },
  ): Promise<unknown> {
    const actor = (ctx.userId ?? undefined) as unknown as string;
    // 도메인 committee 필드에 남길 의결 귀속 문자열(FormularyItem.committee VarChar60)
    const decisionRef = `${ctx.committeeCode ?? ''} ${ctx.decisionNo}`.trim().slice(0, 60);

    switch (kind) {
      case 'CONFIG_CHANGE':
      case 'GATE_MODE': {
        const key = kind === 'CONFIG_CHANGE' ? String(target.key) : String(target.gateKey);
        const before = await this.config.get(key);
        if (kind === 'GATE_MODE' && target.mapKey) {
          // D15 — Map형 게이트 부분 키 집행: 기존 맵을 읽어 해당 키만 바꾼다(타 영역 불변)
          const map = (before && typeof before === 'object' && !Array.isArray(before) ? { ...(before as Record<string, unknown>) } : {});
          map[String(target.mapKey)] = target.mode;
          await this.config.set(key, map, ctx.userId ?? undefined);
        } else {
          const newValue = kind === 'CONFIG_CHANGE' ? target.newValue : target.mode;
          await this.config.set(key, newValue, ctx.userId ?? undefined);
        }
        return { key, value: before };
      }

      case 'FORMULARY': {
        const svc = this.formulary!;
        const op = String(target.op);
        if (op === 'add') {
          return await svc.add(actor, {
            domain: String(target.domain),
            items: target.items as { codeId?: string; presetKey?: string; label?: string }[],
            committee: decisionRef,
            note: target.note ? String(target.note) : undefined,
          }).then((r) => ({ result: r, before: null }));
        }
        if (op === 'setStatus') {
          const id = String(target.id);
          const before = await this.prisma.formularyItem.findUnique({ where: { id }, select: { status: true, committee: true, note: true } });
          await svc.update(actor, id, { status: String(target.status), committee: decisionRef });
          return { id, before };
        }
        // decide
        const requestId = String(target.requestId);
        const before = await this.prisma.formularyRequest.findUnique({ where: { id: requestId }, select: { status: true, decision: true } });
        await svc.decide(actor, requestId, {
          approve: Boolean(target.approve),
          decision: target.decision ? String(target.decision) : `거버넌스 의결 ${ctx.decisionNo}`,
          committee: decisionRef,
        });
        return { requestId, before };
      }

      case 'MASTER_DATA': {
        const master = String(target.master);
        const op = String(target.op);
        const id = target.id ? String(target.id) : undefined;
        const payload = (target.payload ?? {}) as Record<string, unknown>;
        const model = MASTER_BINDINGS[master].model;
        const before = id
          ? await (this.prisma as unknown as Record<string, { findUnique: (a: unknown) => Promise<unknown> }>)[model]
            .findUnique({ where: { id } })
          : null;

        if (master === 'reference-range') {
          if (op === 'create') await this.referenceRange!.create(payload as never);
          else if (op === 'update') await this.referenceRange!.update(id!, payload as never);
          else await this.referenceRange!.deactivate(id!);
        } else if (master === 'cdss-rule') {
          if (op === 'create') await this.cdss!.createRule(payload as never);
          else if (op === 'update') await this.cdss!.updateRule(id!, payload as never);
          else await this.cdss!.deleteRule(id!);
        } else if (master === 'triage-rule') {
          if (op === 'create') await this.triage!.createRule({ ...(payload as object), createdBy: actor } as never);
          else if (op === 'update') await this.triage!.updateRule(id!, payload as never);
          else await this.triage!.deleteRule(id!);
        } else if (master === 'medication-code') {
          if (op === 'create') await this.codeMaster!.createMedication(payload as never);
          else if (op === 'update') await this.codeMaster!.updateMedication(id!, payload as never);
          else await this.codeMaster!.deleteMedication(id!);
        } else if (master === 'staffing-rule') {
          if (op === 'upsert') await this.duty!.upsertStaffingRule(payload as never);
          else await this.duty!.deleteStaffingRule(id!);
        } else if (master === 'quality-indicator') {
          if (op === 'create') {
            const created = await this.quality!.createIndicator(payload as never);
            return { master, id: (created as { id?: string }).id ?? null, before: null };
          }
          await this.quality!.updateIndicator(id!, payload as never);
        } else if (master === 'nursing-checklist') {
          const code = String(target.code);
          const beforeTpl = await this.prisma.nursingChecklistTemplate.findUnique({ where: { code } });
          await this.nursing!.upsertChecklistTemplate(code, payload as never, ctx.userId ?? undefined);
          return { master, code, before: beforeTpl };
        } else { // dur-rules
          if (op === 'create') await this.durRules!.createRule(payload);
          else if (op === 'update') await this.durRules!.updateRule(id!, payload);
          else await this.durRules!.deleteRule(id!);
        }
        return { master, id: id ?? null, before };
      }

      case 'TEMPLATE': {
        const tt = String(target.templateType);
        const id = String(target.id);
        const op = String(target.op);
        if (tt === 'CONSENT') {
          const before = await this.prisma.consentTemplate.findUnique({ where: { id }, select: { isActive: true, version: true } });
          if (op === 'setActive') await this.consentTemplate!.setActive(id, Boolean(target.active));
          else await this.consentTemplate!.restoreVersion(id);
          return { id, before };
        }
        const before = await this.prisma.chartTemplate.findUnique({ where: { id }, select: { isActive: true, version: true } });
        if (op === 'rollback') await this.chartTemplate!.rollbackToVersion(id, String(target.versionId), ctx.userId ?? undefined);
        else await this.chartTemplate!.delete(id);
        return { id, before };
      }

      case 'ACCESS': {
        const scope = String(target.scope);
        const key = String(target.key);
        if (scope === 'feature') {
          const before = await this.featureAccess!.getConfig(key);
          await this.featureAccess!.setConfig(key, target.value as never, actor);
          return { scope, key, before };
        }
        if (scope === 'role-data') {
          const before = await this.accessControl!.getRoleDataAccess(key);
          await this.accessControl!.setRoleDataAccess(key, target.value as Record<string, boolean>, actor);
          return { scope, key, before };
        }
        if (scope === 'dept') {
          const before = await this.accessControl!.getDeptAccess(key);
          await this.accessControl!.setDeptAccess(key, target.value as string[], actor);
          return { scope, key, before };
        }
        const before = await this.accessControl!.getPacsAccess(key);
        await this.accessControl!.setPacsAccess(key, target.value as Record<string, boolean>, actor);
        return { scope, key, before };
      }

      case 'PUBLISH': {
        const dt = String(target.docType);
        const id = String(target.id);
        const op = String(target.op);
        if (dt === 'PROTOCOL') {
          const before = await this.prisma.protocolTemplate.findUnique({ where: { id }, select: { status: true, code: true, version: true } });
          await this.protocol!.publishDraft(id, ctx.userId ?? undefined);
          return { docType: dt, id, before };
        }
        if (dt === 'PATHWAY') {
          const before = await this.prisma.clinicalPathway.findUnique({ where: { id }, select: { status: true } });
          if (op === 'publish') await this.pathway!.publish(id);
          else await this.pathway!.retire(id);
          return { docType: dt, id, before };
        }
        const before = await this.prisma.orderSet.findUnique({ where: { id }, select: { status: true } });
        if (op === 'publish') await this.orderSet!.changeStatus(id, 'ACTIVE', ctx.userId ?? undefined);
        else await this.orderSet!.deprecateOrderSet(id);
        return { docType: dt, id, before };
      }

      case 'RETENTION': {
        const resourceType = String(target.resourceType);
        const before = await this.prisma.retentionPolicy.findUnique({ where: { resourceType } });
        await this.retention!.upsertPolicy({
          resourceType,
          retentionDays: Number(target.retentionDays),
          legalMinDays: target.legalMinDays !== undefined ? Number(target.legalMinDays) : undefined,
          action: target.action ? String(target.action) : undefined,
          legalConfirmed: target.legalConfirmed !== undefined ? Boolean(target.legalConfirmed) : undefined,
          enabled: target.enabled !== undefined ? Boolean(target.enabled) : undefined,
          description: target.description ? String(target.description) : undefined,
        });
        return { resourceType, before };
      }

      default:
        throw new BadRequestException(`집행 불가 kind: ${kind}`);
    }
  }
}
