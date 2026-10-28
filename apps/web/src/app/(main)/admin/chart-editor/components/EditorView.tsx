'use client';

import { useState, useCallback, useEffect } from 'react';
import { kdate } from '@/lib/ui-settings';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { useDepartments } from '@/lib/use-departments';
import {
  ChartTemplate, FieldDef, FieldType, Section, ShowWhenOp,
  PALETTE, ROLE_OPTIONS, LAYOUT_OPTIONS, CATEGORY_OPTIONS,
  SOAP_OPTIONS, SOAP_SLOT_VALUES, CALCULATOR_OPTIONS, SECTION_ICON_OPTIONS, SECTION_ICON_MAP,
  uid,
} from './shared';

/**
 * 필드가 실제로 저장되는 SOAP 슬롯. 정본은 `mappedTo`, `soapMapping` 은 마이그레이션 전 데이터를
 * 읽기 위한 폴백일 뿐이다(🔴 E3 — 두 키가 갈라져 에디터 선택이 저장에 반영되지 않았다).
 */
function effectiveSlot(field: FieldDef): '' | 'subjective' | 'objective' | 'assessment' | 'plan' {
  const slots = SOAP_SLOT_VALUES as readonly string[];
  if (field.mappedTo && slots.includes(field.mappedTo)) return field.mappedTo as 'subjective';
  if (field.soapMapping && slots.includes(field.soapMapping)) return field.soapMapping as 'subjective';
  return '';
}
const SLOT_INITIAL: Record<string, string> = { subjective: 'S', objective: 'O', assessment: 'A', plan: 'P' };
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { chartsByCategory, getChart, ARCHETYPE_LABEL } from '@/lib/clinical-charts';
import { useChartVerifications, effectiveVerified } from '@/components/clinical-charts/useChartVerifications';

import { EmptyState, Unit } from '@/components/ui/display';
import { toast } from '@/stores/toast-store';
import { AI_ORIGIN_TEXT } from '@hospital-run/shared';
import { T, useTAttr } from '@/components/ui/i18n-text';

