import { Injectable, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { TruncationRecorder } from '../../common/stored-truncation';

// Default department access - used when no DB config exists
const DEFAULT_DEPT_ACCESS: Record<string, string[]> = {
  '급양과': ['/dashboard', '/nutrition', '/hr', '/education'],
  '원무과': ['/dashboard', '/reception', '/billing', '/claims', '/patients', '/schedule', '/hr', '/education'],
  '행정과': ['/dashboard', '/hr', '/inventory', '/equipment', '/education', '/admin/analytics', '/admin/status'],
  '의무기록과': ['/dashboard', '/patients', '/medical-records/search', '/medical-records/copy', '/consent', '/hr', '/education', '/admin/emr-cert', '/admin/audit'],
  '경영진': ['/dashboard', '/executive', '/executive/clinical', '/hr', '/admin/analytics', '/admin/status', '/admin/config'],
  '건강검진센터(의사)': ['/checkup', '/checkup/reception', '/checkup/waiting', '/checkup/programs', '/checkup/schedule', '/checkup/review', '/checkup/follow-ups', '/checkup/stats', '/checkup/contracts', '/patients', '/consent', '/hr', '/education'],
  '건강검진센터(간호사)': ['/checkup', '/checkup/reception', '/checkup/waiting', '/checkup/schedule', '/checkup/follow-ups', '/patients', '/consent', '/hr', '/education'],
  '건강검진센터(원무)': ['/checkup', '/checkup/reception', '/checkup/waiting', '/checkup/schedule', '/checkup/contracts', '/checkup/stats', '/patients', '/billing', '/schedule', '/hr', '/education'],
  '건강검진센터(행정)': ['/checkup', '/checkup/contracts', '/checkup/stats', '/checkup/follow-ups', '/hr', '/education', '/admin/analytics'],
  '건강검진센터(검사실)': ['/checkup', '/checkup/station', '/checkup/waiting'],
  // 임상 워크스테이션
  '검사실(채혈)': ['/workstation', '/workstation/lab'],
  '검사실(혈액)': ['/workstation', '/workstation/lab'],
  '검사실(생화학)': ['/workstation', '/workstation/lab'],
  '검사실(소변)': ['/workstation', '/workstation/lab'],
  '검사실(미생물)': ['/workstation', '/workstation/lab'],
  '영상실(일반촬영)': ['/workstation', '/workstation/imaging'],
  '영상실(CT)': ['/workstation', '/workstation/imaging'],
  '영상실(MRI)': ['/workstation', '/workstation/imaging'],
  '영상실(초음파)': ['/workstation', '/workstation/imaging'],
  '기초검사(심전도)': ['/workstation', '/workstation/diagnostic'],
  '기초검사(폐기능)': ['/workstation', '/workstation/diagnostic'],
  '기초검사(내시경)': ['/workstation', '/workstation/diagnostic'],
  '영상의학과(판독)': ['/workstation', '/workstation/reading', '/imaging'],
  '치료실(물리)': ['/workstation', '/workstation/therapy'],
  '치료실(작업)': ['/workstation', '/workstation/therapy'],
  '치료실(언어)': ['/workstation', '/workstation/therapy'],
  '치료실(투석)': ['/workstation', '/workstation/therapy'],
  '치료실(항암)': ['/workstation', '/workstation/therapy'],
  '치료실(방사선)': ['/workstation', '/workstation/therapy'],
};

// All available menu paths
const ALL_MENU_PATHS = [
  { path: '/dashboard', label: '대시보드', section: '임상' },
  { path: '/reception', label: '접수', section: '임상' },
  { path: '/patients', label: '환자 관리', section: '임상' },
  { path: '/schedule', label: '예약', section: '임상' },
  { path: '/orders', label: '오더(OCS)', section: '임상' },
  { path: '/pharmacy', label: '약국', section: '임상' },
  { path: '/lab', label: '검사실', section: '임상' },
  { path: '/imaging', label: '영상실', section: '임상' },
  { path: '/surgery', label: '수술', section: '임상' },
  { path: '/emergency', label: '응급실', section: '임상' },
  { path: '/icu', label: '중환자실', section: '임상' },
  { path: '/diagnostics', label: '기초검사', section: '임상' },
  { path: '/inpatient', label: '입원 환자', section: '입원' },
  { path: '/beds', label: '병상 현황', section: '입원' },
  { path: '/nutrition', label: '급식', section: '입원' },
  { path: '/consent', label: '동의서', section: '의무기록' },
  { path: '/medical-records/search', label: '기록 검색', section: '의무기록' },
  { path: '/medical-records/copy', label: '사본 발급', section: '의무기록' },
  { path: '/billing', label: '수납', section: '관리' },
  { path: '/claims', label: '보험 청구', section: '관리' },
  { path: '/inventory', label: '자재/재고', section: '관리' },
  { path: '/cssd', label: '중앙공급', section: '관리' },
  { path: '/equipment', label: '장비', section: '관리' },
  { path: '/hr', label: '인사', section: '관리' },
  { path: '/safety', label: '환자안전', section: '안전/질관리' },
  { path: '/infection', label: '감염관리', section: '안전/질관리' },
  { path: '/quality', label: 'QI', section: '안전/질관리' },
  { path: '/education', label: '직원교육', section: '안전/질관리' },
  { path: '/executive', label: '경영 대시보드', section: '경영진' },
  { path: '/executive/clinical', label: '의료 품질', section: '경영진' },
  { path: '/admin/staff-management', label: '직원 관리', section: '관리자' },
  { path: '/admin/order-sets', label: '약속처방(CP)', section: '관리자' },
  { path: '/admin/clinic-schedule', label: '진료표', section: '관리자' },
  { path: '/admin/analytics', label: '통계/분석', section: '관리자' },
  { path: '/admin/facility', label: '시설 관리', section: '관리자' },
  { path: '/admin/codes', label: '코드 마스터', section: '관리자' },
  { path: '/admin/status', label: '병원 현황', section: '관리자' },
  { path: '/admin/audit', label: '감사 로그', section: '관리자' },
  { path: '/admin/config', label: '설정', section: '관리자' },
  { path: '/admin/emr-cert', label: 'EMR 인증', section: '관리자' },
  { path: '/admin/access-control', label: '접근 권한 관리', section: '관리자' },
  { path: '/checkup', label: '건강검진센터', section: '클리닉 센터' },
  { path: '/checkup/reception', label: '검진 접수', section: '클리닉 센터' },
  { path: '/checkup/waiting', label: '검진 대기', section: '클리닉 센터' },
  { path: '/checkup/programs', label: '검진 프로그램', section: '클리닉 센터' },
  { path: '/checkup/schedule', label: '검진 예약', section: '클리닉 센터' },
  { path: '/checkup/review', label: '소견 대기', section: '클리닉 센터' },
  { path: '/checkup/contracts', label: '단체 검진', section: '클리닉 센터' },
  { path: '/checkup/follow-ups', label: '추적 관리', section: '클리닉 센터' },
  { path: '/checkup/stats', label: '검진 통계', section: '클리닉 센터' },
  { path: '/checkup/station', label: '검사실', section: '클리닉 센터' },
];

@Injectable()
export class AccessControlService {
  constructor(private readonly prisma: PrismaService) {}

  /** Get all available menu paths */
  getMenuPaths() {
    return ALL_MENU_PATHS;
  }

  /** Get all department access configs */
  async getAllDeptAccess(): Promise<Record<string, string[]>> {
    const configs = await this.prisma.systemConfig.findMany({
      where: { category: 'access' },
    });

    const result: Record<string, string[]> = { ...DEFAULT_DEPT_ACCESS };

    for (const cfg of configs) {
      const dept = (cfg.key as string).replace('access.dept.', '');
      const val = cfg.value as Record<string, unknown>;
      if (val?.allowedPaths && Array.isArray(val.allowedPaths)) {
        result[dept] = val.allowedPaths as string[];
      }
    }

    return result;
  }

  /** Get access config for a specific department */
  async getDeptAccess(department: string): Promise<string[]> {
    const cfg = await this.prisma.systemConfig.findUnique({
      where: { key: `access.dept.${department}` },
    });

    if (cfg) {
      const val = cfg.value as Record<string, unknown>;
      return (val?.allowedPaths as string[] | undefined) ?? [];
    }

    return DEFAULT_DEPT_ACCESS[department] ?? [];
  }

  /** Update access config for a department */
  async setDeptAccess(department: string, allowedPaths: string[], updatedBy: string) {
    const key = `access.dept.${department}`;

    return this.prisma.systemConfig.upsert({
      where: { key },
      update: {
        value: { allowedPaths },
        updatedBy,
      },
      create: {
        key,
        value: { allowedPaths },
        category: 'access',
        label: `${department} 메뉴 접근 권한`,
        updatedBy,
      },
    });
  }

  /** Delete department access (revert to default) */
  async deleteDeptAccess(department: string) {
    const key = `access.dept.${department}`;
    return this.prisma.systemConfig.deleteMany({ where: { key } });
  }

  // ── 사이드바 메뉴 구성·권한 오버라이드(href별 숨김/역할) ──
  /** 메뉴 오버라이드 조회: { [href]: { hidden?, roles?, order?, label? } } */
  async getMenuOverrides(): Promise<Record<string, { hidden?: boolean; roles?: string[]; order?: number; label?: string }>> {
    const cfg = await this.prisma.systemConfig.findUnique({ where: { key: 'access.menu.overrides' } });
    return (cfg?.value as Record<string, { hidden?: boolean; roles?: string[]; order?: number; label?: string }>) ?? {};
  }

  /** 메뉴 오버라이드 저장(관리자) — 하드코딩 사이드바에 적용(표시/권한/순서/라벨) */
  async setMenuOverrides(overrides: Record<string, { hidden?: boolean; roles?: string[]; order?: number; label?: string }>, updatedBy: string) {
    return this.prisma.systemConfig.upsert({
      where: { key: 'access.menu.overrides' },
      update: { value: overrides, updatedBy },
      create: { key: 'access.menu.overrides', value: overrides, category: 'access', label: '사이드바 메뉴 구성·권한 오버라이드', updatedBy },
    });
  }

  // ── 사용자 정의(커스텀) 메뉴 — 관리자가 직접 추가한 메뉴 항목 ──
  /**
   * 커스텀 메뉴 href 검증·정규화 — 사이드바에서 전 직원에게 렌더되므로 보안 경계.
   *  허용: 내부 절대경로('/...') 또는 외부 http(s):// URL(파싱 가능).
   *  차단: 프로토콜-상대('//evil.com' = open-redirect), javascript:/data: 등 모든 스킴.
   *  반환 null = 무효(저장/렌더 제외).
   */
  private sanitizeMenuHref(raw: string | undefined): string | null {
    const href = (raw ?? '').trim();
    if (!href) return null;
    if (/^https?:\/\//i.test(href)) {
      try {
        const u = new URL(href);
        return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
      } catch { return null; }
    }
    if (href.startsWith('//')) return null;             // 프로토콜-상대 URL(외부 유출)
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return null; // javascript:/data:/mailto: 등 스킴 차단
    return href.startsWith('/') ? href : `/${href}`;
  }

  /** 커스텀 메뉴 조회: [{ id, section, href, label, roles }] — 읽기 시에도 href 재검증(기존 불량 데이터 무력화) */
  async getMenuCustom(): Promise<Array<{ id: string; section: string; href: string; label: string; roles: string[] }>> {
    const cfg = await this.prisma.systemConfig.findUnique({ where: { key: 'access.menu.custom' } });
    const rows = (cfg?.value as Array<{ id: string; section: string; href: string; label: string; roles: string[] }>) ?? [];
    return rows
      .map((it) => ({ ...it, href: this.sanitizeMenuHref(it.href) }))
      .filter((it): it is typeof it & { href: string } => it.href !== null);
  }

  /** 커스텀 메뉴 저장(관리자) — 사이드바 기본 메뉴에 병합 */
  async setMenuCustom(
    items: Array<{ id?: string; section: string; href: string; label: string; roles?: string[] }>,
    updatedBy: string,
  ) {
    // 정규화: 빈 항목 제거, id/roles 보정, href 정리
    const seen = new Set<string>();
    const cleaned = (items ?? [])
      .filter((it) => it && it.label?.trim() && it.href?.trim() && it.section?.trim())
      .map((it, i) => {
        const href = this.sanitizeMenuHref(it.href); // 위험 스킴·프로토콜-상대 URL 차단
        if (!href) return null;
        const id = (it.id?.trim() || `custom-${i}-${href.replace(/[^a-zA-Z0-9]/g, '').slice(0, 16)}`);
        return {
          id,
          section: it.section.trim(),
          href,
          label: it.label.trim(),
          roles: Array.isArray(it.roles) && it.roles.length ? it.roles : ['ADMIN'],
        };
      })
      .filter((it): it is NonNullable<typeof it> => it !== null)
      .filter((it) => (seen.has(it.href) ? false : (seen.add(it.href), true))); // href 중복 제거
    return this.prisma.systemConfig.upsert({
      where: { key: 'access.menu.custom' },
      update: { value: cleaned, updatedBy },
      create: { key: 'access.menu.custom', value: cleaned, category: 'access', label: '사이드바 사용자 정의 메뉴', updatedBy },
    });
  }

  // ── 커스텀 콘텐츠 페이지(/custom/<slug>) — 커스텀 메뉴의 내부 목적지(404 방지) ──
  private slugKey(slug: string): string {
    const s = (slug ?? '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 60);
    if (!s) throw new BadRequestException({ code: 'INVALID_SLUG', message: '잘못된 페이지 주소입니다.' });
    return `access.custom-page.${s}`;
  }

  /** 커스텀 페이지 조회 — 없으면 exists:false(편집 안내용) */
  async getCustomPage(slug: string): Promise<{ slug: string; title: string; content: string; exists: boolean; updatedAt: Date | null }> {
    const cfg = await this.prisma.systemConfig.findUnique({ where: { key: this.slugKey(slug) } });
    const v = (cfg?.value as { title?: string; content?: string } | null) ?? null;
    return { slug, title: v?.title ?? '', content: v?.content ?? '', exists: !!cfg, updatedAt: cfg?.updatedAt ?? null };
  }

  /** 커스텀 페이지 저장(관리자) — content 는 FE 에서 sanitize 렌더 */
  async setCustomPage(slug: string, dto: { title?: string; content?: string }, updatedBy: string) {
    const key = this.slugKey(slug);
    // 🔴 (2026-09-15 U4) 운영 문서(제목 200·본문 50,000자) — 잘라 저장하되 잘린 사실을 응답 `truncatedFields` 로 알린다
    const rec = new TruncationRecorder();
    const value = { title: rec.clip('title', dto.title ?? '', 200), content: rec.clip('content', dto.content ?? '', 50000) };
    await this.prisma.systemConfig.upsert({
      where: { key },
      update: { value, updatedBy },
      create: { key, value, category: 'access', label: `커스텀 페이지: ${slug}`, updatedBy },
    });
    return { ok: true, truncatedFields: rec.truncatedFields };
  }

  // ── 역할별 데이터 접근 권한 ──

  private readonly DEFAULT_ROLE_DATA_ACCESS: Record<string, Record<string, boolean>> = {
    // 시스템 역할
    ADMIN: { canRegister: true, showPhone: true, showInsurance: true, showAddress: true, showAllergy: true, showDiagnosis: true, showPrescription: true, showLabResult: true, showImaging: true, showBilling: true, showNursingNote: true },
    DOCTOR: { canRegister: false, showPhone: false, showInsurance: false, showAddress: false, showAllergy: true, showDiagnosis: true, showPrescription: true, showLabResult: true, showImaging: true, showBilling: false, showNursingNote: true },
    NURSE: { canRegister: false, showPhone: true, showInsurance: false, showAddress: false, showAllergy: true, showDiagnosis: true, showPrescription: true, showLabResult: true, showImaging: false, showBilling: false, showNursingNote: true },
    PHARMACIST: { canRegister: false, showPhone: false, showInsurance: false, showAddress: false, showAllergy: true, showDiagnosis: false, showPrescription: true, showLabResult: false, showImaging: false, showBilling: false, showNursingNote: false },
    LAB_TECH: { canRegister: false, showPhone: false, showInsurance: false, showAddress: false, showAllergy: false, showDiagnosis: true, showPrescription: false, showLabResult: true, showImaging: true, showBilling: false, showNursingNote: false },
    // 부서별 (ADMIN 역할 내 세분화)
    'dept.원무과': { canRegister: true, showPhone: true, showInsurance: true, showAddress: true, showAllergy: false, showDiagnosis: false, showPrescription: false, showLabResult: false, showImaging: false, showBilling: true, showNursingNote: false },
    'dept.행정과': { canRegister: false, showPhone: false, showInsurance: false, showAddress: false, showAllergy: false, showDiagnosis: false, showPrescription: false, showLabResult: false, showImaging: false, showBilling: false, showNursingNote: false },
    'dept.급양과': { canRegister: false, showPhone: false, showInsurance: false, showAddress: false, showAllergy: true, showDiagnosis: false, showPrescription: false, showLabResult: false, showImaging: false, showBilling: false, showNursingNote: false },
    'dept.의무기록과': { canRegister: false, showPhone: true, showInsurance: true, showAddress: true, showAllergy: true, showDiagnosis: true, showPrescription: true, showLabResult: true, showImaging: true, showBilling: true, showNursingNote: true },
    'dept.경영진': { canRegister: false, showPhone: false, showInsurance: false, showAddress: false, showAllergy: false, showDiagnosis: false, showPrescription: false, showLabResult: false, showImaging: false, showBilling: true, showNursingNote: false },
  };

  /** Get all data access fields definition */
  getDataAccessFields() {
    return [
      { key: 'canRegister', label: '환자 등록', category: '기본' },
      { key: 'showPhone', label: '연락처 조회', category: '개인정보' },
      { key: 'showInsurance', label: '보험 정보 조회', category: '개인정보' },
      { key: 'showAddress', label: '주소 조회', category: '개인정보' },
      { key: 'showAllergy', label: '알레르기 조회', category: '임상정보' },
      { key: 'showDiagnosis', label: '진단 기록 조회', category: '임상정보' },
      { key: 'showPrescription', label: '처방 기록 조회', category: '임상정보' },
      { key: 'showLabResult', label: '검사 결과 조회', category: '임상정보' },
      { key: 'showImaging', label: '영상 결과 조회', category: '임상정보' },
      { key: 'showBilling', label: '수납/청구 조회', category: '관리' },
      { key: 'showNursingNote', label: '간호 기록 조회', category: '임상정보' },
    ];
  }

  /** Get all role data access configs */
  async getAllRoleDataAccess(): Promise<Record<string, Record<string, boolean>>> {
    const configs = await this.prisma.systemConfig.findMany({
      where: { category: 'role-data-access' },
    });
    const result: Record<string, Record<string, boolean>> = { ...this.DEFAULT_ROLE_DATA_ACCESS };
    for (const cfg of configs) {
      const role = (cfg.key as string).replace('access.role.', '');
      result[role] = cfg.value as Record<string, boolean>;
    }
    return result;
  }

  /** Get data access for a specific role */
  async getRoleDataAccess(role: string): Promise<Record<string, boolean>> {
    const cfg = await this.prisma.systemConfig.findUnique({
      where: { key: `access.role.${role}` },
    });
    if (cfg) return cfg.value as Record<string, boolean>;
    return this.DEFAULT_ROLE_DATA_ACCESS[role] ?? this.DEFAULT_ROLE_DATA_ACCESS.ADMIN;
  }

  /**
   * 🔴 환자 목록 좁히기(2026-10-20 환자 목록 P0) — 화면이 종전에 쓰던 순서 그대로: 부서 키 → 역할 키(각각 저장값 → 기본값).
   * 등재되지 않은 역할은 `null`(좁히지 않는다) — `getRoleDataAccess` 처럼 ADMIN 기본값으로 떨어뜨리지 않는다.
   * 이 값은 서버 권한(RBAC)을 **좁히기만** 한다 — 넓히는 값은 소비처가 무시한다.
   */
  async listNarrowing(role: string, department?: string | null): Promise<{ values: Record<string, boolean>; source: string } | null> {
    const keys = [department ? `dept.${department}` : null, role].filter((k): k is string => !!k);
    const rows = await this.prisma.systemConfig.findMany({
      where: { key: { in: keys.map((k) => `access.role.${k}`) }, category: 'role-data-access' },
    });
    for (const k of keys) {
      const row = rows.find((r) => r.key === `access.role.${k}`);
      if (row && row.value && typeof row.value === 'object') return { values: row.value as Record<string, boolean>, source: `access.role.${k}` };
      if (this.DEFAULT_ROLE_DATA_ACCESS[k]) return { values: this.DEFAULT_ROLE_DATA_ACCESS[k], source: `default:${k}` };
    }
    return null;
  }

  /** Update role data access */
  async setRoleDataAccess(role: string, permissions: Record<string, boolean>, updatedBy: string) {
    const key = `access.role.${role}`;
    return this.prisma.systemConfig.upsert({
      where: { key },
      update: { value: permissions as Prisma.InputJsonValue, updatedBy },
      create: { key, value: permissions as Prisma.InputJsonValue, category: 'role-data-access', label: `${role} 역할 데이터 접근 권한`, updatedBy },
    });
  }

  /** Reset role data access to default */
  async resetRoleDataAccess(role: string) {
    return this.prisma.systemConfig.deleteMany({ where: { key: `access.role.${role}` } });
  }

  // ── PACS 권한 관리 ──

  private readonly PACS_PERMISSION_FIELDS = [
    { key: 'studyView', label: 'Study 조회', category: '조회', description: 'DICOM Study/Series 목록 조회' },
    { key: 'reportView', label: '판독 리포트 조회', category: '조회', description: '판독 리포트 열람' },
    { key: 'reportCreate', label: '판독 리포트 작성', category: '판독', description: '새 판독 리포트 생성' },
    { key: 'reportSign', label: '판독 리포트 서명', category: '판독', description: '판독 서명 (확정)' },
    { key: 'viewerAccess', label: 'OHIF Viewer 접근', category: '뷰어', description: 'OHIF 뷰어로 영상 조회' },
    { key: 'worklistManage', label: 'Worklist 관리', category: '운영', description: '촬영 대기 목록 생성/관리' },
    { key: 'orderCreate', label: '영상 오더 생성', category: '운영', description: '검사 오더 생성' },
    { key: 'aiInference', label: 'AI 분석 요청', category: 'AI', description: 'AI 모델 추론 요청' },
    { key: 'adminAccess', label: 'PACS 관리', category: '관리', description: 'PACS 시스템 설정/사용자 관리' },
  ];

  private readonly DEFAULT_PACS_ACCESS: Record<string, Record<string, boolean>> = {
    ADMIN: { studyView: true, reportView: true, reportCreate: true, reportSign: true, viewerAccess: true, worklistManage: true, orderCreate: true, aiInference: true, adminAccess: true },
    DOCTOR: { studyView: true, reportView: true, reportCreate: true, reportSign: true, viewerAccess: true, worklistManage: false, orderCreate: true, aiInference: true, adminAccess: false },
    NURSE: { studyView: true, reportView: true, reportCreate: false, reportSign: false, viewerAccess: true, worklistManage: false, orderCreate: false, aiInference: false, adminAccess: false },
    PHARMACIST: { studyView: true, reportView: true, reportCreate: false, reportSign: false, viewerAccess: false, worklistManage: false, orderCreate: false, aiInference: false, adminAccess: false },
    LAB_TECH: { studyView: true, reportView: true, reportCreate: false, reportSign: false, viewerAccess: true, worklistManage: true, orderCreate: false, aiInference: false, adminAccess: false },
  };

  /** PACS 권한 항목 정의 */
  getPacsPermissionFields() {
    return this.PACS_PERMISSION_FIELDS;
  }

  /** 전체 역할별 PACS 접근 설정 */
  async getAllPacsAccess(): Promise<Record<string, Record<string, boolean>>> {
    const configs = await this.prisma.systemConfig.findMany({
      where: { category: 'pacs-access' },
    });
    const result: Record<string, Record<string, boolean>> = { ...this.DEFAULT_PACS_ACCESS };
    for (const cfg of configs) {
      const role = (cfg.key as string).replace('pacs.access.', '');
      result[role] = cfg.value as Record<string, boolean>;
    }
    return result;
  }

  /** 특정 역할의 PACS 접근 설정 */
  async getPacsAccess(role: string): Promise<Record<string, boolean>> {
    const cfg = await this.prisma.systemConfig.findUnique({
      where: { key: `pacs.access.${role}` },
    });
    if (cfg) return cfg.value as Record<string, boolean>;
    return this.DEFAULT_PACS_ACCESS[role] ?? this.DEFAULT_PACS_ACCESS.NURSE;
  }

  /** PACS 접근 설정 변경 */
  async setPacsAccess(role: string, permissions: Record<string, boolean>, updatedBy: string) {
    const key = `pacs.access.${role}`;
    return this.prisma.systemConfig.upsert({
      where: { key },
      update: { value: permissions as Prisma.InputJsonValue, updatedBy },
      create: { key, value: permissions as Prisma.InputJsonValue, category: 'pacs-access', label: `${role} PACS 접근 권한`, updatedBy },
    });
  }

  /** PACS 접근 설정 초기화 */
  async resetPacsAccess(role: string) {
    return this.prisma.systemConfig.deleteMany({ where: { key: `pacs.access.${role}` } });
  }

  /** 특정 사용자의 PACS 접근 권한 확인 (역할 + 사용자 오버라이드) */
  async checkPacsPermission(userId: string, userRole: string, permission: string): Promise<boolean> {
    // 1. 사용자 개별 오버라이드 확인
    const userOverride = await this.prisma.systemConfig.findUnique({
      where: { key: `pacs.user.${userId}` },
    });
    if (userOverride) {
      const perms = userOverride.value as Record<string, boolean>;
      if (permission in perms) return perms[permission];
    }

    // 2. 역할 기반 확인
    const roleAccess = await this.getPacsAccess(userRole);
    return roleAccess[permission] ?? false;
  }

  /** 사용자 개별 PACS 권한 오버라이드 설정 */
  async setUserPacsOverride(userId: string, permissions: Record<string, boolean>, updatedBy: string) {
    const key = `pacs.user.${userId}`;
    return this.prisma.systemConfig.upsert({
      where: { key },
      update: { value: permissions as Prisma.InputJsonValue, updatedBy },
      create: { key, value: permissions as Prisma.InputJsonValue, category: 'pacs-user-access', label: `사용자(${userId}) PACS 개별 권한`, updatedBy },
    });
  }

  /** 사용자 개별 PACS 권한 오버라이드 조회 */
  async getUserPacsOverride(userId: string): Promise<Record<string, boolean> | null> {
    const cfg = await this.prisma.systemConfig.findUnique({
      where: { key: `pacs.user.${userId}` },
    });
    return cfg ? (cfg.value as Record<string, boolean>) : null;
  }

  /** 사용자 개별 PACS 권한 초기화 (역할 기본으로 복원) */
  async resetUserPacsOverride(userId: string) {
    return this.prisma.systemConfig.deleteMany({ where: { key: `pacs.user.${userId}` } });
  }

  /** Get all departments that have custom or default configs */
  async getDepartments() {
    // Get departments from staff records
    const staffDepts = await this.prisma.staff.groupBy({
      by: ['department'],
      where: { status: 'ACTIVE' },
      _count: { id: true },
    });

    const all = await this.getAllDeptAccess();

    return staffDepts.map(s => ({
      department: s.department,
      staffCount: s._count.id,
      allowedPaths: all[s.department] ?? null, // null = no restriction (full access)
      isCustom: !DEFAULT_DEPT_ACCESS[s.department],
    }));
  }
}
