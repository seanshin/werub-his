import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { localDateTimeKey, todayDateOnly } from '../../common/day-range';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { gateMode } from '../../common/gate-mode';
import { isPeriodicEncryptedBackup } from '../../common/backup-files';
import { GO_LIVE_REGISTRY, AREA_LABEL, EXPECTED_GIN_INDEXES, GoLiveDef } from './go-live.registry';
import { OUTBOUND_CHANNELS } from '../outbound-channel/outbound-channel.registry';
import { HIS_MODE_CONFIG_KEY, parseHisMode, renderServerMessageKo, serverMsg, type ServerMessage } from '@hospital-run/shared';

type Status = 'NOT_READY' | 'IN_PROGRESS' | 'READY' | 'DONE' | 'BLOCKED';

/**
 * 판정 결과 — 🔴 (2026-09-15) 사유 문장은 서버가 조립하지 않는다. `detailMsg`({k, params})를 화면이 카탈로그로 조립하고,
 *    `detail` 은 종전 문자열을 읽는 소비처(개원 단계 `opening.service` 등)를 위한 **한국어 원문 폴백**이다.
 *    설계 `docs/01-plan/features/server-display-text-i18n.plan.md`.
 */
type Derived = { status: Status; detail: string; detailMsg: ServerMessage };
const derived = (status: Status, m: ServerMessage): Derived => ({ status, detail: renderServerMessageKo(m), detailMsg: m });
/** 설치 필수 기관 키 문장 네 모양이 공통으로 쓰는 판정 근거 꼬리 */

/**
 * 근거 종류 — 준비율이 **무엇을 근거로** 산출됐는지 구분한다.
 * 🔴 예전에는 구분이 없어서, 사람이 수기로 적은 "확인 완료"(GIN 인덱스)와 개발 시드 결재(LIS)가
 *    시스템 실검증과 같은 무게로 준비율에 섞여 들어갔다. 섞이면 준비율이 스스로를 증명하는 숫자가 된다.
 *  · VERIFIED      = 시스템이 조회해서 확인한 사실(config 실값·DB 실측·실 결재 레코드)
 *  · SELF_REPORTED = 사람이 화면에서 표시한 상태(수동 항목) — 근거는 화면 밖에 있다
 */
export type EvidenceKind = 'VERIFIED' | 'SELF_REPORTED';

const READY_SET = new Set(['READY', 'DONE']);
const MODE_ORD: Record<string, number> = { OFF: 0, WARN: 1, BLOCK: 2 };
const ORD_MODE = ['OFF', 'WARN', 'BLOCK'];
/** 개발 시드 결재 표식(seed.ts `evidenceRef: '개발 시드(DEV-SEED)'`) — 실검증으로 세지 않는다 */
const DEV_SEED_RE = /DEV-SEED|개발 시드/i;
/**
 * 🔴 설치 필수 기관 키(2026-09-13 · 상용 릴리즈 기획 T3-2) — `hospital.*` 설정 정의 18개를 **전부** 둘로 가른다.
 *    종전 판정은 6키만 보고 `config.get()` 값이 플레이스홀더 목록에 있는지로 셌다 — `get()` 은 DB 행이 없으면
 *    DEFAULTS 로 떨어지므로 **"행 없음"과 "누가 그 값을 넣음"이 같은 모양**이었고(설정 출처 3상태 축과 같은 결함),
 *    요양기관 면허·응급실 운영·진료시간·국가는 아예 세지 않았다.
 *    분류 정본은 이 두 목록이고, 설정 정의(DEFAULTS)의 `hospital.*` 가 둘 중 하나에 반드시 들어가는지 가드가 대조한다
 *    (`test/go-live/institution-required-keys-probe.spec.ts`).
 */
export const INSTITUTION_REQUIRED_KEYS = [
  'hospital.name', 'hospital.code', 'hospital.bizNo', 'hospital.ceo', 'hospital.license', 'hospital.country',
  'hospital.address', 'hospital.phone', 'hospital.emergency',
  'hospital.hours.weekday', 'hospital.hours.saturday', 'hospital.hours.lunch', 'hospital.hours.closed',
] as const;
/** 없어도 설치·서식이 성립하는 키(없으면 국문명·기본 언어로 대체되거나 표시만 빠진다) */
export const INSTITUTION_OPTIONAL_KEYS = [
  'hospital.nameEn', 'hospital.addressEn', 'hospital.city', 'hospital.ceoSignatureKey', 'hospital.defaultUiLocale',
] as const;
/**
 * DB 행이 있어도 **개발용 가짜 값**이면 입력으로 세지 않는다 — DEFAULTS 의 지어낸 값과 같은 것만.
 * 🔴 진료시간 기본값(`09:00~18:00`)처럼 실제로 쓸 수 있는 값은 여기 넣지 않는다(실제 입력을 가짜로 몰면 거짓 경보다).
 */
const INSTITUTION_PLACEHOLDER: Record<string, readonly string[]> = {
  'hospital.name': ['Hospital RUN 병원'],
  'hospital.code': ['12345678'],
  'hospital.phone': ['02-1234-5678'],
  'hospital.address': ['서울시 강남구'],
};

@Injectable()
export class GoLiveService {
  private readonly logger = new Logger(GoLiveService.name);

  constructor(private readonly prisma: PrismaService, private readonly config: ConfigRuntimeService) {}