/* ------------------------------------------------------------------ */
/*  Version History Types                                              */
/* ------------------------------------------------------------------ */
interface TemplateVersion {
  id: string;
  templateId: string;
  version: string;
  sections: Section[];
  changedBy: string | null;
  changeNote: string | null;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/*  Preview Panel                                                      */
/* ------------------------------------------------------------------ */
function PreviewPanel({ template }: { template: ChartTemplate }) {
  const tAttr = useTAttr();
  const [activeTab, setActiveTab] = useState(0);

  const renderFieldPreview = (field: FieldDef) => {
    // 🔴 배지는 `soapMapping`(죽은 키)이 아니라 실제 저장을 좌우하는 슬롯을 보여준다.
    const slot = effectiveSlot(field);
    const base = (
      <label className="block text-xs font-medium text-gray-700 mb-1">
        {field.label}
        {field.required && <span className="text-red-500 ml-0.5">*</span>}
        {slot ? (
          <span className="ml-1.5 text-[10px] bg-indigo-50 text-indigo-500 px-1 py-0.5 rounded">
            {slot.toUpperCase()}
          </span>
        ) : (
          <span className="ml-1.5 text-[10px] bg-amber-50 text-amber-600 px-1 py-0.5 rounded" title={tAttr('SOAP 미지정 — 객관적 소견(O)의 [SOAP 미지정] 블록에 라벨과 함께 저장됩니다')}>
            <T k="O·미지정" />
          </span>
        )}
      </label>
    );

    switch (field.type) {
      case 'textarea':
        return <div key={field.id}>{base}<div className="w-full rounded-lg border border-gray-200 bg-gray-50 text-xs text-gray-400 p-2" style={{ minHeight: `${(field.rows ?? 3) * 20}px` }}>{field.placeholder || '\u00A0'}</div></div>;
      case 'select':
      case 'multiselect':
        return <div key={field.id}>{base}<div className="w-full rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5 text-xs text-gray-400">{field.options?.[0] || tAttr('선택...')} {field.type === 'multiselect' && <span className="text-[10px]"><T k="(다중)" /></span>}</div></div>;
      case 'checkbox':
        return <div key={field.id} className="flex items-center gap-2"><div className="w-4 h-4 rounded border border-gray-300 bg-white" /><span className="text-xs text-gray-700">{field.label}</span></div>;
      case 'number':
      case 'slider':
        return <div key={field.id}>{base}<div className="w-full rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5 text-xs text-gray-400">{field.min ?? 0} ~ {field.max ?? 100}</div></div>;
      case 'vitals':
        return <div key={field.id}>{base}<div className="grid grid-cols-3 gap-1">{['체온', '혈압', '맥박'].map((v) => <div key={v} className="rounded border border-gray-200 bg-gray-50 px-2 py-1 text-[10px] text-gray-400"><T k={v} /></div>)}</div></div>;
      case 'diagnosis-search':
      case 'medication-search':
      case 'procedure-search':
        return <div key={field.id}>{base}<div className="w-full rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5 text-xs text-gray-400 flex items-center gap-1"><span className="text-gray-300">&#x1F50D;</span>{field.placeholder || tAttr('검색...')}{field.codeSystem && <span className="ml-auto text-[10px] bg-yellow-50 text-yellow-600 px-1 rounded">{field.codeSystem}</span>}</div></div>;
      case 'pain-scale':
        return <div key={field.id}>{base}<div className="flex gap-1">{Array.from({ length: 11 }, (_, i) => <div key={i} className="w-5 h-5 rounded-full border border-gray-200 bg-gray-50 flex items-center justify-center text-[8px] text-gray-400">{i}</div>)}</div></div>;
      case 'score-calculator':
        return <div key={field.id}>{base}<div className="rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5 text-xs text-gray-400">{field.calculator ? <>{field.calculator} <T k="계산기" /></> : <T k="점수 계산기" />}</div></div>;
      case 'clinical-chart': {
        const cc = field.clinicalChartId ? getChart(field.clinicalChartId) : undefined;
        return <div key={field.id}>{base}<div className="rounded-lg border border-indigo-200 bg-indigo-50 px-2 py-1.5 text-xs text-indigo-600">{cc ? `🩺 ${cc.name} [${ARCHETYPE_LABEL[cc.archetype]}]` : <T k="임상도구 미선택" />}</div></div>;
      }
      case 'body-diagram':
        return <div key={field.id}>{base}<div className="w-full h-24 rounded-lg border border-gray-200 bg-gray-50 flex items-center justify-center text-xs text-gray-300"><T k="신체 도식" /></div></div>;
      case 'photo-capture':
        return <div key={field.id}>{base}<div className="w-20 h-20 rounded-lg border-2 border-dashed border-gray-200 flex items-center justify-center text-gray-300 text-lg">+</div></div>;
      case 'timeline':
        return <div key={field.id}>{base}<div className="border-l-2 border-gray-200 pl-3 py-1 text-[10px] text-gray-400 space-y-1"><div><T k="10:00 - 항목 1" /></div><div><T k="11:00 - 항목 2" /></div></div></div>;
      case 'checklist':
        return <div key={field.id}>{base}<div className="space-y-1">{(field.options ?? [tAttr('항목 1'), tAttr('항목 2')]).map((o, i) => <div key={i} className="flex items-center gap-1.5 text-xs text-gray-500"><div className="w-3.5 h-3.5 rounded border border-gray-300" />{o}</div>)}</div></div>;
      default:
        return <div key={field.id}>{base}<div className="w-full rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5 text-xs text-gray-400">{field.placeholder || '\u00A0'}</div></div>;
    }
  };

  const renderSection = (section: Section) => {
    const cols = section.columns ?? 1;
    const gridClass = cols === 3 ? 'grid-cols-3' : cols === 2 ? 'grid-cols-2' : 'grid-cols-1';
    return (
      <div key={section.id} className="mb-4">
        <div className="flex items-center gap-1.5 mb-2 pb-1 border-b border-gray-100">
          {section.icon && SECTION_ICON_MAP[section.icon] && <span className="text-sm">{SECTION_ICON_MAP[section.icon]}</span>}
          <h3 className="text-sm font-semibold text-gray-800">{section.title}</h3>
        </div>
        <div className={`grid ${gridClass} gap-3`}>
          {section.fields.map((f) => renderFieldPreview(f))}
          {section.fields.length === 0 && <p className="text-xs text-gray-300 col-span-full text-center py-2"><T k="필드 없음" /></p>}
        </div>
      </div>
    );
  };

  if (template.layout === 'tabs') {
    return (
      <div>
        <div className="flex gap-1 border-b border-gray-200 mb-4">
          {template.sections.map((s, i) => (
            <button key={s.id} onClick={() => setActiveTab(i)}
              className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${i === activeTab ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
              {s.icon && SECTION_ICON_MAP[s.icon] ? `${SECTION_ICON_MAP[s.icon]} ` : ''}{s.title}
            </button>
          ))}
        </div>
        {template.sections[activeTab] && renderSection(template.sections[activeTab])}
      </div>
    );
  }

  if (template.layout === 'accordion') {
    return <div className="space-y-2">{template.sections.map((s) => <AccordionPreviewSection key={s.id} section={s} renderSection={renderSection} />)}</div>;
  }

  if (template.layout === 'side-by-side') {
    const half = Math.ceil(template.sections.length / 2);
    return (
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-4">{template.sections.slice(0, half).map((s) => renderSection(s))}</div>
        <div className="space-y-4">{template.sections.slice(half).map((s) => renderSection(s))}</div>
      </div>
    );
  }

  // single-page
  return <div className="space-y-4">{template.sections.map((s) => renderSection(s))}</div>;
}

function AccordionPreviewSection({ section, renderSection }: { section: Section; renderSection: (s: Section) => React.ReactNode }) {
  const [open, setOpen] = useState(section.defaultOpen !== false);
  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between px-3 py-2 bg-gray-50 text-xs font-semibold text-gray-700 hover:bg-gray-100">
        <span>{section.icon && SECTION_ICON_MAP[section.icon] ? `${SECTION_ICON_MAP[section.icon]} ` : ''}{section.title}</span>
        <span className="text-gray-400">{open ? '\u25B2' : '\u25BC'}</span>
      </button>
      {open && <div className="p-3">{renderSection(section)}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Section Settings Modal                                             */
/* ------------------------------------------------------------------ */
function SectionSettingsModal({ section, onUpdate, onClose }: {
  section: Section;
  onUpdate: (patch: Partial<Section>) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm space-y-4">
        <h3 className="font-bold text-gray-900"><T k="섹션 설정" /></h3>

        <div>
          <label className="text-xs text-gray-500 block mb-1"><T k="섹션명" /></label>
          <input value={section.title} onChange={(e) => onUpdate({ title: e.target.value })}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm" />
        </div>

        <div>
          <label className="text-xs text-gray-500 block mb-1"><T k="컬럼 수" /></label>
          <div className="flex gap-2">
            {([1, 2, 3] as const).map((n) => (
              <button key={n} onClick={() => onUpdate({ columns: n })}
                className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors ${(section.columns ?? 1) === n ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
                {n}<Unit>열</Unit>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-xs text-gray-500 block mb-1"><T k="아이콘" /></label>
          <div className="flex flex-wrap gap-1.5">
            {SECTION_ICON_OPTIONS.map((icon) => (
              <button key={icon || '__none'} onClick={() => onUpdate({ icon })}
                className={`w-8 h-8 rounded-lg border text-sm flex items-center justify-center transition-colors ${(section.icon ?? '') === icon ? 'bg-blue-100 border-blue-400' : 'border-gray-200 hover:bg-gray-50'}`}>
                {icon ? (SECTION_ICON_MAP[icon] ?? icon) : '-'}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-gray-600">
            <input type="checkbox" checked={section.collapsible ?? false} onChange={(e) => onUpdate({ collapsible: e.target.checked })} className="rounded" />
            <T k="접기 가능" />
          </label>
          {section.collapsible && (
            <label className="flex items-center gap-2 text-xs text-gray-600">
              <input type="checkbox" checked={section.defaultOpen !== false} onChange={(e) => onUpdate({ defaultOpen: e.target.checked })} className="rounded" />
              <T k="기본 펼침" />
            </label>
          )}
        </div>

        <button onClick={onClose} className="w-full py-2 rounded-xl bg-gray-100 text-sm text-gray-700 hover:bg-gray-200"><T k="닫기" /></button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Move Field Modal                                                   */
/* ------------------------------------------------------------------ */
function MoveFieldModal({ sections, currentSectionId, fieldLabel, onMove, onClose }: {
  sections: Section[];
  currentSectionId: string;
  fieldLabel: string;
  onMove: (targetSectionId: string) => void;
  onClose: () => void;
}) {
  const targets = sections.filter((s) => s.id !== currentSectionId);
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm space-y-4">
        <h3 className="font-bold text-gray-900"><T k="필드 이동" /></h3>
        <p className="text-sm text-gray-500">&quot;{fieldLabel}&quot; <T k="필드를 다른 섹션으로 이동합니다." /></p>
        <div className="space-y-2">
          {targets.length === 0 && <p className="text-xs text-gray-400"><T k="이동할 섹션이 없습니다." /></p>}
          {targets.map((s) => (
            <button key={s.id} onClick={() => { onMove(s.id); onClose(); }}
              className="w-full text-left px-3 py-2 rounded-lg border border-gray-200 text-sm hover:border-blue-400 hover:bg-blue-50 transition-colors">
              {s.title} ({s.fields.length}<Unit>개</Unit> <T k="필드" />)
            </button>
          ))}
        </div>
        <button onClick={onClose} className="w-full py-2 rounded-xl bg-gray-100 text-sm text-gray-700 hover:bg-gray-200"><T k="취소" /></button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Add Field Dropdown                                                 */
/* ------------------------------------------------------------------ */
function AddFieldDropdown({ onAdd, onClose }: { onAdd: (type: FieldType) => void; onClose: () => void }) {
  return (
    <div className="absolute top-full left-0 mt-1 z-30 bg-white border border-gray-200 rounded-xl shadow-lg p-2 w-56 max-h-72 overflow-y-auto">
      {PALETTE.map((group) => (
        <div key={group.category}>
          <p className="text-[10px] font-semibold text-gray-400 uppercase px-2 pt-2 pb-1">{group.category}</p>
          {group.fields.map((f) => (
            <button key={f.type} onClick={() => { onAdd(f.type); onClose(); }}
              className="w-full text-left px-2 py-1.5 text-xs text-gray-700 hover:bg-blue-50 hover:text-blue-600 rounded-lg">
              {f.label}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Field Properties Panel                                             */
/* ------------------------------------------------------------------ */
function FieldPropertiesPanel({ field, sectionId, sections, updateField }: {
  field: FieldDef;
  sectionId: string;
  sections: Section[];
  updateField: (sectionId: string, fieldId: string, patch: Partial<FieldDef>) => void;
}) {
  const tAttr = useTAttr();
  const update = (patch: Partial<FieldDef>) => updateField(sectionId, field.id, patch);
  const showSliderRange = field.type === 'slider' || field.type === 'number';
  const showOptions = field.type === 'select' || field.type === 'multiselect' || field.type === 'checklist';
  const showRows = field.type === 'textarea';
  const showCalculator = field.type === 'score-calculator';
  const showClinicalChart = field.type === 'clinical-chart';
  const showCodeSystem = field.type === 'diagnosis-search' || field.type === 'medication-search' || field.type === 'procedure-search';
  const selectedClinical = showClinicalChart && field.clinicalChartId ? getChart(field.clinicalChartId) : undefined;
  const { map: verMap, fourEyes } = useChartVerifications(); // 검수 상태 병합(⚠️ 표시)
  // 정본은 mappedTo. 레거시 soapMapping 은 읽기 폴백으로만 인정한다(저장 시 서버가 흡수·제거).
  const soapSlotValue = effectiveSlot(field);
  const legacyMappedTo = field.mappedTo && !soapSlotValue ? field.mappedTo : '';

  return (
    <div className="p-4 space-y-4">
      <p className="text-xs font-semibold text-gray-500 uppercase"><T k="필드 속성" /></p>

      {/* 기본 속성 */}
      <div>
        <label className="text-xs text-gray-500 block mb-1"><T k="레이블" /></label>
        <input value={field.label} onChange={(e) => update({ label: e.target.value })}
          className="w-full px-2 py-1.5 rounded-lg border border-gray-300 text-sm" />
      </div>

      <div>
        <label className="text-xs text-gray-500 block mb-1"><T k="플레이스홀더" /></label>
        <input value={field.placeholder ?? ''} onChange={(e) => update({ placeholder: e.target.value })}
          className="w-full px-2 py-1.5 rounded-lg border border-gray-300 text-sm" />
      </div>

      <div className="flex items-center gap-2">
        <input type="checkbox" id="req" checked={field.required ?? false}
          onChange={(e) => update({ required: e.target.checked })} className="rounded" />
        <label htmlFor="req" className="text-xs text-gray-600"><T k="필수 항목" /></label>
      </div>

      {/* 조건부 속성 */}
      {showRows && (
        <div>
          <label className="text-xs text-gray-500 block mb-1"><T k="줄 수" /></label>
          <input type="number" min={1} max={20} value={field.rows ?? 3}
            onChange={(e) => update({ rows: Number(e.target.value) })}
            className="w-full px-2 py-1.5 rounded-lg border border-gray-300 text-sm" />
        </div>
      )}

      {showOptions && (
        <div>
          <label className="text-xs text-gray-500 block mb-1"><T k="옵션 (줄바꿈 구분)" /></label>
          <textarea rows={4} value={(field.options ?? []).join('\n')}
            onChange={(e) => update({ options: e.target.value.split('\n').filter(Boolean) })}
            className="w-full px-2 py-1.5 rounded-lg border border-gray-300 text-sm resize-none" />
        </div>
      )}

      {field.type === 'multiselect' && (
        <div className="flex items-center gap-2">
          <input type="checkbox" id="multiple" checked={field.multiple ?? true}
            onChange={(e) => update({ multiple: e.target.checked })} className="rounded" />
          <label htmlFor="multiple" className="text-xs text-gray-600"><T k="다중 선택" /></label>
        </div>
      )}

      {showSliderRange && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-gray-500 block mb-1"><T k="최소값" /></label>
            <input type="number" value={field.min ?? 0} onChange={(e) => update({ min: Number(e.target.value) })}
              className="w-full px-2 py-1.5 rounded-lg border border-gray-300 text-sm" />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1"><T k="최대값" /></label>
            <input type="number" value={field.max ?? 100} onChange={(e) => update({ max: Number(e.target.value) })}
              className="w-full px-2 py-1.5 rounded-lg border border-gray-300 text-sm" />
          </div>
        </div>
      )}

      {showCalculator && (
        <div>
          <label className="text-xs text-gray-500 block mb-1"><T k="계산기 종류" /></label>
          <select value={field.calculator ?? ''} onChange={(e) => update({ calculator: e.target.value as FieldDef['calculator'] })}
            className="w-full px-2 py-1.5 rounded-lg border border-gray-300 text-sm">
            {CALCULATOR_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      )}

      {showClinicalChart && (
        <div>
          <label className="text-xs text-gray-500 block mb-1"><T k="임상도구 선택 (78종)" /></label>
          <select value={field.clinicalChartId ?? ''} onChange={(e) => update({ clinicalChartId: e.target.value })}
            className="w-full px-2 py-1.5 rounded-lg border border-gray-300 text-sm">
            <option value="">{tAttr('— 선택 —')}</option>
            {chartsByCategory().map((g) => (
              <optgroup key={g.category} label={g.category}>
                {g.charts.map((c) => (
                  <option key={c.chartId} value={c.chartId}>{c.name} [{ARCHETYPE_LABEL[c.archetype]}]{effectiveVerified(c, verMap[c.chartId], fourEyes) ? '' : ' ⚠️'}</option>
                ))}
              </optgroup>
            ))}
          </select>
          {selectedClinical && (
            <p className="text-[10px] text-gray-400 mt-1">
              {ARCHETYPE_LABEL[selectedClinical.archetype]} · {selectedClinical.sourceGuideline}
              {!effectiveVerified(selectedClinical, verMap[selectedClinical.chartId], fourEyes) && <span className="text-yellow-600"> <T k="· 미검증" /></span>}
            </p>
          )}
        </div>
      )}

      {showCodeSystem && (
        <div>
          <label className="text-xs text-gray-500 block mb-1"><T k="코드 체계" /></label>
          <select value={field.codeSystem ?? ''} onChange={(e) => update({ codeSystem: e.target.value as FieldDef['codeSystem'] })}
            className="w-full px-2 py-1.5 rounded-lg border border-gray-300 text-sm">
            <option value="">{tAttr('없음')}</option>
            <option value="KCD">{tAttr('KCD (한국표준질병사인분류)')}</option>
            <option value="EDI">{tAttr('EDI (전자청구코드)')}</option>
          </select>
        </div>
      )}

      {/*
        저장 위치 — 매핑 키를 `mappedTo` 하나로 수렴한다.
        🔴 E3 원 결함: 여기 'SOAP 매핑' 은 `soapMapping` 에 썼는데 렌더러/저장은 `mappedTo` 만 읽어
           **선택이 아무 데도 쓰이지 않았다**. 게다가 실제로 저장을 좌우하는 `mappedTo` 는
           "매핑 경로 (FHIR/openEHR)" 라는 이름에 placeholder `Observation.valueQuantity` 로 제시돼,
           안내대로 쓰면 SOAP 슬롯이 아니라 값이 버려졌다.
      */}
      <div className="pt-2 border-t border-gray-100">
        <p className="text-xs font-semibold text-gray-400 uppercase mb-2"><T k="저장 위치" /></p>
        <div>
          <label className="text-xs text-gray-500 block mb-1"><T k="진료기록(SOAP) 어디에 저장할지" /></label>
          <select value={soapSlotValue} onChange={(e) => update({ mappedTo: e.target.value || undefined, soapMapping: undefined })}
            className="w-full px-2 py-1.5 rounded-lg border border-gray-300 text-sm">
            {SOAP_OPTIONS.map((o) => <option key={o.value} value={o.value}>{tAttr(o.label)}</option>)}
          </select>
          {legacyMappedTo && (
            <p className="text-[10px] text-amber-600 mt-1">
              <T k="이전 값" /> <code className="bg-amber-50 px-1 rounded">{legacyMappedTo}</code> <T k="은 SOAP 슬롯이 아니라 저장 경로가 없습니다 — 슬롯을 고르면 교체됩니다(고르지 않으면 미지정 블록에 저장)." />
            </p>
          )}
          <p className="text-[10px] text-gray-400 mt-1">
            <T k="같은 슬롯에 여러 필드를 두면 덮어쓰지 않고" /> <strong><T k="라벨과 함께 합쳐" /></strong> <T k="저장됩니다." />
          </p>
        </div>
      </div>

      {/* 조건부 표시 (showWhen) — 대상 필드 값이 조건 충족 시에만 렌더 */}
      <div className="pt-2 border-t border-gray-100">
        <p className="text-xs font-semibold text-gray-400 uppercase mb-2"><T k="조건부 표시" /></p>
        <div className="space-y-2">
          <select value={field.showWhen?.fieldId ?? ''}
            onChange={(e) => update({ showWhen: e.target.value ? { fieldId: e.target.value, op: field.showWhen?.op ?? 'notEmpty', value: field.showWhen?.value } : undefined })}
            className="w-full px-2 py-1.5 rounded-lg border border-gray-300 text-sm">
            <option value="">{tAttr('항상 표시')}</option>
            {sections.flatMap((s) => s.fields.filter((f) => f.id !== field.id).map((f) => (
              <option key={f.id} value={f.id}>{s.title} · {f.label}</option>
            )))}
          </select>
          {field.showWhen?.fieldId && (
            <div className="grid grid-cols-2 gap-2">
              <select value={field.showWhen.op}
                onChange={(e) => update({ showWhen: { ...field.showWhen!, op: e.target.value as ShowWhenOp } })}
                className="px-2 py-1.5 rounded-lg border border-gray-300 text-sm">
                <option value="notEmpty">{tAttr('값 있음')}</option>
                <option value="eq">{tAttr('= 같음')}</option>
                <option value="ne">{tAttr('≠ 다름')}</option>
                <option value="gt">{tAttr('> 초과')}</option>
                <option value="lt">{tAttr('< 미만')}</option>
              </select>
              {field.showWhen.op !== 'notEmpty' && (
                <input value={field.showWhen.value ?? ''}
                  onChange={(e) => update({ showWhen: { ...field.showWhen!, value: e.target.value } })}
                  placeholder={tAttr('비교값')}
                  className="px-2 py-1.5 rounded-lg border border-gray-300 text-sm" />
              )}
            </div>
          )}
        </div>
      </div>

      {/*
        🔴 E5·E9 — 아래 셋은 **진료 화면 렌더러에 참조가 없다**(aiAssist·autoLoad 참조 0건,
        durCheck 는 배지만 그리고 DUR 호출이 없다). 켜도 아무 일이 일어나지 않으므로,
        기존 데이터는 보존하되 "동작하지 않는다"고 화면이 사실대로 말한다(P16).
      */}
      <div className="pt-2 border-t border-gray-100 space-y-2">
        <p className="text-xs font-semibold text-gray-400 uppercase"><T k="미구현 플래그" /></p>
        <p className="text-[10px] text-amber-600">
          <T k="아래 항목은 진료 화면 렌더러가 아직 사용하지 않습니다 — 켜도 동작이 달라지지 않습니다." />
        </p>
        <label className="flex items-center gap-2 text-xs text-gray-500">
          <input type="checkbox" checked={field.aiAssist ?? false}
            onChange={(e) => update({ aiAssist: e.target.checked })} className="rounded" />
          {AI_ORIGIN_TEXT} <T k="보조" /> <span className="text-[10px] text-gray-400"><T k="(미동작)" /></span>
        </label>
        <label className="flex items-center gap-2 text-xs text-gray-500">
          <input type="checkbox" checked={field.autoLoad ?? false}
            onChange={(e) => update({ autoLoad: e.target.checked })} className="rounded" />
          <T k="자동 로드" /> <span className="text-[10px] text-gray-400"><T k="(미동작)" /></span>
        </label>
        <label className="flex items-center gap-2 text-xs text-gray-500">
          <input type="checkbox" checked={field.durCheck ?? false}
            onChange={(e) => update({ durCheck: e.target.checked })} className="rounded" />
          <T k="DUR 체크" /> <span className="text-[10px] text-gray-400"><T k="(미동작 — 처방 패널에서만 DUR 검증)" /></span>
        </label>
      </div>

      <div className="pt-2 border-t border-gray-100">
        <p className="text-xs text-gray-400"><T k="타입:" /> <span className="font-medium text-gray-600">{field.type}</span></p>
        <p className="text-xs text-gray-400 mt-0.5">ID: <span className="font-mono text-gray-500">{field.id}</span></p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Version History Panel                                              */
/* ------------------------------------------------------------------ */
function VersionHistoryPanel({ templateId, currentSections, onRollback, onClose }: {
  templateId: string;
  currentSections: Section[];
  onRollback: (sections: Section[]) => void;
  onClose: () => void;
}) {
  const tAttr = useTAttr();
  const { data, isLoading } = useQuery({
    queryKey: ['chart-template-versions', templateId],
    queryFn: () => apiClient.get<{ data: TemplateVersion[] }>(`/api/v1/chart-templates/${templateId}/versions`),
    enabled: !!templateId,
  });

  const rollbackMut = useMutation({
    mutationFn: (versionId: string) =>
      apiClient.fetch(`/api/v1/chart-templates/${templateId}/rollback/${versionId}`, { method: 'POST' }),
    onSuccess: (_data, versionId) => {
      const version = versions.find((v) => v.id === versionId);
      if (version) onRollback(version.sections);
    },
  });

  const raw = data?.data;
  const versions: TemplateVersion[] = Array.isArray(raw) ? raw : (raw as Record<string, unknown> | undefined)?.data as TemplateVersion[] ?? [];

  const currentFieldCount = currentSections.reduce((acc, s) => acc + s.fields.length, 0);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full max-w-lg max-h-[80vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h3 className="font-bold text-gray-900"><T k="버전 이력" /></h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg">{'\u2715'}</button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {/* 현재 버전 (편집 중) */}
          <div className="px-4 py-3 rounded-xl border-2 border-blue-400 bg-blue-50">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs font-bold text-blue-700"><T k="현재 (편집 중)" /></span>
                <p className="text-[10px] text-blue-500 mt-0.5">{currentSections.length}<Unit>섹션</Unit> / {currentFieldCount}<Unit>필드</Unit></p>
              </div>
            </div>
          </div>

          {isLoading && <p className="text-xs text-gray-400 text-center py-4"><T k="로딩 중..." /></p>}

          {versions.length === 0 && !isLoading && (
            <EmptyState icon="📋" title="이전 버전이 없습니다." />
          )}

          {versions.map((ver) => {
            const verSections = (ver.sections ?? []) as Section[];
            const verFieldCount = verSections.reduce((acc: number, s: Section) => acc + (s.fields?.length ?? 0), 0);
            const sectionDiff = verSections.length - currentSections.length;
            const fieldDiff = verFieldCount - currentFieldCount;

            return (
              <div key={ver.id} className="px-4 py-3 rounded-xl border border-gray-200 hover:border-gray-300 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-gray-800">v{ver.version}</span>
                      <span className="text-[10px] text-gray-400">
                        {kdate(new Date(ver.createdAt), 'datetime')}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] text-gray-500">
                        {verSections.length}<Unit>섹션</Unit> / {verFieldCount}<Unit>필드</Unit>
                      </span>
                      {sectionDiff !== 0 && (
                        <span className={`text-[10px] ${sectionDiff > 0 ? 'text-red-500' : 'text-green-500'}`}>
                          ({sectionDiff > 0 ? '+' : ''}{sectionDiff}<Unit>섹션</Unit>)
                        </span>
                      )}
                      {fieldDiff !== 0 && (
                        <span className={`text-[10px] ${fieldDiff > 0 ? 'text-red-500' : 'text-green-500'}`}>
                          ({fieldDiff > 0 ? '+' : ''}{fieldDiff}<Unit>필드</Unit>)
                        </span>
                      )}
                    </div>
                    {ver.changeNote && (
                      <p className="text-[10px] text-gray-400 mt-0.5 truncate">{ver.changeNote}</p>
                    )}
                  </div>
                  <button
                    onClick={() => {
                      if (confirm(`v${ver.version}으로 복원하시겠습니까? 현재 상태는 자동 저장됩니다.`)) {
                        rollbackMut.mutate(ver.id);
                      }
                    }}
                    disabled={rollbackMut.isPending}
                    className="shrink-0 ml-3 px-3 py-1.5 text-xs font-medium bg-gray-100 text-gray-700 rounded-lg hover:bg-blue-50 hover:text-blue-600 transition-colors disabled:opacity-50"
                  >
                    {rollbackMut.isPending ? <T k="복원 중..." /> : <T k="복원" />}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  DnD 정렬 래퍼 — 모듈 스코프(react/no-unstable-nested-components 회피) */
/* ------------------------------------------------------------------ */
function SortableWrap({ id, children }: { id: string; children: (handleProps: Record<string, unknown>) => React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 }}>
      {children({ ...attributes, ...listeners })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  EditorView (Main)                                                  */
/* ------------------------------------------------------------------ */
export function EditorView({ initial, onBack }: { initial: ChartTemplate; onBack: () => void }) {
  const tAttr = useTAttr();
  const { names: deptOptions } = useDepartments({ category: 'CLINICAL' });
  const qc = useQueryClient();
  const [template, setTemplate] = useState<ChartTemplate>(initial);
  const [selectedField, setSelectedField] = useState<{ sectionId: string; fieldId: string } | null>(null);
  const [showPreview, setShowPreview] = useState(true);
  const [sectionSettingsId, setSectionSettingsId] = useState<string | null>(null);
  const [moveFieldState, setMoveFieldState] = useState<{ sectionId: string; fieldId: string } | null>(null);
  const [addFieldSectionId, setAddFieldSectionId] = useState<string | null>(null);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [showVersionHistory, setShowVersionHistory] = useState(false);

  const saveMut = useMutation({
    mutationFn: (t: ChartTemplate) =>
      t.id
        ? apiClient.fetch(`/api/v1/chart-templates/${t.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(t) })
        : apiClient.fetch('/api/v1/chart-templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(t) }).then((r: unknown) => { const res = r as { data: { id: string } }; setTemplate((prev) => ({ ...prev, id: res.data.id })); return r; }),
    onSuccess: () => {
      toast.success(tAttr('템플릿이 저장되었습니다.'));
      qc.invalidateQueries({ queryKey: ['chart-templates'] });
      qc.invalidateQueries({ queryKey: ['chart-templates-personal'] });
    },
    // 🔴 종전엔 저장 실패가 조용했다 — 계약 위반(한글 역할 등)으로 400 이 나도 화면은 아무 말이 없었다.
    onError: (err: unknown) => toast.error((err as { message?: string })?.message || tAttr('저장에 실패했습니다.')),
  });

  /* DnD 정렬 — 섹션(외부 컨텍스트)·필드(섹션별 중첩 컨텍스트). ▲▼ 버튼과 병행 */
  const dndSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const onSectionDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setTemplate((p) => {
      const from = p.sections.findIndex((s) => s.id === active.id);
      const to = p.sections.findIndex((s) => s.id === over.id);
      if (from < 0 || to < 0) return p;
      return { ...p, sections: arrayMove(p.sections, from, to) };
    });
  };
  const onFieldDragEnd = (sectionId: string) => (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setTemplate((p) => ({
      ...p,
      sections: p.sections.map((s) => {
        if (s.id !== sectionId) return s;
        const from = s.fields.findIndex((f) => f.id === active.id);
        const to = s.fields.findIndex((f) => f.id === over.id);
        if (from < 0 || to < 0) return s;
        return { ...s, fields: arrayMove(s.fields, from, to) };
      }),
    }));
  };

  /* Section operations */
  const addSection = () => setTemplate((p) => ({ ...p, sections: [...p.sections, { id: uid(), title: `섹션 ${p.sections.length + 1}`, fields: [], columns: 1, collapsible: false, defaultOpen: true }] }));
  const removeSection = (sid: string) => setTemplate((p) => ({ ...p, sections: p.sections.filter((s) => s.id !== sid) }));
  const updateSection = (sid: string, patch: Partial<Section>) => setTemplate((p) => ({ ...p, sections: p.sections.map((s) => s.id === sid ? { ...s, ...patch } : s) }));
  const moveSectionUp = (idx: number) => {
    if (idx === 0) return;
    setTemplate((p) => {
      const secs = [...p.sections];
      [secs[idx - 1], secs[idx]] = [secs[idx], secs[idx - 1]];
      return { ...p, sections: secs };
    });
  };
  const moveSectionDown = (idx: number) => {
    setTemplate((p) => {
      if (idx >= p.sections.length - 1) return p;
      const secs = [...p.sections];
      [secs[idx], secs[idx + 1]] = [secs[idx + 1], secs[idx]];
      return { ...p, sections: secs };
    });
  };
  const toggleCollapse = (sid: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sid)) next.delete(sid); else next.add(sid);
      return next;
    });
  };

  /* Field operations */
  const addFieldToSection = useCallback((sectionId: string, type: FieldType) => {
    const label = PALETTE.flatMap((g) => g.fields).find((f) => f.type === type)?.label ?? type;
    const newField: FieldDef = { id: uid(), type, label };
    setTemplate((p) => ({ ...p, sections: p.sections.map((s) => s.id === sectionId ? { ...s, fields: [...s.fields, newField] } : s) }));
  }, []);

  const removeField = (sectionId: string, fieldId: string) => {
    setTemplate((p) => ({ ...p, sections: p.sections.map((s) => s.id === sectionId ? { ...s, fields: s.fields.filter((f) => f.id !== fieldId) } : s) }));
    if (selectedField?.fieldId === fieldId) setSelectedField(null);
  };

  const moveFieldUp = (sectionId: string, idx: number) => {
    if (idx === 0) return;
    setTemplate((p) => ({
      ...p, sections: p.sections.map((s) => {
        if (s.id !== sectionId) return s;
        const fields = [...s.fields];
        [fields[idx - 1], fields[idx]] = [fields[idx], fields[idx - 1]];
        return { ...s, fields };
      }),
    }));
  };

  const moveFieldDown = (sectionId: string, idx: number) => {
    setTemplate((p) => ({
      ...p, sections: p.sections.map((s) => {
        if (s.id !== sectionId || idx >= s.fields.length - 1) return s;
        const fields = [...s.fields];
        [fields[idx], fields[idx + 1]] = [fields[idx + 1], fields[idx]];
        return { ...s, fields };
      }),
    }));
  };

  const moveFieldToSection = (fromSectionId: string, fieldId: string, toSectionId: string) => {
    setTemplate((p) => {
      let movedField: FieldDef | null = null;
      const sections = p.sections.map((s) => {
        if (s.id === fromSectionId) {
          movedField = s.fields.find((f) => f.id === fieldId) ?? null;
          return { ...s, fields: s.fields.filter((f) => f.id !== fieldId) };
        }
        return s;
      });
      if (!movedField) return p;
      const finalField = movedField;
      return {
        ...p,
        sections: sections.map((s) => s.id === toSectionId ? { ...s, fields: [...s.fields, finalField] } : s),
      };
    });
    if (selectedField?.fieldId === fieldId) setSelectedField(null);
  };

  const updateField = (sectionId: string, fieldId: string, patch: Partial<FieldDef>) => {
    setTemplate((p) => ({ ...p, sections: p.sections.map((s) => s.id === sectionId ? { ...s, fields: s.fields.map((f) => f.id === fieldId ? { ...f, ...patch } : f) } : s) }));
  };

  const selField = selectedField
    ? template.sections.find((s) => s.id === selectedField.sectionId)?.fields.find((f) => f.id === selectedField.fieldId) ?? null
    : null;

  const sectionForSettings = sectionSettingsId ? template.sections.find((s) => s.id === sectionSettingsId) : null;
  const moveFieldData = moveFieldState
    ? template.sections.find((s) => s.id === moveFieldState.sectionId)?.fields.find((f) => f.id === moveFieldState.fieldId)
    : null;

  const totalFields = template.sections.reduce((acc, s) => acc + s.fields.length, 0);

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 bg-white shrink-0">
        <button onClick={onBack} className="text-sm text-gray-500 hover:text-gray-800"><T k="← 목록" /></button>
        {template.isPersonal && <span className="text-[10px] bg-indigo-100 text-indigo-600 px-2 py-0.5 rounded-full"><T k="개인 템플릿" /></span>}
        <input value={template.name} onChange={(e) => setTemplate((p) => ({ ...p, name: e.target.value }))}
          className="flex-1 max-w-xs text-sm font-semibold bg-transparent border-b border-transparent hover:border-gray-300 focus:border-blue-500 focus:outline-none px-1" />
        <select value={template.department} onChange={(e) => setTemplate((p) => ({ ...p, department: e.target.value }))}
          className="text-xs border border-gray-300 rounded-lg px-2 py-1">
          {deptOptions.map((d) => <option key={d}>{d}</option>)}
        </select>
        {/* 🔴 E10 — 표시는 한글, 저장은 계약값(영문 코드). 한글로 저장하면 진료 화면 목록에 안 뜬다. */}
        <select value={template.role} onChange={(e) => setTemplate((p) => ({ ...p, role: e.target.value }))}
          className="text-xs border border-gray-300 rounded-lg px-2 py-1">
          {ROLE_OPTIONS.filter((r) => r.value !== '').map((r) => <option key={r.value} value={r.value}>{tAttr(r.label)}</option>)}
        </select>
        <select value={template.category ?? 'OUTPATIENT'} onChange={(e) => setTemplate((p) => ({ ...p, category: e.target.value }))}
          className="text-xs border border-gray-300 rounded-lg px-2 py-1">
          {CATEGORY_OPTIONS.map((c) => <option key={c.value} value={c.value}>{tAttr(c.label)}</option>)}
        </select>
        <select value={template.layout} onChange={(e) => setTemplate((p) => ({ ...p, layout: e.target.value as ChartTemplate['layout'] }))}
          className="text-xs border border-gray-300 rounded-lg px-2 py-1">
          {LAYOUT_OPTIONS.map((l) => <option key={l.value} value={l.value}>{tAttr(l.label)}</option>)}
        </select>
        <span className="text-[10px] text-gray-400">{template.sections.length}<Unit>섹션</Unit> {totalFields}<Unit>필드</Unit></span>
        <button onClick={() => setShowPreview((v) => !v)}
          className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${showPreview ? 'bg-gray-800 text-white border-gray-800' : 'border-gray-300 hover:bg-gray-50'}`}>
          {showPreview ? <T k="미리보기 숨김" /> : <T k="미리보기" />}
        </button>
        {template.id && (
          <button onClick={() => setShowVersionHistory(true)}
            className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-50 transition-colors">
            <T k="버전 이력" />
          </button>
        )}
        <button onClick={() => saveMut.mutate(template)} disabled={saveMut.isPending}
          className="text-xs px-4 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
          {saveMut.isPending ? <T k="저장 중..." /> : <T k="저장" />}
        </button>
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Palette */}
        <aside className="w-48 border-r border-gray-200 bg-gray-50 overflow-y-auto shrink-0">
          <div className="p-3 space-y-3">
            <p className="text-[10px] font-semibold text-gray-400 uppercase"><T k="필드 팔레트" /></p>
            {PALETTE.map((group) => (
              <div key={group.category}>
                <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1.5">{group.category}</p>
                <div className="space-y-1">
                  {group.fields.map((f) => (
                    <div key={f.type}
                      className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-white border border-gray-200 text-xs text-gray-700 cursor-default hover:border-blue-400 hover:bg-blue-50 select-none">
                      <span className="text-gray-400 text-[10px]">{'\u2807'}</span>
                      <span className="flex-1 truncate">{f.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </aside>

        {/* Center: Editor */}
        <main className={`flex-1 overflow-y-auto p-4 space-y-4 bg-gray-100 ${showPreview ? 'max-w-[50%]' : ''}`}>
          <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={onSectionDragEnd}>
          <SortableContext items={template.sections.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          {template.sections.map((section, sIdx) => {
            const isCollapsed = collapsedSections.has(section.id);
            return (
              <SortableWrap key={section.id} id={section.id}>
              {(sectionHandle) => (
              <div className="rounded-2xl bg-white border border-gray-200 overflow-hidden">
                {/* Section Header */}
                <div className="flex items-center gap-2 px-4 py-2 bg-gray-50 border-b border-gray-200">
                  <span {...sectionHandle} className="cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 text-sm select-none" title="\uB4DC\uB798\uADF8\uB85C \uC139\uC158 \uC21C\uC11C \uBCC0\uACBD">{'\u283F'}</span>
                  <button onClick={() => toggleCollapse(section.id)} className="text-xs text-gray-400 hover:text-gray-600 w-4">
                    {isCollapsed ? '\u25B6' : '\u25BC'}
                  </button>
                  {section.icon && SECTION_ICON_MAP[section.icon] && (
                    <span className="text-sm">{SECTION_ICON_MAP[section.icon]}</span>
                  )}
                  <input value={section.title}
                    onChange={(e) => updateSection(section.id, { title: e.target.value })}
                    className="flex-1 text-sm font-semibold bg-transparent focus:outline-none border-b border-transparent focus:border-blue-400" />
                  {section.columns && section.columns > 1 && (
                    <span className="text-[10px] bg-gray-200 text-gray-500 px-1.5 py-0.5 rounded">{section.columns}<Unit>열</Unit></span>
                  )}
                  <span className="text-[10px] text-gray-400">{section.fields.length}<Unit>필드</Unit></span>
                  <button onClick={() => moveSectionUp(sIdx)} disabled={sIdx === 0}
                    className="text-xs text-gray-400 hover:text-gray-600 disabled:opacity-30" title={tAttr('위로')}>{'\u25B2'}</button>
                  <button onClick={() => moveSectionDown(sIdx)} disabled={sIdx === template.sections.length - 1}
                    className="text-xs text-gray-400 hover:text-gray-600 disabled:opacity-30" title={tAttr('아래로')}>{'\u25BC'}</button>
                  <button onClick={() => setSectionSettingsId(section.id)}
                    className="text-xs text-gray-400 hover:text-blue-500" title={tAttr('섹션 설정')}>{'\u2699'}</button>
                  <button onClick={() => { if (confirm(`"${section.title}" 섹션을 삭제할까요?`)) removeSection(section.id); }}
                    className="text-xs text-red-400 hover:text-red-600" title={tAttr('섹션 삭제')}>{'\u2715'}</button>
                </div>

                {/* Section Body */}
                {!isCollapsed && (
                  <div className="p-3 space-y-2 min-h-[48px]">
                    {section.fields.length === 0 && (
                      <p className="text-xs text-gray-400 text-center py-4"><T k="필드를 추가하세요" /></p>
                    )}
                    <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={onFieldDragEnd(section.id)}>
                    <SortableContext items={section.fields.map((f) => f.id)} strategy={verticalListSortingStrategy}>
                    {section.fields.map((field, fIdx) => {
                      const isSelected = selectedField?.sectionId === section.id && selectedField?.fieldId === field.id;
                      return (
                        <SortableWrap key={field.id} id={field.id}>
                        {(fieldHandle) => (
                        <div
                          onClick={() => setSelectedField({ sectionId: section.id, fieldId: field.id })}
                          className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-sm cursor-pointer select-none transition-all ${isSelected ? 'ring-2 ring-blue-500 border-blue-400 bg-blue-50' : 'border-gray-200 bg-white hover:border-gray-300'}`}>
                          <span {...fieldHandle} onClick={(e) => e.stopPropagation()} className="cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 text-xs select-none shrink-0" title={tAttr('드래그로 필드 순서 변경')}>{'⠿'}</span>
                          <div className="flex flex-col gap-0.5 shrink-0">
                            <button onClick={(e) => { e.stopPropagation(); moveFieldUp(section.id, fIdx); }} disabled={fIdx === 0}
                              className="text-[10px] text-gray-300 hover:text-gray-600 disabled:opacity-30 leading-none">{'\u25B2'}</button>
                            <button onClick={(e) => { e.stopPropagation(); moveFieldDown(section.id, fIdx); }} disabled={fIdx === section.fields.length - 1}
                              className="text-[10px] text-gray-300 hover:text-gray-600 disabled:opacity-30 leading-none">{'\u25BC'}</button>
                          </div>
                          <div className="flex-1 min-w-0">
                            <span className="text-gray-800 font-medium">{field.label}</span>
                            {field.required && <span className="text-red-500 ml-0.5">*</span>}
                            <span className="ml-2 text-[10px] text-gray-400 bg-gray-100 px-1 py-0.5 rounded">{field.type}</span>
                            {effectiveSlot(field)
                              ? <span className="ml-1 text-[10px] bg-indigo-50 text-indigo-500 px-1 py-0.5 rounded">{SLOT_INITIAL[effectiveSlot(field)]}</span>
                              : <span className="ml-1 text-[10px] bg-amber-50 text-amber-600 px-1 py-0.5 rounded" title={tAttr('SOAP 미지정 — 객관적 소견(O)의 [SOAP 미지정] 블록에 저장')}><T k="O·미지정" /></span>}
                            {field.showWhen?.fieldId && <span className="ml-1 text-[10px] bg-purple-50 text-purple-500 px-1 py-0.5 rounded" title={tAttr('조건부 표시')}><T k="조건" /></span>}
                          </div>
                          <button onClick={(e) => { e.stopPropagation(); setMoveFieldState({ sectionId: section.id, fieldId: field.id }); }}
                            className="text-[10px] text-gray-300 hover:text-blue-500 shrink-0" title={tAttr('섹션 이동')}>{'\u21C4'}</button>
                          <button onClick={(e) => { e.stopPropagation(); removeField(section.id, field.id); }}
                            className="text-xs text-gray-300 hover:text-red-400 shrink-0">{'\u2715'}</button>
                        </div>
                        )}
                        </SortableWrap>
                      );
                    })}
                    </SortableContext>
                    </DndContext>

                    {/* Add field button */}
                    <div className="relative">
                      <button onClick={() => setAddFieldSectionId(addFieldSectionId === section.id ? null : section.id)}
                        className="w-full py-2 rounded-xl border border-dashed border-gray-300 text-xs text-gray-400 hover:border-blue-400 hover:text-blue-500 transition-colors">
                        <T k="+ 필드 추가" />
                      </button>
                      {addFieldSectionId === section.id && (
                        <AddFieldDropdown
                          onAdd={(type) => addFieldToSection(section.id, type)}
                          onClose={() => setAddFieldSectionId(null)}
                        />
                      )}
                    </div>
                  </div>
                )}
              </div>
              )}
              </SortableWrap>
            );
          })}
          </SortableContext>
          </DndContext>
          <button onClick={addSection}
            className="w-full py-3 rounded-2xl border-2 border-dashed border-gray-300 text-sm text-gray-400 hover:border-blue-400 hover:text-blue-500 transition-colors">
            <T k="+ 섹션 추가" />
          </button>
        </main>

        {/* Right: Preview or Properties */}
        {showPreview ? (
          <div className="flex-1 border-l border-gray-200 overflow-hidden flex flex-col">
            {/* Properties strip at top-right if a field is selected */}
            {selField && selectedField && (
              <div className="border-b border-gray-200 max-h-[45%] overflow-y-auto shrink-0">
                <FieldPropertiesPanel field={selField} sectionId={selectedField.sectionId} sections={template.sections} updateField={updateField} />
              </div>
            )}
            {/* Preview */}
            <div className="flex-1 overflow-y-auto bg-white p-4">
              <p className="text-[10px] font-semibold text-gray-400 uppercase mb-3"><T k="미리보기" /></p>
              <div className="border border-gray-200 rounded-xl p-4 bg-gray-50/50">
                <PreviewPanel template={template} />
              </div>
            </div>
          </div>
        ) : (
          /* Properties panel only */
          <aside className="w-72 border-l border-gray-200 bg-white overflow-y-auto shrink-0">
            {selField && selectedField ? (
              <FieldPropertiesPanel field={selField} sectionId={selectedField.sectionId} sections={template.sections} updateField={updateField} />
            ) : (
              <div className="p-4 text-center text-gray-400 text-xs mt-8">
                <p className="text-2xl mb-2">{'\uD83D\uDDB1'}</p>
                <T k="필드를 클릭하면 속성을 편집할 수 있습니다" />
              </div>
            )}
          </aside>
        )}
      </div>

      {/* Modals */}
      {sectionForSettings && sectionSettingsId && (
        <SectionSettingsModal
          section={sectionForSettings}
          onUpdate={(patch) => updateSection(sectionSettingsId, patch)}
          onClose={() => setSectionSettingsId(null)}
        />
      )}

      {moveFieldState && moveFieldData && (
        <MoveFieldModal
          sections={template.sections}
          currentSectionId={moveFieldState.sectionId}
          fieldLabel={moveFieldData.label}
          onMove={(targetId) => moveFieldToSection(moveFieldState.sectionId, moveFieldState.fieldId, targetId)}
          onClose={() => setMoveFieldState(null)}
        />
      )}

      {showVersionHistory && template.id && (
        <VersionHistoryPanel
          templateId={template.id}
          currentSections={template.sections}
          onRollback={(sections) => {
            setTemplate((p) => ({ ...p, sections }));
            setShowVersionHistory(false);
          }}
          onClose={() => setShowVersionHistory(false)}
        />
      )}
    </div>
  );
}
