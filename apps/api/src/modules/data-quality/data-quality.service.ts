import { Injectable, Logger, Optional, ForbiddenException } from '@nestjs/common';
import { localDateTimeKey, todayDateOnly } from '../../common/day-range';
import { normalizePhone } from '../../common/phone';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { Cron, CronExpression } from '@nestjs/schedule';
import { QualityMetric, canViewMetric, ALL_QUALITY_METRICS } from './quality-registry';
import { redactForAiEgress } from '../../common/util/ai-phi-redact';
import { aiEgressFetch } from '../../common/util/ai-egress-fetch';
import { AI_DEFAULT_DISCLAIMER, AI_ORIGIN_TEXT } from '@hospital-run/shared';
import { CRITICAL_ALERT_ACKNOWLEDGED_STATUSES, CRITICAL_ALERT_OPEN_STATUSES } from '../lab/critical-value-alert-states';

/**
 * 특수 지표(레지스트리 밖 — raw SQL 필요) 정의 **정본**.
 * 🔴 산출에 성공하든 실패하든 화면에는 **같은 5줄**이 있어야 한다 — 실패로 줄이 사라지면
 *    화면은 그것을 "그런 지표는 없다"로 읽는다. 그래서 라벨·드릴다운을 여기 한 곳에 둔다.
 */
const SPECIAL_METRIC_DEFS = [
  { key: 'patient.dupSuspect', domain: 'patient', label: '중복 의심(동명·동생일 그룹)', drillDown: '/patients?quality=dupSuspect', severityWhenOver: 'WARNING' as const },
  { key: 'patient.nationalitySuspect', domain: 'patient', label: '국적 불일치 의심(비한글 이름·KR)', drillDown: '/patients?quality=nationalitySuspect', severityWhenOver: 'INFO' as const },
  { key: 'order.durOverrideWeak', domain: 'order', label: 'DUR 오버라이드 사유 부실(<10자)', drillDown: 'panel', severityWhenOver: 'WARNING' as const },
  { key: 'admission.summaryMissing', domain: 'admission', label: '퇴원요약 미서명(최근 30일 — 누적 지표와 다른 질문)', drillDown: 'panel', severityWhenOver: 'WARNING' as const },
  { key: 'foreign.consentLangGap', domain: 'patient', label: '언어판 동의서 갭(외국인 언어)', drillDown: 'panel', severityWhenOver: 'INFO' as const },
] as const;

/** 도메인별 품질 지표 집계 — P0=환자, P1+에서 도메인 provider 추가 등록 */
@Injectable()
export class DataQualityService {
  private readonly logger = new Logger(DataQualityService.name);
  private readonly metrics: QualityMetric[] = ALL_QUALITY_METRICS;

  constructor(private readonly prisma: PrismaService, @Optional() private readonly config?: ConfigRuntimeService) {}

  /** 특수 지표(레지스트리 밖 — raw 필요): 중복 의심·국적 불일치. patient.service resolveQualityIds와 동일 판정 */
  private async specialPatientMetrics() {
    const [dup, nat] = await Promise.all([
      this.prisma.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(*) as count FROM (
          SELECT family_name, given_name, date_of_birth FROM patients
          WHERE valid_to IS NULL
          GROUP BY family_name, given_name, date_of_birth HAVING COUNT(*) > 1
        ) dups`,
      this.prisma.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(*) as count FROM patients
        WHERE valid_to IS NULL AND (nationality IS NULL OR nationality IN ('KR','KOR'))
          AND (family_name || given_name) !~ '[가-힣]'`,
    ]);
    const [durWeak, summaryMissing, langGap] = await Promise.all([
      this.prisma.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(*) as count FROM prescriptions
        WHERE dur_override_reason IS NOT NULL AND length(trim(dur_override_reason)) < 10`,
      this.prisma.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(*) as count FROM admissions a
        WHERE a.status = 'DISCHARGED' AND a.discharge_date >= now() - interval '30 days'
          AND NOT EXISTS (
            SELECT 1 FROM discharge_summaries ds
            WHERE ds.admission_id = a.id AND ds.status IN ('SIGNED', 'AMENDED'))`,
      this.prisma.$queryRaw<{ lang: string }[]>`
        SELECT DISTINCT p.preferred_language as lang FROM patients p
        WHERE p.valid_to IS NULL AND p.nationality IS NOT NULL AND p.nationality NOT IN ('KR', 'KOR')
          AND p.preferred_language IS NOT NULL AND p.preferred_language <> 'ko'
          AND NOT EXISTS (SELECT 1 FROM consent_templates ct WHERE ct.language = p.preferred_language)`,
    ]);
    const values: Record<string, number> = {
      'patient.dupSuspect': Number(dup[0]?.count ?? 0),
      'patient.nationalitySuspect': Number(nat[0]?.count ?? 0),
      'order.durOverrideWeak': Number(durWeak[0]?.count ?? 0),
      'admission.summaryMissing': Number(summaryMissing[0]?.count ?? 0),
      'foreign.consentLangGap': langGap.length,
    };
    return SPECIAL_METRIC_DEFS.map((d) => ({
      ...d,
      value: values[d.key],
      ...(d.key === 'foreign.consentLangGap' ? { detail: langGap.map((l) => l.lang).join(', ') } : {}),
    }));
  }

