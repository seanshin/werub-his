import { Injectable, Logger, Optional } from '@nestjs/common';
import { NursingService } from '../nursing/nursing.service';
import { EmergencyService } from '../emergency/emergency.service';
import { BedBoardService } from '../bed/bed-board.service';
import { PharmacyBoardService } from '../pharmacy/pharmacy-board.service';
import { ReceptionBillingBoardService } from '../billing/reception-billing-board.service';
import { DiagnosticsBoardService } from '../lab/diagnostics-board.service';
import { SafetyQualityBoardService } from '../qi/safety-quality-board.service';
import { DriftRecorderService } from '../../sentinel/drift-recorder.service';

/** 섹션별 열람 역할 — 개별 보드 EP의 RolesGuard와 동일 세트(집계 EP가 게이팅을 우회하지 않도록) */
/**
 * '경고 총합'에 기여하는 섹션들 — 이 중 하나라도 실패하면 합계는 **부분 집계**다.
 * (bed 는 bedAlert 로만 기여하는데, 가동률이 null 이면 bedAlert 가 이미 0 이라 여기 넣지 않는다)
 */
/**
 * 🔴 **키를 문자열로 읽는 순간 tsc 가 손을 뗀다**(2026-09-02 실측 결함의 근본 원인).
 *    이 롤업은 하위 보드 결과를 `as { summary: Record<string, unknown> }` 로 캐스팅해 받고 있었다.
 *    그래서 `bed.summary.totalBeds` 를 `'total'` 로 읽어도 **컴파일도 테스트도 통과**했고,
 *    화면만 "산출 불가 — 등록 병상 없음"이라 말했다(운영엔 병상 57개).
 *
 *    캐스팅을 걷어내고 **생산자의 실제 반환 타입에서 키를 유도**한다 —
 *    이제 키 오타는 화면이 아니라 `tsc` 에서 터진다.
 *    (판정 규칙 §8 "위험한 곳은 구조 캐스팅으로 타입 검사를 우회한 자리뿐")
 */
type SummaryOf<T> = T extends { summary: infer S } ? S : never;
type BoardSummaries = {
  nursing: SummaryOf<Awaited<ReturnType<NursingService['getStationBoard']>>>;
  emergency: SummaryOf<Awaited<ReturnType<EmergencyService['getBoard']>>>;
  bed: SummaryOf<Awaited<ReturnType<BedBoardService['getBoard']>>>;
  pharmacy: SummaryOf<Awaited<ReturnType<PharmacyBoardService['getBoard']>>>;
  receptionBilling: SummaryOf<Awaited<ReturnType<ReceptionBillingBoardService['getBoard']>>>;
  diagnostics: SummaryOf<Awaited<ReturnType<DiagnosticsBoardService['getBoard']>>>;
  safetyQuality: SummaryOf<Awaited<ReturnType<SafetyQualityBoardService['getBoard']>>>;
};
/** 숫자로 읽어도 되는 키만 — 문자열·객체 키를 숫자로 읽는 실수도 함께 막는다 */
type NumericKeyOf<S> = Extract<{ [K in keyof S]: S[K] extends number | null | undefined ? K : never }[keyof S], string>;

const ALERT_SOURCE_SECTIONS = ['nursing', 'emergency', 'pharmacy', 'receptionBilling', 'diagnostics', 'safetyQuality'] as const;

export const SECTION_ROLES: Record<string, string[]> = {
  nursing: ['ADMIN', 'NURSE', 'DOCTOR'],
  emergency: ['ADMIN', 'DOCTOR', 'NURSE'],
  bed: ['ADMIN', 'NURSE', 'DOCTOR'],
  pharmacy: ['ADMIN', 'PHARMACIST'],
  receptionBilling: ['ADMIN', 'NURSE', 'DOCTOR'],
  diagnostics: ['ADMIN', 'LAB_TECH', 'DOCTOR', 'NURSE'],
  safetyQuality: ['ADMIN', 'NURSE', 'DOCTOR'],
};

/**
 * 통합 상황판 집계 — 7개 현장 보드 요약을 1요청으로 (기존: 카드 7개 독립 폴링 팬아웃).
 * 부분 실패 허용: 섹션별 {ok, summary|error} — 한 보드 장애가 전체 상황판을 죽이지 않는다.
 */
