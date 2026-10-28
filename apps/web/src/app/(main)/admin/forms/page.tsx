'use client';

import { useState } from 'react';
import { kdate } from '@/lib/ui-settings';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { useDepartments } from '@/lib/use-departments';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';

import { EmptyState, KDate, Unit } from '@/components/ui/display';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';
import { RATIO_UNAVAILABLE } from '@hospital-run/shared';

interface FormField {
  id?: string;
  type: string;
  label: string;
  placeholder?: string;
  required?: boolean;
  options?: (string | { label: string; value: string })[];
}

interface FormSection {
  title?: string;
  fields?: FormField[];
}

interface FormSchema {
  id: string;
  name: string;
  version: string;
  /** 문항 판 번호(서버가 문항이 바뀔 때마다 올린다 · 2026-10-21 P5 A7) — 옛 서버면 없음 */
  revision?: number;
  category: string;
  estimatedMinutes?: number;
  description?: string;
  isActive: boolean;
  schema: {
    title?: string;
    description?: string;
    fields?: FormField[];
    sections?: FormSection[];
  };
}

interface QuestionnaireMapping {
  id: string;
  departmentName: string;
  formSchemaId: string;
  visitType: string;
  priority: number;
  formSchema?: { name: string };
}

interface QuestionnaireStats {
  total: { sent?: number; completed?: number; pending?: number; expired?: number };
  /** 🔴 발송 0건이면 서버가 `null` 을 준다 — `?? 0` 으로 접지 않는다(표본 부재 ≠ 0%) */
  completionRate?: number | null;
  completionRateUnavailableReason?: string | null;
}

interface PendingQuestionnaire {
  id: string;
  status: string;
  expiresAt: string;
  patient?: { familyName?: string; givenName?: string; mrn?: string };
  formSchema?: { name: string };
}

type Tab = 'forms' | 'mappings' | 'stats';

export default function AdminFormsPage() {
  const [tab, setTab] = useState<Tab>('forms');
  const tabs: { id: Tab; label: string }[] = [
    { id: 'forms', label: '양식 목록' },
    { id: 'mappings', label: '진료과 매핑' },
    { id: 'stats', label: '문진표 현황' },
  ];

  return (
    <div className="max-w-5xl">
      <h2 className="text-2xl font-bold text-gray-900 mb-4"><T k="문진표 관리" /></h2>

      <div className="flex gap-1 mb-4 bg-gray-100 rounded-lg p-1">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex-1 py-2 px-3 text-sm font-medium rounded-md transition-colors ${
              tab === t.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}><T k={t.label} /></button>
        ))}
      </div>

      {tab === 'forms' && <FormsTab />}
      {tab === 'mappings' && <MappingsTab />}
      {tab === 'stats' && <StatsTab />}
    </div>
  );
}

