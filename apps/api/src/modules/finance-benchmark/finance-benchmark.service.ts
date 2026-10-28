import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  DISCLOSURE_ACCOUNT_TREE, DISCLOSURE_COLUMN_MAP, DISCLOSURE_META_COLUMNS, FINANCE_RATIOS, accountChildren, accountNode,
  disclosureIdentityIssues, financeRatios, normalizeSidoName, parseCsvLine, peerDeviation, peerStat, regionOf,
  type FinanceAccount, type FinanceAccounts, type FinanceRatio, type PeerStat,
} from '@hospital-run/shared';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';

const KNOWN_CODES = new Set(DISCLOSURE_ACCOUNT_TREE.map((n) => n.code));

/** 한 파일 최대 행 — 공시 전체(연 ~300 기관 × 수년)를 넉넉히 넘는다 */
const MAX_ROWS = 5000;

export interface Reject { line: number; name: string | null; year: number | null; reason: string; detail?: string }

type Row = Prisma.FinanceDisclosureGetPayload<Record<string, never>>;

/**
 * 경영성과 벤치마크 — 의료기관 회계정보공시 손익(외부 공개 프로젝트의 분석 틀 · shared `hospital-finance` 정본).
 *
 * 🔴 정직 규칙:
 *   - 공시 원자료는 관리자가 CSV 로 가져온다(외부 저장소 데이터를 저장소에 넣지 않았다 — 라이선스 표기 없음).
 *   - 항등식이 깨진 행·숫자가 아닌 칸·같은 파일 안 중복은 **들이지 않고 사유를 돌려준다**(왜곡된 행이 동급 통계를 오염시키지 않게).
 *   - "우리 병원"은 설정 `finance.benchmark.selfInstitution`(공시 기관명)으로만 정한다 — 미설정·미존재면 비교하지 않고 그 사실을 말한다.
 *     (HIS 에는 손익이 없다 — 수납 금액뿐이고 인건비·재료비는 ERP/회계에 있다)
 *   - 동급 통계는 평균·중앙값·사분위·n 을 함께 · 편차 기준은 중앙값.
 */
