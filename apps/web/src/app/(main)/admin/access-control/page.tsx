'use client';

import { useState, useEffect, useCallback } from 'react';
import { kdate } from '@/lib/ui-settings';
import { apiClient } from '@/lib/api-client';
import { EVERY_STAFF_ROLE, USER_ROLE_LABEL } from '@hospital-run/shared';

import { EmptyState, Unit } from '@/components/ui/display';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface MenuPath {
  path: string;
  label: string;
  section: string;
}

interface DeptInfo {
  department: string;
  staffCount: number;
  allowedPaths: string[] | null;
  isCustom: boolean;
}

/**
 * 🔴 역할 목록 정본은 shared `EVERY_STAFF_ROLE`(14종)·`USER_ROLE_LABEL` 이다 (2026-08-27 회수).
 *
 *  종전 이 파일은 `SYSTEM_ROLES = ['ADMIN','DOCTOR','NURSE','PHARMACIST','LAB_TECH']` 5종을
 *  손으로 적어두고 있었다 → **NUTRITION·RECEPTIONIST·ADMIN_STAFF·MEDICAL_RECORDS·CHECKUP·
 *  CRM_MANAGER·CRM_STAFF·EXECUTIVE·READ 9역할이 이 화면에 아예 나타나지 않아** 권한을
 *  보거나 편집할 수 없었다(v3.96 에서 신설된 직군이 이 목록만 안 따라갔다).
 *
 * 🔴 `dept.*` 는 v3.96 이전 어휘지만 **지우지 않는다** — 운영 `system_configs` 가 그 키로
 *    저장돼 있고 `/patients` 가 `dept.<부서명>` 을 먼저 읽어 실제로 적용 중이다
 *    (`access.dept.원무과` 시드 잔재가 운영 관리자를 잠갔던 그 어휘다). 화면은 병기하되
 *    **무엇이 레거시인지 말한다.** 서버 응답에만 있는 `dept.*` 키도 목록에 살려 낸다
 *    (여기 적힌 5개가 전부라고 가정하면 운영에 저장된 다른 부서 설정이 화면에서 사라진다).
 */
const LEGACY_DEPT_ROLES = ['dept.원무과', 'dept.행정과', 'dept.급양과', 'dept.의무기록과', 'dept.경영진'];
const SYSTEM_ROLES: string[] = [...EVERY_STAFF_ROLE];
const roleLabel = (r: string): string =>
  r.startsWith('dept.') ? `${r.slice('dept.'.length)} (부서)` : USER_ROLE_LABEL[r] ?? r;
/**
 * 역할 이름 렌더 — 정본 역할명(`USER_ROLE_LABEL`)만 카탈로그를 태우고,
 * `dept.<부서명>` 은 **기관이 지은 고유명사**라 번역 대상이 아니다(미등록 티도 달지 않는다).
 */
const RoleName = ({ r }: { r: string }) =>
  r.startsWith('dept.') ? <>{roleLabel(r)}</> : <T k={roleLabel(r)} />;