// ── 양식 목록 탭 ──
function FormsTab() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['form-schemas'],
    queryFn: () => apiClient.get<{ data: FormSchema[] }>('/api/v1/forms'),
  });
  const raw = data?.data;
  const forms: FormSchema[] = Array.isArray(raw) ? raw : (raw as Record<string, unknown> | undefined)?.data as FormSchema[] ?? [];
  const [selected, setSelected] = useState<FormSchema | null>(null);
  const [editing, setEditing] = useState<FormSchema | null>(null);
  const [creating, setCreating] = useState(false);
  const [historyOf, setHistoryOf] = useState<FormSchema | null>(null);
  const qc = useQueryClient();

  const categoryLabel: Record<string, string> = { QUESTIONNAIRE: '문진표', SCORING: '평가도구', CONSENT: '동의서', CUSTOM: '기타' };
  const categoryColor: Record<string, string> = { QUESTIONNAIRE: 'bg-blue-100 text-blue-700', SCORING: 'bg-purple-100 text-purple-700', CONSENT: 'bg-green-100 text-green-700', CUSTOM: 'bg-gray-100 text-gray-600' };

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  return (
    <div>
      <div className="bg-white rounded-xl border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-3 text-left"><T k="양식명" /></th>
              <th className="px-4 py-3 text-left"><T k="카테고리" /></th>
              <th className="px-4 py-3 text-left"><T k="버전" /></th>
              <th className="px-4 py-3 text-left"><T k="예상 시간" /></th>
              <th className="px-4 py-3 text-left"><T k="상태" /></th>
              <th className="px-4 py-3 text-left"><T k="관리" /></th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400"><T k="로딩 중..." /></td></tr>
            ) : !forms.length ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400"><T k="등록된 양식이 없습니다." /></td></tr>
            ) : forms.map((f: FormSchema) => (
              <tr key={f.id} className="border-b hover:bg-gray-50">
                <td className="px-4 py-3 font-medium">{f.name}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded ${categoryColor[f.category] ?? 'bg-gray-100 text-gray-600'}`}>
                    <T k={categoryLabel[f.category] ?? f.category ?? '문진표'} />
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-500" data-form-revision={f.revision ?? 'UNKNOWN'}>
                  {f.version}
                  {f.revision != null && <span className="ml-1 text-[11px] text-gray-400">· <T k="판" /> {f.revision}</span>}
                </td>
                <td className="px-4 py-3 text-gray-500">{f.estimatedMinutes ? <>{f.estimatedMinutes}<T k="분" /></> : '-'}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded ${f.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    <T k={f.isActive ? '활성' : '비활성'} />
                  </span>
                </td>
                <td className="px-4 py-3 space-x-2">
                  <button onClick={() => setSelected(f)} className="text-xs text-blue-600 hover:underline"><T k="미리보기" /></button>
                  <button onClick={() => setEditing(f)} className="text-xs text-gray-500 hover:underline"><T k="편집" /></button>
                  <button onClick={() => setHistoryOf(f)} className="text-xs text-gray-500 hover:underline" data-form-history-open={f.id}><T k="판 기록" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 미리보기 모달 */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setSelected(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">{selected.name}</h3>
              <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
            </div>
            <FormPreview schema={selected} />
          </div>
        </div>
      )}

      {historyOf && <FormRevisionsModal form={historyOf} onClose={() => setHistoryOf(null)} />}

      {/* 양식 편집/생성 모달 */}
      {(editing || creating) && (
        <FormEditorModal
          schema={editing}
          onClose={() => { setEditing(null); setCreating(false); }}
          onSaved={() => { setEditing(null); setCreating(false); qc.invalidateQueries({ queryKey: ['form-schemas'] }); }}
        />
      )}
    </div>
  );
}

function FormPreview({ schema }: { schema: FormSchema }) {
  const s = schema.schema;
  const fields: FormField[] = s?.fields ?? s?.sections?.flatMap((sec: FormSection) => sec.fields ?? []) ?? [];

  return (
    <div className="space-y-4">
      {s?.title && <p className="text-sm text-gray-600">{s.description ?? s.title}</p>}
      {fields.map((f: FormField, i: number) => (
        <div key={i} className="space-y-1">
          <label className="text-sm font-medium text-gray-700">
            {f.label} {f.required && <span className="text-red-500">*</span>}
          </label>
          {f.type === 'textarea' ? (
            <div className="w-full h-16 border border-gray-200 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-400">{f.placeholder ?? ''}</div>
          ) : f.type === 'select' || f.type === 'radio' ? (
            <div className="space-y-1">
              {(f.options ?? []).map((opt: string | { label: string; value: string }, j: number) => (
                <label key={j} className="flex items-center gap-2 text-xs text-gray-600">
                  <input type="radio" name={f.id} disabled className="accent-blue-600" />
                  {typeof opt === 'string' ? opt : opt.label}
                </label>
              ))}
            </div>
          ) : (
            <input disabled className="w-full border border-gray-200 rounded-lg bg-gray-50 px-3 py-2 text-xs" placeholder={f.placeholder ?? ''} />
          )}
        </div>
      ))}
      {!fields.length && <p className="text-sm text-gray-400"><T k="필드가 정의되지 않았습니다." /></p>}
    </div>
  );
}

/**
 * 🔴 W8 — 편집 진입 시 **반드시 상세를 다시 읽는다.**
 * 종전에는 목록 행(schema 미포함)을 그대로 초기값으로 써서 문항이 `[]` 로 시작했고,
 * 저장을 누르면 그 빈 문항이 원장을 덮어썼다(13개 양식 전부 소실 위험).
 * 서버도 문항 소거를 거부하지만(form-engine.service.updateSchema), 화면 역시
 * **모르는 값을 빈 값으로 만들지 않는다** — 못 읽었으면 편집을 열지 않는다.
 */
function FormEditorModal({ schema, onClose, onSaved }: { schema: FormSchema | null; onClose: () => void; onSaved: () => void }) {
  const isNew = !schema;
  const { data: detailData, isLoading: detailLoading, isError: detailError } = useQuery({
    queryKey: ['form-schema-detail', schema?.name],
    queryFn: () => apiClient.get<{ data: FormSchema }>(`/api/v1/forms/${encodeURIComponent(schema!.name)}`),
    enabled: !isNew,
  });
  const detailRaw = detailData?.data;
  const detail = ((detailRaw as Record<string, unknown> | undefined)?.data as FormSchema) ?? (detailRaw as FormSchema | undefined);

  if (!isNew && detailLoading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
        <div className="bg-white rounded-2xl shadow-2xl px-8 py-6 text-sm text-gray-500"><T k="양식을 불러오는 중..." /></div>
      </div>
    );
  }
  if (!isNew && (detailError || !detail)) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
        <div className="bg-white rounded-2xl shadow-2xl px-8 py-6 max-w-sm text-sm">
          <p className="text-red-600 font-medium mb-1"><T k="양식을 불러오지 못했습니다." /></p>
          <p className="text-gray-500 text-xs"><T k="문항을 모르는 채로 저장하면 기존 문항이 지워질 수 있어 편집을 열지 않습니다." /></p>
          <button onClick={onClose} className="mt-4 px-4 py-2 bg-gray-100 text-gray-600 text-sm rounded-lg"><T k="닫기" /></button>
        </div>
      </div>
    );
  }

  return <FormEditorForm source={isNew ? null : detail!} onClose={onClose} onSaved={onSaved} />;
}

interface FormRevisionRow { id: string; revision: number; version: string; origin: 'CREATE' | 'EDIT' | 'BEFORE_LEDGER'; createdAt: string; submissions: number }
interface FormRevisions {
  form: { id: string; name: string; revision: number; version: string };
  currentRecorded: boolean;
  revisions: FormRevisionRow[];
  submissionsBeforeLedger: number;
  submissionsOnUnrecordedCurrent: number;
}
const ORIGIN_LABEL: Record<FormRevisionRow['origin'], React.ReactNode> = { CREATE: <T k="만들 때" />, EDIT: <T k="문항 수정" />, BEFORE_LEDGER: <T k="판 기록 시작 전 내용" /> };

/**
 * 판 기록(2026-10-21 임상 규칙 P5 A7) — 판마다 받은 제출 수.
 * 🔴 판 기록 시작 전 제출은 "어떤 문항으로 받았는지 모름"으로 따로 말한다(어느 판에도 넣지 않는다).
 * 🔴 아직 한 번도 안 고친 폼의 현재 판은 원장에 없다 — 없는 게 아니라 아직 안 올라간 것(처음 고칠 때 남는다).
 */
function FormRevisionsModal({ form, onClose }: { form: FormSchema; onClose: () => void }) {
  const q = useQuery({
    queryKey: ['form-revisions', form.id],
    queryFn: () => apiClient.get<{ data: FormRevisions }>(`/api/v1/forms/${form.id}/revisions`),
  });
  const raw = q.data?.data as FormRevisions | { data?: FormRevisions } | undefined;
  const r = (raw && 'data' in raw ? raw.data : raw) as FormRevisions | undefined;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] overflow-y-auto p-6 space-y-3" onClick={(e) => e.stopPropagation()} data-form-revisions>
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold">{form.name} <T k="판 기록" /></h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
        </div>
        <p className="text-xs text-gray-500"><T k="문항이나 채점 규칙을 고치면 새 판이 됩니다. 제목·설명만 고치면 판은 그대로입니다. 제출은 받은 판 번호를 함께 남깁니다." /></p>
        {q.isError && <QueryErrorFallback error={q.error} onRetry={q.refetch} />}
        {q.isLoading && <p className="text-sm text-gray-400"><T k="불러오는 중…" /></p>}
        {r && (
          <>
            {!r.currentRecorded && (
              <p className="text-xs text-gray-600 bg-gray-50 rounded-lg px-3 py-2" data-form-current-unrecorded>
                <Tf k="지금 판 {판}은 아직 판 기록에 없습니다 — 처음 고칠 때 지금 문항이 그대로 남습니다." params={{ 판: r.form.revision }} />
                {r.submissionsOnUnrecordedCurrent > 0 && <> (<T k="이 판으로 받은 제출" /> {r.submissionsOnUnrecordedCurrent})</>}
              </p>
            )}
            {r.submissionsBeforeLedger > 0 && (
              <p className="text-xs text-amber-800 bg-amber-50 rounded-lg px-3 py-2" data-form-before-ledger={r.submissionsBeforeLedger}>
                <T k="판 기록 시작 전 제출" /> {r.submissionsBeforeLedger} — <T k="어떤 문항으로 받았는지 알 수 없습니다." />
              </p>
            )}
            {r.revisions.length > 0 && (
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-gray-500 border-b">
                  <th className="py-1.5"><T k="판" /></th><th className="py-1.5"><T k="표기 버전" /></th><th className="py-1.5"><T k="출처" /></th><th className="py-1.5"><T k="기록 시각" /></th><th className="py-1.5 text-right"><T k="제출" /></th>
                </tr></thead>
                <tbody>
                  {r.revisions.map((v) => (
                    <tr key={v.id} className="border-b border-gray-50" data-form-revision-row={v.revision}>
                      <td className="py-1.5 font-medium">{v.revision}{v.revision === r.form.revision && <span className="ml-1 text-[10px] text-blue-700"><T k="지금" /></span>}</td>
                      <td className="py-1.5 text-gray-500">{v.version}</td>
                      <td className="py-1.5 text-xs">{ORIGIN_LABEL[v.origin] ?? v.origin}</td>
                      <td className="py-1.5 text-xs text-gray-500">{v.origin === 'BEFORE_LEDGER' ? <T k="만든 시각 모름" /> : <KDate value={v.createdAt} mode="datetime" />}</td>
                      <td className="py-1.5 text-right tabular-nums">{v.submissions}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function FormEditorForm({ source, onClose, onSaved }: { source: FormSchema | null; onClose: () => void; onSaved: () => void }) {
  const tAttr = useTAttr();
  const schema = source;
  const isNew = !schema;
  const [name, setName] = useState(schema?.name ?? '');
  const [version, setVersion] = useState(schema?.version ?? '1.0');
  const [category, setCategory] = useState(schema?.category ?? 'QUESTIONNAIRE');
  const [minutes, setMinutes] = useState(schema?.estimatedMinutes ?? 5);
  const [description, setDescription] = useState(schema?.description ?? schema?.schema?.description ?? '');
  const [fieldsJson, setFieldsJson] = useState(JSON.stringify(schema?.schema?.fields ?? schema?.schema?.sections ?? [], null, 2));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    setSaving(true); setError('');
    try {
      let parsedFields: (FormField | FormSection)[];
      try { parsedFields = JSON.parse(fieldsJson); } catch { setError(tAttr('JSON 형식 오류')); setSaving(false); return; }
      if (!Array.isArray(parsedFields)) { setError(tAttr('필드/섹션은 배열이어야 합니다')); setSaving(false); return; }
      // 🔴 문항 0개 저장은 화면에서도 막는다 — 서버도 거부하지만, 여기서 막아야 사용자가 이유를 안다.
      if (!isNew && parsedFields.length === 0) {
        setError(tAttr('문항이 비어 있습니다 — 기존 문항이 지워지므로 저장하지 않습니다.'));
        setSaving(false); return;
      }
      const isSections = Array.isArray(parsedFields) && parsedFields.length > 0 && 'title' in parsedFields[0];
      const schemaBody: Record<string, unknown> = { title: name, description };
      if (isSections) schemaBody.sections = parsedFields; else schemaBody.fields = parsedFields;
      const meta = { category, estimatedMinutes: Number.isFinite(minutes) ? minutes : undefined, description };
      if (isNew) {
        await apiClient.post('/api/v1/forms', { name, version, locale: 'ko', schema: schemaBody, ...meta });
      } else {
        await apiClient.put(`/api/v1/forms/${schema.id}`, { version, schema: schemaBody, ...meta });
      }
      onSaved();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : tAttr('저장 실패')); }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[85vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold">{isNew ? <T k="양식 생성" /> : <>{schema.name} <T k="편집" /></>}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
        </div>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs text-gray-500 block mb-1"><T k="양식명" /></label><input value={name} onChange={e => setName(e.target.value)} disabled={!isNew} className="w-full border rounded-lg px-3 py-2 text-sm disabled:bg-gray-100" /></div>
            <div><label className="text-xs text-gray-500 block mb-1"><T k="버전" /></label><input value={version} onChange={e => setVersion(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs text-gray-500 block mb-1"><T k="카테고리" /></label>
              <select value={category} onChange={e => setCategory(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm">
                <option value="QUESTIONNAIRE">{tAttr('문진표')}</option><option value="SCORING">{tAttr('평가도구')}</option><option value="CONSENT">{tAttr('동의서')}</option><option value="CUSTOM">{tAttr('기타')}</option>
              </select></div>
            <div><label className="text-xs text-gray-500 block mb-1"><T k="예상 시간 (분)" /></label><input type="number" value={minutes} onChange={e => setMinutes(parseInt(e.target.value))} className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
          </div>
          <div><label className="text-xs text-gray-500 block mb-1"><T k="설명" /></label><input value={description} onChange={e => setDescription(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder={tAttr('환자에게 표시되는 설명')} /></div>
          {!isNew && (
            <p className="text-[11px] text-gray-500 bg-gray-50 rounded px-2 py-1.5" data-form-revision-hint>
              {schema.revision != null
                ? <Tf k="문항이나 채점 규칙을 바꾸면 새 판({지금} → {다음})이 됩니다 — 지난 제출은 받은 판 그대로 남습니다." params={{ 지금: schema.revision, 다음: schema.revision + 1 }} />
                : <T k="문항이나 채점 규칙을 바꾸면 새 판이 됩니다 — 지난 제출은 받은 판 그대로 남습니다." />}
            </p>
          )}
          <div>
            <label className="text-xs text-gray-500 block mb-1"><T k="필드/섹션 (JSON)" /></label>
            <textarea value={fieldsJson} onChange={e => setFieldsJson(e.target.value)} rows={12} className="w-full border rounded-lg px-3 py-2 text-xs font-mono resize-y" />
          </div>
          {error && <p className="text-xs text-red-600 bg-red-50 px-3 py-1.5 rounded">{error}</p>}
          <div className="flex gap-2">
            <button onClick={handleSave} disabled={saving} className="flex-1 py-2.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50"><T k={saving ? '저장 중...' : isNew ? '생성' : '저장'} /></button>
            <button onClick={onClose} className="px-4 py-2.5 bg-gray-100 text-gray-600 text-sm rounded-lg hover:bg-gray-200"><T k="취소" /></button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 진료과 매핑 탭 ──
function MappingsTab() {
  const qc = useQueryClient();
  const tAttr = useTAttr();
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ departmentName: '', formSchemaId: '', visitType: 'ALL', priority: 1 });
  const { data, isLoading } = useQuery({
    queryKey: ['questionnaire-mappings'],
    queryFn: () => apiClient.get<{ data: QuestionnaireMapping[] }>('/api/v1/admin/questionnaire/mappings'),
  });
  const { data: schemasData } = useQuery({
    queryKey: ['form-schemas-for-mapping'],
    queryFn: () => apiClient.get<{ data: FormSchema[] }>('/api/v1/forms'),
  });
  const raw = data?.data;
  const mappings: QuestionnaireMapping[] = Array.isArray(raw) ? raw : (raw as Record<string, unknown> | undefined)?.data as QuestionnaireMapping[] ?? [];
  const schemasRaw = schemasData?.data;
  const schemas: FormSchema[] = Array.isArray(schemasRaw) ? schemasRaw : (schemasRaw as Record<string, unknown> | undefined)?.data as FormSchema[] ?? [];

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.del(`/api/v1/admin/questionnaire/mappings/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['questionnaire-mappings'] }),
  });
  const addMutation = useMutation({
    mutationFn: (d: { departmentName: string; formSchemaId: string; visitType: string; priority: number }) => apiClient.post('/api/v1/admin/questionnaire/mappings', d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['questionnaire-mappings'] }); setShowAdd(false); setAddForm({ departmentName: '', formSchemaId: '', visitType: 'ALL', priority: 1 }); },
  });

  // 진료과별 그룹핑
  const grouped = new Map<string, QuestionnaireMapping[]>();
  for (const m of mappings) {
    const dept = m.departmentName;
    if (!grouped.has(dept)) grouped.set(dept, []);
    grouped.get(dept)!.push(m);
  }

  const visitTypeLabel: Record<string, string> = { INITIAL: '초진', FOLLOW_UP: '재진', PRE_OP: '수술전', ALL: '전체' };

  // 진료과 목록 정본 = 마스터(useDepartments) — 로컬 배열 재정의 금지(input-assist-ux P1)
  const { names: DEPTS } = useDepartments({ category: 'CLINICAL' });

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <span />
        <button onClick={() => setShowAdd(!showAdd)} className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700"><T k={showAdd ? '닫기' : '+ 매핑 추가'} /></button>
      </div>
      {showAdd && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div><label className="text-[10px] text-gray-500"><T k="진료과" /></label>
              <select value={addForm.departmentName} onChange={e => setAddForm(f => ({ ...f, departmentName: e.target.value }))} className="w-full border rounded-lg px-2 py-1.5 text-xs">
                <option value="">{tAttr('선택')}</option>{DEPTS.map(d => <option key={d} value={d}>{d}</option>)}
              </select></div>
            <div><label className="text-[10px] text-gray-500"><T k="양식" /></label>
              <select value={addForm.formSchemaId} onChange={e => setAddForm(f => ({ ...f, formSchemaId: e.target.value }))} className="w-full border rounded-lg px-2 py-1.5 text-xs">
                <option value="">{tAttr('선택')}</option>{schemas.map((s: FormSchema) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select></div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="text-[10px] text-gray-500"><T k="유형" /></label>
              <select value={addForm.visitType} onChange={e => setAddForm(f => ({ ...f, visitType: e.target.value }))} className="w-full border rounded-lg px-2 py-1.5 text-xs">
                <option value="ALL">{tAttr('전체')}</option><option value="INITIAL">{tAttr('초진')}</option><option value="FOLLOW_UP">{tAttr('재진')}</option><option value="PRE_OP">{tAttr('수술전')}</option>
              </select></div>
            <div><label className="text-[10px] text-gray-500"><T k="우선순위" /></label>
              <input type="number" min={1} max={10} value={addForm.priority} onChange={e => setAddForm(f => ({ ...f, priority: parseInt(e.target.value) }))} className="w-full border rounded-lg px-2 py-1.5 text-xs" /></div>
          </div>
          <button onClick={() => addMutation.mutate(addForm)} disabled={!addForm.departmentName || !addForm.formSchemaId || addMutation.isPending}
            className="w-full py-2 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 disabled:opacity-50"><T k="추가" /></button>
        </div>
      )}
      {isLoading ? (
        <div className="text-center py-8 text-gray-400"><T k="로딩 중..." /></div>
      ) : !grouped.size ? (
        <EmptyState icon="📋" title="매핑이 없습니다." />
      ) : Array.from(grouped.entries()).map(([dept, items]) => (
        <div key={dept} className="bg-white rounded-xl border p-4">
          <h3 className="font-semibold text-gray-900 mb-2">{dept}</h3>
          <div className="space-y-1.5">
            {items.map((m: QuestionnaireMapping) => (
              <div key={m.id} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded"><T k={visitTypeLabel[m.visitType] ?? m.visitType} /></span>
                  <span className="text-gray-700">{m.formSchema?.name}</span>
                  {m.priority > 1 && <span className="text-[10px] text-gray-400">P{m.priority}</span>}
                </div>
                <button onClick={() => deleteMutation.mutate(m.id)} className="text-xs text-red-400 hover:text-red-600"><T k="삭제" /></button>
              </div>
            ))}
          </div>
        </div>
      ))}
      {/* 🔴 W8 — 안내와 실제가 달랐다(실제로는 알파벳 첫 양식 = 내과 문진표가 나갔다). 실제 폴백 이름을 적는다. */}
      <p className="text-xs text-gray-400"><T k="매핑 없는 진료과는 진료과 무관 기본 문진표" />(<T k="초진" /> <code>questionnaire-initial</code> · <T k="재진" /> <code>questionnaire-followup</code> · <T k="수술전" /> <code>questionnaire-preop</code>)<T k="가 적용됩니다. 해당 양식이 없으면 발송이 거부됩니다." /></p>
    </div>
  );
}