@Injectable()
export class FinanceBenchmarkService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly config?: ConfigRuntimeService,
  ) {}

  private async selfName(): Promise<string | null> {
    const v = await this.config?.get('finance.benchmark.selfInstitution');
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  }

  // ── 가져오기 ──

  async importCsv(file: { buffer: Buffer; originalname: string }, sourceNote: string | undefined, userId: string | null) {
    const text = file.buffer.toString('utf8').replace(/^﻿/, '');
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) throw new BadRequestException({ code: 'CSV_EMPTY' });
    if (lines.length - 1 > MAX_ROWS) throw new BadRequestException({ code: 'CSV_TOO_MANY_ROWS', details: { max: MAX_ROWS } });

    const header = parseCsvLine(lines[0]).map((h) => h.trim());
    const col = (name: string) => header.indexOf(name);
    const need = [DISCLOSURE_META_COLUMNS.year, DISCLOSURE_META_COLUMNS.name, 'Ⅰ.의료수익'];
    const missing = need.filter((n) => col(n) < 0);
    if (missing.length) throw new BadRequestException({ code: 'CSV_HEADER_MISSING', details: { missing } });
    const accountCols = Object.entries(DISCLOSURE_COLUMN_MAP).map(([h, k]) => [col(h), k] as const).filter(([i]) => i >= 0);

    const num = (s: string | undefined) => {
      const t = (s ?? '').replace(/[,\s]/g, '');
      if (t === '') return undefined;
      const n = Number(t);
      return Number.isFinite(n) ? n : NaN;
    };
    const rejects: Reject[] = [];
    const valid: Array<{ key: string; line: number; data: Omit<Prisma.FinanceDisclosureUncheckedCreateInput, 'importId'> }> = [];
    const seen = new Set<string>();

    for (let i = 1; i < lines.length; i++) {
      const cells = parseCsvLine(lines[i]);
      const cell = (name: string) => { const j = col(name); return j >= 0 ? (cells[j] ?? '').trim() : ''; };
      const year = num(cell(DISCLOSURE_META_COLUMNS.year));
      const name = cell(DISCLOSURE_META_COLUMNS.name) || null;
      const line = i + 1;
      if (!name || year == null || Number.isNaN(year) || !Number.isInteger(year) || year < 1990 || year > 2100) {
        rejects.push({ line, name, year: Number.isInteger(year) ? (year as number) : null, reason: 'ROW_KEY_MISSING' });
        continue;
      }
      // 식별 — 기관 코드가 있으면 (연도, 코드) · 없으면 (연도, 이름). 같은 해 같은 법인명의 다른 기관은 코드로 갈린다
      const code = cell(DISCLOSURE_META_COLUMNS.code) || null;
      const key = code ? `${year}|c:${code}` : `${year}|n:${name}`;
      if (seen.has(key)) { rejects.push({ line, name, year, reason: 'DUPLICATE_IN_FILE' }); continue; }
      const accounts: FinanceAccounts = {};
      let badCol: string | null = null;
      for (const [j, k] of accountCols) {
        const v = num(cells[j]);
        if (v === undefined) continue;
        if (Number.isNaN(v)) { badCol = header[j]; break; }
        accounts[k as FinanceAccount] = v;
      }
      if (badCol) { rejects.push({ line, name, year, reason: 'NUMBER_INVALID', detail: badCol }); continue; }
      if (accounts.medicalRevenue == null) { rejects.push({ line, name, year, reason: 'REVENUE_MISSING' }); continue; }
      const issues = disclosureIdentityIssues(accounts);
      if (issues.length) { rejects.push({ line, name, year, reason: 'IDENTITY', detail: issues.join(',') }); continue; }
      seen.add(key);
      // 세목 — JSON 객체 {계정코드: 금액} · 트리에 있는 코드만 남긴다 · 깨진 JSON·숫자 아닌 값은 행을 거절(세목이 조용히 사라지지 않게)
      let detail: Record<string, number> | null = null;
      const detailRaw = cell(DISCLOSURE_META_COLUMNS.detail);
      if (detailRaw) {
        try {
          const obj = JSON.parse(detailRaw) as Record<string, unknown>;
          if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('not object');
          detail = {};
          for (const [k, v] of Object.entries(obj)) {
            if (!KNOWN_CODES.has(k)) continue;
            if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(k);
            detail[k] = v;
          }
        } catch (e) {
          rejects.push({ line, name, year, reason: 'DETAIL_INVALID', detail: e instanceof Error ? e.message.slice(0, 40) : undefined });
          continue;
        }
      }
      const address = cell(DISCLOSURE_META_COLUMNS.address) || null;
      // 시도·시군구 — 구조화 열이 있으면 그것을(약칭은 정식 이름으로) · 없거나 못 읽으면 주소에서
      const parsed = regionOf(address);
      const sidoCell = normalizeSidoName(cell(DISCLOSURE_META_COLUMNS.sido));
      const sido = sidoCell ?? parsed.sido;
      const sigungu = (sidoCell ? cell(DISCLOSURE_META_COLUMNS.sigungu) || null : null) ?? parsed.sigungu;
      const beds = num(cell(DISCLOSURE_META_COLUMNS.beds));
      const lat = num(cell(DISCLOSURE_META_COLUMNS.lat));
      const lng = num(cell(DISCLOSURE_META_COLUMNS.lng));
      valid.push({
        key, line,
        data: {
          fiscalYear: year, institutionName: name, institutionCode: code,
          beds: beds != null && Number.isInteger(beds) && beds >= 0 ? beds : null,
          hospitalType: cell(DISCLOSURE_META_COLUMNS.type) || null,
          foundingType: cell(DISCLOSURE_META_COLUMNS.founding) || null,
          address, sido, sigungu,
          // 좌표 0,0 은 지오코딩 실패 표식이다(원 프로젝트 실측) — 좌표로 쓰지 않는다
          lat: lat != null && !Number.isNaN(lat) && lat !== 0 ? lat : null,
          lng: lng != null && !Number.isNaN(lng) && lng !== 0 ? lng : null,
          accounts: accounts as Prisma.InputJsonValue,
          ...(detail ? { detail: detail as Prisma.InputJsonValue } : {}),
        },
      });
    }

    // 기존 행 찾기 — ① 같은 (연도, 코드) ② 코드 없는 기존 행 중 같은 (연도, 이름)(원 저장소 행에 코드를 붙인다)
    //   코드 없는 입력은 같은 (연도, 이름) 행이 하나일 때만 갱신 · 둘 이상이면 어느 기관인지 모르므로 거절(AMBIGUOUS_NAME)
    const years = [...new Set(valid.map((v) => v.data.fiscalYear))];
    const existing = years.length
      ? await this.prisma.financeDisclosure.findMany({ where: { fiscalYear: { in: years } }, select: { id: true, fiscalYear: true, institutionName: true, institutionCode: true } })
      : [];
    const byCode = new Map(existing.filter((e) => e.institutionCode).map((e) => [`${e.fiscalYear}|${e.institutionCode}`, e.id]));
    const byName = new Map<string, typeof existing>();
    for (const e of existing) {
      const k = `${e.fiscalYear}|${e.institutionName}`;
      byName.set(k, [...(byName.get(k) ?? []), e]);
    }
    const claimed = new Set<string>();
    const plan: Array<{ id: string | null; data: (typeof valid)[number]['data'] }> = [];
    for (const v of valid) {
      const d = v.data;
      const code = d.institutionCode as string | null;
      let id: string | null = code ? byCode.get(`${d.fiscalYear}|${code}`) ?? null : null;
      if (!id) {
        const sameName = (byName.get(`${d.fiscalYear}|${d.institutionName}`) ?? []).filter((e) => !claimed.has(e.id));
        const candidates = code ? sameName.filter((e) => !e.institutionCode) : sameName;
        if (!code && candidates.length > 1) {
          rejects.push({ line: v.line, name: d.institutionName, year: d.fiscalYear, reason: 'AMBIGUOUS_NAME', detail: `${candidates.length}` });
          continue;
        }
        id = candidates[0]?.id ?? null;
      }
      if (id) claimed.add(id);
      plan.push({ id, data: d });
    }
    const created = plan.filter((p) => !p.id).length;
    const updated = plan.length - created;

    const imp = await this.prisma.$transaction(async (tx) => {
      const rec = await tx.financeDisclosureImport.create({
        data: {
          fileName: file.originalname.slice(0, 200), sourceNote: sourceNote?.trim().slice(0, 300) || null,
          totalRows: lines.length - 1, created, updated, rejected: rejects.length,
          rejects: rejects.slice(0, 200) as unknown as Prisma.InputJsonValue, importedById: userId,
        },
      });
      for (const p of plan) {
        if (p.id) await tx.financeDisclosure.update({ where: { id: p.id }, data: { ...p.data, importId: rec.id } });
        else await tx.financeDisclosure.create({ data: { ...p.data, importId: rec.id } });
      }
      return rec;
    }, { timeout: 120_000 });

    return { importId: imp.id, totalRows: lines.length - 1, created, updated, rejected: rejects.length, rejects: rejects.slice(0, 50) };
  }

  async imports() {
    return this.prisma.financeDisclosureImport.findMany({ orderBy: { createdAt: 'desc' }, take: 20 });
  }

  // ── 조회 ──

  private ratiosOf(r: Row) {
    return financeRatios(r.accounts as FinanceAccounts);
  }

  /** 동급 개관 — 연도·종별의 동급 통계 + 우리 병원(지정 시) 편차 */
  async overview(yearQ?: number, typeQ?: string) {
    const yearsRaw = await this.prisma.financeDisclosure.groupBy({ by: ['fiscalYear'], _count: true, orderBy: { fiscalYear: 'desc' } });
    const years = yearsRaw.map((y) => y.fiscalYear);
    const lastImport = await this.prisma.financeDisclosureImport.findFirst({ orderBy: { createdAt: 'desc' }, select: { createdAt: true, fileName: true, sourceNote: true } });
    if (!years.length) return { available: false as const, reason: 'NO_DATA' as const, lastImport };
    const year = yearQ && years.includes(yearQ) ? yearQ : years[0];

    const rows = await this.prisma.financeDisclosure.findMany({ where: { fiscalYear: year } });
    const types = [...new Set(rows.map((r) => r.hospitalType).filter((t): t is string => !!t))].sort();
    const selfName = await this.selfName();
    const selfRow = selfName ? rows.find((r) => r.institutionName === selfName) ?? null : null;
    const type = typeQ || selfRow?.hospitalType || null;
    const peers = rows.filter((r) => (!type || r.hospitalType === type) && r !== selfRow);

    const peer = {} as Record<FinanceRatio, PeerStat>;
    for (const k of FINANCE_RATIOS) peer[k] = peerStat(peers.map((r) => this.ratiosOf(r)[k]));

    let self: {
      status: 'NOT_SET' | 'NOT_FOUND' | 'FOUND'; name: string | null;
      ratios?: Record<FinanceRatio, number | null>;
      deviations?: Record<FinanceRatio, { diff: number | null; worse: boolean | null }>;
      accounts?: FinanceAccounts; hospitalType?: string | null; beds?: number | null;
    };
    if (!selfName) self = { status: 'NOT_SET', name: null };
    else if (!selfRow) self = { status: 'NOT_FOUND', name: selfName };
    else {
      const ratios = this.ratiosOf(selfRow);
      const deviations = {} as Record<FinanceRatio, { diff: number | null; worse: boolean | null }>;
      for (const k of FINANCE_RATIOS) deviations[k] = peerDeviation(k, ratios[k], peer[k]);
      self = { status: 'FOUND', name: selfName, ratios, deviations, accounts: selfRow.accounts as FinanceAccounts, hospitalType: selfRow.hospitalType, beds: selfRow.beds };
    }
    return { available: true as const, years, year, types, type, peerCount: peers.length, peer, self, lastImport };
  }

  /** 기관 목록 — 지역 비교·지도용(연도·종별·시도·시군구) */
  async institutions(yearQ?: number, type?: string, sido?: string, sigungu?: string) {
    const years = (await this.prisma.financeDisclosure.groupBy({ by: ['fiscalYear'], orderBy: { fiscalYear: 'desc' } })).map((y) => y.fiscalYear);
    if (!years.length) return { available: false as const, reason: 'NO_DATA' as const };
    const year = yearQ && years.includes(yearQ) ? yearQ : years[0];
    const all = await this.prisma.financeDisclosure.findMany({ where: { fiscalYear: year } });
    const regions: Record<string, Record<string, number>> = {};
    for (const r of all) {
      if (!r.sido) continue;
      regions[r.sido] ??= {};
      if (r.sigungu) regions[r.sido][r.sigungu] = (regions[r.sido][r.sigungu] ?? 0) + 1;
    }
    const selfName = await this.selfName();
    // 같은 해 같은 이름의 다른 기관(명지병원 고양·제천)은 화면에서 갈라 보이게 지역을 붙인다(표시만 · 저장 이름은 그대로)
    const nameCount = new Map<string, number>();
    for (const r of all) nameCount.set(r.institutionName, (nameCount.get(r.institutionName) ?? 0) + 1);
    const displayName = (r: Row) => ((nameCount.get(r.institutionName) ?? 0) > 1
      ? `${r.institutionName} (${r.sigungu ?? r.sido ?? r.institutionCode ?? r.id.slice(0, 8)})`
      : r.institutionName);
    const rows = all
      .filter((r) => (!type || r.hospitalType === type) && (!sido || r.sido === sido) && (!sigungu || r.sigungu === sigungu))
      .map((r) => {
        const a = r.accounts as FinanceAccounts;
        return {
          name: displayName(r), institutionName: r.institutionName, institutionCode: r.institutionCode, self: r.institutionName === selfName,
          hospitalType: r.hospitalType, foundingType: r.foundingType, beds: r.beds, sido: r.sido, sigungu: r.sigungu,
          // 공시 주소(기관 공개 정보) — 좌표가 없을 때 화면이 읍면동까지 근사하는 데 쓴다
          address: r.address,
          lat: r.lat == null ? null : Number(r.lat), lng: r.lng == null ? null : Number(r.lng),
          medicalRevenue: a.medicalRevenue ?? null, medicalProfit: a.medicalProfit ?? null,
          ratios: financeRatios(a),
          // 선택 기관 상세(손익 흐름·수익 구성)를 화면이 한 번에 그리게 계정을 함께 싣는다(기관 공시 손익 — 환자 정보 아님)
          accounts: a,
        };
      })
      .sort((p, q) => (q.medicalProfit ?? -Infinity) - (p.medicalProfit ?? -Infinity));
    return { available: true as const, years, year, regions, rows };
  }

  /**
   * 한 기관의 연도별 추이 + 같은 종별 동급 중앙값.
   * 🔴 기관 코드가 있으면 **코드로** 잇는다 — 연도마다 공시 이름 표기가 다르다(1,143곳 중 156곳 · 2026-09-29 실측: 서울아산 2016·2022 가 이름으로는 빠졌다).
   *    코드가 없는 기관(원 저장소 행)만 이름으로 찾고, 그 사실을 `linkedBy` 로 말한다. 이름이 해마다 달랐으면 `names` 에 다 싣는다.
   */
  async trend(name?: string, code?: string) {
    const mine = code
      ? await this.prisma.financeDisclosure.findMany({ where: { institutionCode: code }, orderBy: { fiscalYear: 'asc' } })
      : await this.prisma.financeDisclosure.findMany({ where: { institutionName: name ?? '' }, orderBy: { fiscalYear: 'asc' } });
    if (!mine.length) throw new NotFoundException({ code: 'INSTITUTION_NOT_FOUND' });
    const out = [];
    for (const r of mine) {
      const peers = await this.prisma.financeDisclosure.findMany({
        where: { fiscalYear: r.fiscalYear, hospitalType: r.hospitalType, NOT: { id: r.id } },
      });
      const pr = peers.map((p) => this.ratiosOf(p));
      out.push({
        year: r.fiscalYear, hospitalType: r.hospitalType, institutionName: r.institutionName,
        ratios: this.ratiosOf(r),
        medicalRevenue: (r.accounts as FinanceAccounts).medicalRevenue ?? null,
        medicalProfit: (r.accounts as FinanceAccounts).medicalProfit ?? null,
        peerMedian: {
          medicalProfitMargin: peerStat(pr.map((x) => x.medicalProfitMargin)).median,
          ordinaryMargin: peerStat(pr.map((x) => x.ordinaryMargin)).median,
        },
        peerN: peers.length,
      });
    }
    const names = [...new Set(mine.map((r) => r.institutionName))];
    return { name: name ?? mine[mine.length - 1].institutionName, code: code ?? null, linkedBy: code ? ('CODE' as const) : ('NAME' as const), names, rows: out };
  }

  /**
   * 세목 드릴다운 — 한 기관·한 해의 세목 금액과 의료수익 대비 비중, 같은 해·같은 종별 동급의 비중 중앙값(n 병기).
   * 🔴 세목이 없는 행(세목 없이 가져온 자료)은 `available:false` — 0 으로 그리지 않는다.
   * 🔴 세목 합이 상위 계정과 다르면(허용 1원) `mismatches` 로 말한다 — 숨기지 않는다.
   */
  async detail(code?: string, name?: string, yearQ?: number) {
    const years = (await this.prisma.financeDisclosure.groupBy({ by: ['fiscalYear'], orderBy: { fiscalYear: 'desc' } })).map((y) => y.fiscalYear);
    const year = yearQ && years.includes(yearQ) ? yearQ : years[0];
    const row = code
      ? await this.prisma.financeDisclosure.findFirst({ where: { fiscalYear: year, institutionCode: code } })
      : await this.prisma.financeDisclosure.findFirst({ where: { fiscalYear: year, institutionName: name ?? '' } });
    if (!row) throw new NotFoundException({ code: 'INSTITUTION_NOT_FOUND' });
    const rev = (row.accounts as FinanceAccounts).medicalRevenue ?? null;
    const mine = (row.detail ?? null) as Record<string, number> | null;
    if (!mine) return { available: false as const, reason: 'NO_DETAIL' as const, year, name: row.institutionName };
    const peers = await this.prisma.financeDisclosure.findMany({
      where: { fiscalYear: year, hospitalType: row.hospitalType, NOT: { id: row.id } },
      select: { accounts: true, detail: true },
    });
    const peerRows = peers
      .map((p) => ({ rev: (p.accounts as FinanceAccounts).medicalRevenue ?? null, d: (p.detail ?? null) as Record<string, number> | null }))
      .filter((p): p is { rev: number; d: Record<string, number> } => !!p.d && typeof p.rev === 'number' && p.rev > 0);
    const share = (v: number | undefined | null, r: number | null) => (typeof v === 'number' && typeof r === 'number' && r > 0 ? v / r : null);
    const nodes = DISCLOSURE_ACCOUNT_TREE.map((n) => {
      const ps = peerStat(peerRows.map((p) => share(p.d[n.code], p.rev)));
      return { code: n.code, name: n.name, parent: n.parent, amount: mine[n.code] ?? null, share: share(mine[n.code], rev), peerMedianShare: ps.median, peerN: ps.n };
    });
    // 세목 합 ≠ 상위(허용 1원) — 자식이 있는 노드만
    const mismatches = DISCLOSURE_ACCOUNT_TREE.filter((n) => accountChildren(n.code).length > 0 && typeof mine[n.code] === 'number')
      .filter((n) => {
        const kids = accountChildren(n.code).map((k) => mine[k.code]).filter((v): v is number => typeof v === 'number');
        return kids.length > 0 && Math.abs(kids.reduce((a, b) => a + b, 0) - mine[n.code]) > 1;
      })
      .map((n) => ({ code: n.code, name: accountNode(n.code)?.name ?? n.code }));
    return {
      available: true as const, year, name: row.institutionName, code: row.institutionCode, hospitalType: row.hospitalType,
      medicalRevenue: rev, peerCount: peerRows.length, nodes, mismatches,
    };
  }
}
