import { Injectable, BadRequestException, ConflictException, Logger, NotFoundException, Optional } from '@nestjs/common';
import { configEnvOverride } from '../../common/config-env-overrides';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { medicationSearchOrTerms } from '../../common/medication-search';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { FormularyGateService, FORMULARY_DOMAINS, FORMULARY_CODE_TYPE, FormularyDomain } from './formulary-gate.service';
import { aiEgressFetch } from '../../common/util/ai-egress-fetch';
import { aiDisabledException, isAiServerEnabled } from '../../common/util/ai-kill-switch';
import { TruncationRecorder } from '../../common/stored-truncation';
import { isFormularyPresetKey } from '@hospital-run/shared';
import {
  CSV_MAX_BYTES, CSV_MAX_ROWS, readCsv, cell, pickMaster, actionForExisting, VALID_FROM_RE,
  type CsvRowAction, type CsvRowError, type MasterCandidate,
} from './formulary-csv';

// 원내 처방집(포뮬러리) — 위원회 승인 코드 관리 + 등재 요청 심의.
// 마스터(약품/수가/간호코드)는 참조만, 승인 집합과 요청 워크플로우가 본체.
// 정책(OFF/WARN/BLOCK) 해석·집행은 FormularyGateService 정본에 위임한다(W8-R2 F1/F2).

const DOMAINS = FORMULARY_DOMAINS;
type Domain = FormularyDomain;

/** 영역 → 마스터 코드 타입(프리셋 영역은 PRESET 병행) — 게이트 정본과 공유(드리프트 방지) */
const DOMAIN_CODE_TYPE = FORMULARY_CODE_TYPE;