// ── 문진표 현황 탭 ──
function StatsTab() {
  const tAttr = useTAttr();
  const { data: statsData, isLoading: statsLoading } = useQuery({
    queryKey: ['questionnaire-stats'],
    queryFn: () => apiClient.get<{ data: QuestionnaireStats }>('/api/v1/admin/questionnaire/stats'),
  });
  const { data: pendingData } = useQuery({
    queryKey: ['questionnaire-pending'],
    queryFn: () => apiClient.get<{ data: PendingQuestionnaire[] }>('/api/v1/admin/questionnaire/pending'),
  });

  const stats: QuestionnaireStats | null = (statsData?.data as Record<string, unknown> | undefined)?.data as QuestionnaireStats ?? (statsData?.data as QuestionnaireStats) ?? null;
  const pendingRaw = pendingData?.data;
  const pending: PendingQuestionnaire[] = Array.isArray(pendingRaw) ? pendingRaw : (pendingRaw as Record<string, unknown> | undefined)?.data as PendingQuestionnaire[] ?? [];

  if (statsLoading) return <div className="text-center py-8 text-gray-400"><T k="로딩 중..." /></div>;
  if (!stats) return <div className="text-center py-8 text-gray-400"><T k="통계 데이터를 불러올 수 없습니다." /></div>;

  const total = stats.total ?? {};
  const statusColor = (s: string) => s === 'COMPLETED' ? 'bg-green-100 text-green-700' : s === 'OPENED' ? 'bg-blue-100 text-blue-700' : s === 'EXPIRED' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700';

  return (
    <div className="space-y-4">
      {/* 통계 카드 */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: '발송', value: total.sent ?? 0, color: 'text-blue-600' },
          { label: '완료', value: total.completed ?? 0, color: 'text-green-600' },
          { label: '미작성', value: total.pending ?? 0, color: 'text-yellow-600' },
          { label: '만료', value: total.expired ?? 0, color: 'text-red-600' },
        ].map(c => (
          <div key={c.label} className="bg-white rounded-xl border p-4 text-center">
            <p className="text-xs text-gray-500"><T k={c.label} /></p>
            <p className={`text-2xl font-bold ${c.color}`}>{c.value}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border p-4">
        <p className="text-sm font-semibold text-gray-900 mb-1"><T k="작성률" /></p>
        <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden">
          {/*
            🔴 (2026-09-16 I4) 서버는 발송 0건이면 `completionRate: null` + `completionRateUnavailableReason`
               ("발송된 문진이 없습니다(표본 0)")을 준다. 화면이 `?? 0` 으로 그 사실을 버려
               **빈 초록 막대 + "0%"** 를 그렸다 — 한 건도 안 보낸 상태를 "아무도 안 썼다"로 말한 것이다.
          */}
          {stats.completionRate != null && (
            <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${stats.completionRate}%` }} />
          )}
        </div>
        <p className="text-xs text-gray-500 mt-1">
          {stats.completionRate != null
            ? <>{stats.completionRate}<Unit>%</Unit></>
            : <span className="text-gray-400">{stats.completionRateUnavailableReason ?? RATIO_UNAVAILABLE}</span>}
        </p>
      </div>

      {/* 미작성 목록 */}
      <div className="bg-white rounded-xl border">
        <div className="px-4 py-3 border-b">
          <h3 className="text-sm font-semibold text-gray-900"><T k="미작성 문진표" /> ({pending.length}<Unit><T k="건" /></Unit>)</h3>
        </div>
        <div className="divide-y">
          {!pending.length ? (
            <EmptyState icon="📋" title="미작성 문진표가 없습니다." />
          ) : pending.slice(0, 20).map((p: PendingQuestionnaire) => (
            <div key={p.id} className="px-4 py-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-800">{p.patient?.familyName}{p.patient?.givenName} ({p.patient?.mrn})</p>
                <p className="text-xs text-gray-500">{p.formSchema?.name} | <T k="만료" />: {kdate(new Date(p.expiresAt), 'datetime')}</p>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded ${statusColor(p.status)}`}>{p.status}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