@Injectable()
export class CommandCenterService {
  private readonly logger = new Logger(CommandCenterService.name);

  constructor(
    private readonly nursing: NursingService,
    private readonly emergency: EmergencyService,
    private readonly bedBoard: BedBoardService,
    private readonly pharmacyBoard: PharmacyBoardService,
    private readonly receptionBillingBoard: ReceptionBillingBoardService,
    private readonly diagnosticsBoard: DiagnosticsBoardService,
    private readonly safetyQualityBoard: SafetyQualityBoardService,
    /**
     * 🔴 `@Optional()` — 감시 기록이 없다고 관제가 죽으면 안 된다. 다만 주입이 빠지면
     *    **조용히 아무것도 안 남는다**. 그래서 배선을 가드로 확인한다
     *    (이 저장소에서 `@Optional()` 주입 누락으로 원장이 통째로 비었던 적이 있다).
     */
    @Optional() private readonly drift?: DriftRecorderService,
  ) {}

  async getSummary(role?: string) {
    const allowed = (section: string) => !role || (SECTION_ROLES[section] ?? []).includes(role);

    // 🔴 캐스팅 금지 — 하위 보드의 실제 반환 타입이 그대로 흘러야 키 오타를 tsc 가 잡는다
    const jobs: [string, () => Promise<Record<string, unknown>>][] = [
      ['nursing', async () => (await this.nursing.getStationBoard()).summary],
      ['emergency', async () => (await this.emergency.getBoard()).summary],
      ['bed', async () => (await this.bedBoard.getBoard()).summary],
      ['pharmacy', async () => (await this.pharmacyBoard.getBoard()).summary],
      ['receptionBilling', async () => (await this.receptionBillingBoard.getBoard()).summary],
      ['diagnostics', async () => (await this.diagnosticsBoard.getBoard()).summary],
      ['safetyQuality', async () => (await this.safetyQualityBoard.getBoard()).summary],
    ];
    const active = jobs.filter(([name]) => allowed(name));
    const settled = await Promise.allSettled(active.map(([, fn]) => fn()));

    const sections: Record<string, { ok: boolean; summary?: Record<string, unknown>; error?: string }> = {};
    settled.forEach((r, i) => {
      const name = active[i][0];
      if (r.status === 'fulfilled') sections[name] = { ok: true, summary: r.value };
      else {
        const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
        this.logger.warn(`command-center 섹션 실패(비차단) ${name}: ${msg}`);
        sections[name] = { ok: false, error: msg };
      }
    });

    return { sections, kpi: this.buildKpi(sections), generatedAt: new Date().toISOString() };
  }

