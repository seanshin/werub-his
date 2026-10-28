import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import * as crypto from 'crypto';

interface SearchFilters {
  type?: string;
  /**
   * 환자 한 명 안으로 좁힌다(차트 내 검색 — patient-chart-refinement C4).
   * 🔴 주면 **모든** 하위 질의에 같은 환자 조건이 걸린다 — 한 갈래라도 빠지면 다른 환자 기록이 섞인다(가드가 갈래별로 본다).
   * 진단·처방·검사 결과 갈래는 환자를 지정했을 때만 연다 — 전 환자 전문검색 화면의 결과 구성을 바꾸지 않는다.
   */
  patientId?: string;
  dateFrom?: string;
  dateTo?: string;
  doctorId?: string;
  page?: number;
  limit?: number;
}

interface RawSearchRow {
  id: string;
  type: string;
  headline: string;
  patient_name: string;
  doctor_name: string;
  recorded_at: string;
  status: string | null;
}

export interface SearchResult {
  id: string;
  type: string;
  headline: string;
  patientName: string;
  doctorName: string;
  recordedAt: string;
  /** 갈래 고유 상태(검사 결과 VERIFIED/COMPLETED·처방 ACTIVE/CANCELLED) — 없는 갈래는 null */
  status?: string | null;
}

export interface SearchResponse {
  results: SearchResult[];
  total: number;
  /** 🔴 자르면 잘랐다고 말한다 — total 이 이번에 돌려준 범위를 넘으면 true */
  truncated?: boolean;
  /** 결과를 만든 시각 — 캐시(5분)에서 온 결과면 과거 시각이다 */
  generatedAt?: string;
}

/** 환자 지정 시에만 여는 갈래 */
export const PATIENT_SCOPED_TYPES = ['diagnosis', 'prescription', 'lab_result'] as const;

@Injectable()
export class MedicalRecordSearchService implements OnModuleInit {
  private readonly logger = new Logger('MedicalRecordSearch');
  private readonly CACHE_TTL = 300; // 5분 캐싱

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /**
   * 부팅 시 검색용 pg_trgm GIN 3개를 보장한다(스키마 밖 인덱스 — `docs/05-reference/manual-index-inventory.md` §3).
   * 🔴 (2026-09-13) 종전에는 각 CREATE 를 `.catch(() => {})` 로 삼키고 무조건 "ensured" 를 남겼다 — 실패해도 "ensured".
   * 이제 인덱스마다 결과를 따로 말한다. 부팅은 막지 않는다(검색은 인덱스 없이도 동작 — 막으면 방치된다).
   * `CREATE INDEX CONCURRENTLY` 가 중간에 실패하면 INVALID 인덱스가 남고 `IF NOT EXISTS` 가 영원히 건너뛴다 —
   * 그래서 생성 뒤 `pg_index.indisvalid` 를 읽어 "있다"와 "쓸 수 있다"를 구분한다.
   */
  async onModuleInit() {
    const result = await this.ensureTrgmIndexes();
    const failed = result.filter((r) => r.status !== 'VALID');
    if (failed.length === 0) {
      this.logger.log(`pg_trgm GIN indexes ensured (${result.length}/${result.length} valid)`);
    } else {
      // 로그 문장은 고정 — 서버 조립 표시 문장 가드(server-composed-display-text)를 늘리지 않는다
      for (const f of failed) this.logger.warn(`pg_trgm GIN ${f.name} ${f.status}${f.reason ? `: ${f.reason}` : ''}`);
      this.logger.warn('pg_trgm GIN 인덱스가 유효하지 않은 검색은 인덱스 없이(순차 스캔) 동작한다 — 위 인덱스를 확인한다');
    }
  }

