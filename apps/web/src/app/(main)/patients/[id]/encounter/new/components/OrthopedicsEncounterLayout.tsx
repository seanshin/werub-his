'use client';

import type { ReactNode } from 'react';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import SkeletonDiagram, { type SkeletonMarker } from '@/components/specialty/SkeletonDiagram';
import { T, useTAttr } from '@/components/ui/i18n-text';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface OrthopedicsEncounterLayoutProps {
  /** 처방 열(페이지가 넘긴다) — 서명 바 위에 그린다. 종전엔 진료과 레이아웃에 처방 입력이 없었다 */
  rxSlot?: ReactNode;
  patientId: string;
  encounterId: string | null;
  onStartEncounter: () => void;
  patient: { familyName?: string; givenName?: string; mrn?: string };
  onSaveDraft: (data?: { subjective?: string; objective?: string; assessment?: string; plan?: string }) => void;
  onSignAndBill: (data?: { subjective?: string; objective?: string; assessment?: string; plan?: string }) => void;
  isSaving: boolean;
  isSigning: boolean;
}

interface RomEntry {
  movement: string;
  measured: string;
  normal: string;
}

interface MmtEntry {
  muscle: string;
  grade: string;
}

interface SpecialTest {
  name: string;
  result: '+' | '-' | '';
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const BODY_PARTS = [
  '어깨', '팔꿈치', '손목', '고관절', '무릎', '발목', '경추', '흉추', '요추',
];

const ROM_TEMPLATES: Record<string, { movement: string; normal: string }[]> = {
  '어깨': [
    { movement: '굴곡 (Flexion)', normal: '180' },
    { movement: '신전 (Extension)', normal: '60' },
    { movement: '외전 (Abduction)', normal: '180' },
    { movement: '내회전 (IR)', normal: '70' },
    { movement: '외회전 (ER)', normal: '90' },
  ],
  '무릎': [
    { movement: '굴곡 (Flexion)', normal: '135' },
    { movement: '신전 (Extension)', normal: '0' },
  ],
  '고관절': [
    { movement: '굴곡 (Flexion)', normal: '120' },
    { movement: '신전 (Extension)', normal: '30' },
    { movement: '외전 (Abduction)', normal: '45' },
    { movement: '내전 (Adduction)', normal: '30' },
    { movement: '내회전 (IR)', normal: '35' },
    { movement: '외회전 (ER)', normal: '45' },
  ],
  '발목': [
    { movement: '배굴 (Dorsiflexion)', normal: '20' },
    { movement: '저굴 (Plantar flexion)', normal: '50' },
    { movement: '내번 (Inversion)', normal: '35' },
    { movement: '외번 (Eversion)', normal: '25' },
  ],
  '팔꿈치': [
    { movement: '굴곡 (Flexion)', normal: '150' },
    { movement: '신전 (Extension)', normal: '0' },
    { movement: '회내 (Pronation)', normal: '80' },
    { movement: '회외 (Supination)', normal: '80' },
  ],
  '손목': [
    { movement: '굴곡 (Flexion)', normal: '80' },
    { movement: '신전 (Extension)', normal: '70' },
    { movement: '요측편향 (Radial)', normal: '20' },
    { movement: '척측편향 (Ulnar)', normal: '30' },
  ],
  '경추': [
    { movement: '굴곡 (Flexion)', normal: '45' },
    { movement: '신전 (Extension)', normal: '45' },
    { movement: '회전 (Rotation)', normal: '80' },
    { movement: '측굴 (Lateral)', normal: '45' },
  ],
  '흉추': [
    { movement: '굴곡 (Flexion)', normal: '40' },
    { movement: '회전 (Rotation)', normal: '30' },
  ],
  '요추': [
    { movement: '굴곡 (Flexion)', normal: '60' },
    { movement: '신전 (Extension)', normal: '25' },
    { movement: '측굴 (Lateral)', normal: '25' },
    { movement: '회전 (Rotation)', normal: '30' },
  ],
};

const MMT_MUSCLES: Record<string, string[]> = {
  '어깨': ['삼각근', '극상근', '극하근', '이두근', '삼두근'],
  '무릎': ['대퇴사두근', '햄스트링', '내전근'],
  '고관절': ['장요근', '대둔근', '중둔근', '내전근군'],
  '발목': ['전경골근', '비복근', '비골근'],
  '팔꿈치': ['이두근', '삼두근', '완요골근'],
  '손목': ['요측수근신전근', '척측수근굴곡근'],
  '경추': ['경부 굴곡근', '경부 신전근'],
  '흉추': ['승모근', '능형근'],
  '요추': ['복직근', '요방형근', '척추기립근'],
};

const SPECIAL_TESTS: Record<string, string[]> = {
  '어깨': ['Neer test', 'Hawkins test', 'Speed test', 'Empty can test', 'Drop arm test'],
  '무릎': ['McMurray test', 'Lachman test', 'Anterior drawer', 'Posterior drawer', 'Valgus stress', 'Varus stress'],
  '고관절': ['Patrick test', 'Thomas test', 'Trendelenburg test', 'Ober test'],
  '발목': ['Anterior drawer', 'Talar tilt', 'Thompson test'],
  '팔꿈치': ['Cozen test', 'Mill test', 'Tinel sign'],
  '손목': ['Phalen test', 'Tinel sign', 'Finkelstein test'],
  '경추': ['Spurling test', 'Jackson test', 'Lhermitte sign'],
  '흉추': ['Slump test'],
  '요추': ['SLR test', 'Lasegue test', 'Bragard test', 'Patrick test', 'Schober test'],
};

const MMT_GRADES = ['0', '1', '2', '3', '4', '5'];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function OrthopedicsEncounterLayout({
  patientId,
  encounterId,
  onStartEncounter: _onStartEncounter,
  patient: _patient,
  onSaveDraft,
  onSignAndBill,
  isSaving,
  isSigning,
  rxSlot,
}: OrthopedicsEncounterLayoutProps) {
  const tAttr = useTAttr();
  const [bodyPart, setBodyPart] = useState('');
  const [side, setSide] = useState<'LEFT' | 'RIGHT' | 'BILATERAL'>('LEFT');
  const [romEntries, setRomEntries] = useState<RomEntry[]>([]);
  const [mmtEntries, setMmtEntries] = useState<MmtEntry[]>([]);
  const [specialTests, setSpecialTests] = useState<SpecialTest[]>([]);
  const [painVas, setPainVas] = useState(0);
  const [skeletonView, setSkeletonView] = useState<'front' | 'back'>('front');
  const [selectedJoint, setSelectedJoint] = useState<string | null>(null);
  const [markers] = useState<SkeletonMarker[]>([]);
  const [findings, setFindings] = useState('');

  const handleBodyPartChange = (part: string) => {
    setBodyPart(part);
    const romTmpl = ROM_TEMPLATES[part] ?? [];
    setRomEntries(romTmpl.map((t) => ({ movement: t.movement, measured: '', normal: t.normal })));
    const muscles = MMT_MUSCLES[part] ?? [];
    setMmtEntries(muscles.map((m) => ({ muscle: m, grade: '5' })));
    const tests = SPECIAL_TESTS[part] ?? [];
    setSpecialTests(tests.map((t) => ({ name: t, result: '' })));
  };

  const updateRom = (idx: number, measured: string) => {
    setRomEntries((prev) => prev.map((r, i) => (i === idx ? { ...r, measured } : r)));
  };

  const updateMmt = (idx: number, grade: string) => {
    setMmtEntries((prev) => prev.map((m, i) => (i === idx ? { ...m, grade } : m)));
  };

  const toggleSpecialTest = (idx: number) => {
    setSpecialTests((prev) =>
      prev.map((t, i) => {
        if (i !== idx) return t;
        const next = t.result === '' ? '+' : t.result === '+' ? '-' : '';
        return { ...t, result: next };
      }),
    );
  };

  const saveMutation = useMutation({
    mutationFn: () =>
      // 🔴 `findings` 를 여기로 보내면 **전역 whitelist 가 조용히 지운다** — `ortho_exams` 에는
      //    `imaging_findings`(영상 소견) 밖에 없고, 이 칸은 영상 소견이 아니라 진찰 소견이다.
      //    영상 소견 컬럼에 진찰 소견을 담으면 나중에 읽는 사람이 판독문으로 오독한다.
      //    → 소견은 SOAP 객관(objective)으로 기록한다(buildSoap). 비뇨의학과와 같은 규약.
      apiClient.post('/api/v1/orthopedics/exams', {
        patientId,
        encounterId,
        bodyPart,
        side,
        rom: romEntries,
        mmt: mmtEntries,
        specialTests,
        painVas,
      }),
    onSuccess: () => toast.success('정형외과 검사가 저장되었습니다.'),
    onError: () => toast.error('저장에 실패했습니다.'),
  });

  const buildSoap = (): { subjective?: string; objective?: string; assessment?: string; plan?: string } => ({
    objective: findings || undefined,
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left: Skeleton Diagram */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0" />
            </svg>
            <T k="골격 다이어그램" />
          </h3>

          <div className="flex justify-center gap-2 mb-2">
            <button
              onClick={() => setSkeletonView('front')}
              className={`px-3 py-1 text-xs rounded-lg ${skeletonView === 'front' ? 'bg-blue-100 text-blue-700 font-medium' : 'bg-gray-100 text-gray-500'}`}
            >
              <T k="앞면" />
            </button>
            <button
              onClick={() => setSkeletonView('back')}
              className={`px-3 py-1 text-xs rounded-lg ${skeletonView === 'back' ? 'bg-blue-100 text-blue-700 font-medium' : 'bg-gray-100 text-gray-500'}`}
            >
              <T k="뒷면" />
            </button>
          </div>

          <SkeletonDiagram
            selectedPart={selectedJoint}
            onPartClick={setSelectedJoint}
            markers={markers}
            view={skeletonView}
          />
        </div>

        {/* Right: Exam Form */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08" />
            </svg>
            <T k="정형외과 검사" />
          </h3>

          {/* Body Part + Side Selectors */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="부위" /></label>
              <select
                value={bodyPart}
                onChange={(e) => handleBodyPartChange(e.target.value)}
                disabled={!encounterId}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50"
              >
                <option value=""><T k="부위 선택..." /></option>
                {BODY_PARTS.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="측면" /></label>
              <select
                value={side}
                onChange={(e) => setSide(e.target.value as 'LEFT' | 'RIGHT' | 'BILATERAL')}
                disabled={!encounterId}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50"
              >
                <option value="LEFT"><T k="좌측 (LEFT)" /></option>
                <option value="RIGHT"><T k="우측 (RIGHT)" /></option>
                <option value="BILATERAL"><T k="양측 (BILATERAL)" /></option>
              </select>
            </div>
          </div>

          {/* Pain VAS */}
          <div>
            <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="통증 VAS (0-10)" /></label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={0}
                max={10}
                value={painVas}
                onChange={(e) => setPainVas(Number(e.target.value))}
                disabled={!encounterId}
                className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-red-500"
              />
              <span className={`text-sm font-bold min-w-[2rem] text-center ${painVas >= 7 ? 'text-red-600' : painVas >= 4 ? 'text-yellow-600' : 'text-green-600'}`}>
                {painVas}
              </span>
            </div>
          </div>

          {/* ROM Table */}
          {romEntries.length > 0 && (
            <div>
              <label className="block text-[11px] font-medium text-gray-500 mb-2 uppercase tracking-wide"><T k="ROM (관절가동범위)" /></label>
              <div className="border border-gray-200 rounded-xl overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="text-left px-3 py-2 font-medium text-gray-500"><T k="동작" /></th>
                      <th className="text-center px-3 py-2 font-medium text-gray-500 w-20"><T k="측정값" /></th>
                      <th className="text-center px-3 py-2 font-medium text-gray-500 w-16"><T k="정상" /></th>
                    </tr>
                  </thead>
                  <tbody>
                    {romEntries.map((r, i) => (
                      <tr key={i} className="border-t border-gray-100">
                        <td className="px-3 py-2 text-gray-700">{r.movement}</td>
                        <td className="px-3 py-2 text-center">
                          <input
                            type="number"
                            value={r.measured}
                            onChange={(e) => updateRom(i, e.target.value)}
                            disabled={!encounterId}
                            className="w-16 px-2 py-1 border border-gray-200 rounded text-center text-xs focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
                            placeholder="°"
                          />
                        </td>
                        <td className="px-3 py-2 text-center text-gray-400">{r.normal}°</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* MMT Table */}
          {mmtEntries.length > 0 && (
            <div>
              <label className="block text-[11px] font-medium text-gray-500 mb-2 uppercase tracking-wide"><T k="MMT (도수근력검사)" /></label>
              <div className="border border-gray-200 rounded-xl overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="text-left px-3 py-2 font-medium text-gray-500"><T k="근육군" /></th>
                      <th className="text-center px-3 py-2 font-medium text-gray-500 w-20">Grade</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mmtEntries.map((m, i) => (
                      <tr key={i} className="border-t border-gray-100">
                        <td className="px-3 py-2 text-gray-700">{m.muscle}</td>
                        <td className="px-3 py-2 text-center">
                          <select
                            value={m.grade}
                            onChange={(e) => updateMmt(i, e.target.value)}
                            disabled={!encounterId}
                            className="w-16 px-2 py-1 border border-gray-200 rounded text-center text-xs focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
                          >
                            {MMT_GRADES.map((g) => (
                              <option key={g} value={g}>{g}</option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Special Tests */}
          {specialTests.length > 0 && (
            <div>
              <label className="block text-[11px] font-medium text-gray-500 mb-2 uppercase tracking-wide"><T k="특수 검사" /></label>
              <div className="grid grid-cols-2 gap-2">
                {specialTests.map((t, i) => (
                  <button
                    key={i}
                    onClick={() => toggleSpecialTest(i)}
                    disabled={!encounterId}
                    className={`flex items-center justify-between px-3 py-2 rounded-lg border text-xs transition-colors disabled:opacity-50 ${
                      t.result === '+' ? 'bg-red-50 border-red-200 text-red-700' :
                      t.result === '-' ? 'bg-green-50 border-green-200 text-green-700' :
                      'bg-white border-gray-200 text-gray-600'
                    }`}
                  >
                    <span>{t.name}</span>
                    <span className="font-bold">{t.result || '—'}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Findings */}
          <div>
            <label className="block text-[11px] font-medium text-gray-500 mb-1">
              <T k="소견" /> <span className="font-normal text-gray-400">— 아래 &lsquo;저장 (임시)&rsquo;·&lsquo;서명 완료&rsquo; 시 SOAP 객관 소견으로 기록됩니다(검사 기록에는 담기지 않습니다)</span>
            </label>
            <textarea
              rows={3}
              value={findings}
              onChange={(e) => setFindings(e.target.value)}
              placeholder={tAttr("검사 소견을 입력하세요...")}
              disabled={!encounterId}
              className="w-full px-3 py-3 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none disabled:bg-gray-50 placeholder:text-gray-300"
            />
          </div>

          {/* Save exam button */}
          <button
            onClick={() => saveMutation.mutate()}
            disabled={!encounterId || !bodyPart || saveMutation.isPending}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-40"
          >
            {saveMutation.isPending ? '저장중...' : '검사 기록 저장'}
          </button>
        </div>
      </div>

      {rxSlot}

      {/* Bottom Action Bar */}
      <div className="sticky bottom-0 z-20 bg-white/95 backdrop-blur rounded-2xl shadow-[0_-6px_16px_-8px_rgba(15,23,42,0.15)] border border-gray-100 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
            </svg>
            VAS {painVas}/10 | {bodyPart || '부위 미선택'} ({side})
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => onSaveDraft(buildSoap())}
              disabled={!encounterId || isSaving}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-gray-100 text-gray-700 text-sm font-medium rounded-xl hover:bg-gray-200 transition-colors disabled:opacity-40"
            >
              <T k="저장 (임시)" />
            </button>
            <button
              onClick={() => onSignAndBill(buildSoap())}
              disabled={!encounterId || isSigning}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-40"
            >
              {isSigning ? '처리중...' : '서명 완료'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