@Injectable()
export class FormularyService {
  private readonly logger = new Logger(FormularyService.name);
  private readonly gate: FormularyGateService;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() config?: ConfigRuntimeService,
    @Optional() gate?: FormularyGateService,
  ) {
    // DI 로 주입되면 그것을, 아니면 같은 클래스를 직접 구성 — 어느 쪽이든 해석/집행 구현은 하나(P12)
    this.gate = gate ?? new FormularyGateService(prisma, config);
  }

  private assertDomain(domain: string): asserts domain is Domain {
    if (!DOMAINS.includes(domain as Domain)) throw new BadRequestException(`잘못된 영역: ${domain}`);
  }

  /** 승인 목록(코드명 조인) — 관리 화면 그리드 */
  async list(domain: string, status?: string, q?: string) {
    this.assertDomain(domain);
    const items = await this.prisma.formularyItem.findMany({
      where: { domain, ...(status ? { status } : { status: { not: 'REMOVED' } }) },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 1000,
    });
    const enriched = await this.enrich(items);
    if (!q?.trim()) return enriched;
    const needle = q.trim().toLowerCase();
    return enriched.filter(
      (i) => (i.label ?? '').toLowerCase().includes(needle) || (i.code ?? '').toLowerCase().includes(needle) || (i.presetKey ?? '').toLowerCase().includes(needle),
    );
  }

  /** 마스터 코드명 조인(코드타입별) */
  private async enrich(items: { id: string; codeType: string; codeId: string | null; presetKey: string | null }[] & Record<string, unknown>[]) {
    const byType = (t: string) => items.filter((i) => i.codeType === t && i.codeId).map((i) => i.codeId as string);
    const [meds, procs, nurs] = await Promise.all([
      byType('MEDICATION_CODE').length
        ? this.prisma.medicationCode.findMany({ where: { id: { in: byType('MEDICATION_CODE') } }, select: { id: true, code: true, nameKo: true, isActive: true } })
        : [],
      byType('PROCEDURE_CODE').length
        ? this.prisma.procedureCode.findMany({ where: { id: { in: byType('PROCEDURE_CODE') } }, select: { id: true, code: true, nameKo: true, isActive: true } })
        : [],
      byType('NURSING_CODE').length
        ? this.prisma.nursingCode.findMany({ where: { id: { in: byType('NURSING_CODE') } }, select: { id: true, code: true, nameKo: true, isActive: true } })
        : [],
    ]);
    const map = new Map<string, { code: string; nameKo: string; isActive: boolean }>();
    [...meds, ...procs, ...nurs].forEach((c) => map.set(c.id, c as { code: string; nameKo: string; isActive: boolean }));
    return items.map((i) => {
      const m = i.codeId ? map.get(i.codeId as string) : undefined;
      return {
        ...i,
        code: i.codeId ? m?.code ?? null : i.presetKey,
        label: i.codeId ? m?.nameKo ?? '(마스터에서 삭제됨)' : i.presetKey,
        masterActive: i.codeId ? m?.isActive ?? false : true, // 마스터 비활성/삭제 시 관리 화면 경고(처방 검색은 isActive 필터로 자동 미노출)
      };
    });
  }

  /** 등재(단건/일괄) — 중복은 재활성화(REMOVED/SUSPENDED→ACTIVE) */
  async add(
    userId: string,
    body: { domain: string; items: { codeId?: string; presetKey?: string; label?: string }[]; committee?: string; note?: string },
  ) {
    this.assertDomain(body.domain);
    if (!body.items?.length) throw new BadRequestException('등재할 항목이 없습니다');
    const codeType = DOMAIN_CODE_TYPE[body.domain as Domain];
    let created = 0;
    let reactivated = 0;
    for (const it of body.items) {
      if (!it.codeId && !it.presetKey) continue;
      // ⚠️ compound unique findUnique는 null 필드를 허용하지 않아 항상 실패(멱등성 깨짐·중복 행) — 일반 where로 조회
      const existing = await this.prisma.formularyItem.findFirst({
        where: { domain: body.domain, codeType, codeId: it.codeId ?? null, presetKey: it.presetKey ?? null },
        orderBy: { createdAt: 'asc' },
      });
      if (existing) {
        if (existing.status !== 'ACTIVE') {
          await this.prisma.formularyItem.update({
            where: { id: existing.id },
            data: { status: 'ACTIVE', committee: body.committee ?? existing.committee, note: body.note ?? existing.note, decidedAt: new Date(), decidedBy: userId },
          });
          reactivated++;
        }
        continue;
      }
      await this.prisma.formularyItem.create({
        data: {
          domain: body.domain,
          codeType,
          codeId: it.codeId ?? null,
          presetKey: it.presetKey ?? null,
          committee: body.committee ?? null,
          note: body.note ?? null,
          decidedAt: new Date(),
          decidedBy: userId,
        },
      });
      created++;
    }
    return { created, reactivated };
  }

  /** 상태 변경(중지/재개/제거) + 메모 */
  async update(userId: string, id: string, body: { status?: string; note?: string; committee?: string }) {
    if (body.status && !['ACTIVE', 'SUSPENDED', 'REMOVED'].includes(body.status)) throw new BadRequestException('잘못된 상태');
    const item = await this.prisma.formularyItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('항목을 찾을 수 없습니다');
    return this.prisma.formularyItem.update({
      where: { id },
      data: {
        ...(body.status ? { status: body.status, decidedAt: new Date(), decidedBy: userId } : {}),
        ...(body.note !== undefined ? { note: body.note } : {}),
        ...(body.committee !== undefined ? { committee: body.committee } : {}),
      },
    });
  }

  /** 사용 실적 일괄 등재 — 최근 N개월 처방에 쓰인 코드를 ACTIVE로(콜드스타트 회피) */
  async seedFromUsage(userId: string, months = 6) {
    const since = new Date(Date.now() - months * 30 * 24 * 3600 * 1000);
    const rx = await this.prisma.prescription.findMany({
      where: { createdAt: { gte: since } },
      select: { type: true, medicationCodeId: true, procedureCodeId: true },
    });
    const med = new Set<string>();
    const proc = new Map<string, string>(); // codeId → domain
    for (const r of rx) {
      if (r.medicationCodeId) med.add(r.medicationCodeId);
      if (r.procedureCodeId) {
        const d = r.type === 'LAB' || r.type === 'IMAGING' || r.type === 'DIET' ? r.type : 'LAB';
        if (!proc.has(r.procedureCodeId)) proc.set(r.procedureCodeId, d);
      }
    }
    const note = `초기 실적 등재(최근 ${months}개월 사용)`;
    let total = 0;
    const r1 = await this.add(userId, { domain: 'MEDICATION', items: [...med].map((codeId) => ({ codeId })), note });
    total += r1.created + r1.reactivated;
    for (const domain of ['LAB', 'IMAGING', 'DIET'] as const) {
      const ids = [...proc.entries()].filter(([, d]) => d === domain).map(([codeId]) => ({ codeId }));
      if (ids.length) {
        const r = await this.add(userId, { domain, items: ids, note });
        total += r.created + r.reactivated;
      }
    }
    return { seeded: total, medications: med.size, procedures: proc.size };
  }

  private static readonly UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

  /** 특정 코드들의 승인 상태(batch) — code-search 소비. domain 지정 시 교차 도메인 오배지 방지 */
  async statusFor(codeIds: string[], domain?: string): Promise<Map<string, string>> {
    if (!codeIds.length) return new Map();
    if (domain) this.assertDomain(domain);
    const rows = await this.prisma.formularyItem.findMany({
      where: { codeId: { in: codeIds }, ...(domain ? { domain } : {}), status: { not: 'REMOVED' } },
      select: { codeId: true, status: true },
    });
    return new Map(rows.map((r) => [r.codeId as string, r.status]));
  }

  /** 코드마스터 화면용 batch 상태 조회 — 비UUID는 400(P2023 500 방지) */
  async statusByIds(ids: string[], domain?: string) {
    const cleaned = ids.filter(Boolean).slice(0, 500);
    if (cleaned.some((id) => !FormularyService.UUID_RE.test(id))) {
      throw new BadRequestException('유효하지 않은 코드 ID가 포함되어 있습니다');
    }
    const m = await this.statusFor(cleaned, domain);
    return Object.fromEntries(m);
  }

  /** 코드마스터에서 원클릭 토글 — 미등재→등재(ACTIVE), ACTIVE→SUSPENDED, SUSPENDED→ACTIVE */
  async toggle(userId: string, body: { domain: string; codeId: string }) {
    this.assertDomain(body.domain);
    const codeType = DOMAIN_CODE_TYPE[body.domain as Domain];
    const existing = await this.prisma.formularyItem.findFirst({
      where: { domain: body.domain, codeType, codeId: body.codeId, status: { not: 'REMOVED' } },
    });
    if (!existing) {
      await this.add(userId, { domain: body.domain, items: [{ codeId: body.codeId }], note: '코드마스터에서 등재' });
      return { status: 'ACTIVE' };
    }
    const next = existing.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
    await this.prisma.formularyItem.update({ where: { id: existing.id }, data: { status: next, decidedAt: new Date(), decidedBy: userId } });
    return { status: next };
  }

  // ── 정책 게이트(OFF/WARN/BLOCK — 영역별·SystemConfig) ──
  // 🔴 W8-R2 F1/F2(2026-08-14) — 정책 해석·집행의 정본은 FormularyGateService 하나다.
  //   종전 이 자리에 로컬 3항 해석(`v==='WARN'||v==='BLOCK' ? v : 'OFF'`)이 있어 오타·미상값이
  //   조용히 OFF(무통제)로 떨어졌고(fail-open), 서버 집행부는 아예 없었다(FE 한 화면이 유일).
  //   여기서 다시 해석하면 정본이 둘이 된다(P12) → 위임만 한다.

  /** 영역별 시행 모드 — OFF(표시만)/WARN(경고)/BLOCK(차단). 키 부재=OFF·미지값=BLOCK(fail-closed). */
  async getPolicy(): Promise<Record<string, 'OFF' | 'WARN' | 'BLOCK'>> {
    return this.gate.getPolicy();
  }

  async setPolicy(userId: string, patch: Record<string, string>) {
    return this.gate.setPolicy(userId, patch);
  }

  /** 영역별 실제 집행 여부(집행점 유무) — 관리 화면이 "적용 중"을 말할 근거(F3) */
  async getEnforcement() {
    return this.gate.enforcement();
  }

  // ── AI 체크리스트(큐레이션) ──

  /** Ollama generate — 프록시가 stream:false를 무시하고 NDJSON 스트리밍 반환하므로 라인 병합 필수 */
  private async llmGenerate(prompt: string, timeoutMs = 120_000): Promise<string> {
    const cfgs = await this.prisma.systemConfig.findMany({ where: { key: { in: ['ai.server.url', 'ai.server.gpuKey', 'ai.server.enabled'] } } });
    const cfg = new Map(cfgs.map((c) => [c.key, c.value as string]));
    // 🔴 kill switch — 꺼져 있으면 보내지 않는다(r3 B6 · 정본 common/util/ai-kill-switch)
    if (!isAiServerEnabled(cfg.get('ai.server.enabled'))) throw aiDisabledException();
    // 🔴 배포 환경변수가 DB 설정을 이긴다 — 정본 `common/config-env-overrides`
    const url = configEnvOverride('ai.server.url') ?? (cfg.get('ai.server.url') ?? ''); // P0-6
    const key = cfg.get('ai.server.gpuKey') ?? '';
    // 미설정과 '허용되지 않음'은 다른 사실이다 — 같은 말로 내려보내지 않는다.
    if (!url.trim()) throw new BadRequestException('AI 서버 미설정(ai.server.url)');
    // G3: 목적지 검증 + 경계 통과 감사(정본 common/util/ai-egress-fetch). 차단은 던진다(빈 결과로 덮지 않음).
    const res = await aiEgressFetch(url, '/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({ model: 'qwen2.5:14b', prompt, stream: false, options: { temperature: 0.1 } }),
      signal: AbortSignal.timeout(timeoutMs),
    }, { client: 'formulary' });
    if (!res.ok) throw new BadRequestException(`AI 서버 오류: ${res.status}`);
    const raw = await res.text();
    let full = '';
    for (const line of raw.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try {
        full += (JSON.parse(t) as { response?: string }).response ?? '';
      } catch { /* skip */ }
    }
    return full;
  }

  /** LLM 출력에서 JSON 오브젝트 추출(코드펜스·서두 잡음 방어) */
  private extractJson<T>(text: string): T {
    // 모델이 JSON 뒤에 부가 텍스트/두 번째 JSON 객체를 붙이는 경우가 있어(2026-07-07 검수 배치 실측)
    // last-} 방식은 "Extra data" 파싱 실패 — 중괄호 짝 맞춤으로 첫 객체만 추출
    const start = text.indexOf('{');
    if (start < 0) throw new BadRequestException('AI 응답 파싱 실패');
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) return JSON.parse(text.slice(start, i + 1)) as T;
      }
    }
    throw new BadRequestException('AI 응답 파싱 실패');
  }

  // AI 초안 잡 스토어 — nginx 프록시 타임아웃(60s) 회피용 비동기 처리(pm2 단일 인스턴스·인메모리)
  private aiJobs = new Map<string, { status: 'RUNNING' | 'DONE' | 'ERROR'; result?: unknown; error?: string; at: number }>();

  /** 비동기 시작 — 즉시 jobId 반환, 완료는 폴링으로 확인 */
  startAiDraft(body: { domain: string; topic: string }): { jobId: string } {
    this.assertDomain(body.domain);
    if (!body.topic?.trim()) throw new BadRequestException('주제를 입력하세요');
    // 오래된 잡 정리(30분)
    for (const [k, v] of this.aiJobs) if (Date.now() - v.at > 30 * 60_000) this.aiJobs.delete(k);
    const jobId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    this.aiJobs.set(jobId, { status: 'RUNNING', at: Date.now() });
    this.aiDraft(body)
      .then((result) => this.aiJobs.set(jobId, { status: 'DONE', result, at: Date.now() }))
      .catch((e: Error) => this.aiJobs.set(jobId, { status: 'ERROR', error: e.message, at: Date.now() }));
    return { jobId };
  }

  getAiDraftJob(jobId: string) {
    const job = this.aiJobs.get(jobId);
    if (!job) throw new NotFoundException('잡을 찾을 수 없습니다(만료되었을 수 있음)');
    return job;
  }

  /** 주제 → AI 초안: 키워드 생성 → 마스터 후보 검색 → AI 카테고리 분류(번호 기반·환각 방지) */
  async aiDraft(body: { domain: string; topic: string }) {
    this.assertDomain(body.domain);
    const topic = body.topic?.trim();
    if (!topic) throw new BadRequestException('주제를 입력하세요');

    // 1) 검색 키워드 생성
    const kwText = await this.llmGenerate(
      `병원 처방 코드 검색용 한국어 키워드를 만들어라. 주제: "${topic}" (영역: ${body.domain}).\n` +
        `약품명/성분명/검사명에 포함될 법한 짧은 키워드 6~10개. JSON만 출력: {"keywords":["..."]}`,
      60_000,
    );
    const { keywords } = this.extractJson<{ keywords: string[] }>(kwText);
    const kws = (keywords ?? []).filter((k) => k && k.length >= 2).slice(0, 10);
    if (!kws.length) throw new BadRequestException('키워드 생성 실패 — 주제를 더 구체적으로 입력하세요');

    // 2) 마스터 후보 검색(도메인별·dedup·cap)
    const candidates: { codeId: string; code: string; label: string; extra?: string }[] = [];
    const seen = new Set<string>();
    for (const kw of kws) {
      let rows: { id: string; code: string; nameKo: string; extra?: string | null }[] = [];
      if (body.domain === 'MEDICATION') {
        rows = (
          await this.prisma.medicationCode.findMany({
            // 한/영 병용 P1(D2): 공용 OR 항 + 이 EP 고유의 category 매칭 합성
            where: { isActive: true, OR: [...medicationSearchOrTerms(kw), { category: { contains: kw } }] },
            select: { id: true, code: true, nameKo: true, category: true },
            take: 40,
          })
        ).map((r) => ({ ...r, extra: r.category }));
      } else if (body.domain === 'NURSING') {
        rows = await this.prisma.nursingCode.findMany({
          where: { isActive: true, codeSystem: 'NIC', OR: [{ nameKo: { contains: kw } }] },
          select: { id: true, code: true, nameKo: true },
          take: 20,
        });
      } else {
        const PREFIXES: Record<string, string[]> = { LAB: ['B', 'C', 'D', 'E', 'F'], IMAGING: ['G', 'H', 'EB'], DIET: ['6'] };
        const prefixes = PREFIXES[body.domain];
        rows = await this.prisma.procedureCode.findMany({
          where: {
            isActive: true,
            nameKo: { contains: kw },
            ...(prefixes ? { OR: prefixes.map((p) => ({ code: { startsWith: p } })) } : {}),
          },
          select: { id: true, code: true, nameKo: true },
          take: 40,
        });
      }
      for (const r of rows) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        candidates.push({ codeId: r.id, code: r.code, label: r.nameKo, extra: r.extra ?? undefined });
        if (candidates.length >= 250) break;
      }
      if (candidates.length >= 250) break;
    }
    if (!candidates.length) return { topic, keywords: kws, categories: [], candidateCount: 0 };

    // 3) AI 분류 — 번호 기반(코드 환각 방지)
    const listing = candidates.map((c, i) => `[${i + 1}] ${c.code} ${c.label}${c.extra ? ` (${c.extra})` : ''}`).join('\n');
    const clsText = await this.llmGenerate(
      `주제 "${topic}" 관련 병원 코드 체크리스트를 만든다. 아래 후보에서 주제와 관련 있는 항목만 골라 임상적으로 자연스러운 카테고리(2~6개, 한국어)로 묶어라.\n` +
        `관련 없는 항목은 제외. 번호만 사용. JSON만 출력: {"categories":[{"name":"카테고리명","numbers":[1,2]}]}\n\n후보:\n${listing}`,
      120_000,
    );
    const parsed = this.extractJson<{ categories: { name: string; numbers: number[] }[] }>(clsText);
    const categories = (parsed.categories ?? [])
      .map((c) => ({
        category: String(c.name ?? '').slice(0, 60) || '기타',
        items: [...new Set(c.numbers ?? [])]
          .filter((n) => Number.isInteger(n) && n >= 1 && n <= candidates.length)
          .map((n) => candidates[n - 1]),
      }))
      .filter((c) => c.items.length > 0);
    return { topic, keywords: kws, categories, candidateCount: candidates.length };
  }

  // ── 체크리스트 CRUD ──

  async createList(userId: string, body: { domain: string; name: string; description?: string; items: unknown; aiGenerated?: boolean }) {
    this.assertDomain(body.domain);
    if (!body.name?.trim()) throw new BadRequestException('리스트 이름은 필수입니다');
    // 🔴 (2026-09-15 U4) 운영 메모류 — 스키마 길이(120·300)로 잘라 저장하되 잘린 사실을 응답 `truncatedFields` 로 알린다
    const rec = new TruncationRecorder();
    const row = await this.prisma.formularyList.create({
      data: {
        domain: body.domain,
        name: rec.clip('name', body.name.trim(), 120),
        description: rec.clip('description', body.description, 300) ?? null,
        items: (body.items ?? []) as never,
        aiGenerated: !!body.aiGenerated,
        createdBy: userId,
      },
    });
    return { ...row, truncatedFields: rec.truncatedFields };
  }

  async lists(domain?: string) {
    return this.prisma.formularyList.findMany({
      where: domain ? { domain } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async deleteList(id: string) {
    await this.prisma.formularyList.delete({ where: { id } }).catch(() => {
      throw new NotFoundException('리스트를 찾을 수 없습니다');
    });
    return { deleted: true };
  }

  // ── 등재 요청 ──

  async createRequest(
    userId: string,
    department: string | undefined,
    body: { domain: string; codeId?: string; codeLabel?: string; freeText?: string; reason: string; urgency?: string },
  ) {
    this.assertDomain(body.domain);
    if (!body.reason?.trim()) throw new BadRequestException('임상 사유는 필수입니다');
    if (!body.codeId && !body.freeText?.trim()) throw new BadRequestException('코드 또는 신규 항목명이 필요합니다');
    // 동일 (domain, codeId) PENDING 요청 존재 시 기존 요청 반환 — 심의함 중복 누적 방지
    if (body.codeId) {
      const dup = await this.prisma.formularyRequest.findFirst({
        where: { domain: body.domain, codeId: body.codeId, status: 'PENDING' },
      });
      if (dup) return dup;
    }
    // 🔴 (2026-09-15 U4) 표시용 코드명·신규 항목명(300)은 잘라 저장하되 `truncatedFields` 로 알린다(임상 사유는 자르지 않는다)
    const rec = new TruncationRecorder();
    const row = await this.prisma.formularyRequest.create({
      data: {
        domain: body.domain,
        codeType: DOMAIN_CODE_TYPE[body.domain as Domain],
        codeId: body.codeId ?? null,
        codeLabel: rec.clip('codeLabel', body.codeLabel, 300) ?? null,
        freeText: rec.clip('freeText', body.freeText, 300) ?? null,
        reason: body.reason.trim(),
        urgency: body.urgency === 'URGENT' ? 'URGENT' : 'ROUTINE',
        requestedBy: userId,
        department: department ?? null,
      },
    });
    return { ...row, truncatedFields: rec.truncatedFields };
  }

  async listRequests(status = 'PENDING', domain?: string) {
    const rows = await this.prisma.formularyRequest.findMany({
      where: { status, ...(domain ? { domain } : {}) },
      orderBy: [{ urgency: 'desc' }, { createdAt: 'asc' }],
      take: 200,
    });
    // 요청자 이름 조인
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.requestedBy))] } },
      select: { id: true, familyName: true, givenName: true, department: true },
    });
    const umap = new Map(users.map((u) => [u.id, `${u.familyName}${u.givenName}`]));
    return rows.map((r) => ({ ...r, requesterName: umap.get(r.requestedBy) ?? '-' }));
  }

  /** 심의 — 승인 시 FormularyItem 자동 생성(즉시 처방집 반영) */
  async decide(userId: string, id: string, body: { approve: boolean; decision?: string; committee?: string }) {
    const req = await this.prisma.formularyRequest.findUnique({ where: { id } });
    if (!req) throw new NotFoundException('요청을 찾을 수 없습니다');
    if (req.status !== 'PENDING') throw new BadRequestException('이미 처리된 요청입니다');
    if (!body.approve && !body.decision?.trim()) throw new BadRequestException('반려 사유는 필수입니다');

    // 동시 심의 race 차단 — PENDING 조건부 갱신(count=0이면 다른 심의가 선점 → 409)
    const { count } = await this.prisma.formularyRequest.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: body.approve ? 'APPROVED' : 'REJECTED', decision: body.decision ?? null, decidedBy: userId, decidedAt: new Date() },
    });
    if (count === 0) throw new ConflictException('이미 처리된 요청입니다(동시 심의)');
    if (body.approve && req.codeId) {
      await this.add(userId, {
        domain: req.domain,
        items: [{ codeId: req.codeId }],
        committee: body.committee,
        note: `등재 요청 승인(${req.reason.slice(0, 80)})`,
      });
    }
    return this.prisma.formularyRequest.findUnique({ where: { id } });
  }

  /** 요약(영역별 승인 수·대기 요청 수) — 관리 화면 헤더 */
  async summary() {
    const [items, pending] = await Promise.all([
      this.prisma.formularyItem.groupBy({ by: ['domain', 'status'], _count: true, where: { status: { not: 'REMOVED' } } }),
      this.prisma.formularyRequest.groupBy({ by: ['domain'], _count: true, where: { status: 'PENDING' } }),
    ]);
    return { items, pending };
  }

  // ── CSV 일괄 등재(기획 §3.3 · P2) ──

  /**
   * CSV 일괄 등재 — 드라이런(미리보기)과 확정이 **같은 판정**을 거친다.
   * 확정은 미리보기 결과를 믿지 않고 다시 판정한 뒤, 행마다 정본 `add()` 를 부른다(검증·재활성화 규칙 재사용).
   * 🔴 행 단위로 말한다 — 틀린 행은 ERROR, 적용 중 실패는 APPLY_FAILED. 전체 성공을 가장하지 않는다.
   * 🔴 같은 CSV 를 다시 올리면 전부 UNCHANGED — 중복 행을 만들지 않는다(add 의 기존 행 조회).
   */
  async importCsv(
    userId: string,
    body: { domain: string; csv: string; committee?: string; note?: string; dryRun: boolean },
  ) {
    this.assertDomain(body.domain);
    const domain = body.domain as Domain;
    if (Buffer.byteLength(body.csv ?? '', 'utf8') > CSV_MAX_BYTES) throw new BadRequestException('CSV 가 너무 큽니다(최대 1MB)');
    const parsed = readCsv(body.csv ?? '');
    const codeType = DOMAIN_CODE_TYPE[domain];
    const isPreset = codeType === 'PRESET';
    const keyCol = isPreset ? 'presetKey' : 'code';
    if (parsed.columns[keyCol] === undefined) {
      throw new BadRequestException(isPreset ? 'CSV 머리글에 presetKey 열이 없습니다' : 'CSV 머리글에 code 열이 없습니다');
    }
    if (parsed.rows.length === 0) throw new BadRequestException('CSV 에 데이터 행이 없습니다');
    if (parsed.rows.length > CSV_MAX_ROWS) throw new BadRequestException('CSV 행이 너무 많습니다(최대 2000행)');

    type Row = {
      line: number; code: string | null; presetKey: string | null; note: string | null;
      action: CsvRowAction; error: CsvRowError | null; codeId: string | null; label: string | null; previousStatus: string | null;
    };
    const rows: Row[] = parsed.rows.map((r) => ({
      line: r.line,
      code: isPreset ? null : cell(parsed, r.cells, 'code') || null,
      presetKey: isPreset ? cell(parsed, r.cells, 'presetKey') || null : null,
      note: cell(parsed, r.cells, 'note') || null,
      action: 'ERROR', error: null, codeId: null, label: null, previousStatus: null,
    }));

    // 마스터 후보 — 코드 정확 일치로만 한 번에 조회
    const codes = [...new Set(rows.map((r) => r.code).filter((c): c is string => !!c))];
    const candidates = new Map<string, MasterCandidate[]>();
    if (!isPreset && codes.length) {
      const found: MasterCandidate[] =
        codeType === 'MEDICATION_CODE'
          ? await this.prisma.medicationCode.findMany({ where: { code: { in: codes } }, select: { id: true, code: true, nameKo: true, isActive: true } })
          : codeType === 'PROCEDURE_CODE'
            ? await this.prisma.procedureCode.findMany({ where: { code: { in: codes } }, select: { id: true, code: true, nameKo: true, isActive: true, validFrom: true } })
            : await this.prisma.nursingCode.findMany({ where: { code: { in: codes } }, select: { id: true, code: true, nameKo: true, isActive: true, codeSystem: true } });
      for (const f of found) candidates.set(f.code, [...(candidates.get(f.code) ?? []), f]);
    }

    const seen = new Set<string>();
    for (const r of rows) {
      const src = parsed.rows.find((x) => x.line === r.line)!;
      if (isPreset) {
        if (!r.presetKey) { r.error = 'MISSING_PRESET_KEY'; continue; }
        if (!isFormularyPresetKey(domain, r.presetKey)) { r.error = 'UNKNOWN_PRESET'; continue; }
        r.label = r.presetKey;
      } else {
        if (!r.code) { r.error = 'MISSING_CODE'; continue; }
        const validFrom = cell(parsed, src.cells, 'validFrom');
        if (validFrom && !VALID_FROM_RE.test(validFrom)) { r.error = 'BAD_VALID_FROM'; continue; }
        const picked = pickMaster(candidates.get(r.code) ?? [], { codeSystem: cell(parsed, src.cells, 'codeSystem') || undefined, validFrom: validFrom || undefined });
        if (!picked.ok) { r.error = picked.error; continue; }
        r.codeId = picked.master.id;
        r.label = picked.master.nameKo;
      }
      const identity = r.codeId ?? `preset:${r.presetKey}`;
      if (seen.has(identity)) { r.error = 'DUPLICATE_IN_FILE'; continue; }
      seen.add(identity);
      r.action = 'CREATE';
    }

    // 기존 등재 상태 — add() 와 같은 식별(domain·codeType·codeId·presetKey)
    const valid = rows.filter((r) => r.error == null);
    if (valid.length) {
      const existing = await this.prisma.formularyItem.findMany({
        where: {
          domain, codeType,
          OR: [
            ...(valid.some((r) => r.codeId) ? [{ codeId: { in: valid.map((r) => r.codeId).filter((v): v is string => !!v) } }] : []),
            ...(valid.some((r) => r.presetKey) ? [{ presetKey: { in: valid.map((r) => r.presetKey).filter((v): v is string => !!v) } }] : []),
          ],
        },
        orderBy: { createdAt: 'asc' },
        select: { codeId: true, presetKey: true, status: true },
      });
      for (const r of valid) {
        const hit = existing.find((e) => (r.codeId ? e.codeId === r.codeId : e.presetKey === r.presetKey && e.codeId == null));
        r.previousStatus = hit?.status ?? null;
        r.action = actionForExisting(hit?.status);
      }
    }

    const count = (a: CsvRowAction) => rows.filter((r) => r.action === a).length;
    const summary = { total: rows.length, create: count('CREATE'), reactivate: count('REACTIVATE'), unchanged: count('UNCHANGED'), error: count('ERROR') };
    if (body.dryRun) {
      return { dryRun: true, domain, unknownColumns: parsed.unknownColumns, summary, applied: null, rows };
    }

    let created = 0;
    let reactivated = 0;
    let applyFailed = 0;
    for (const r of rows) {
      if (r.action !== 'CREATE' && r.action !== 'REACTIVATE') continue;
      try {
        const res = await this.add(userId, {
          domain,
          items: [r.codeId ? { codeId: r.codeId } : { presetKey: r.presetKey as string }],
          committee: body.committee,
          note: r.note ?? body.note,
        });
        created += res.created;
        reactivated += res.reactivated;
      } catch (e) {
        // 행 하나의 적용 실패가 나머지 행을 멈추지 않는다 — 실패는 그 행에 남기고 로그로도 남긴다(삼키지 않는다)
        this.logger.warn(`formulary CSV apply failed at line ${r.line}: ${e instanceof Error ? e.message : String(e)}`);
        applyFailed++;
        r.action = 'ERROR';
        r.error = 'APPLY_FAILED';
      }
    }
    return {
      dryRun: false, domain, unknownColumns: parsed.unknownColumns,
      summary: { ...summary, error: count('ERROR') },
      applied: { created, reactivated, applyFailed },
      rows,
    };
  }
}