  /** 레지스트리 정본을 GoLiveItem에 멱등 시딩(제목·소유·소스는 정본 우선, status/blocker/targetDate는 수동값 보존) */
  private async ensureSeeded() {
    for (const def of GO_LIVE_REGISTRY) {
      await this.prisma.goLiveItem.upsert({
        where: { key: def.key },
        update: {
          area: def.area, title: def.title, type: def.type, owner: def.owner ?? null,
          drillDown: def.drillDown ?? null, sourceKey: def.sourceKey ?? null,
          targetMode: def.targetMode ?? null, isBlocking: def.isBlocking ?? true,
        },
        create: {
          area: def.area, key: def.key, title: def.title, type: def.type, owner: def.owner ?? null,
          drillDown: def.drillDown ?? null, sourceKey: def.sourceKey ?? null,
          targetMode: def.targetMode ?? null, isBlocking: def.isBlocking ?? true,
        },
      });
    }
  }

  // ── 어댑터 (config/DB 직접조회 — 모듈 순환 회피) ──

  /**
   * 영역별 게이트 맵(예: formulary.enforce)의 준비 판정.
   * 🔴 맵을 `String(raw)` 로 취급하면 '[object Object]' 가 되고 gateMode 의 fail-closed 분기에 걸려
   *    **항상 BLOCK** 으로 읽혔다 — 7영역 중 6개가 OFF 인데 화면은 준비완료였다.
   * 판정 기준은 **최저 영역**: 한 영역이라도 목표 미만이면 미준비. 값 해석은 정본 gateMode 만 사용한다
   * (게이트 해석 함수를 여기서 새로 만들지 않는다 — 이 함수는 관제 표시용 롤업일 뿐이다).
   */
  private deriveGateMap(map: Record<string, unknown>, targetMode?: string): Derived {
    const entries = Object.entries(map);
    if (!entries.length) return derived('NOT_READY', serverMsg('영역 미설정(전 영역 OFF)'));
    const target = targetMode ?? 'BLOCK';
    const modes = entries.map(([area, v]) => ({ area, mode: gateMode(v, 'OFF') }));
    const minOrd = Math.min(...modes.map((m) => MODE_ORD[m.mode]));
    const met = modes.filter((m) => MODE_ORD[m.mode] >= MODE_ORD[target]);
    const below = modes.filter((m) => MODE_ORD[m.mode] < MODE_ORD[target]).map((m) => `${m.area}=${m.mode}`);
    const base = { 전체: entries.length, 충족: met.length, 목표: target, 최저: ORD_MODE[minOrd] };
    const m = below.length
      ? serverMsg('{전체}영역 중 {충족}영역만 목표({목표}) 충족 · 최저 {최저} — 미달 {미달}', { ...base, 미달: below.join('·') })
      : serverMsg('{전체}영역 중 {충족}영역만 목표({목표}) 충족 · 최저 {최저}', base);
    return derived(met.length === entries.length ? 'READY' : 'IN_PROGRESS', m);
  }