  /** panel 지표 상세 워크리스트(상위 50) — 관제 페이지 인라인 표시용 */
  async detail(key: string, role?: string | null) {
    // 🔴 B4: 워크리스트(PII 포함)는 그 지표를 볼 권한이 있는 역할에게만
    const metric = this.metrics.find((m) => m.key === key);
    if (metric && !canViewMetric(metric, role)) throw new ForbiddenException('이 지표 워크리스트 열람 권한이 없습니다');
    const D = 86400_000; const H = 3600_000;
    switch (key) {
      case 'encounter.unsignedStale': {
        const rows = await this.prisma.encounter.findMany({
          where: { status: 'DRAFT', createdAt: { lt: new Date(Date.now() - 48 * H) } },
          select: { id: true, createdAt: true, patient: { select: { familyName: true, givenName: true, mrn: true } }, doctor: { select: { familyName: true, givenName: true } } },
          orderBy: { createdAt: 'asc' }, take: 50,
        });
        return rows.map((r) => ({ id: r.id, title: `${r.patient.familyName}${r.patient.givenName} (${r.patient.mrn})`, sub: `담당의 ${r.doctor?.familyName ?? ''}${r.doctor?.givenName ?? ''} · ${r.createdAt.toISOString().slice(0, 10)}`, href: undefined }));
      }
      case 'encounter.noDiagnosis': {
        const rows = await this.prisma.encounter.findMany({
          where: { status: { in: ['SIGNED', 'AMENDED'] }, createdAt: { gte: new Date(Date.now() - 30 * D) }, diagnoses: { none: {} } },
          select: { id: true, createdAt: true, patientId: true, patient: { select: { familyName: true, givenName: true, mrn: true } } },
          orderBy: { createdAt: 'desc' }, take: 50,
        });
        return rows.map((r) => ({ id: r.id, title: `${r.patient.familyName}${r.patient.givenName} (${r.patient.mrn})`, sub: r.createdAt.toISOString().slice(0, 10), href: `/patients/${r.patientId}` }));
      }
      case 'order.durOverrideWeak': {
        const rows = await this.prisma.$queryRaw<{ id: string; reason: string; patient_id: string; family_name: string; given_name: string }[]>`
          SELECT rx.id::text as id, rx.dur_override_reason as reason, e.patient_id::text as patient_id, p.family_name, p.given_name
          FROM prescriptions rx
          JOIN encounters e ON e.id = rx.encounter_id
          JOIN patients p ON p.id = e.patient_id
          WHERE rx.dur_override_reason IS NOT NULL AND length(trim(rx.dur_override_reason)) < 10
          ORDER BY rx.created_at DESC LIMIT 50`;
        return rows.map((r) => ({ id: r.id, title: `${r.family_name}${r.given_name}`, sub: `사유: "${r.reason}"`, href: `/patients/${r.patient_id}` }));
      }
      case 'admission.summaryMissing': {
        const rows = await this.prisma.$queryRaw<{ id: string; discharge_date: Date; patient_id: string; family_name: string; given_name: string; mrn: string }[]>`
          SELECT a.id::text as id, a.discharge_date, a.patient_id::text as patient_id, p.family_name, p.given_name, p.mrn
          FROM admissions a JOIN patients p ON p.id = a.patient_id
          WHERE a.status = 'DISCHARGED' AND a.discharge_date >= now() - interval '30 days'
            AND NOT EXISTS (SELECT 1 FROM discharge_summaries ds WHERE ds.admission_id = a.id AND ds.status IN ('SIGNED', 'AMENDED'))
          ORDER BY a.discharge_date DESC LIMIT 50`;
        return rows.map((r) => ({ id: r.id, title: `${r.family_name}${r.given_name} (${r.mrn})`, sub: `퇴원 ${new Date(r.discharge_date).toISOString().slice(0, 10)}`, href: `/patients/${r.patient_id}` }));
      }
      case 'foreign.consentLangGap': {
        const rows = await this.prisma.$queryRaw<{ lang: string; cnt: bigint }[]>`
          SELECT p.preferred_language as lang, COUNT(*) as cnt FROM patients p
          WHERE p.valid_to IS NULL AND p.nationality IS NOT NULL AND p.nationality NOT IN ('KR', 'KOR')
            AND p.preferred_language IS NOT NULL AND p.preferred_language <> 'ko'
            AND NOT EXISTS (SELECT 1 FROM consent_templates ct WHERE ct.language = p.preferred_language)
          GROUP BY p.preferred_language`;
        return rows.map((r) => ({ id: r.lang, title: `언어 '${r.lang}' 템플릿 없음`, sub: `해당 언어 외국인 ${Number(r.cnt)}명`, href: '/admin/consent' }));
      }
      case 'lab.criticalPending':
      case 'lab.readBackMissing': {
        // CriticalValueAlert는 patient 관계 미정의(patientId만) — 배치 조회로 매핑
        const where = key === 'lab.criticalPending'
          ? { status: { in: CRITICAL_ALERT_OPEN_STATUSES } }
          : { status: { in: CRITICAL_ALERT_ACKNOWLEDGED_STATUSES }, readBackConfirmed: false, acknowledgedAt: { lt: new Date(Date.now() - 24 * H) } };
        const rows = await this.prisma.criticalValueAlert.findMany({
          where, select: { id: true, testName: true, value: true, unit: true, notifiedAt: true, acknowledgedAt: true, patientId: true },
          orderBy: { notifiedAt: 'asc' }, take: 50,
        });
        const pids = [...new Set(rows.map((r) => r.patientId))];
        const pts = pids.length ? await this.prisma.patient.findMany({ where: { id: { in: pids } }, select: { id: true, familyName: true, givenName: true, mrn: true } }) : [];
        const byId = new Map(pts.map((p2) => [p2.id, p2]));
        return rows.map((r) => {
          const pt = byId.get(r.patientId);
          return {
            id: r.id,
            title: `${pt?.familyName ?? ''}${pt?.givenName ?? ''} — ${r.testName} ${r.value}${r.unit}`,
            sub: key === 'lab.criticalPending'
              ? `통보 ${r.notifiedAt ? localDateTimeKey(r.notifiedAt) : '-'}`
              : `확인 ${r.acknowledgedAt?.toISOString().slice(0, 10) ?? '-'} · read-back 미확인`,
            href: pt ? `/patients/${pt.id}` : undefined,
          };
        });
      }
      case 'staff.credentialExpiring': {
        const rows = await this.prisma.staffCredential.findMany({
          where: { OR: [{ status: 'EXPIRED' }, { expiresAt: { lt: new Date(Date.now() + 60 * D) } }] },
          select: { id: true, type: true, name: true, expiresAt: true, status: true, userId: true },
          orderBy: { expiresAt: 'asc' }, take: 50,
        });
        const uids = [...new Set(rows.map((r) => r.userId))];
        const staffs = uids.length ? await this.prisma.staff.findMany({ where: { userId: { in: uids } }, select: { userId: true, familyName: true, givenName: true, department: true } }) : [];
        const byUid = new Map(staffs.map((st) => [st.userId, st]));
        return rows.map((r) => {
          const st = byUid.get(r.userId);
          return { id: r.id, title: `${st?.familyName ?? ''}${st?.givenName ?? ''} — ${r.name ?? r.type}`, sub: `${r.status === 'EXPIRED' ? '만료됨' : `만료 ${r.expiresAt?.toISOString().slice(0, 10) ?? '-'}`} · ${st?.department ?? ''}`, href: '/hr' };
        });
      }
      case 'staff.noManager': {
        const rows = await this.prisma.staff.findMany({
          where: { status: 'ACTIVE', managerStaffId: null },
          select: { id: true, familyName: true, givenName: true, department: true, position: true },
          take: 50,
        });
        return rows.map((r) => ({ id: r.id, title: `${r.familyName}${r.givenName}`, sub: `${r.department ?? ''} ${r.position ?? ''} — 보고라인 미지정(결재 상신 불가)`, href: '/hr' }));
      }
      case 'patient.dupSuspect': {
        // C2: 그룹 단위 상세(동명·동생일) — 병합 판단용
        const rows = await this.prisma.$queryRaw<{ family_name: string; given_name: string; date_of_birth: Date | null; mrns: string[]; cnt: bigint }[]>`
          SELECT family_name, given_name, date_of_birth, array_agg(mrn ORDER BY mrn) as mrns, COUNT(*) as cnt
          FROM patients WHERE valid_to IS NULL
          GROUP BY family_name, given_name, date_of_birth HAVING COUNT(*) > 1
          ORDER BY COUNT(*) DESC LIMIT 50`;
        return rows.map((r, i) => ({
          id: `dup-${i}`,
          title: `${r.family_name}${r.given_name} (${r.date_of_birth ? new Date(r.date_of_birth).toISOString().slice(0, 10) : '생일 미상'}) — ${Number(r.cnt)}건`,
          sub: `MRN: ${r.mrns.join(' · ')} — 병합은 환자 관리 상단 '병합'에서`,
          href: `/patients?q=${encodeURIComponent(r.given_name ?? '')}`,
        }));
      }
      default: return [];
    }
  }