  /** 인덱스별 결과 — VALID(존재·사용 가능) · INVALID(CONCURRENTLY 실패 잔재) · FAILED(생성 실패) · UNKNOWN(검증 조회 실패) */
  async ensureTrgmIndexes(): Promise<Array<{ name: string; status: 'VALID' | 'INVALID' | 'FAILED' | 'UNKNOWN'; reason?: string }>> {
    const defs: Array<{ name: string; sql: string }> = [
      { name: 'idx_encounters_soap_trgm', sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_encounters_soap_trgm
        ON encounters USING gin ((COALESCE(subjective,'') || ' ' || COALESCE(objective,'') || ' ' || COALESCE(assessment,'') || ' ' || COALESCE(plan,'')) gin_trgm_ops)` },
      { name: 'idx_progress_notes_content_trgm', sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_progress_notes_content_trgm
        ON progress_notes USING gin (content gin_trgm_ops)` },
      { name: 'idx_nursing_notes_search_trgm', sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_nursing_notes_search_trgm
        ON nursing_notes USING gin ((COALESCE(focus,'') || ' ' || COALESCE(data,'') || ' ' || COALESCE(action,'') || ' ' || COALESCE(response,'') || ' ' || COALESCE(content,'')) gin_trgm_ops)` },
    ];
    try {
      await this.prisma.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
    } catch (e) {
      const reason = `CREATE EXTENSION pg_trgm failed: ${(e as Error).message}`;
      return defs.map((d) => ({ name: d.name, status: 'FAILED' as const, reason }));
    }
    const out: Array<{ name: string; status: 'VALID' | 'INVALID' | 'FAILED' | 'UNKNOWN'; reason?: string }> = [];
    for (const d of defs) {
      // CONCURRENTLY 는 트랜잭션 밖에서만 가능 — 인덱스마다 따로 실행하고, 실패는 그 인덱스의 사실로 남긴다
      try {
        await this.prisma.$executeRawUnsafe(d.sql);
      } catch (e) {
        out.push({ name: d.name, status: 'FAILED', reason: (e as Error).message });
        continue;
      }
      try {
        const rows = await this.prisma.$queryRawUnsafe<Array<{ valid: boolean }>>(
          `SELECT i.indisvalid AS valid FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = $1`, d.name,
        );
        if (rows.length === 0) out.push({ name: d.name, status: 'FAILED', reason: '생성 명령은 끝났으나 인덱스가 없다' });
        else out.push({ name: d.name, status: rows[0].valid ? 'VALID' : 'INVALID', reason: rows[0].valid ? undefined : 'CONCURRENTLY 실패 잔재 — DROP INDEX CONCURRENTLY 후 재부팅 필요(사람 확인)' });
      } catch (e) {
        out.push({ name: d.name, status: 'UNKNOWN', reason: `pg_index validity query failed: ${(e as Error).message}` });
      }
    }
    return out;
  }

  private getCacheKey(query: string, filters: SearchFilters): string {
    const key = `search:${query}:${JSON.stringify(filters)}`;
    return crypto.createHash('sha256').update(key).digest('hex');
  }

  async search(query: string, filters: SearchFilters): Promise<SearchResponse> {
    if (!query || query.trim().length < 2) {
      return { results: [], total: 0 };
    }

    // 캐시에서 먼저 검색
    const cacheKey = this.getCacheKey(query, filters);
    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (err) {
      // 캐시 실패시 무시하고 계속
    }

    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;
    const offset = (page - 1) * limit;
    const searchTerm = `%${query.trim()}%`;

    // 파라미터 배열 관리 ($1 = searchTerm, 이후 동적 추가)
    const params: (string | number)[] = [searchTerm];
    let paramIndex = 2; // 다음 파라미터 인덱스

    // 날짜/의사 필터를 파라미터화
    const buildSafeFilters = (dateCol: string): string => {
      const parts: string[] = [];
      if (filters.dateFrom) {
        parts.push(`AND ${dateCol} >= $${paramIndex}`);
        params.push(filters.dateFrom);
        paramIndex++;
      }
      if (filters.dateTo) {
        parts.push(`AND ${dateCol} <= $${paramIndex}`);
        params.push(filters.dateTo);
        paramIndex++;
      }
      if (filters.doctorId) {
        parts.push(`AND e.doctor_id = $${paramIndex}`);
        params.push(filters.doctorId);
        paramIndex++;
      }
      return parts.join(' ');
    };

    const buildSafeDateFilter = (dateCol: string): string => {
      const parts: string[] = [];
      if (filters.dateFrom) {
        parts.push(`AND ${dateCol} >= $${paramIndex}`);
        params.push(filters.dateFrom);
        paramIndex++;
      }
      if (filters.dateTo) {
        parts.push(`AND ${dateCol} <= $${paramIndex}`);
        params.push(filters.dateTo);
        paramIndex++;
      }
      return parts.join(' ');
    };

    // 환자 조건 — 갈래마다 새 파라미터 번호로 건다(같은 값이라도 $n 을 공유하지 않아 갈래 추가·삭제에 안전)
    const patientFilter = (col: string): string => {
      if (!filters.patientId) return '';
      params.push(filters.patientId);
      return `AND ${col} = $${paramIndex++}::uuid`;
    };
    const wantType = (t: string) => (filters.type ? filters.type === t : true);

    const queries: string[] = [];

    if (!filters.type || filters.type === 'encounter') {
      const encounterFilters = buildSafeFilters('e.created_at') + ' ' + patientFilter('e.patient_id');
      // CONCAT_WS — 종전 `a || ' ' || b` 는 S·O·A·P 중 하나만 비어도 headline 전체가 NULL→'' 이 됐다
      queries.push(`
        SELECT e.id, 'encounter' as type,
          COALESCE(SUBSTRING(CONCAT_WS(' ', e.subjective, e.objective, e.assessment, e.plan) FROM 1 FOR 200), '') as headline,
          p.family_name || p.given_name as patient_name,
          u.family_name || u.given_name as doctor_name,
          e.created_at as recorded_at,
          NULL::text as status
        FROM encounters e
        JOIN patients p ON p.id = e.patient_id
        JOIN users u ON u.id = e.doctor_id
        WHERE (e.subjective ILIKE $1 OR e.objective ILIKE $1 OR e.assessment ILIKE $1 OR e.plan ILIKE $1)
        ${encounterFilters}
      `);
    }

    if (!filters.type || filters.type === 'progress_note') {
      const noteFilters = buildSafeDateFilter('pn.created_at') + ' ' + patientFilter('a.patient_id');
      queries.push(`
        SELECT pn.id, 'progress_note' as type,
          SUBSTRING(pn.content FROM 1 FOR 200) as headline,
          p.family_name || p.given_name as patient_name,
          u.family_name || u.given_name as doctor_name,
          pn.created_at as recorded_at,
          NULL::text as status
        FROM progress_notes pn
        JOIN admissions a ON a.id = pn.admission_id
        JOIN patients p ON p.id = a.patient_id
        JOIN users u ON u.id = pn.doctor_id
        WHERE pn.content ILIKE $1
        ${noteFilters}
      `);
    }

    if (!filters.type || filters.type === 'nursing_note') {
      const nursingFilters = buildSafeDateFilter('nn.created_at') + ' ' + patientFilter('a.patient_id');
      queries.push(`
        SELECT nn.id, 'nursing_note' as type,
          COALESCE(SUBSTRING(nn.focus || ' ' || COALESCE(nn.data,'') || ' ' || COALESCE(nn.action,'') || ' ' || COALESCE(nn.response,'') FROM 1 FOR 200), '') as headline,
          p.family_name || p.given_name as patient_name,
          u.family_name || u.given_name as doctor_name,
          nn.created_at as recorded_at,
          NULL::text as status
        FROM nursing_notes nn
        JOIN admissions a ON a.id = nn.admission_id
        JOIN patients p ON p.id = a.patient_id
        JOIN users u ON u.id = nn.nurse_id
        WHERE (nn.focus ILIKE $1 OR nn.data ILIKE $1 OR nn.action ILIKE $1 OR nn.response ILIKE $1 OR nn.content ILIKE $1)
        ${nursingFilters}
      `);
    }

    if (!filters.type || filters.type === 'discharge_summary') {
      const dsFilters = buildSafeDateFilter('ds.created_at') + ' ' + patientFilter('a.patient_id');
      queries.push(`
        SELECT ds.id, 'discharge_summary' as type,
          SUBSTRING(ds.hospital_course FROM 1 FOR 200) as headline,
          p.family_name || p.given_name as patient_name,
          u.family_name || u.given_name as doctor_name,
          ds.created_at as recorded_at,
          NULL::text as status
        FROM discharge_summaries ds
        JOIN admissions a ON a.id = ds.admission_id
        JOIN patients p ON p.id = a.patient_id
        JOIN users u ON u.id = ds.doctor_id
        WHERE (ds.hospital_course ILIKE $1 OR ds.admit_diagnosis ILIKE $1 OR ds.discharge_diagnosis ILIKE $1)
        ${dsFilters}
      `);
    }

    if (filters.patientId && wantType('diagnosis')) {
      const f = buildSafeDateFilter('e.created_at') + ' ' + patientFilter('e.patient_id');
      queries.push(`
        SELECT ed.id, 'diagnosis' as type,
          CONCAT_WS(' ', dc.code, dc.name_ko) as headline,
          p.family_name || p.given_name as patient_name,
          COALESCE(u.family_name || u.given_name, '') as doctor_name,
          e.created_at as recorded_at,
          NULL::text as status
        FROM encounter_diagnoses ed
        JOIN encounters e ON e.id = ed.encounter_id
        JOIN diagnosis_codes dc ON dc.id = ed.diagnosis_code_id
        JOIN patients p ON p.id = e.patient_id
        LEFT JOIN users u ON u.id = e.doctor_id
        WHERE (dc.name_ko ILIKE $1 OR dc.name_en ILIKE $1 OR dc.code ILIKE $1)
        ${f}
      `);
    }

    if (filters.patientId && wantType('prescription')) {
      const f = buildSafeDateFilter('rx.created_at') + ' ' + patientFilter('e.patient_id');
      queries.push(`
        SELECT rx.id, 'prescription' as type,
          CONCAT_WS(' ', COALESCE(mc.name_ko, pc.name_ko), rx.dosage, rx.frequency) as headline,
          p.family_name || p.given_name as patient_name,
          COALESCE(u.family_name || u.given_name, '') as doctor_name,
          rx.created_at as recorded_at,
          rx.status::text as status
        FROM prescriptions rx
        JOIN encounters e ON e.id = rx.encounter_id
        LEFT JOIN medication_codes mc ON mc.id = rx.medication_code_id
        LEFT JOIN procedure_codes pc ON pc.id = rx.procedure_code_id
        JOIN patients p ON p.id = e.patient_id
        LEFT JOIN users u ON u.id = COALESCE(rx.prescriber_id, rx.created_by)
        WHERE (mc.name_ko ILIKE $1 OR mc.name_en ILIKE $1 OR mc.ingredient ILIKE $1 OR pc.name_ko ILIKE $1)
        ${f}
      `);
    }

    if (filters.patientId && wantType('lab_result')) {
      const f = buildSafeDateFilter('lr.created_at') + ' ' + patientFilter('lr.patient_id');
      // 보고값은 그대로(재반올림 금지) · 예비(COMPLETED)와 확정(VERIFIED)은 status 로 구분해 내보낸다
      queries.push(`
        SELECT li.id, 'lab_result' as type,
          CONCAT_WS(' ', li.test_name, li.value, li.unit) as headline,
          p.family_name || p.given_name as patient_name,
          COALESCE(u.family_name || u.given_name, '') as doctor_name,
          COALESCE(lr.verified_at, lr.completed_at, lr.created_at) as recorded_at,
          lr.status::text as status
        FROM lab_result_items li
        JOIN lab_results lr ON lr.id = li.lab_result_id
        JOIN patients p ON p.id = lr.patient_id
        LEFT JOIN users u ON u.id = lr.technician_id
        WHERE (li.test_name ILIKE $1 OR li.test_code ILIKE $1)
        ${f}
      `);
    }

    if (queries.length === 0) return { results: [], total: 0 };

    const unionQuery = queries.join(' UNION ALL ');
    // Parameterize LIMIT/OFFSET to prevent SQL injection
    const limitParamIdx = params.length + 1;
    const offsetParamIdx = params.length + 2;
    const sql = `SELECT * FROM (${unionQuery}) sub ORDER BY recorded_at DESC LIMIT $${limitParamIdx} OFFSET $${offsetParamIdx}`;
    const countSql = `SELECT COUNT(*) as total FROM (${unionQuery}) sub`;

    const [results, countResult] = await Promise.all([
      this.prisma.$queryRawUnsafe<RawSearchRow[]>(sql, ...params, limit, offset),
      this.prisma.$queryRawUnsafe<{ total: bigint }[]>(countSql, ...params),
    ]);

    const total = Number(countResult[0]?.total ?? 0);
    const response: SearchResponse = {
      results: results.map((r) => ({
        id: r.id,
        type: r.type,
        headline: this.highlightQuery(r.headline, query),
        recordedAt: String(r.recorded_at),
        patientName: String(r.patient_name),
        doctorName: String(r.doctor_name),
        status: r.status ?? null,
      })),
      total,
      truncated: total > offset + results.length,
      generatedAt: new Date().toISOString(),
    };

    // 캐시에 저장
    try {
      await this.redis.setex(cacheKey, this.CACHE_TTL, JSON.stringify(response));
    } catch (err) {
      // 캐시 실패시 무시하고 계속
    }

    return response;
  }

  // 날짜 필터는 search() 내부에서 파라미터화 처리

  private highlightQuery(text: string, query: string): string {
    if (!text || !query) return text;
    const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return text.replace(regex, '<mark>$1</mark>');
  }
}