  private deriveConfigGate(raw: unknown, targetMode?: string): Derived {
    // 영역별 맵이 먼저 — 문자열화하면 사실이 사라진다
    if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
      return this.deriveGateMap(raw as Record<string, unknown>, targetMode);
    }
    const rawSet = raw != null && String(raw).trim() !== '';
    if (!rawSet) return derived('NOT_READY', serverMsg('미설정(전환 결정 필요)'));
    const s = String(raw).trim().toLowerCase();
    if (s === 'true' || s === 'false') {
      // 불리언 게이트 — targetMode 'OFF'=비활성 목표(예: 자체발급 폐지)
      const desiredFalse = (targetMode ?? 'OFF') === 'OFF';
      const ok = (s === 'false') === desiredFalse;
      return derived(ok ? 'READY' : 'IN_PROGRESS', serverMsg('현재 {값}', { 값: s }));
    }
    const mode = gateMode(raw, 'OFF');
    const ok = MODE_ORD[mode] >= MODE_ORD[targetMode ?? 'BLOCK'];
    return derived(ok ? 'READY' : 'IN_PROGRESS', serverMsg('모드 {모드} (목표 {목표})', { 모드: mode, 목표: targetMode ?? 'BLOCK' }));
  }

  /**
   * 설정 읽기 — 🔴 (2026-10-01 .catch 비리터럴 판정) 실패를 미설정으로 접지 않는다. 종전 `.catch(() => ({}))`·`.catch(() => '')`·`.catch(() => null)` 은
   * 조회 실패를 "법무 승인 대기"·"key=미설정"·"현재 미설정"으로 말했다(관제가 장애를 준비 부족으로 보고). 실패면 판정 불가(BLOCKED) — 같은 파일
   * `deriveHospitalInfo` 의 규약과 같다.
   */
  private async readConfig(key: string): Promise<{ ok: true; v: unknown } | { ok: false }> {
    try {
      return { ok: true, v: await this.config.get(key) };
    } catch (e) {
      this.logger.warn(`관제 설정 조회 실패 ${key}: ${String(e)}`);
      return { ok: false };
    }
  }

  private static readonly UNREADABLE = (key: string) =>
    derived('BLOCKED', serverMsg('설정 {키} 를 확인하지 못했습니다(판정 불가 — 미설정이라 말하지 않는다)', { 키: key }));

  private async derivePhase0(): Promise<Derived> {
    const read = await this.readConfig('integration.cutoverApproval');
    if (!read.ok) return GoLiveService.UNREADABLE('integration.cutoverApproval');
    const appr = (read.v ?? {}) as { approvedAt?: string; executedAt?: string };
    if (appr?.executedAt) return derived('DONE', serverMsg('실행 완료'));
    if (appr?.approvedAt) return derived('READY', serverMsg('승인됨(실행 대기)'));
    return derived('NOT_READY', serverMsg('법무 승인 대기'));
  }

  /**
   * 설치 필수 기관 키 — **`system_configs` 행의 실재**로 판정한다(요양기관 종별과 같은 이유: 기본값은 설정이 아니다).
   * 🔴 관제만 한다 — 법정 서식 발급 **차단**은 사람 결정 `identity.unsetIssuance` 뒤다(가짜 게이트 금지).
   * 🔴 미입력을 0 으로 그리지 않는다 — 항상 `입력 n / 필수 N` 분모를 병기하고, 못 읽었으면 "판정 불가"다.
   */
  async deriveHospitalInfo(): Promise<Derived> {
    const required = [...INSTITUTION_REQUIRED_KEYS];
    let rows: Array<{ key: string; value: unknown }>;
    try {
      rows = await this.prisma.systemConfig.findMany({ where: { key: { in: required } }, select: { key: true, value: true } });
    } catch (e) {
      // 예외 원문은 화면이 아니라 로그로 — 화면에는 "판정 불가"라는 사실만
      this.logger.warn(`기관 필수 키 조회 실패: ${String(e)}`);
      return derived('BLOCKED', serverMsg('기관 필수 키를 확인하지 못했습니다(판정 불가 — 미입력이라 말하지 않는다)'));
    }
    const byKey = new Map(rows.map((r) => [r.key, String(r.value ?? '').replace(/^"|"$/g, '').trim()]));
    const missing: string[] = [];
    const placeholder: string[] = [];
    for (const k of required) {
      const v = byKey.get(k);
      if (v === undefined || v === '') missing.push(k);
      else if ((INSTITUTION_PLACEHOLDER[k] ?? []).includes(v)) placeholder.push(k);
    }
    const entered = required.length - missing.length - placeholder.length;
    // 🔴 수·키 목록은 값, 문장은 카탈로그 키 — 붙는 조각에 따라 문장 모양이 넷이다(조각을 이어 붙이면 어순이 언어마다 깨진다)
    const keyNames = (ks: string[]) => ks.map((k) => k.replace(/^hospital\./, '')).join(', ');
    const p = { 입력: entered, 필수: required.length, 행없음수: missing.length, 행없음키: keyNames(missing), 가짜수: placeholder.length, 가짜키: keyNames(placeholder) };
    const m = missing.length && placeholder.length
      ? serverMsg('입력 {입력} / 필수 {필수} · 행 없음 {행없음수}({행없음키}) · 개발용 가짜 값 {가짜수}({가짜키}) — 판정은 DB 행 실재(기본값은 설정이 아니다) · 발급 차단은 identity.unsetIssuance 결정 뒤', p)
      : missing.length
        ? serverMsg('입력 {입력} / 필수 {필수} · 행 없음 {행없음수}({행없음키}) — 판정은 DB 행 실재(기본값은 설정이 아니다) · 발급 차단은 identity.unsetIssuance 결정 뒤', p)
        : placeholder.length
          ? serverMsg('입력 {입력} / 필수 {필수} · 개발용 가짜 값 {가짜수}({가짜키}) — 판정은 DB 행 실재(기본값은 설정이 아니다) · 발급 차단은 identity.unsetIssuance 결정 뒤', p)
          : serverMsg('입력 {입력} / 필수 {필수} — 판정은 DB 행 실재(기본값은 설정이 아니다) · 발급 차단은 identity.unsetIssuance 결정 뒤', p);
    if (entered === required.length) return derived('READY', m);
    if (entered === 0) return derived('NOT_READY', m);
    return derived('IN_PROGRESS', m);
  }

  /**
   * F 영역 — GIN(pg_trgm) 인덱스 실측. `pg_indexes` 를 직접 조회한다(읽기 전용).
   * 🔴 이 항목은 오래도록 수동 READY 였고 SQL 파일 헤더에도 "적용 완료 + 9.0ms→0.28ms" 가 적혀 있었지만
   *    실측하면 6종 중 0종이었다(medication_codes 한글 LIKE = 여전히 Seq Scan). 선언은 검증이 아니다.
   * 인덱스 생성(DDL)은 여기서 하지 않는다 — 배포 절차 영역이고, 관제는 사실을 보고할 뿐이다.
   */
  /**
   * 정기 DB 백업 실측 — 🔴 **파일이 있느냐로 판정한다. 사람이 "했다"고 선언할 수 없다.**
   *
   * 2026-08-25 실측: 크론은 2026-05-07부터 매일 03:00 에 돌았는데 스크립트에 실행 비트가 없어
   * `Permission denied` 89회. **문서에는 "매일 백업"이라 적혀 있었고 아무도 확인하지 않았다.**
   * 그래서 "크론이 등록됐는가"가 아니라 **"최근 백업 파일이 있는가"** 를 본다 —
   * 크론이 돌아도 실패하면 파일이 안 생긴다(그 구분이 이 항목의 존재 이유다).
   */
  /**
   * 운영 모드가 REAL 인가 — 🔴 **리허설 배포본에는 시드 로그인이 번들에 들어 있다.**
   *
   * 관리 화면 토글로는 사라지지 않는다(런타임은 숨길 뿐이다). 리얼로 되돌리는 것은 **재배포**이고,
   * 그래서 사람 기억이 아니라 여기서 판정한다 — 백업 항목과 같은 이유다(2026-08-25).
   * 판정은 **빌드 상한**(`HIS_MODE` 환경변수)으로 한다. 런타임 토글이 REAL 이어도
   * 번들에 시드가 들어 있다면 아직 준비된 것이 아니다.
   */
  /**
   * 요양기관 종별 — **개설 허가가 정하는 사실**이라 사람이 넣어야 한다.
   *
   * 🔴 `ConfigRuntimeService.get()` 으로 판정하지 않는다. 그것은 DB 행이 없으면
   *    DEFAULTS 의 `'CLINIC'` 을 돌려주므로 **미설정이 "의원으로 설정됨"으로 보인다.**
   *    개시 전 점검에서 그것을 READY 로 읽으면 아무도 확인하지 않은 채 개통한다.
   *    그래서 **`system_configs` 행의 실재**로 판정한다(기본값은 설정이 아니다).
   */
  private async deriveInstitutionGrade(): Promise<Derived> {
    const KEY = 'billing.institution.grade';
    const ALLOWED = ['CLINIC', 'HOSPITAL', 'GENERAL', 'TERTIARY'];
    const LABEL: Record<string, string> = { CLINIC: '의원', HOSPITAL: '병원', GENERAL: '종합병원', TERTIARY: '상급종합병원' };
    let row: { value: unknown } | null = null;
    try {
      row = await this.prisma.systemConfig.findUnique({ where: { key: KEY }, select: { value: true } });
    } catch (e) {
      // 🔴 못 읽었으면 "미설정"이라 말하지 않는다 — 모르는 것과 없는 것은 다른 사실이다
      return derived('BLOCKED', serverMsg('종별 설정을 확인하지 못했습니다(판정 불가) — {오류}', { 오류: String(e) }));
    }
    if (!row) {
      return derived(
        'NOT_READY',
        serverMsg('요양기관 종별이 설정되지 않았습니다 — 코드가 기본값 CLINIC(의원)으로 떨어져 **의원으로 청구됩니다**. /admin/billing-calc 에서 개설 허가상 종별을 지정하십시오.'),
      );
    }
    const v = String(row.value).replace(/^"|"$/g, '');
    if (!ALLOWED.includes(v)) {
      return derived('NOT_READY', serverMsg('알 수 없는 종별 값입니다: {값} (가능: {가능})', { 값: v, 가능: ALLOWED.join('·') }));
    }
    return derived(
      'READY',
      // 종별 이름은 번역 대상 낱말 조각({k}) — 코드는 그대로
      serverMsg('종별 {종별}({코드}) — 종별가산·의료급여 정액·수가 단가 열이 이 값을 따릅니다. 개설 허가와 일치하는지는 사람이 확인합니다.', { 종별: { k: LABEL[v] }, 코드: v }),
    );
  }

  private async deriveHisMode(): Promise<Derived> {
    const build = parseHisMode(process.env.HIS_MODE);
    const runtime = parseHisMode(await this.config.get(HIS_MODE_CONFIG_KEY).catch(() => null));
    if (!build) {
      // 미설정 = REAL 로 동작한다(안전측). 다만 "확인했다"고 말할 수는 없다 — 그대로 말한다.
      return derived('READY', serverMsg('HIS_MODE 미설정 — REAL 로 동작 중(명시 설정 권장)'));
    }
    if (build === 'REAL') {
      return derived(
        'READY',
        runtime && runtime !== 'REAL' ? serverMsg('빌드 상한 REAL (런타임 {런타임} 는 넓히지 못해 무시됨)', { 런타임: runtime }) : serverMsg('빌드 상한 REAL'),
      );
    }
    return derived(
      'NOT_READY',
      serverMsg('빌드 상한이 {빌드} 다 — 이 배포본에는 시드 로그인이 포함돼 있고 대외 발신이 차단된다. 실환자 전에 `deploy.sh --mode real` 로 재배포해야 한다(화면 토글로는 사라지지 않는다).', { 빌드: build }),
    );
  }

  private async deriveDbBackup(): Promise<Derived> {
    const dir = process.env.DB_BACKUP_DIR ?? '/home/deploy/backups/hospitalrun';
    const STALE_HOURS = 48; // 일 1회 스케줄이므로 이틀이면 확실히 이상이다
    try {
      const { readdir, stat } = await import('fs/promises');
      // 🔴 `.gpg` 면 아무거나 세지 않는다 — 배포 백업(`pre-deploy_*.gpg`)이 섞이면 정기 크론이 죽어도 배포만 하면 READY
      const names = (await readdir(dir)).filter(isPeriodicEncryptedBackup);
      if (!names.length) {
        return derived('NOT_READY', serverMsg('암호화된 정기 백업 파일이 없다 ({경로}) — 크론이 돌아도 실패하면 파일이 생기지 않는다(배포 백업은 세지 않는다)', { 경로: dir }));
      }
      let newest = 0;
      for (const n of names) {
        const st = await stat(`${dir}/${n}`).catch(() => null);
        if (st && st.mtimeMs > newest) newest = st.mtimeMs;
      }
      const ageH = (Date.now() - newest) / 3_600_000;
      const when = localDateTimeKey(new Date(newest)); // 🔴 UTC 절단이면 03:00 백업이 '전날 18:00' 으로 읽힌다
      if (ageH <= STALE_HOURS) {
        return derived('READY', serverMsg('최근 백업 {시각} ({시간}시간 전) · 보관 {건수}건', { 시각: when, 시간: Math.round(ageH), 건수: names.length }));
      }
      return derived('NOT_READY', serverMsg('🔴 최근 백업이 {일}일 전({시각}) — 크론 로그(~/backups/backup.log)를 확인하라', { 일: Math.round(ageH / 24), 시각: when }));
    } catch (e) {
      // 🔴 못 읽은 것을 "정상"이라고 말하지 않는다 — 판정 불가는 판정 불가다
      return derived('NOT_READY', serverMsg('백업 디렉터리를 읽지 못했다({경로}) — 판정 불가: {오류}', { 경로: dir, 오류: e instanceof Error ? e.message : String(e) }));
    }
  }

  /**
   * 🔴 PID 암호화 키 로테이션 판정 — env 값으로 자동(사람 선언 불가).
   *    all-zeros(개발 플레이스홀더)·미설정이면 PID 암호화가 무력하다 → NOT_READY.
   *    값 자체는 절대 로그·응답에 담지 않는다(길이·플레이스홀더 여부만).
   */
  private deriveEncryptionKey(): Derived {
    const key = process.env.ENCRYPTION_KEY;
    if (!key) return derived('NOT_READY', serverMsg('🔴 ENCRYPTION_KEY 미설정 — PID 암호화 불가'));
    if (/^0+$/.test(key)) return derived('NOT_READY', serverMsg('🔴 ENCRYPTION_KEY 가 all-zeros(개발 플레이스홀더) — 실 키로 로테이션 + 기존 암호문 재암호화 필요'));
    if (key.length !== 64) return derived('NOT_READY', serverMsg('🔴 ENCRYPTION_KEY 길이 {길이}자(AES-256 = 64 hex 자) — 설정 오류', { 길이: key.length }));
    return derived('READY', serverMsg('실 키 설정됨(64 hex·플레이스홀더 아님)'));
  }

  private async deriveGinIndex(): Promise<Derived> {
    const expected = [...EXPECTED_GIN_INDEXES];
    try {
      const rows = await this.prisma.$queryRaw<{ indexname: string }[]>`
        SELECT indexname FROM pg_indexes
        WHERE schemaname = 'public' AND indexdef ILIKE '%USING gin%'
      `;
      const present = new Set(rows.map((r) => r.indexname));
      const missing = expected.filter((n) => !present.has(n));
      const applied = expected.length - missing.length;
      if (!missing.length) return derived('READY', serverMsg('적용 {적용}/{전체} (pg_indexes 실측)', { 적용: applied, 전체: expected.length }));
      return derived(
        applied ? 'IN_PROGRESS' : 'NOT_READY',
        serverMsg('적용 {적용}/{전체} — 부재: {부재} (수동 SQL 미적용)', { 적용: applied, 전체: expected.length, 부재: missing.join(', ') }),
      );
    } catch (e) {
      // 실측 실패를 준비완료로 바꾸지 않는다(모르면 모른다고 말한다)
      this.logger.warn(`GIN 인덱스 실측 실패: ${(e as Error).message}`);
      return derived('NOT_READY', serverMsg('실측 실패 — 확인 불가 ({오류})', { 오류: (e as Error).message }));
    }
  }

  /** B 연동 어댑터 — integration-gate 트랙 CONFIRMED(+config live) 또는 config mode=REAL 파생 */
  private async deriveIntegration(sourceKey: string): Promise<Derived> {
    if (sourceKey.startsWith('track:')) {
      const track = sourceKey.slice(6);
      const gates = await this.prisma.integrationGate.findMany({
        where: { track }, select: { status: true, evidenceRef: true, note: true },
      });
      if (!gates.length) return derived('NOT_READY', serverMsg('개통 게이트 미착수'));
      // 🔴 개발 시드 결재(DEV-SEED)를 실 결재로 세면 컷오버가 스스로를 승인한 것이 된다 — 분리해서 센다
      const confirmed = gates.filter((g) => g.status === 'CONFIRMED');
      const seeded = confirmed.filter((g) => DEV_SEED_RE.test(`${g.evidenceRef ?? ''} ${g.note ?? ''}`));
      const real = confirmed.length - seeded.length;
      if (real === gates.length) return derived('DONE', serverMsg('결재 {실결재}/{전체} 완료', { 실결재: real, 전체: gates.length }));
      return derived(
        real ? 'IN_PROGRESS' : 'NOT_READY',
        seeded.length
          ? serverMsg('실 결재 {실결재}/{전체} · 개발 시드 {시드}건 제외(실 결재로 교체 필요)', { 실결재: real, 전체: gates.length, 시드: seeded.length })
          : serverMsg('실 결재 {실결재}/{전체}', { 실결재: real, 전체: gates.length }),
      );
    }
    /**
     * 🔴 `channel:<KEY>[,<KEY>…]` — 대외 발신 채널의 **구현 여부를 코드에서 읽는다.**
     * 종전 B 영역은 사람이 "됐다"고 적으면 그대로 믿었다(같은 영역에서 개발 시드 결재를
     * 실 결재로 세던 것과 같은 함정). 채널은 `implemented` 상수가 사실이므로 그것을 판정에 쓴다.
     * 여러 채널을 묶은 항목은 **전부 구현돼야** 완료다(하나라도 빠지면 그 기관에는 못 보낸다).
     */
    if (sourceKey.startsWith('channel:')) {
      const keys = sourceKey.slice(8).split(',').map((k) => k.trim()).filter(Boolean);
      const found = keys.map((k) => ({ key: k, def: OUTBOUND_CHANNELS.find((c) => c.key === k) }));
      const unknown = found.filter((f) => !f.def).map((f) => f.key);
      if (unknown.length) {
        // 🔴 등록부에 없는 키를 "준비완료"로 접지 않는다 — 모르면 모른다고 말한다
        return derived('NOT_READY', serverMsg('채널 등록부에 없음: {키}', { 키: unknown.join(', ') }));
      }
      const done = found.filter((f) => f.def!.implemented === true).map((f) => f.key);
      const undecided = found.filter((f) => f.def!.implemented === null).map((f) => f.key);
      if (undecided.length) return derived('NOT_READY', serverMsg('구현 여부 판정 불가: {키}', { 키: undecided.join(', ') }));
      if (done.length === keys.length) return derived('DONE', serverMsg('전송 구현 {구현}/{전체}', { 구현: done.length, 전체: keys.length }));
      const missing = keys.filter((k) => !done.includes(k));
      return derived(
        done.length ? 'IN_PROGRESS' : 'NOT_READY',
        serverMsg('전송 구현 {구현}/{전체} — 미구현: {미구현}(수기 신고로 대체 중)', { 구현: done.length, 전체: keys.length, 미구현: missing.join(', ') }),
      );
    }

    // config:key=val
    const m = sourceKey.match(/^config:(.+)=(.+)$/);
    if (!m) return derived('NOT_READY', serverMsg('소스 미정'));
    const [, key, expected] = m;
    const read = await this.readConfig(key);
    if (!read.ok) return GoLiveService.UNREADABLE(key);
    const raw = String(read.v ?? '').replace(/^"|"$/g, '');
    return raw === expected
      ? derived('DONE', serverMsg('{key}={value}', { key, value: raw }))
      : derived('NOT_READY', serverMsg('{키}={값} (목표 {목표})', { 키: key, 값: raw || { k: '미설정' }, 목표: expected }));
  }

  /**
   * H 영역 — 서비스 개시 설정 확정. `flag:<key>=<target>`
   *  · target 'false'/'true' = 자동 판정(개발 전용 기능이 켜진 채 개시되는 것을 막는 용도)
   *  · target 'DECIDE'       = 자동 판정 불가(운영/임상/법무 결정) → **현재값을 보여주고** 수동 status 존중
   */
  private async deriveServiceFlag(sourceKey: string, manualStatus: string): Promise<Derived & { auto: boolean }> {
    const m = sourceKey.match(/^flag:(.+)=(.+)$/);
    if (!m) return { ...derived('NOT_READY', serverMsg('소스 미정')), auto: true };
    const [, key, target] = m;
    const read = await this.readConfig(key);
    if (!read.ok) return { ...GoLiveService.UNREADABLE(key), auto: true };
    const raw = read.v;
    const unset = raw === null || raw === undefined || String(raw).trim() === '';
    const cur = unset ? '' : String(raw).replace(/^"|"$/g, '');
    // 미설정은 번역 대상 낱말 조각({k}), 실제 값은 그대로
    const curParam = unset ? { k: '미설정' } : cur;
    if (target === 'DECIDE') {
      return { ...derived(manualStatus as Status, serverMsg('현재 {현재} — 개시 전 운영 결정 필요', { 현재: curParam })), auto: false };
    }
    const ok = !unset && cur === target;
    return { ...derived(ok ? 'READY' : 'NOT_READY', serverMsg('현재 {현재} (개시 목표 {목표})', { 현재: curParam, 목표: target })), auto: true };
  }

  private async deriveStatus(item: { area: string; sourceKey: string | null; targetMode: string | null; status: string }): Promise<{ status: Status; detail?: string; detailMsg?: ServerMessage; auto: boolean; evidence: EvidenceKind }> {
    const sk = item.sourceKey;
    // 수동 항목 — 근거는 화면 밖(담당자 신고). 준비율에서 실검증과 구분해 센다
    if (!sk) return { status: item.status as Status, auto: false, evidence: 'SELF_REPORTED' };
    if (sk === 'phase0') return { ...(await this.derivePhase0()), auto: true, evidence: 'VERIFIED' };
    if (sk === 'hospitalInfo') return { ...(await this.deriveHospitalInfo()), auto: true, evidence: 'VERIFIED' };
    if (sk === 'ginIndex') return { ...(await this.deriveGinIndex()), auto: true, evidence: 'VERIFIED' };
    if (sk === 'dbBackup') return { ...(await this.deriveDbBackup()), auto: true, evidence: 'VERIFIED' };
    if (sk === 'encryptionKey') return { ...this.deriveEncryptionKey(), auto: true, evidence: 'VERIFIED' };
    if (sk === 'hisMode') return { ...(await this.deriveHisMode()), auto: true, evidence: 'VERIFIED' };
    if (sk === 'institutionGrade') return { ...(await this.deriveInstitutionGrade()), auto: true, evidence: 'VERIFIED' };
    if (sk.startsWith('flag:')) {
      const f = await this.deriveServiceFlag(sk, item.status);
      // DECIDE 는 자동 판정이 아니라 운영 결정 — 그 상태는 자가 신고다
      return { ...f, evidence: f.auto ? 'VERIFIED' : 'SELF_REPORTED' };
    }
    if (item.area === 'B') return { ...(await this.deriveIntegration(sk)), auto: true, evidence: 'VERIFIED' };
    // A/E/G config gate
    const read = await this.readConfig(sk);
    if (!read.ok) return { ...GoLiveService.UNREADABLE(sk), auto: true, evidence: 'VERIFIED' };
    return { ...this.deriveConfigGate(read.v, item.targetMode ?? undefined), auto: true, evidence: 'VERIFIED' };
  }

  /** 롤업 — 전 항목 status 파생 + 영역 집계 + 준비도 점수 + 크리티컬 패스 */
  async rollup() {
    await this.ensureSeeded();
    const items = await this.prisma.goLiveItem.findMany({
      orderBy: [{ area: 'asc' }, { key: 'asc' }],
      include: { approvals: { orderBy: { createdAt: 'desc' }, take: 1 }, _count: { select: { approvals: true } } },
    });
    const now = Date.now();
    const defByKey = new Map(GO_LIVE_REGISTRY.map((d) => [d.key, d]));
    const resolved = await Promise.all(items.map(async (it) => {
      const d = await this.deriveStatus(it);
      // 지연 = 목표일 경과 + 아직 미준비(블로커면 크리티컬)
      const overdue = !!it.targetDate && it.targetDate.getTime() < now && !READY_SET.has(d.status);
      const last = it.approvals[0];
      return {
        id: it.id, area: it.area, areaLabel: AREA_LABEL[it.area as keyof typeof AREA_LABEL] ?? it.area,
        key: it.key, title: it.title, type: it.type, owner: it.owner,
        status: d.status, detail: d.detail, detailMsg: d.detailMsg ?? null, auto: d.auto, evidence: d.evidence, overdue,
        blocker: it.blocker, drillDown: it.drillDown, targetMode: it.targetMode,
        isBlocking: it.isBlocking, targetDate: it.targetDate, updatedAt: it.updatedAt,
        note: defByKey.get(it.key)?.note ?? null, // 개시 시 확인 사항(레지스트리 정본)
        approvalCount: it._count.approvals,
        lastApproval: last ? { action: last.action, actorName: last.actorName, reason: last.reason, at: last.createdAt } : null,
      };
    }));

    // 영역 롤업
    const areas = Object.keys(AREA_LABEL).map((a) => {
      const list = resolved.filter((r) => r.area === a);
      const ready = list.filter((r) => READY_SET.has(r.status)).length;
      const blocked = list.filter((r) => r.status === 'BLOCKED').length;
      return { area: a, label: AREA_LABEL[a as keyof typeof AREA_LABEL], total: list.length, ready, blocked };
    }).filter((x) => x.total > 0);

    // 준비도 점수(blocking 항목만)
    // 🔴 예전 식은 `blocking.length ? … : 100` — **필수 항목이 0건이면 자동 100%** 였고 배너가
    //    "✅ 실운영 전환 가능"을 띄웠다. 표본이 없으면 100% 가 아니라 **산출 불가**다.
    const blocking = resolved.filter((r) => r.isBlocking);
    const readyItems = blocking.filter((r) => READY_SET.has(r.status));
    const blockingReady = readyItems.length;
    const verifiedReady = readyItems.filter((r) => r.evidence === 'VERIFIED').length;
    const selfReportedReady = blockingReady - verifiedReady;
    const computable = blocking.length > 0;
    const basisMsg = computable
      ? serverMsg('필수 {필수}건 중 준비 {준비}건(시스템 실검증 {실검증} · 담당자 자가신고 {자가신고})', {
          필수: blocking.length, 준비: blockingReady, 실검증: verifiedReady, 자가신고: selfReportedReady,
        })
      : serverMsg('필수 항목이 0건 — 준비율 산출 불가(분모 없음)');
    const readinessPct = computable ? Math.round((blockingReady / blocking.length) * 100) : null;
    const verifiedPct = computable ? Math.round((verifiedReady / blocking.length) * 100) : null;

    // 크리티컬 패스 = blocking인데 미준비/BLOCKED
    const criticalPath = resolved
      .filter((r) => r.isBlocking && !READY_SET.has(r.status))
      .sort((a, b) => (a.status === 'BLOCKED' ? -1 : 1));

    const overdueCount = resolved.filter((r) => r.overdue).length;

    return {
      generatedAt: new Date().toISOString(),
      readinessPct, blockingTotal: blocking.length, blockingReady, overdueCount,
      // 근거 종류 분해 — "65%" 안에 실검증과 자가 신고가 몇 건씩 들어 있는지 화면이 밝힐 수 있게 한다
      readiness: {
        computable, pct: readinessPct, verifiedPct,
        total: blocking.length, ready: blockingReady, verifiedReady, selfReportedReady,
        basis: renderServerMessageKo(basisMsg),
        basisMsg,
      },
      // 표본이 없으면 전환 가능이 아니다. 필수 항목 전부가 준비됐을 때만 true.
      canGoLive: computable && blockingReady === blocking.length,
      areas, criticalPath, items: resolved,
    };
  }

  /** 지연 항목(목표일 경과+미준비) — 알림 크론용 */
  async overdueItems() {
    const r = await this.rollup();
    return r.items.filter((i) => i.overdue);
  }

  /** 일일 준비도 스냅샷(추이) — capturedOn(UTC date) 멱등 upsert. 직전 대비 canGoLive 전환 여부 반환 */
  async snapshot() {
    const r = await this.rollup();
    // 산출 불가(필수 0건)면 추이에 숫자를 남기지 않는다 — 빈 표본을 0/100 어느 쪽으로도 기록하지 않는다
    if (r.readinessPct === null) {
      this.logger.warn('운영 전환 준비율 산출 불가(필수 항목 0건) — 스냅샷 미기록');
      return { readinessPct: null, canGoLive: false, justReachedReady: false, computable: false };
    }
    const capturedOn = todayDateOnly(); // 🔴 KST 날짜의 UTC 자정 — toISOString().slice 는 KST 오전에 전날
    const prev = await this.prisma.goLiveSnapshot.findFirst({ where: { capturedOn: { lt: capturedOn } }, orderBy: { capturedOn: 'desc' }, select: { readinessPct: true } });
    await this.prisma.goLiveSnapshot.upsert({
      where: { capturedOn },
      update: { readinessPct: r.readinessPct, blockingReady: r.blockingReady, blockingTotal: r.blockingTotal, overdueCount: r.overdueCount },
      create: { capturedOn, readinessPct: r.readinessPct, blockingReady: r.blockingReady, blockingTotal: r.blockingTotal, overdueCount: r.overdueCount },
    });
    return { readinessPct: r.readinessPct, canGoLive: r.canGoLive, computable: true, justReachedReady: r.canGoLive && (prev ? prev.readinessPct < 100 : true) };
  }

  /** 준비도 추이(최근 N일) */
  async trend(days = 30) {
    const from = new Date(Date.now() - days * 86400_000);
    return this.prisma.goLiveSnapshot.findMany({
      where: { capturedOn: { gte: from } }, orderBy: { capturedOn: 'asc' },
      select: { capturedOn: true, readinessPct: true, overdueCount: true },
    });
  }

  /** 수동 항목 상태/blocker/소유/목표일 갱신(자동 파생 항목은 거부) */
  async updateItem(key: string, patch: { status?: string; blocker?: string; owner?: string; targetDate?: string }, userId: string) {
    const item = await this.prisma.goLiveItem.findUnique({ where: { key }, select: { id: true, sourceKey: true } });
    if (!item) throw new NotFoundException('항목을 찾을 수 없습니다.');
    // 🔴 (2026-09-13) hospitalInfo 는 DB 행 실측(DB_PROBE)으로 바뀌어 수동 상태 변경 예외에서 뺐다 — 사람이 "완비"를 선언할 수 없다
    if (item.sourceKey && item.sourceKey !== 'phase0') {
      // A/E/G config gate·C·D는 자동 파생 — 상태는 해당 상세 화면에서 조작(수동 변경 거부). blocker/owner 메모는 허용
      if (patch.status) throw new BadRequestException('자동 파생 항목의 상태는 해당 상세 화면에서 변경하세요(config 게이트).');
    }
    const data: Record<string, unknown> = { updatedBy: userId };
    if (patch.status) data.status = patch.status;
    if (patch.blocker !== undefined) data.blocker = patch.blocker || null;
    if (patch.owner !== undefined) data.owner = patch.owner || null;
    if (patch.targetDate !== undefined) data.targetDate = patch.targetDate ? new Date(patch.targetDate) : null;
    await this.prisma.goLiveItem.update({ where: { key }, data });
    return { ok: true };
  }

  /** 항목 승인/철회 기록(거버넌스 사인오프·감사). 상태는 별도(자동 파생/수동)이며 승인은 근거 기록 */
  async approve(key: string, action: 'APPROVE' | 'REVOKE', userId: string, userName: string, reason: string) {
    if (!reason?.trim()) throw new BadRequestException('승인 근거(사유)는 필수입니다.');
    const item = await this.prisma.goLiveItem.findUnique({ where: { key }, select: { id: true, title: true } });
    if (!item) throw new NotFoundException('항목을 찾을 수 없습니다.');
    await this.prisma.goLiveApproval.create({ data: { itemId: item.id, action, actorId: userId, actorName: userName, reason: reason.trim() } });
    await this.prisma.auditLog.create({
      data: { userId, action: 'UPDATE', resourceType: `GOLIVE_${action}`, resourceId: item.id, changes: { key, reason: reason.trim() } as never },
    }).catch((e) => {
      // 승인 원장(goLiveApproval)은 이미 남았다 — 감사 사본 실패를 조용히 삼키지 않는다
      this.logger.warn(`go-live ${action} audit write failed key=${key}: ${e instanceof Error ? e.message : String(e)}`);
    });
    this.logger.log(`운영 전환 항목 ${action}: ${key} by ${userName}`);
    return { ok: true };
  }

  async getApprovals(key: string) {
    const item = await this.prisma.goLiveItem.findUnique({ where: { key }, select: { id: true } });
    if (!item) throw new NotFoundException('항목을 찾을 수 없습니다.');
    return this.prisma.goLiveApproval.findMany({ where: { itemId: item.id }, orderBy: { createdAt: 'desc' } });
  }
}