  // ── AI 컨시어지(C1/C2) — 게이트 quality.ai.enabled 기본 OFF·Human-in-loop·집계/최소필드만 전달 ──

  private async aiEnabled(): Promise<boolean> {
    return String((await this.config?.get('quality.ai.enabled').catch(() => 'false')) ?? 'false') === 'true';
  }

  /** WeRU.B generate(formulary 패턴 — NDJSON 병합·ai.server kill switch는 상위 config로 대변) */
  private async llmGenerate(prompt: string, timeoutMs = 60_000): Promise<string> {
    const [url, key, enabled] = await Promise.all([
      this.config?.get('ai.server.url') as Promise<string | undefined>,
      this.config?.get('ai.server.gpuKey') as Promise<string | undefined>,
      this.config?.get('ai.server.enabled') as Promise<unknown>,
    ]);
    if (enabled === false || String(enabled) === 'false') throw new Error('AI 비활성(kill switch)');
    if (!url) throw new Error('ai.server.url 미설정'); // P0-6 규약
    // G3: 목적지 검증 + 경계 통과 감사를 한 경로로(정본 common/util/ai-egress-fetch).
    // 이전에는 검증(assertAiServerUrl)만 있고 감사가 없었다 — 무엇이 얼마나 나갔는지 남지 않았다.
    const res = await aiEgressFetch(url, '/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({ model: 'qwen2.5:14b', prompt, stream: false, options: { temperature: 0.2 } }),
      signal: AbortSignal.timeout(timeoutMs),
    }, { client: 'data-quality' });
    if (!res.ok) throw new Error(`AI 서버 ${res.status}`);
    let full = '';
    for (const line of (await res.text()).split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try { full += (JSON.parse(t) as { response?: string }).response ?? ''; } catch { /* skip */ }
    }
    return full.trim();
  }

  /** C1 품질 브리핑 — 지표 스냅샷(숫자만·환자 식별자 0)→우선순위 요약. AI 불가 시 규칙 기반 폴백 */
  async briefing() {
    const { domains } = await this.summary();
    const flat = domains.flatMap((d) => d.metrics).filter((m) => m.value > 0 && !('error' in m && m.error));
    const critical = flat.filter((m) => m.severityWhenOver === 'CRITICAL');
    const warning = flat.filter((m) => m.severityWhenOver === 'WARNING');
    const fallback = [
      critical.length ? `🚨 즉시: ${critical.map((m) => `${m.label} ${m.value}건`).join(', ')}` : null,
      // 🔴 종전 `warning.slice(0,5)` 가 **잘랐다는 표시 없이** 경고를 5개로 잘랐다 — 화면 실사용 점검 W8.
      //    WARNING 9건 중 4건이 브리핑에서 조용히 사라졌고, 읽는 사람은 그게 전부라고 믿었다.
      //    (AI 경로는 전량을 넘기므로 모드에 따라 항목 수가 달라지는 모순도 있었다.)
      //    자를 수는 있다 — **자른 사실을 말해야 한다.**
      warning.length
        ? `⚠ 우선: ${warning.slice(0, 5).map((m) => `${m.label} ${m.value}건`).join(', ')}${warning.length > 5 ? ` 외 ${warning.length - 5}건` : ''}`
        : null,
      '각 카드의 워크리스트에서 담당자 확인 후 조치하세요.',
    ].filter(Boolean).join('\n');

    if (!(await this.aiEnabled())) return { mode: 'rule' as const, text: fallback };
    try {
      const snapshot = flat.map((m) => ({ label: m.label, value: m.value, severity: m.severityWhenOver }));
      const prompt = `너는 병원 데이터 품질 관리 보조자다. 아래 품질 지표(집계 숫자만)를 보고 이번 주 우선 처리 3가지를 한국어로 간결히 제안하라. 임상 판단·진단 금지, 행정 조치 순서만. 각 항목 1줄, 마지막에 근거 1줄.\n지표: ${JSON.stringify(snapshot)}`;
      const text = await this.llmGenerate(prompt);
      // 🔴 (2026-10-01 .catch 비리터럴 판정) 종전 `.catch(() => '')` — `'' ?? 기본` 은 기본으로 떨어지지 않아 조회 실패 시 **AI 고지가 빈 문자열**이
      //    됐다(AI기본법 표기). 실패도 미설정처럼 기본 고지로 — 고지를 빼는 쪽으로는 폴백하지 않는다.
      const disclaimer = String((await this.config?.get('ai.disclaimer').catch(() => null)) ?? AI_DEFAULT_DISCLAIMER);
      return { mode: 'ai' as const, text, disclaimer };
    } catch (e) {
      this.logger.warn(`C1 브리핑 AI 실패 — 규칙 폴백: ${(e as Error).message}`);
      return { mode: 'rule' as const, text: fallback };
    }
  }

  /** C2 중복 의심 AI 판별 — 상위 N그룹·최소 필드(이름·생일·성별·전화 뒤4)만 전달. 병합은 사람(기존 EP) */
  async scoreDuplicates(limit = 10) {
    if (!(await this.aiEnabled())) return { mode: 'rule' as const, pairs: [] };
    const groups = await this.prisma.$queryRaw<{ family_name: string; given_name: string; date_of_birth: Date | null }[]>`
      SELECT family_name, given_name, date_of_birth FROM patients WHERE valid_to IS NULL
      GROUP BY family_name, given_name, date_of_birth HAVING COUNT(*) > 1
      ORDER BY COUNT(*) DESC LIMIT ${limit}`;
    const pairs: { group: string; score: number; reason: string }[] = [];
    for (const g of groups) {
      const members = await this.prisma.patient.findMany({
        where: { validTo: null, familyName: g.family_name, givenName: g.given_name, dateOfBirth: g.date_of_birth ?? undefined },
        select: { gender: true, phone: true, nationality: true },
        take: 5,
      });
      const feat = members.map((m) => ({ gender: m.gender, phoneTail: m.phone?.slice(-4) ?? null, nat: m.nationality }));
      try {
        // 🔴 P14(주석이 밝힌 조건이 구현에 없음): 주석은 "(식별자 없음)"이라 적혀 있는데 프롬프트는
        //    **환자 실명과 생년월일을 그대로** 외부 AI 로 보내고 있었다. 그 둘은 이 판별에 필요하지도 않다 —
        //    묶음의 전제(이름·생일 동일)는 SQL GROUP BY 가 이미 보장하므로, LLM 이 볼 것은 나머지 특징뿐이다.
        //    실명·전체 생일은 서버 안에 남기고 **출생연도만** 넘긴다. redactForAiEgress 는 남은 본문(feat 등)에
        //    이름·연락처가 섞여 들어오는 경우까지 잡는 2차 그물이다. 정본: common/util/ai-phi-redact.ts
        const birthYear = g.date_of_birth ? new Date(g.date_of_birth).getFullYear() : null;
        const red = redactForAiEgress(
          `동일인 여부 판별 보조. **이름과 생년월일이 이미 동일한** 환자 레코드 묶음이다(성명·생일은 전달하지 않는다). 나머지 특징이 서로 모순 없으면 동일인 가능성이 높다. JSON만 출력: {"score": 0~1 숫자, "reason": "한 줄"}\n출생연도: ${birthYear ?? '미상'}\n레코드 특징: ${JSON.stringify(feat)}`,
          { patientNames: [`${g.family_name}${g.given_name}`] },
        );
        const out = await this.llmGenerate(red.text, 30_000);
        const m = out.match(/\{[\s\S]*?\}/);
        const parsed = m ? JSON.parse(m[0]) as { score?: number; reason?: string } : {};
        pairs.push({ group: `${g.family_name}${g.given_name}`, score: Math.min(1, Math.max(0, Number(parsed.score ?? 0))), reason: String(parsed.reason ?? '').slice(0, 120) });
      } catch {
        pairs.push({ group: `${g.family_name}${g.given_name}`, score: 0, reason: 'AI 판별 실패 — 수동 확인' });
      }
    }
    return { mode: 'ai' as const, pairs };
  }

  /** 일일 스냅샷(06시 — 04시 응급정리·05시 알림보존과 분산). 숫자만 저장·보존 365일 */
  @Cron('0 6 * * *')
  async captureSnapshot() {
    const { domains } = await this.summary();
    // 🔴 크론이 06:00 KST(=전날 21:00 UTC)라 `toISOString().slice(0,10)` 은 **전날** UTC 날짜다 →
    //    capturedOn(@db.Date)이 매일 하루 밀려 저장됐다(@@unique 라 추이가 굳음). 정본 todayDateOnly()=KST 날짜.
    const today = todayDateOnly();
    let saved = 0;
    const failed: string[] = [];
    for (const d of domains) {
      for (const m of d.metrics) {
        if (m.value < 0) continue;
        await this.prisma.qualityMetricSnapshot.upsert({
          where: { metricKey_capturedOn: { metricKey: m.key, capturedOn: today } },
          create: { metricKey: m.key, value: m.value, total: (m as { total?: number }).total ?? null, capturedOn: today },
          update: { value: m.value, total: (m as { total?: number }).total ?? null },
        }).then(() => { saved++; }).catch((e) => {
          // 🔴 종전엔 `catch` 밖에서 `saved++` 를 해 **실패분까지 저장된 것으로 셌다**
          //    ("실행하지 않고 성공 상태만 기록" — 감시자 자신이 그러면 추이 전체를 못 믿는다)
          failed.push(m.key);
          this.logger.warn(`스냅샷 저장 실패 ${m.key}: ${(e as Error).message}`);
        });
      }
    }
    // 🔴 (2026-10-01 .catch 비리터럴 판정) 종전 `.catch(() => 365)` — 보존기간 조회가 실패하면 **기본 365일로 지웠다**.
    //    원내가 더 길게 정해 두었어도 설정 서비스가 잠깐 죽으면 그 사이 스냅샷이 사라진다(지우는 쪽 폴백 = 되돌릴 수 없다).
    //    실패면 이번 정리는 건너뛴다(미설정은 종전대로 365).
    let retention: number | null = null;
    try {
      retention = Number((await this.config?.get('quality.snapshot.retentionDays')) ?? 365);
    } catch (e) {
      this.logger.warn(`품질 스냅샷 보존기간 조회 실패 — 이번 정리 건너뜀: ${(e as Error).message}`);
    }
    if (retention !== null && Number.isFinite(retention) && retention > 0) {
      await this.prisma.qualityMetricSnapshot.deleteMany({ where: { capturedOn: { lt: new Date(Date.now() - retention * 86400_000) } } }).catch(() => undefined);
    }
    if (failed.length) this.logger.warn(`품질 스냅샷 저장 실패 ${failed.length}건: ${failed.join(', ')}`);
    this.logger.log(`품질 스냅샷 저장: ${saved}건${failed.length ? ` · 실패 ${failed.length}건` : ''}`);
    return { saved, failed: failed.length, failedKeys: failed };
  }

  async trend(key: string, days = 30) {
    const rows = await this.prisma.qualityMetricSnapshot.findMany({
      where: { metricKey: key, capturedOn: { gte: new Date(Date.now() - days * 86400_000) } },
      orderBy: { capturedOn: 'asc' },
      select: { capturedOn: true, value: true, total: true },
    });
    return rows.map((r) => ({ date: r.capturedOn.toISOString().slice(0, 10), value: r.value, total: r.total }));
  }

  async summary(domain?: string, role?: string | null) {
    const targets = this.metrics.filter((m) => (!domain || m.domain === domain) && canViewMetric(m, role));
    const computed = await Promise.all(targets.map(async (m) => {
      try {
        const r = await m.compute(this.prisma);
        const threshold = m.thresholdKey ? Number((await this.config?.get(m.thresholdKey).catch(() => null)) ?? NaN) : NaN;
        return { key: m.key, domain: m.domain, label: m.label, value: r.value, total: r.total, drillDown: m.drillDown, severityWhenOver: m.severityWhenOver, threshold: Number.isFinite(threshold) ? threshold : undefined };
      } catch (e) {
        this.logger.warn(`지표 산출 실패 ${m.key}: ${(e as Error).message}`);
        return { key: m.key, domain: m.domain, label: m.label, value: -1, drillDown: m.drillDown, severityWhenOver: m.severityWhenOver, error: true };
      }
    }));
    /**
     * 🔴 특수 지표 묶음이 실패하면 **카드 5장이 통째로 사라졌다**(2026-08-21).
     *    화면은 없어진 줄을 "그런 지표는 없다"로 읽는다 — 그중엔 '퇴원요약 미완' 같은
     *    미완결 추적 지표가 있다. 레지스트리 지표는 이미 `{error:true, value:-1}` 로 실패를
     *    말하고 화면이 '집계 실패'로 그린다(page.tsx). 같은 계약을 여기에도 쓴다.
     */
    const special = (!domain || domain === 'patient')
      ? await this.specialPatientMetrics().catch((e) => {
          this.logger.warn(`특수 지표 산출 실패(5종 전부): ${(e as Error).message}`);
          return SPECIAL_METRIC_DEFS.map((d) => ({ ...d, value: -1, error: true }));
        })
      : [];
    const all = [...computed, ...special];
    const byDomain = new Map<string, typeof all>();
    for (const m of all) {
      if (!byDomain.has(m.domain)) byDomain.set(m.domain, []);
      byDomain.get(m.domain)!.push(m);
    }
    return { domains: [...byDomain.entries()].map(([d, metrics]) => ({ domain: d, metrics })) };
  }

  // ── P3: C3 아웃리치 초안 · C4 전화 정규화 ──

  /** C3 대상 요약 — 발송 아님·초안+대상 수만. 동의=PatientAccount.marketingConsent(실측 필드) */
  async outreachTargets(typeRaw: 'recall' | 'infoUpdate' | 'passportExpiry') {
    const type = (['recall', 'infoUpdate', 'passportExpiry'].includes(typeRaw) ? typeRaw : 'recall') as 'recall' | 'infoUpdate' | 'passportExpiry';
    const base = type === 'recall'
      ? { validTo: null, encounters: { none: { createdAt: { gte: new Date(Date.now() - 365 * 86400_000) } } } }
      : type === 'passportExpiry'
        ? { validTo: null, nationality: { notIn: ['KR', 'KOR'], not: null }, passportExpiry: { lt: new Date(Date.now() + 90 * 86400_000) } }
        : { validTo: null, phone: null };
    const [total, consented] = await Promise.all([
      this.prisma.patient.count({ where: base as never }),
      this.prisma.patient.count({ where: { ...(base as object), account: { marketingConsent: true } } as never }),
    ]);
    return { type, total, consented, note: consented < total ? '미동의/무계정 환자는 목록 확인 후 연락 여부를 사람이 판단합니다(자동 발송 없음)' : undefined };
  }

  /** C3 초안 생성 — 환자명 미전달({{name}} 토큰)·발송 없음. 게이트 OFF/실패=정적 템플릿 */
  async outreachDraft(typeRaw: 'recall' | 'infoUpdate' | 'passportExpiry', language = 'ko') {
    const type = (['recall', 'infoUpdate', 'passportExpiry'].includes(typeRaw) ? typeRaw : 'recall') as 'recall' | 'infoUpdate' | 'passportExpiry';
    // (2026-10-01) 종전 `.catch(() => '')` — 실패 시 기관명이 빈 문자열이라 초안이 "{{name}}님, 입니다." 가 됐다. 실패도 미설정처럼
    const hospital = String((await this.config?.get('hospital.name').catch(() => null)) ?? '병원');
    const FALLBACK: Record<string, string> = {
      recall: `{{name}}님, ${hospital}입니다. 마지막 내원 후 1년이 지났습니다. 건강 관리를 위해 진료 예약을 안내드립니다.`,
      infoUpdate: `{{name}}님, ${hospital}입니다. 등록된 연락처 정보 갱신이 필요합니다. 다음 내원 시 접수처에 말씀해 주세요.`,
      passportExpiry: `{{name}}님, ${hospital}입니다. 등록된 여권의 만료가 임박했습니다. 갱신 후 접수처에 새 여권 정보를 알려주세요.`,
    };
    if (!(await this.aiEnabled()) || language === 'ko') return { mode: 'template' as const, language: 'ko', text: FALLBACK[type] };
    try {
      const typeDesc = type === 'recall' ? '1년 이상 미내원 환자 리콜(진료 예약 안내)' : type === 'infoUpdate' ? '연락처 정보 갱신 요청' : '여권 만료 임박 안내(갱신 후 정보 업데이트 요청)';
      const text = await this.llmGenerate(
        `병원 안내 메시지 초안 작성. 언어: ${language}. 병원명: ${hospital}. 목적: ${typeDesc}. 환자 이름 자리에는 반드시 {{name}} 토큰 그대로 사용. 정중하고 간결하게 3문장 이내. 의료 조언·진단 금지. 메시지 본문만 출력.`,
        45_000,
      );
      return { mode: 'ai' as const, language, text, disclaimer: `${AI_ORIGIN_TEXT} 초안 — 발송 전 상담데스크 검토·수신동의 확인 필수` };
    } catch (e) {
      this.logger.warn(`C3 초안 AI 실패 — ko 템플릿 폴백: ${(e as Error).message}`);
      return { mode: 'template' as const, language: 'ko', text: FALLBACK[type] };
    }
  }

  /** C4 전화 정규화 — 정본 `common/phone.ts` 재사용(환자 등록·중복검사와 같은 규칙·2026-08-31 승격) */
  private normalizePhone(raw: string): string | null {
    return normalizePhone(raw);
  }

  async normalizePreview() {
    const rows = await this.prisma.patient.findMany({
      where: { validTo: null, phone: { not: null } },
      select: { id: true, mrn: true, familyName: true, givenName: true, phone: true },
      take: 2000,
    });
    const out: { id: string; mrn: string; name: string; before: string; after: string }[] = [];
    for (const r of rows) {
      const after = this.normalizePhone(r.phone!);
      if (after && after !== r.phone) out.push({ id: r.id, mrn: r.mrn, name: `${r.familyName}${r.givenName}`, before: r.phone!, after });
      if (out.length >= 100) break;
    }
    return { candidates: out.length, rows: out };
  }

  /** C4 적용 — 사람이 diff 승인한 id만·감사 로그(before/after) 보존 */
  async normalizeApply(ids: string[], userId: string) {
    let applied = 0;
    for (const id of ids.slice(0, 100)) {
      const p = await this.prisma.patient.findUnique({ where: { id }, select: { phone: true } });
      if (!p?.phone) continue;
      const after = this.normalizePhone(p.phone);
      if (!after || after === p.phone) continue;
      await this.prisma.patient.update({ where: { id }, data: { phone: after } });
      await this.prisma.auditLog.create({
        data: { userId, action: 'UPDATE', resourceType: 'PATIENT_PHONE_NORMALIZE', resourceId: id, changes: { before: p.phone, after } as never },
      }).catch(() => undefined);
      applied++;
    }
    return { applied };
  }
}
