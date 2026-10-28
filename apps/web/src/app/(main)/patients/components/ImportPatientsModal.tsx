'use client';

import { useState, useRef } from 'react';
import { Unit } from '@/components/ui/display';
import { useImportPatients } from '@/hooks/usePatients';
import { toast } from '@/stores/toast-store';
import { GENDER_LABEL, INSURANCE_LABEL } from '@hospital-run/shared';
import { T } from '@/components/ui/i18n-text';

export function ImportPatientsModal({ onClose }: { onClose: () => void }) {
  const [csvData, setCsvData] = useState<Record<string, string>[]>([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ created: number; skipped: number; errors: Array<{ index: number; reason: string }> } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importMut = useImportPatients();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
      if (lines.length < 2) {
        toast.warning('CSV 파일에 데이터가 없습니다.');
        return;
      }

      const headers = lines[0].split(',').map(h => h.trim());
      const rows = lines.slice(1).map(line => {
        const values = line.split(',').map(v => v.trim());
        const obj: Record<string, string> = {};
        headers.forEach((h, i) => { obj[h] = values[i] ?? ''; });
        return obj;
      });

      setCsvData(rows);
    };
    reader.readAsText(file);
  };

  const handleImport = async () => {
    if (csvData.length === 0) return;
    setImporting(true);

    const GENDER_MAP: Record<string, string> = { '남': 'MALE', '여': 'FEMALE', '남성': 'MALE', '여성': 'FEMALE', 'M': 'MALE', 'F': 'FEMALE' };

    // 🔴 A5: 백엔드 create 가 이미 받는 필드로 매핑 확장(주소·국적·언어·이메일). 🔴 주민번호는 보안상 일괄 제외 유지.
    const patients = csvData.map(row => ({
      familyName: row['성'] || row['familyName'] || row['성명']?.slice(0, 1) || '',
      givenName: row['이름'] || row['givenName'] || row['성명']?.slice(1) || '',
      dateOfBirth: row['생년월일'] || row['dateOfBirth'] || '',
      gender: GENDER_MAP[row['성별'] || row['gender'] || ''] || row['gender'] || 'UNKNOWN',
      phone: row['전화번호'] || row['phone'] || undefined,
      email: row['이메일'] || row['email'] || undefined,
      insuranceType: row['보험유형'] || row['insuranceType'] || 'NHI',
      address: (row['주소'] || row['address']) ? { line1: row['주소'] || row['address'] } : undefined,
      nationality: row['국적'] || row['nationality'] || undefined,
      preferredLanguage: row['언어'] || row['preferredLanguage'] || undefined,
    }));

    try {
      const res = await importMut.mutateAsync({ patients });
      type ImportResult = { created: number; skipped: number; errors: Array<{ index: number; reason: string }> };
      const data: ImportResult = ((res as unknown as { data?: ImportResult })?.data ?? res) as ImportResult;
      setResult(data);
      toast.success(`${data.created}명 등록, ${data.skipped}명 건너뜀`);
    } catch {
      toast.error('일괄 등록에 실패했습니다.');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="text-lg font-semibold text-gray-900"><T k="환자 일괄 가져오기 (CSV)" /></h3>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div className="text-xs text-gray-500 bg-gray-50 rounded-xl p-3">
            <p className="font-medium mb-1"><T k="CSV 형식 안내" /></p>
            <p>헤더(필수): 성, 이름, 생년월일, 성별 · 선택: 전화번호, 이메일, 보험유형, 주소, 국적, 언어 · 🔴 주민번호는 보안상 일괄 등록 제외</p>
            <p>예시: 홍,길동,1990-01-15,남,010-1234-5678,NHI</p>
          </div>

          <input type="file" ref={fileInputRef} accept=".csv" onChange={handleFileChange} className="hidden" />
          <button onClick={() => fileInputRef.current?.click()} className="px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors">
            <T k="CSV 파일 선택" />
          </button>

          {csvData.length > 0 && !result && (
            <>
              <p className="text-sm text-gray-600">{csvData.length}<Unit>건</Unit> <T k="미리보기" /></p>
              <div className="border border-gray-200 rounded-xl overflow-x-auto max-h-60">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>{Object.keys(csvData[0]).map(k => (<th key={k} className="px-3 py-2 text-left text-gray-500 font-medium">{k}</th>))}</tr>
                  </thead>
                  <tbody>
                    {csvData.slice(0, 10).map((row, i) => (
                      <tr key={i} className="border-b border-gray-50">{Object.values(row).map((v, j) => (<td key={j} className="px-3 py-2 text-gray-700">{v}</td>))}</tr>
                    ))}
                    {csvData.length > 10 && (<tr><td colSpan={Object.keys(csvData[0]).length} className="px-3 py-2 text-gray-400 text-center">...외 {csvData.length - 10}<Unit>건</Unit></td></tr>)}
                  </tbody>
                </table>
              </div>
              <button onClick={handleImport} disabled={importing} className="px-4 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors">
                {importing ? '등록 중...' : `${csvData.length}건 등록`}
              </button>
            </>
          )}

          {result && (
            <div className="space-y-2">
              <div className="flex gap-3">
                <div className="bg-emerald-50 rounded-xl p-3 flex-1 text-center"><p className="text-xs text-emerald-600"><T k="등록 완료" /></p><p className="text-xl font-bold text-emerald-700">{result.created}</p></div>
                <div className="bg-amber-50 rounded-xl p-3 flex-1 text-center"><p className="text-xs text-amber-600"><T k="건너뜀 (중복)" /></p><p className="text-xl font-bold text-amber-700">{result.skipped}</p></div>
                <div className="bg-red-50 rounded-xl p-3 flex-1 text-center"><p className="text-xs text-red-600"><T k="오류" /></p><p className="text-xl font-bold text-red-700">{result.errors.length}</p></div>
              </div>
              {result.errors.length > 0 && (
                <div className="bg-red-50 rounded-xl p-3 text-xs text-red-600 max-h-40 overflow-y-auto">
                  {result.errors.map((e, i) => (<p key={i}>행 {e.index + 1}: {e.reason}</p>))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