  /** 상단 통합 KPI — 재원·응급·위급대기·경고 총합(섹션 headline 경고의 합, 실패 섹션은 0 처리) */
  private buildKpi(sections: Record<string, { ok: boolean; summary?: Record<string, unknown> }>) {
    /**
     * 🔴 **없는 키를 조용히 접지 않는다**(2026-09-02).
     *    베드 보드는 `totalBeds` 를 내는데 여기서 `total` 을 읽어 분모가 항상 사라졌고,
     *    화면은 그것을 "산출 불가 — 등록 병상 없음"으로 그렸다(운영엔 병상 57개가 있었다).
     *    타입도 테스트도 못 잡는 자리라, **섹션은 성공했는데 키가 없으면** 드러낸다.
     *    값은 그대로 접되(화면 계약 유지) 드리프트가 침묵하지 않게 한다.
     *
     * 🔴 2026-09-02(P2): 종전에는 **로그 한 줄**이라 아무도 보지 않았다. 하루 수천 줄에 섞이면
     *    없는 것과 같다 — 이제 감시자 원장(`SentinelRuntimeSignal`)에도 적어
     *    `/admin/sentinel` 계약 축에 **줄어드는 목록**으로 뜬다.
     */
    const warnMissing = (section: string, key: string) => {
      const sec = sections[section];
      if (sec?.ok && sec.summary && !(key in sec.summary)) {
        const actual = Object.keys(sec.summary).join(', ');
        this.logger.warn(
          `command-center KPI 키 불일치 — ${section}.summary 에 '${key}' 가 없습니다(관제가 그 값을 잃습니다). ` +
          `실제 키: ${actual}`,
        );
        this.drift?.record({
          kind: 'KEY_MISSING',
          producer: `${section}-board.summary`,
          consumer: 'command-center.buildKpi',
          detail: `읽은 키 '${key}' 가 없습니다 · 실제 키: ${actual}`,
        });
      }
    };
    const n = <S extends keyof BoardSummaries>(section: S, key: NumericKeyOf<BoardSummaries[S]>): number => {
      warnMissing(section, key);
      const v = sections[section]?.ok ? sections[section]?.summary?.[key] : 0;
      return typeof v === 'number' && Number.isFinite(v) ? v : 0;
    };
    /**
     * 🔴 `n()` 은 숫자가 아니면 0 으로 접는다 — 그대로 두면 **등록 병상 0(산출 불가)** 이
     *    "가동률 0%"로 KPI 에 찍힌다(표본 부재를 성적으로 읽는 것). 비율은 null 을 살려서 넘긴다.
     */
    const nOrNull = <S extends keyof BoardSummaries>(section: S, key: NumericKeyOf<BoardSummaries[S]>): number | null => {
      warnMissing(section, key);
      const v = sections[section]?.ok ? sections[section]?.summary?.[key] : null;
      return typeof v === 'number' && Number.isFinite(v) ? v : null;
    };
    const occupancyRate = nOrNull('bed', 'occupancyRate');
    const occupancyNumerator = nOrNull('bed', 'occupied');
    /**
     * 🔴 **키 이름이 어긋나 "등록 병상 없음"이라 말하고 있었다**(2026-09-02 운영 실측).
     *    베드 보드 요약은 `totalBeds` 를 내는데 여기서 `total` 을 읽어 항상 `undefined → null` 이었다.
     *    화면(`<Ratio unavailableHint="등록 병상 없음">`)은 그것을 **"산출 불가 — 등록 병상 없음"** 으로
     *    그렸는데, 운영에는 병상 **57개**(5병동)가 있고 가동률도 9% 로 함께 내려오고 있었다.
     *    🔴 정직해 보이는 '산출 불가'가 **그 자체로 거짓**이었던 자리다 — 분자만 있고 분모만 사라졌다.
     */
    const occupancyDenominator = nOrNull('bed', 'totalBeds');
    // 🔴 산출 불가(null)에서는 경보하지 않는다 — 모르는 것을 위반으로 세면 거짓 경보가 된다
    const bedAlert = occupancyRate != null && occupancyRate >= 90 ? 1 : 0;
    const alertsTotal =
      n('nursing', 'medsOverdue') + n('nursing', 'unsignedNotes') +
      n('emergency', 'pendingTriage') + n('emergency', 'boarding') +
      bedAlert +
      n('pharmacy', 'verifyWait') + n('pharmacy', 'lowStockCount') +
      n('receptionBilling', 'eligUnchecked') +
      n('diagnostics', 'criticalPending') + n('diagnostics', 'criticalOverdue') +
      n('safetyQuality', 'incidentsOpen');
    /**
     * 🔴 **조회 실패를 '경고 없음'으로 번역하지 않는다**(2026-09-02).
     *    이 EP 는 섹션 부분 실패를 허용한다 — 그런데 `n()` 이 실패 섹션을 0 으로 접으므로
     *    간호·응급·약제가 통째로 죽어도 '경고 총합'은 그만큼 **작아진** 숫자로 안심시킨다.
     *    합계는 남은 것으로 계속 내되(전부 잃는 게 더 나쁘다) **어느 섹션이 빠졌는지 함께 준다** —
     *    화면은 그걸로 '부분 집계'임을 말한다(§1 표본 부재 ≠ 0 · 덜 안전하게 말하는 것도 거짓).
     */
    const alertsUnavailable = ALERT_SOURCE_SECTIONS.filter((k) => sections[k] && !sections[k].ok);
    return {
      // 🔴 실패 섹션은 0 이 아니라 null — '재원 0명'은 '조회 실패'와 다른 사실이다
      census: nOrNull('nursing', 'total'),
      erActive: nOrNull('emergency', 'active'),
      criticalPending: nOrNull('diagnostics', 'criticalPending'),
      occupancyRate,
      occupancyNumerator,
      occupancyDenominator,
      bedAlert,
      alertsTotal,
      alertsUnavailable,
    };
  }
}
