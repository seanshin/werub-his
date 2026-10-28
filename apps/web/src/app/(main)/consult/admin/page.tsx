'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { AI_ORIGIN_TEXT } from '@hospital-run/shared';
import { T, Tf, useTAttr, useTfAttr } from '@/components/ui/i18n-text';

interface Team { id: string; name: string; description?: string | null; categories: string[]; locales: string[]; defaultAiMode: string; isDefault: boolean; active: boolean; memberCount: number }
interface Member { userId: string; name: string; role: string; status: string; maxConcurrent: number; activeCount: number }
interface StaffUser { id: string; familyName: string; givenName: string; role: string; department?: string }

const CATS = [['GENERAL', '일반'], ['INTERNATIONAL', '국제'], ['CHECKUP', '검진'], ['BILLING', '수납']] as const;
const ROLES = [['AGENT', '상담원'], ['LEAD', '팀장'], ['ADMIN', '관리자']] as const;
const ST: Record<string, string> = { ONLINE: '🟢', AWAY: '🟡', BUSY: '🔴', OFFLINE: '⚪' };

export default function ConsultAdminPage() {
  const tAttr = useTAttr();
  const tfAttr = useTfAttr();
  const [teams, setTeams] = useState<Team[]>([]);
  const [selId, setSelId] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [users, setUsers] = useState<StaffUser[]>([]);
  // 새 팀 폼
  const [name, setName] = useState('');
  const [cats, setCats] = useState<string[]>(['GENERAL']);
  const [aiMode, setAiMode] = useState('AUTO');
  // 멤버 추가 폼
  const [newUserId, setNewUserId] = useState('');
  const [newRole, setNewRole] = useState('AGENT');

  const loadTeams = () => apiClient.get<{ data: Team[] }>(`/api/v1/consult/teams`).then((r) => setTeams(r.data ?? [])).catch(() => toast.error(tAttr('팀 목록 조회 실패')));
  const loadMembers = (id: string) => apiClient.get<{ data: Member[] }>(`/api/v1/consult/teams/${id}/members`).then((r) => setMembers(r.data ?? [])).catch(() => {});

  useEffect(() => { loadTeams(); apiClient.get<{ data: StaffUser[] }>(`/api/v1/users`).then((r) => setUsers(r.data ?? [])).catch(() => {}); }, []);
  useEffect(() => { if (selId) loadMembers(selId); }, [selId]);

  const createTeam = async () => {
    if (!name.trim()) { toast.error(tAttr('팀명을 입력하세요')); return; }
    try { await apiClient.post(`/api/v1/consult/teams`, { name, categories: cats, defaultAiMode: aiMode }); setName(''); setCats(['GENERAL']); setAiMode('AUTO'); loadTeams(); toast.success(tAttr('팀 생성')); }
    catch { toast.error(tAttr('팀 생성 실패')); }
  };
  const patchTeam = async (id: string, body: Record<string, unknown>) => {
    try { await apiClient.patch(`/api/v1/consult/teams/${id}`, body); loadTeams(); }
    catch (e) { toast.error((e as { message?: string })?.message ?? tAttr('수정 실패')); }
  };
  const addMember = async () => {
    if (!selId || !newUserId) { toast.error(tAttr('직원을 선택하세요')); return; }
    try { await apiClient.post(`/api/v1/consult/teams/${selId}/members`, { userId: newUserId, role: newRole }); setNewUserId(''); loadMembers(selId); loadTeams(); toast.success(tAttr('멤버 배정')); }
    catch { toast.error(tAttr('멤버 배정 실패')); }
  };
  const removeMember = async (userId: string) => {
    if (!selId) return;
    try { await apiClient.del(`/api/v1/consult/teams/${selId}/members/${userId}`); loadMembers(selId); loadTeams(); }
    catch { toast.error(tAttr('해제 실패')); }
  };

  const sel = teams.find((t) => t.id === selId);
  const toggleCat = (c: string) => setCats((cs) => cs.includes(c) ? cs.filter((x) => x !== c) : [...cs, c]);

  return (
    <div className="w-full p-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900"><T k="상담 팀 관리" /></h1>
          <p className="text-sm text-gray-500"><Tf k="팀 구성·담당 카테고리·기본 {AI표기}모드·멤버 배정" params={{ AI표기: AI_ORIGIN_TEXT }} /></p>
        </div>
        <Link href="/consult" className="text-xs text-gray-600 border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50">← <T k="데스크" /></Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* 팀 목록 + 생성 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <h2 className="text-sm font-bold text-gray-800 mb-2"><T k="팀 목록" /></h2>
          <div className="space-y-1.5 mb-4">
            {teams.map((t) => (
              <button key={t.id} onClick={() => setSelId(t.id)} className={`w-full text-left px-3 py-2 rounded-xl border ${selId === t.id ? 'border-blue-300 bg-blue-50' : 'border-gray-100 hover:bg-gray-50'} ${!t.active ? 'opacity-50' : ''}`}>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-gray-800">{t.name} {t.isDefault && <span className="text-[9px] bg-gray-200 text-gray-600 rounded px-1 ml-1"><T k="기본" /></span>}</span>
                  <span className="text-[10px] text-gray-400"><Tf k="멤버 {수} · AI {모드}" params={{ 수: t.memberCount, 모드: t.defaultAiMode }} /></span>
                </div>
                <div className="text-[10px] text-gray-500 mt-0.5">{t.categories.map((c) => tAttr(CATS.find(([v]) => v === c)?.[1] ?? c)).join(', ') || <T k="미지정" />}</div>
              </button>
            ))}
            {teams.length === 0 && <p className="text-xs text-gray-400 text-center py-4"><T k="팀 없음" /></p>}
          </div>
          <div className="border-t pt-3">
            <h3 className="text-xs font-bold text-gray-600 mb-2"><T k="새 팀 생성" /></h3>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={tAttr('팀명')} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg mb-2" />
            <div className="flex flex-wrap gap-1 mb-2">
              {CATS.map(([v, l]) => (
                <button key={v} onClick={() => toggleCat(v)} className={`text-[11px] px-2 py-1 rounded-lg border ${cats.includes(v) ? 'bg-blue-600 text-white border-blue-600' : 'bg-gray-50 text-gray-600 border-gray-200'}`}><T k={l} /></button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <select value={aiMode} onChange={(e) => setAiMode(e.target.value)} className="text-xs border border-gray-200 rounded-lg px-2 py-1.5">
                <option value="AUTO">{tfAttr('{AI표기} 자동(AUTO)', { AI표기: AI_ORIGIN_TEXT })}</option>
                <option value="OFF">{tfAttr('{AI표기} 끔(OFF)', { AI표기: AI_ORIGIN_TEXT })}</option>
              </select>
              <button onClick={createTeam} className="flex-1 text-sm bg-blue-600 text-white rounded-lg py-1.5 hover:bg-blue-700"><T k="생성" /></button>
            </div>
          </div>
        </div>

        {/* 팀 상세 + 멤버 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          {!sel ? (
            <div className="text-sm text-gray-400 text-center py-12"><T k="팀을 선택하세요" /></div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-bold text-gray-800">{sel.name}</h2>
                <div className="flex items-center gap-1.5">
                  <select value={sel.defaultAiMode} onChange={(e) => patchTeam(sel.id, { defaultAiMode: e.target.value })} className="text-[11px] border border-gray-200 rounded-lg px-2 py-1">
                    <option value="AUTO">{AI_ORIGIN_TEXT} AUTO</option><option value="OFF">{AI_ORIGIN_TEXT} OFF</option>
                  </select>
                  {!sel.isDefault && <button onClick={() => patchTeam(sel.id, { isDefault: true })} className="text-[11px] text-gray-600 border border-gray-200 rounded-lg px-2 py-1 hover:bg-gray-50"><T k="기본팀 지정" /></button>}
                  {!sel.isDefault && sel.active && <button onClick={() => { if (confirm(tAttr('팀을 비활성화할까요?'))) patchTeam(sel.id, { active: false }); }} className="text-[11px] text-red-500 border border-red-100 rounded-lg px-2 py-1 hover:bg-red-50"><T k="비활성" /></button>}
                </div>
              </div>
              <div className="flex flex-wrap gap-1 mb-3">
                {CATS.map(([v, l]) => {
                  const on = sel.categories.includes(v);
                  return <button key={v} onClick={() => patchTeam(sel.id, { categories: on ? sel.categories.filter((c) => c !== v) : [...sel.categories, v] })} className={`text-[11px] px-2 py-1 rounded-lg border ${on ? 'bg-blue-600 text-white border-blue-600' : 'bg-gray-50 text-gray-500 border-gray-200'}`}><T k={l} /></button>;
                })}
              </div>

              <h3 className="text-xs font-bold text-gray-600 mb-2"><Tf k="멤버 ({수})" params={{ 수: members.length }} /></h3>
              <div className="space-y-1 mb-3 max-h-60 overflow-y-auto">
                {members.map((m) => (
                  <div key={m.userId} className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-gray-50">
                    <span className="text-sm text-gray-700">{ST[m.status] ?? '⚪'} {m.name} <span className="text-[10px] text-gray-400"><T k={ROLES.find(([v]) => v === m.role)?.[1] ?? ''} /> · {m.activeCount}/{m.maxConcurrent}</span></span>
                    <button onClick={() => removeMember(m.userId)} className="text-[11px] text-red-400 hover:text-red-600"><T k="해제@지정" /></button>
                  </div>
                ))}
                {members.length === 0 && <p className="text-xs text-gray-400 py-2"><T k="멤버 없음" /></p>}
              </div>
              <div className="flex items-center gap-1.5 border-t pt-3">
                <select value={newUserId} onChange={(e) => setNewUserId(e.target.value)} className="flex-1 text-xs border border-gray-200 rounded-lg px-2 py-1.5">
                  <option value="">{tAttr('직원 선택…')}</option>
                  {users.filter((u) => !members.some((m) => m.userId === u.id)).map((u) => <option key={u.id} value={u.id}>{u.familyName}{u.givenName} ({u.role})</option>)}
                </select>
                <select value={newRole} onChange={(e) => setNewRole(e.target.value)} className="text-xs border border-gray-200 rounded-lg px-2 py-1.5">
                  {ROLES.map(([v, l]) => <option key={v} value={v}>{tAttr(l)}</option>)}
                </select>
                <button onClick={addMember} className="text-sm bg-emerald-600 text-white rounded-lg px-3 py-1.5 hover:bg-emerald-700"><T k="배정" /></button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