export default function AccessControlPage() {
  const [tab, setTab] = useState<'dept' | 'role' | 'external' | 'feature'>('dept');
  const [departments, setDepartments] = useState<DeptInfo[]>([]);
  const [menuPaths, setMenuPaths] = useState<MenuPath[]>([]);
  const [selectedDept, setSelectedDept] = useState<string | null>(null);
  const [editPaths, setEditPaths] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const loadData = useCallback(async () => {
    const [deptRes, menuRes] = await Promise.all([
      apiClient.get<{ data: DeptInfo[] }>('/api/v1/access-control/departments'),
      apiClient.get<{ data: MenuPath[] }>('/api/v1/access-control/menu-paths'),
    ]);
    setDepartments(deptRes.data);
    setMenuPaths(menuRes.data);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleSelectDept = async (dept: string) => {
    setSelectedDept(dept);
    setMessage('');
    const res = await apiClient.get<{ data: string[] }>(`/api/v1/access-control/dept-access/${encodeURIComponent(dept)}`);
    setEditPaths(res.data);
  };

  const handleTogglePath = (path: string) => {
    setEditPaths(prev => prev.includes(path) ? prev.filter(p => p !== path) : [...prev, path]);
  };

  const handleSelectAll = (section: string) => {
    const sectionPaths = menuPaths.filter(m => m.section === section).map(m => m.path);
    const allSelected = sectionPaths.every(p => editPaths.includes(p));
    if (allSelected) {
      setEditPaths(prev => prev.filter(p => !sectionPaths.includes(p)));
    } else {
      setEditPaths(prev => [...new Set([...prev, ...sectionPaths])]);
    }
  };

  const handleSave = async () => {
    if (!selectedDept) return;
    setSaving(true);
    setMessage('');
    try {
      await apiClient.put(`/api/v1/access-control/dept-access/${encodeURIComponent(selectedDept)}`, { allowedPaths: editPaths });
      setMessage('저장되었습니다.');
      await loadData();
    } catch {
      setMessage('저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!selectedDept) return;
    setSaving(true);
    try {
      await apiClient.del(`/api/v1/access-control/dept-access/${encodeURIComponent(selectedDept)}`);
      setMessage('기본값으로 초기화되었습니다.');
      await loadData();
      await handleSelectDept(selectedDept);
    } catch {
      setMessage('초기화에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  // Group menu paths by section
  const sections = menuPaths.reduce<Record<string, MenuPath[]>>((acc, m) => {
    if (!acc[m.section]) acc[m.section] = [];
    acc[m.section].push(m);
    return acc;
  }, {});

  return (
    <div className="max-w-[1200px] mx-auto">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900"><T k="접근 권한 관리" /></h2>
        <p className="text-sm text-gray-500 mt-1"><T k="부서별 메뉴 접근 권한 및 역할별 데이터 접근 권한을 설정합니다" /></p>
      </div>

      {/* Tab Bar */}
      <div className="flex items-center gap-1 mb-6 bg-gray-100/80 p-1 rounded-xl w-fit">
        <button onClick={() => setTab('dept')} className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${tab === 'dept' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
          <T k="부서별 메뉴 접근" />
        </button>
        <button onClick={() => setTab('role')} className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${tab === 'role' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
          <T k="역할별 데이터 접근" />
        </button>
        <button onClick={() => setTab('external')} className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${tab === 'external' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
          <T k="외부 시스템 접근" />
        </button>
        <button onClick={() => setTab('feature')} className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${tab === 'feature' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
          <T k="기능 접근" />
        </button>
      </div>

      {/* 역할별 데이터 접근 탭 */}
      {tab === 'role' && <RoleDataAccessTab />}

      {/* 외부 시스템(ERP 등) 접근 탭 */}
      {tab === 'external' && <ExternalAccessTab />}

      {/* 기능별 접근 권한 탭 */}
      {tab === 'feature' && <FeatureAccessTab />}

      {/* 부서별 메뉴 접근 탭 */}
      {tab === 'dept' && <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Department List */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <h3 className="text-sm font-bold text-gray-900 mb-4"><T k="부서 목록" /></h3>
          <div className="space-y-1.5">
            {departments.map((d) => (
              <button
                key={d.department}
                onClick={() => handleSelectDept(d.department)}
                className={`w-full text-left px-3 py-2.5 rounded-xl transition-colors ${
                  selectedDept === d.department
                    ? 'bg-blue-50 border border-blue-200 text-blue-700'
                    : 'hover:bg-gray-50 border border-transparent'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{d.department}</p>
                    <p className="text-[10px] text-gray-400">{d.staffCount}<Unit>명</Unit></p>
                  </div>
                  <div className="flex items-center gap-2">
                    {d.allowedPaths ? (
                      <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-100">
                        {d.allowedPaths.length}개 메뉴
                      </span>
                    ) : (
                      <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-gray-50 text-gray-500 border border-gray-100">
                        <T k="전체 접근" />
                      </span>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>

          {departments.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-8"><T k="부서 데이터 로딩중..." /></p>
          )}
        </div>

        {/* Right: Menu Access Settings */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          {!selectedDept ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-center">
                <svg className="w-12 h-12 mx-auto text-gray-200 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
                </svg>
                <p className="text-sm text-gray-400"><T k="좌측에서 부서를 선택하세요" /></p>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h3 className="text-sm font-bold text-gray-900">{selectedDept} — <T k="메뉴 접근 권한" /></h3>
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    <T k="체크된 메뉴만 사이드바에 표시됩니다" /> ({editPaths.length}개 선택)
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleReset}
                    disabled={saving}
                    className="px-3 py-1.5 text-xs font-medium text-gray-500 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 disabled:opacity-50"
                  >
                    <T k="기본값 복원" />
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="px-4 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                  >
                    <T k={saving ? '저장중...' : '저장'} />
                  </button>
                </div>
              </div>

              {message && (
                <div className={`mb-4 px-3 py-2 rounded-lg text-xs font-medium ${
                  message.includes('실패') ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600'
                }`}>
                  <T k={message} />
                </div>
              )}

              <div className="space-y-4 max-h-[500px] overflow-y-auto pr-1">
                {Object.entries(sections).map(([section, paths]) => {
                  const allSelected = paths.every(p => editPaths.includes(p.path));
                  const someSelected = paths.some(p => editPaths.includes(p.path));
                  return (
                    <div key={section} className="border border-gray-100 rounded-xl p-3">
                      <div className="flex items-center justify-between mb-2">
                        <button
                          onClick={() => handleSelectAll(section)}
                          className="flex items-center gap-2 text-xs font-bold text-gray-700 hover:text-blue-600"
                        >
                          <span className={`w-4 h-4 rounded border flex items-center justify-center ${
                            allSelected ? 'bg-blue-600 border-blue-600' : someSelected ? 'bg-blue-100 border-blue-300' : 'border-gray-300'
                          }`}>
                            {(allSelected || someSelected) && (
                              <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d={allSelected ? "M5 13l4 4L19 7" : "M5 12h14"} />
                              </svg>
                            )}
                          </span>
                          {section}
                        </button>
                        <span className="text-[10px] text-gray-400">
                          {paths.filter(p => editPaths.includes(p.path)).length}/{paths.length}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-1">
                        {paths.map((m) => {
                          const checked = editPaths.includes(m.path);
                          return (
                            <label
                              key={m.path}
                              className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg cursor-pointer transition-colors ${
                                checked ? 'bg-blue-50' : 'hover:bg-gray-50'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => handleTogglePath(m.path)}
                                className="w-3.5 h-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                              />
                              <span className={`text-xs ${checked ? 'text-blue-700 font-medium' : 'text-gray-600'}`}>
                                {m.label}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>}
    </div>
  );
}

// ── 역할별 데이터 접근 권한 탭 ──
function RoleDataAccessTab() {
  const [fields, setFields] = useState<{ key: string; label: string; category: string }[]>([]);
  const [roleAccess, setRoleAccess] = useState<Record<string, Record<string, boolean>>>({});
  const [selectedRole, setSelectedRole] = useState<string>('DOCTOR');
  const [editPerms, setEditPerms] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    Promise.all([
      apiClient.get<{ data: { key: string; label: string; category: string }[] }>('/api/v1/access-control/data-access-fields'),
      apiClient.get<{ data: Record<string, Record<string, boolean>> }>('/api/v1/access-control/role-data-access'),
    ]).then(([fRes, rRes]) => {
      setFields(fRes.data);
      setRoleAccess(rRes.data);
      setEditPerms(rRes.data[selectedRole] ?? {});
    });
  }, []);

  useEffect(() => {
    setEditPerms(roleAccess[selectedRole] ?? {});
    setMessage('');
  }, [selectedRole, roleAccess]);

  const handleToggle = (key: string) => {
    setEditPerms(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await apiClient.put(`/api/v1/access-control/role-data-access/${selectedRole}`, { permissions: editPerms });
      setRoleAccess(prev => ({ ...prev, [selectedRole]: { ...editPerms } }));
      setMessage('저장되었습니다.');
    } catch { setMessage('저장 실패'); }
    setSaving(false);
  };

  const handleReset = async () => {
    setSaving(true);
    try {
      await apiClient.del(`/api/v1/access-control/role-data-access/${selectedRole}`);
      const rRes = await apiClient.get<{ data: Record<string, Record<string, boolean>> }>('/api/v1/access-control/role-data-access');
      setRoleAccess(rRes.data);
      setMessage('기본값으로 초기화되었습니다.');
    } catch { setMessage('초기화 실패'); }
    setSaving(false);
  };

  // Group fields by category
  const categories = fields.reduce<Record<string, typeof fields>>((acc, f) => {
    if (!acc[f.category]) acc[f.category] = [];
    acc[f.category].push(f);
    return acc;
  }, {});

  /**
   * 🔴 서버가 아직 안 왔을 때(`loaded=false`)와 "설정이 없다"를 구분한다.
   *    모르는 것을 "전부 차단(0/11)"으로 그리면 화면이 사실이 아닌 것을 말한다.
   */
  const loaded = fields.length > 0;
  const isConfigured = (role: string) => Object.prototype.hasOwnProperty.call(roleAccess, role);
  // 서버 응답에만 있는 dept.* 키까지 살려 낸다(여기 적힌 5개가 전부라고 가정하지 않는다)
  const deptRoles = Array.from(new Set([
    ...LEGACY_DEPT_ROLES,
    ...Object.keys(roleAccess).filter(k => k.startsWith('dept.')),
  ])).sort();
  const allRoles = [...SYSTEM_ROLES, ...deptRoles];
  const unconfigured = SYSTEM_ROLES.filter(r => !isConfigured(r));

  const tAttr = useTAttr();
  const RoleButton = ({ role, tone }: { role: string; tone: 'system' | 'dept' }) => {
    const perms = roleAccess[role] ?? {};
    const enabled = Object.values(perms).filter(Boolean).length;
    const configured = isConfigured(role);
    const activeCls = tone === 'dept'
      ? 'bg-amber-50 border border-amber-200 text-amber-700'
      : 'bg-blue-50 border border-blue-200 text-blue-700';
    return (
      <button onClick={() => setSelectedRole(role)}
        className={`w-full text-left px-3 py-2 rounded-xl transition-colors ${selectedRole === role ? activeCls : 'hover:bg-gray-50 border border-transparent'}`}>
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium"><RoleName r={role} /></p>
          {/* 🔴 "설정 없음"과 "전부 차단(0/11)"은 다른 사실이다 */}
          {!loaded ? (
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-gray-50 text-gray-400">…</span>
          ) : configured ? (
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">{enabled}/{fields.length}</span>
          ) : (
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-500" title={tAttr('이 역할에는 저장된 설정도 서버 기본값도 없습니다')}><T k="미설정" /></span>
          )}
        </div>
      </button>
    );
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
      {/* Left: Role List */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <h3 className="text-sm font-bold text-gray-900 mb-1"><T k="시스템 역할" /> <span className="text-[10px] font-normal text-gray-400">({SYSTEM_ROLES.length}종 전체)</span></h3>
        <p className="text-[10px] text-gray-400 mb-2"><T k="역할 목록 정본은 시스템 공용 정의(`EVERY_STAFF_ROLE`)입니다 — 이 화면이 따로 추리지 않습니다." /></p>
        <div className="space-y-1 mb-4">
          {SYSTEM_ROLES.map(role => <RoleButton key={role} role={role} tone="system" />)}
        </div>
        {loaded && unconfigured.length > 0 && (
          <p className="text-[10px] leading-relaxed text-slate-500 bg-slate-50 rounded-lg px-2 py-1.5 mb-4">
            🔴 <b>미설정 {unconfigured.length}역할</b>({unconfigured.map(roleLabel).join('·')})에는 서버 기본값이 없습니다.
            저장하기 전까지 환자 목록 화면은 이 역할을 <b>최소권한</b>(등록·연락처·보험 모두 차단)으로 다룹니다 —
            &ldquo;전부 허용&rdquo;이 아닙니다.
          </p>
        )}
        <h3 className="text-sm font-bold text-gray-900 mb-1 pt-3 border-t border-gray-100"><T k="부서별" /> (<T k="레거시" /> <span className="font-mono text-[10px]">dept.*</span>)</h3>
        <p className="text-[10px] leading-relaxed text-gray-400 mb-2">
          v3.96 이전 어휘입니다. 신규 설정은 위의 시스템 역할로 하세요. 다만 <b>운영 데이터가 이 키로 저장돼 있고
          환자 목록 화면이 역할보다 <span className="font-mono">dept.&lt;부서명&gt;</span>을 먼저 읽으므로</b> 지우지 않고 그대로 둡니다.
        </p>
        <div className="space-y-1">
          {deptRoles.map(role => <RoleButton key={role} role={role} tone="dept" />)}
        </div>

        {/* 권한 요약 매트릭스 — 3상태(허용 O / 차단 - / 미설정 ?) */}
        <div className="mt-6 pt-4 border-t border-gray-100">
          <p className="text-[10px] font-semibold text-gray-400 uppercase mb-2"><T k="권한 매트릭스" /></p>
          <p className="text-[9px] text-gray-400 mb-1">O <T k="허용" /> · - <T k="차단" /> · <span className="text-slate-500">? <T k="미설정" /></span>(<T k="설정이 없다는 뜻이지 차단이라는 뜻이 아닙니다" />)</p>
          <div className="overflow-x-auto">
            <table className="text-[9px]">
              <thead>
                <tr>
                  <th className="pr-1 text-left text-gray-400"><T k="항목" /></th>
                  {/* 🔴 한 글자 머리글은 관리자/간호사/검사기사/검진센터가 겹친다 — 두 글자+전체 라벨 title */}
                  {allRoles.map(r => <th key={r} title={roleLabel(r)} className="px-1 text-center text-gray-400">{roleLabel(r).slice(0, 2)}</th>)}
                </tr>
              </thead>
              <tbody>
                {fields.slice(0, 8).map(f => (
                  <tr key={f.key}>
                    <td className="pr-1 py-0.5 text-gray-500 whitespace-nowrap">{f.label.slice(0, 6)}</td>
                    {allRoles.map(r => (
                      <td key={r} className="px-1 py-0.5 text-center">
                        {!isConfigured(r)
                          ? <span className="text-slate-400" title={`${roleLabel(r)}: 설정 없음`}>?</span>
                          : (roleAccess[r] ?? {})[f.key] ? <span className="text-emerald-500">O</span> : <span className="text-gray-300">-</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Right: Permission Editor */}
      <div className="lg:col-span-3 bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="text-sm font-bold text-gray-900"><RoleName r={selectedRole} /> — <T k="데이터 접근 권한" /></h3>
            <p className="text-[11px] text-gray-400 mt-0.5">
              <T k="환자 정보 중 이 역할이 조회/접근할 수 있는 항목을 설정합니다" />
              {selectedRole.startsWith('dept.') && <span className="text-amber-600"> · 레거시 <span className="font-mono">dept.*</span> 항목입니다(부서명이 일치하는 직원에게 역할보다 우선 적용)</span>}
            </p>
            {/* 🔴 체크가 모두 비어 있는 이유를 밝힌다 — "전부 차단"이 아니라 "설정 없음"일 수 있다 */}
            {loaded && !isConfigured(selectedRole) && (
              <p className="text-[11px] text-slate-600 mt-1">
                이 역할에는 저장된 설정도 서버 기본값도 없습니다. 아래 체크는 <b>모두 해제된 초기 상태</b>이며,
                저장하기 전까지는 &ldquo;전부 차단&rdquo;이 아니라 <b>미설정</b>(환자 목록 화면은 최소권한으로 동작)입니다.
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={handleReset} disabled={saving} className="px-3 py-1.5 text-xs font-medium text-gray-500 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 disabled:opacity-50"><T k="기본값 복원" /></button>
            <button onClick={handleSave} disabled={saving} className="px-4 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"><T k={saving ? '저장중...' : '저장'} /></button>
          </div>
        </div>

        {message && (
          <div className={`mb-4 px-3 py-2 rounded-lg text-xs font-medium ${message.includes('실패') ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600'}`}><T k={message} /></div>
        )}

        <div className="space-y-4">
          {Object.entries(categories).map(([category, catFields]) => (
            <div key={category} className="border border-gray-100 rounded-xl p-4">
              <p className="text-xs font-bold text-gray-700 mb-3">{category}</p>
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
                {catFields.map(f => {
                  const checked = editPerms[f.key] ?? false;
                  return (
                    <label key={f.key} className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${checked ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
                      <input type="checkbox" checked={checked} onChange={() => handleToggle(f.key)}
                        className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                      <span className={`text-sm ${checked ? 'text-blue-700 font-medium' : 'text-gray-600'}`}>{f.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── 외부 시스템(ERP 등) 접근 권한 탭 — 역할 기준 ∪ 개별 사용자, erp.allowedRoles/allowedUserIds 단일 진실원천 ──
// ErpLauncher(사이드바 하단)·erp-sso 서버 게이트가 같은 config를 읽으므로 자동 동기화.
// HIS는 ERP "접근(SSO)"만 부여 — ERP 내부 역할은 ERP(/erp/admin/users)에서 별도 관리.
interface ErpStaffUser { id: string; familyName: string; givenName: string; email: string; role: string; department?: string }
interface ErpSyncMeta { mode?: string; total?: number; matched?: number; unmatched?: string[]; deactivated?: string[]; allowedUserIds?: number; at?: string }

function ExternalAccessTab() {
  const tAttr = useTAttr();
  const [enabled, setEnabled] = useState<boolean>(true);
  const [roles, setRoles] = useState<string[]>(['ADMIN']);
  const [userIds, setUserIds] = useState<string[]>([]);
  const [users, setUsers] = useState<ErpStaffUser[]>([]);
  const [syncMeta, setSyncMeta] = useState<ErpSyncMeta | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  /**
   * 🔴 설정 조회 실패를 초기값으로 덮지 않는다(2026-09-02).
   *    종전엔 `.catch(() => { 기본값 유지 })` 라 실패 시 화면이 `roles=['ADMIN'] · userIds=[]` 를
   *    **현재 정책인 것처럼** 그렸고, 그 상태에서 [저장]을 누르면 실제 ERP 허용목록이 그 값으로 **덮였다**.
   *    읽지 못한 것을 쓰지 않는다 — 실패하면 편집 폼을 열지 않는다.
   */
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    Promise.all([
      apiClient.get<{ data: { key: string; value: unknown }[] }>('/api/v1/config?category=integration'),
      apiClient.get<{ data: ErpStaffUser[] }>('/api/v1/users').catch(() => ({ data: [] as ErpStaffUser[] })),
    ])
      .then(([cfgRes, usersRes]) => {
        const m = new Map((cfgRes.data ?? []).map((c) => [c.key, c.value]));
        setEnabled(m.get('erp.enabled') !== false);
        setRoles(Array.isArray(m.get('erp.allowedRoles')) ? (m.get('erp.allowedRoles') as string[]) : ['ADMIN']);
        setUserIds(Array.isArray(m.get('erp.allowedUserIds')) ? (m.get('erp.allowedUserIds') as string[]) : []);
        setSyncMeta((m.get('erp.accessSyncMeta') as ErpSyncMeta) ?? null);
        setUsers(usersRes.data ?? []);
      })
      .catch(() => setLoadFailed(true))
      .finally(() => setLoading(false));
  }, []);

  const toggleRole = (r: string) => setRoles((p) => (p.includes(r) ? p.filter((x) => x !== r) : [...p, r]));
  const addUser = (id: string) => { setUserIds((p) => (p.includes(id) ? p : [...p, id])); setQuery(''); };
  const removeUser = (id: string) => setUserIds((p) => p.filter((x) => x !== id));

  const userById = (id: string) => users.find((u) => u.id === id);
  const fullName = (u: ErpStaffUser) => `${u.familyName ?? ''}${u.givenName ?? ''}`;
  const q = query.trim().toLowerCase();
  const matches = q
    ? users.filter((u) => !userIds.includes(u.id) && (
        u.email?.toLowerCase().includes(q) || fullName(u).toLowerCase().includes(q) || (u.department ?? '').toLowerCase().includes(q)
      )).slice(0, 8)
    : [];

  const handleSave = async () => {
    setSaving(true);
    setMessage('');
    try {
      await Promise.all([
        apiClient.put('/api/v1/config/erp.allowedRoles', { value: roles }),
        apiClient.put('/api/v1/config/erp.allowedUserIds', { value: userIds }),
      ]);
      setMessage('저장되었습니다.');
    } catch {
      setMessage('저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 text-sm text-gray-400"><T k="불러오는 중..." /></div>;
  if (loadFailed) {
    return (
      <div className="bg-white rounded-2xl border border-red-200 shadow-sm p-8">
        <p className="text-sm font-bold text-red-700"><T k="현재 접근 정책을 불러오지 못했습니다" /></p>
        <p className="mt-1 text-xs text-gray-600">
          <T k="지금 보이는 값이 현재 정책이라고 말할 수 없어 편집 폼을 열지 않습니다. 이 상태로 저장하면 실제 허용 목록이 덮일 수 있습니다." />
        </p>
        <button onClick={() => location.reload()} className="mt-4 min-h-[44px] px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700">
          <T k="다시 불러오기" />
        </button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Left: 외부 시스템 목록 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <h3 className="text-sm font-bold text-gray-900 mb-3"><T k="외부 시스템" /></h3>
        <div className="px-3 py-2.5 rounded-xl bg-blue-50 border border-blue-200">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-blue-700">🏢 ERP</span>
            <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${enabled ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 'bg-gray-100 text-gray-500 border border-gray-200'}`}><T k={enabled ? '활성' : '비활성'} /></span>
          </div>
          <p className="text-[10px] text-blue-400 mt-0.5"><T k="사이드바 ERP 바로가기(SSO 자동 로그인)" /></p>
        </div>
        <p className="text-[11px] text-gray-400 mt-3 leading-relaxed">
          URL·SSO 경로·핸드오프·웹훅 등 <b className="text-gray-500">기술 설정</b>은 <a href="/admin/erp" className="text-blue-600 underline">ERP 접근 설정</a>에서 관리합니다. 이 탭에서는 <b className="text-gray-500">접근(SSO) 허용 대상</b>만 설정합니다.
        </p>
        <p className="text-[11px] text-gray-400 mt-2 leading-relaxed pt-2 border-t border-gray-100">
          ⓘ HIS는 ERP <b className="text-gray-500">접근(SSO)</b>만 부여합니다. ERP <b className="text-gray-500">내부 역할</b>(관리자·원장·부서장 등)은 ERP <span className="font-mono">/erp/admin/users</span>에서 별도 관리합니다.
        </p>
      </div>

      {/* Right: 역할 + 개별 사용자 편집 */}
      <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="text-sm font-bold text-gray-900"><T k="ERP — 접근(SSO) 허용 대상" /></h3>
            <p className="text-[11px] text-gray-400 mt-0.5">허용 역할 <b>또는</b> 개별 허용 사용자에 해당하면 ERP 바로가기 노출·SSO 진입이 허용됩니다.</p>
          </div>
          <button onClick={handleSave} disabled={saving} className="px-4 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"><T k={saving ? '저장중...' : '저장'} /></button>
        </div>

        {message && (
          <div className={`mb-4 px-3 py-2 rounded-lg text-xs font-medium ${message.includes('실패') ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600'}`}><T k={message} /></div>
        )}
        {!enabled && (
          <div className="mb-4 px-3 py-2 rounded-lg text-xs bg-amber-50 text-amber-700">ERP 바로가기가 현재 <b>비활성</b> 상태입니다. 대상을 지정해도 <a href="/admin/erp" className="underline">ERP 접근 설정</a>에서 활성화하기 전까지 노출되지 않습니다.</div>
        )}

        {/* 허용 역할 — 🔴 정본 14역할 전체(종전 5역할만 보여 9역할은 지정 자체가 불가능했다).
            저장된 값 중 정본에 없는 것도 그대로 렌더한다(보이지 않으면 끌 수도 없다). */}
        <div className="border border-gray-100 rounded-xl p-4 mb-4">
          <p className="text-xs font-bold text-gray-700 mb-3"><T k="허용 역할" /> <span className="text-gray-400 font-normal">({roles.length}<Unit>개</Unit>)</span></p>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
            {Array.from(new Set([...SYSTEM_ROLES, ...roles])).map((r) => {
              const checked = roles.includes(r);
              const known = SYSTEM_ROLES.includes(r);
              return (
                <label key={r} className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${checked ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
                  <input type="checkbox" checked={checked} onChange={() => toggleRole(r)} className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                  <span className={`text-sm ${checked ? 'text-blue-700 font-medium' : 'text-gray-600'}`}><RoleName r={r} /></span>
                  {!known && <span className="text-[9px] text-amber-600" title={tAttr('현재 역할 정본에 없는 저장값입니다')}><T k="정본 밖" /></span>}
                </label>
              );
            })}
          </div>
        </div>

        {/* 개별 허용 사용자 */}
        <div className="border border-gray-100 rounded-xl p-4">
          <p className="text-xs font-bold text-gray-700 mb-1"><T k="개별 허용 사용자" /> <span className="text-gray-400 font-normal">({userIds.length}<Unit>명</Unit>)</span></p>
          <p className="text-[11px] text-gray-400 mb-3">역할과 무관하게 특정 직원에게 ERP 접근을 부여합니다. ERP가 명단을 일괄 동기화하거나, ERP 사용자 명단(<span className="font-mono">/erp/admin/users</span>)의 이메일과 대조해 직접 선택하세요.</p>

          {/* ERP 명단 동기화 상태 */}
          {syncMeta?.at && (
            <div className="mb-3 rounded-lg bg-slate-50 border border-slate-100 px-3 py-2.5 text-[11px] text-gray-500">
              <div className="flex items-center justify-between flex-wrap gap-1">
                <span className="font-semibold text-gray-600">🔄 <T k="ERP 명단 최근 동기화" /></span>
                <span className="text-gray-400">{kdate(syncMeta.at, 'datetimeShort')} · <T k={syncMeta.mode === 'merge' ? '병합' : '전체대체'} /></span>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                <span><T k="명단" /> {syncMeta.total ?? 0}<Unit>건</Unit></span>
                <span className="text-emerald-600"><T k="매칭(부여)" /> {syncMeta.matched ?? 0}</span>
                {!!syncMeta.unmatched?.length && <span className="text-amber-600"><T k="미매칭" /> {syncMeta.unmatched.length}</span>}
                {!!syncMeta.deactivated?.length && <span className="text-gray-400"><T k="회수" /> {syncMeta.deactivated.length}</span>}
              </div>
              {!!syncMeta.unmatched?.length && (
                <p className="mt-1 text-[10px] text-amber-600 break-all"><T k="미매칭(HIS 직원 없음)" />: {syncMeta.unmatched.slice(0, 8).join(', ')}{syncMeta.unmatched.length > 8 ? ` 외 ${syncMeta.unmatched.length - 8}` : ''}</p>
              )}
            </div>
          )}

          {/* 검색 */}
          <div className="relative mb-3">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={tAttr('이름·이메일·부서로 검색하여 추가')}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-100 outline-none"
            />
            {matches.length > 0 && (
              <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                {matches.map((u) => (
                  <button key={u.id} onClick={() => addUser(u.id)}
                    className="w-full text-left px-3 py-2 hover:bg-blue-50 flex items-center justify-between gap-2">
                    <span className="text-sm text-gray-700">{fullName(u)} <span className="text-gray-400 text-xs"><RoleName r={u.role} />{u.department ? ` · ${u.department}` : ''}</span></span>
                    <span className="text-[11px] text-gray-400 font-mono">{u.email}</span>
                  </button>
                ))}
              </div>
            )}
            {q && matches.length === 0 && <p className="absolute z-10 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg px-3 py-2 text-xs text-gray-400"><T k="일치하는 사용자가 없습니다." /></p>}
          </div>

          {/* 선택된 사용자 칩 */}
          {userIds.length === 0 ? (
            <EmptyState icon="👤" title="개별 허용 사용자가 없습니다." hint="(역할 기준만 적용)" className="border border-dashed border-gray-200 rounded-lg" />
          ) : (
            <ul className="space-y-1.5">
              {userIds.map((id) => {
                const u = userById(id);
                return (
                  <li key={id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-gray-50">
                    <div className="min-w-0">
                      <span className="text-sm text-gray-700">{u ? fullName(u) : <T k="(알 수 없는 사용자)" />}</span>
                      {u && <span className="text-[11px] text-gray-400 ml-2 font-mono">{u.email}</span>}
                      {u && <span className="text-[10px] text-gray-400 ml-1">· <RoleName r={u.role} />{u.department ? ` · ${u.department}` : ''}</span>}
                    </div>
                    <button onClick={() => removeUser(id)} className="text-xs text-red-500 hover:underline flex-shrink-0"><T k="제거" /></button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

// ── 기능별 접근 권한 탭 — 자체가드 기능(상담·보안·경영)의 진입 권한 중앙 관리 ──
// 백엔드 FeatureAccessService.can() 과 동일한 featureKey 사용. 오버라이드 미설정 시 defaultRoles 기준선(현행 동작 유지).
interface FeatureDef { key: string; label: string; group: string; defaultRoles: string[]; description?: string }
interface FeatureCfg { roles?: Record<string, boolean>; grants?: string[]; denies?: string[] }

/**
 * 🔴 기능 접근 매트릭스의 역할 축도 정본 하나를 쓴다(2026-08-27).
 *    종전 9종 하드코딩이라 NUTRITION·RECEPTIONIST·ADMIN_STAFF·MEDICAL_RECORDS·CHECKUP
 *    5역할은 기능 허용/차단을 **지정할 수도, 현재 상태를 볼 수도 없었다**.
 *    (기본값에 없던 역할이 차단인 것은 종전과 같다 — 보이게 만들었을 뿐 판정은 그대로다.)
 */
const FEATURE_ROLES: string[] = [...EVERY_STAFF_ROLE];
const GROUP_LABEL: Record<string, string> = { 상담: '상담', 보안: '보안', 경영: '경영' };

function FeatureAccessTab() {
  const [features, setFeatures] = useState<FeatureDef[]>([]);
  const [configs, setConfigs] = useState<Record<string, FeatureCfg>>({});
  const [users, setUsers] = useState<ErpStaffUser[]>([]);
  const [selKey, setSelKey] = useState<string>('');
  const [editRoles, setEditRoles] = useState<Record<string, boolean>>({});
  const [grants, setGrants] = useState<string[]>([]);
  const [denies, setDenies] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [target, setTarget] = useState<'grant' | 'deny'>('grant');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    Promise.all([
      apiClient.get<{ data: { features: FeatureDef[]; configs: Record<string, FeatureCfg> } }>('/api/v1/access-control/feature-access'),
      apiClient.get<{ data: ErpStaffUser[] }>('/api/v1/users').catch(() => ({ data: [] as ErpStaffUser[] })),
    ]).then(([mRes, uRes]) => {
      setFeatures(mRes.data.features ?? []);
      setConfigs(mRes.data.configs ?? {});
      setUsers(uRes.data ?? []);
      setSelKey((prev) => prev || (mRes.data.features?.[0]?.key ?? ''));
    }).catch(() => { /* 기본값 유지 */ }).finally(() => setLoading(false));
  }, []);

  const selFeature = features.find((f) => f.key === selKey);

  // 선택 변경 시 메시지 초기화
  useEffect(() => { setMessage(''); }, [selKey]);

  // 선택/설정 변경 시 편집 상태 구체화 (defaultRoles 기준선 → 명시 매트릭스로 머티리얼라이즈)
  useEffect(() => {
    if (!selFeature) return;
    const cfg = configs[selKey] ?? {};
    const hasExplicit = !!(cfg.roles && Object.keys(cfg.roles).length);
    const rolesMap: Record<string, boolean> = {};
    for (const r of FEATURE_ROLES) rolesMap[r] = hasExplicit ? cfg.roles![r] === true : selFeature.defaultRoles.includes(r);
    rolesMap.ADMIN = true; // 관리자 항상 허용(자기잠금 방지)
    setEditRoles(rolesMap);
    setGrants(cfg.grants ?? []);
    setDenies(cfg.denies ?? []);
  }, [selKey, configs, selFeature]);

  const isOverridden = (k: string) => {
    const c = configs[k];
    return !!(c && ((c.roles && Object.keys(c.roles).length) || c.grants?.length || c.denies?.length));
  };
  // 매트릭스 요약용: 역할 규칙상 허용 역할 집합 (per-user 무시)
  const effectiveRoles = (f: FeatureDef): Set<string> => {
    const c = configs[f.key];
    if (c?.roles && Object.keys(c.roles).length) return new Set(FEATURE_ROLES.filter((r) => c.roles![r] === true).concat('ADMIN'));
    return new Set([...f.defaultRoles, 'ADMIN']);
  };

  const toggleRole = (r: string) => { if (r === 'ADMIN') return; setEditRoles((p) => ({ ...p, [r]: !p[r] })); };

  const userById = (id: string) => users.find((u) => u.id === id);
  const fullName = (u: ErpStaffUser) => `${u.familyName ?? ''}${u.givenName ?? ''}`;
  const q = query.trim().toLowerCase();
  const matches = q
    ? users.filter((u) => !grants.includes(u.id) && !denies.includes(u.id) && (
        u.email?.toLowerCase().includes(q) || fullName(u).toLowerCase().includes(q) || (u.department ?? '').toLowerCase().includes(q)
      )).slice(0, 8)
    : [];
  const addUser = (id: string) => {
    if (target === 'grant') { setGrants((p) => (p.includes(id) ? p : [...p, id])); setDenies((p) => p.filter((x) => x !== id)); }
    else { setDenies((p) => (p.includes(id) ? p : [...p, id])); setGrants((p) => p.filter((x) => x !== id)); }
    setQuery('');
  };

  const handleSave = async () => {
    if (!selKey) return;
    setSaving(true); setMessage('');
    try {
      await apiClient.put(`/api/v1/access-control/feature-access/${encodeURIComponent(selKey)}`, { roles: editRoles, grants, denies });
      setConfigs((prev) => ({ ...prev, [selKey]: { roles: { ...editRoles }, grants: [...grants], denies: [...denies] } }));
      setMessage('저장되었습니다.');
    } catch { setMessage('저장에 실패했습니다.'); }
    finally { setSaving(false); }
  };
  const handleReset = async () => {
    if (!selKey) return;
    setSaving(true); setMessage('');
    try {
      await apiClient.del(`/api/v1/access-control/feature-access/${encodeURIComponent(selKey)}`);
      setConfigs((prev) => { const n = { ...prev }; delete n[selKey]; return n; }); // → 편집 상태 effect가 defaultRoles로 복원
      setMessage('기본값으로 초기화되었습니다.');
    } catch { setMessage('초기화에 실패했습니다.'); }
    finally { setSaving(false); }
  };

  if (loading) return <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 text-sm text-gray-400"><T k="불러오는 중..." /></div>;

  // 그룹별 기능 목록
  const grouped = features.reduce<Record<string, FeatureDef[]>>((acc, f) => { (acc[f.group] ??= []).push(f); return acc; }, {});

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Left: 기능 목록 + 요약 매트릭스 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <h3 className="text-sm font-bold text-gray-900 mb-3"><T k="기능 목록" /></h3>
        <div className="space-y-3">
          {Object.entries(grouped).map(([group, fs]) => (
            <div key={group}>
              <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1"><T k={GROUP_LABEL[group] ?? group} /></p>
              <div className="space-y-1">
                {fs.map((f) => (
                  <button key={f.key} onClick={() => setSelKey(f.key)}
                    className={`w-full text-left px-3 py-2 rounded-xl transition-colors ${selKey === f.key ? 'bg-blue-50 border border-blue-200 text-blue-700' : 'hover:bg-gray-50 border border-transparent'}`}>
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium">{f.label}</p>
                      {isOverridden(f.key)
                        ? <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 border border-amber-100"><T k="사용자지정" /></span>
                        : <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-gray-50 text-gray-400 border border-gray-100"><T k="기본" /></span>}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* 요약 매트릭스 (기능 × 역할) */}
        <div className="mt-6 pt-4 border-t border-gray-100">
          <p className="text-[10px] font-semibold text-gray-400 uppercase mb-2"><T k="접근 매트릭스 (역할)" /></p>
          <div className="overflow-x-auto">
            <table className="text-[9px]">
              <thead>
                <tr>
                  <th className="pr-1 text-left text-gray-400"><T k="기능" /></th>
                  {FEATURE_ROLES.map((r) => <th key={r} className="px-1 text-center text-gray-400">{roleLabel(r).slice(0, 2)}</th>)}
                </tr>
              </thead>
              <tbody>
                {features.map((f) => {
                  const eff = effectiveRoles(f);
                  return (
                    <tr key={f.key}>
                      <td className="pr-1 py-0.5 text-gray-500 whitespace-nowrap">{f.label.slice(0, 7)}</td>
                      {FEATURE_ROLES.map((r) => (
                        <td key={r} className="px-1 py-0.5 text-center">
                          {eff.has(r) ? <span className="text-emerald-500">O</span> : <span className="text-gray-300">-</span>}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Right: 선택 기능 권한 편집 */}
      <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        {!selFeature ? (
          <div className="flex items-center justify-center h-64 text-sm text-gray-400"><T k="좌측에서 기능을 선택하세요" /></div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="text-sm font-bold text-gray-900">{selFeature.label} — <T k="접근 권한" /></h3>
                <p className="text-[11px] text-gray-400 mt-0.5">{selFeature.description ?? <T k="이 기능에 진입할 수 있는 역할/사용자를 설정합니다." />}</p>
              </div>
              <div className="flex gap-2">
                <button onClick={handleReset} disabled={saving} className="px-3 py-1.5 text-xs font-medium text-gray-500 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 disabled:opacity-50"><T k="기본값 복원" /></button>
                <button onClick={handleSave} disabled={saving} className="px-4 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"><T k={saving ? '저장중...' : '저장'} /></button>
              </div>
            </div>

            {message && (
              <div className={`mb-4 px-3 py-2 rounded-lg text-xs font-medium ${message.includes('실패') ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600'}`}><T k={message} /></div>
            )}

            {/* 허용 역할 */}
            <div className="border border-gray-100 rounded-xl p-4 mb-4">
              <p className="text-xs font-bold text-gray-700 mb-1"><T k="허용 역할" /></p>
              <p className="text-[11px] text-gray-400 mb-3"><T k="기본값" />: <span className="font-medium text-gray-500">{selFeature.defaultRoles.map((r) => roleLabel(r)).join(', ')}</span>. <T k="관리자는 항상 허용됩니다." /></p>
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
                {FEATURE_ROLES.map((r) => {
                  const checked = editRoles[r] ?? false;
                  const locked = r === 'ADMIN';
                  return (
                    <label key={r} className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg transition-colors ${locked ? 'opacity-70 cursor-not-allowed bg-gray-50' : checked ? 'bg-blue-50 cursor-pointer' : 'hover:bg-gray-50 cursor-pointer'}`}>
                      <input type="checkbox" checked={checked} disabled={locked} onChange={() => toggleRole(r)} className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                      <span className={`text-sm ${checked ? 'text-blue-700 font-medium' : 'text-gray-600'}`}><RoleName r={r} />{locked && <span className="text-[9px] text-gray-400 ml-1"><T k="고정" /></span>}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* 사용자 개별 grant/deny */}
            <div className="border border-gray-100 rounded-xl p-4">
              <p className="text-xs font-bold text-gray-700 mb-1"><T k="사용자 개별 권한" /></p>
              <p className="text-[11px] text-gray-400 mb-3">역할과 무관하게 특정 직원을 <b className="text-emerald-600">허용</b>하거나 <b className="text-red-500">차단</b>합니다. 차단이 최우선입니다.</p>

              <div className="flex items-center gap-2 mb-2">
                <div className="flex items-center gap-1 bg-gray-100 p-0.5 rounded-lg">
                  <button onClick={() => setTarget('grant')} className={`px-2.5 py-1 text-[11px] font-medium rounded-md ${target === 'grant' ? 'bg-white text-emerald-600 shadow-sm' : 'text-gray-500'}`}><T k="허용 추가" /></button>
                  <button onClick={() => setTarget('deny')} className={`px-2.5 py-1 text-[11px] font-medium rounded-md ${target === 'deny' ? 'bg-white text-red-500 shadow-sm' : 'text-gray-500'}`}><T k="차단 추가" /></button>
                </div>
                <div className="relative flex-1">
                  <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`이름·이메일·부서로 검색하여 ${target === 'grant' ? '허용' : '차단'} 추가`}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-100 outline-none" />
                  {matches.length > 0 && (
                    <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                      {matches.map((u) => (
                        <button key={u.id} onClick={() => addUser(u.id)} className="w-full text-left px-3 py-2 hover:bg-blue-50 flex items-center justify-between gap-2">
                          <span className="text-sm text-gray-700">{fullName(u)} <span className="text-gray-400 text-xs"><RoleName r={u.role} />{u.department ? ` · ${u.department}` : ''}</span></span>
                          <span className="text-[11px] text-gray-400 font-mono">{u.email}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {q && matches.length === 0 && <p className="absolute z-10 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg px-3 py-2 text-xs text-gray-400"><T k="일치하는 사용자가 없습니다." /></p>}
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-3">
                {/* 허용 목록 */}
                <div>
                  <p className="text-[11px] font-semibold text-emerald-600 mb-1.5"><T k="허용" /> ({grants.length})</p>
                  {grants.length === 0 ? <p className="text-xs text-gray-400 py-2 text-center border border-dashed border-gray-200 rounded-lg"><T k="없음" /></p> : (
                    <ul className="space-y-1">
                      {grants.map((id) => { const u = userById(id); return (
                        <li key={id} className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg bg-emerald-50/60">
                          <span className="text-sm text-gray-700 truncate">{u ? fullName(u) : <T k="(알 수 없음)" />} {u && <span className="text-[10px] text-gray-400 font-mono">{u.email}</span>}</span>
                          <button onClick={() => setGrants((p) => p.filter((x) => x !== id))} className="text-xs text-red-500 hover:underline flex-shrink-0"><T k="제거" /></button>
                        </li>
                      ); })}
                    </ul>
                  )}
                </div>
                {/* 차단 목록 */}
                <div>
                  <p className="text-[11px] font-semibold text-red-500 mb-1.5"><T k="차단" /> ({denies.length})</p>
                  {denies.length === 0 ? <p className="text-xs text-gray-400 py-2 text-center border border-dashed border-gray-200 rounded-lg"><T k="없음" /></p> : (
                    <ul className="space-y-1">
                      {denies.map((id) => { const u = userById(id); return (
                        <li key={id} className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg bg-red-50/60">
                          <span className="text-sm text-gray-700 truncate">{u ? fullName(u) : <T k="(알 수 없음)" />} {u && <span className="text-[10px] text-gray-400 font-mono">{u.email}</span>}</span>
                          <button onClick={() => setDenies((p) => p.filter((x) => x !== id))} className="text-xs text-red-500 hover:underline flex-shrink-0"><T k="제거" /></button>
                        </li>
                      ); })}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
