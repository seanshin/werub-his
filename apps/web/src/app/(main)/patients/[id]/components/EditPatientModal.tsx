'use client';
import { ReasonInput, reasonFilled } from '@/components/ui/ReasonInput';

import { useState, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useUpdatePatient, usePatientContacts, useCreateContact, useDeleteContact, useUploadPhoto } from '@/hooks/usePatients';
import { toast } from '@/stores/toast-store';
import { TAG_COLORS, DEFAULT_TAG_COLOR, SUGGESTED_TAGS, RELATIONSHIP_OPTIONS, RELATIONSHIP_LABEL, MARITAL_STATUS_OPTIONS, NATIONALITY_OPTIONS, LANGUAGE_OPTIONS } from '@/lib/patient-constants';
import type { PatientContact } from '@/types/patient';

import { EmptyState } from '@/components/ui/display';
import { T, useTAttr } from '@/components/ui/i18n-text';

const EDIT_TABS = [
  { key: 'basic', label: '기본정보' },
  { key: 'contact', label: '연락처@섹션' },
  { key: 'guardian', label: '보호자' },
  { key: 'medical', label: '의료정보' },
  { key: 'admin', label: '관리' },
] as const;
type EditTabKey = (typeof EDIT_TABS)[number]['key'];

function ModalField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1"><T k={label} /></label>
      {children}
    </div>
  );
}

function PhotoUploadSection({ patientId, currentPhotoUrl }: { patientId: string; currentPhotoUrl?: string }) {
  const tAttr = useTAttr();
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadMut = useUploadPhoto();

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast.error('파일 크기는 2MB 이하여야 합니다.');
      return;
    }
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      toast.error('JPEG/PNG 파일만 업로드 가능합니다.');
      return;
    }
    try {
      await uploadMut.mutateAsync({ patientId, file });
      toast.success('사진이 업로드되었습니다.');
    } catch {
      toast.error('사진 업로드에 실패했습니다.');
    }
  };

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2"><T k="환자 사진" /></label>
      <div className="flex items-center gap-4">
        {currentPhotoUrl ? (
          <img
            src={`${process.env.NEXT_PUBLIC_API_URL || ''}${currentPhotoUrl}`}
            alt={tAttr('환자 사진')}
            className="w-16 h-16 rounded-xl object-cover border border-gray-200"
          />
        ) : (
          <div className="w-16 h-16 rounded-xl bg-gray-100 flex items-center justify-center text-gray-400">
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" /></svg>
          </div>
        )}
        <div>
          <input type="file" ref={fileRef} accept="image/jpeg,image/png" onChange={handleUpload} className="hidden" />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploadMut.isPending}
            className="px-4 py-2 text-sm font-medium bg-blue-50 text-blue-700 rounded-xl hover:bg-blue-100 disabled:opacity-50 transition-colors"
          >
            {uploadMut.isPending ? <T k="업로드 중..." /> : <T k="사진 업로드" />}
          </button>
          <p className="text-[11px] text-gray-400 mt-1"><T k="JPEG/PNG, 최대 2MB" /></p>
        </div>
      </div>
    </div>
  );
}

interface EditPatientModalProps {
  patient: Record<string, any>;
  patientId: string;
  onClose: () => void;
}

export function EditPatientModal({ patient, patientId, onClose }: EditPatientModalProps) {
  const tAttr = useTAttr();
  const [editTab, setEditTab] = useState<EditTabKey>('basic');
  const [changeReason, setChangeReason] = useState('');
  const updatePatient = useUpdatePatient();
  const { data: contactsData } = usePatientContacts(patientId);
  const createContactMut = useCreateContact();
  const deleteContactMut = useDeleteContact();
  const qc = useQueryClient();

  const _allergies: string[] = typeof patient.allergies === 'string' ? JSON.parse(patient.allergies || '[]') : (patient.allergies ?? []);
  const _patientTags: string[] = Array.isArray(patient.tags) ? patient.tags : [];
  const _contactsRaw = contactsData?.data;
  const contactsList: PatientContact[] = Array.isArray(_contactsRaw) ? _contactsRaw : (_contactsRaw as Record<string, unknown> | undefined)?.data as PatientContact[] ?? (patient.contacts as PatientContact[] ?? []);

  const [formData, setFormData] = useState({
    familyName: patient.familyName ?? '',
    givenName: patient.givenName ?? '',
    dateOfBirth: patient.dateOfBirth?.slice(0, 10) ?? '',
    gender: patient.gender ?? 'MALE',
    nationality: patient.nationality ?? '대한민국',
    preferredLanguage: patient.preferredLanguage ?? '한국어',
    insuranceType: patient.insuranceType ?? 'NHI',
    insuranceNumber: patient.insuranceNumber ?? '',
    phone: patient.phone ?? '',
    email: patient.email ?? '',
    address: typeof patient.address === 'string' ? patient.address : '',
    bloodType: patient.bloodType ?? '',
    religion: patient.religion ?? '',
    occupation: patient.occupation ?? '',
    smokingStatus: patient.smokingStatus ?? '',
    maritalStatus: patient.maritalStatus ?? '',
    allergiesText: _allergies.join(', '),
    memo: patient.memo ?? '',
    tags: [..._patientTags],
  });

  const [newContact, setNewContact] = useState({
    name: '',
    relationship: 'SPOUSE',
    phone: '',
    isEmergencyContact: false,
    isLegalGuardian: false,
    isPrimaryContact: false,
  });
  const [showAddContact, setShowAddContact] = useState(false);

  const updateField = (field: string, value: string | boolean | string[]) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const toggleTag = (tag: string) => {
    setFormData((prev) => ({
      ...prev,
      tags: prev.tags.includes(tag)
        ? prev.tags.filter((t) => t !== tag)
        : [...prev.tags, tag],
    }));
  };

  const handleSave = async () => {
    if (editTab === 'basic' && !reasonFilled(changeReason)) {
      toast.warning('기본정보 변경 시 변경 사유를 입력해주세요.');
      return;
    }

    const allergiesArray = formData.allergiesText
      ? formData.allergiesText.split(',').map((s) => s.trim()).filter(Boolean)
      : [];

    try {
      await updatePatient.mutateAsync({
        id: patientId,
        data: {
          familyName: formData.familyName,
          givenName: formData.givenName,
          dateOfBirth: formData.dateOfBirth,
          gender: formData.gender,
          nationality: formData.nationality,
          preferredLanguage: formData.preferredLanguage,
          insuranceType: formData.insuranceType,
          insuranceNumber: formData.insuranceNumber || undefined,
          phone: formData.phone || undefined,
          email: formData.email || undefined,
          address: formData.address || undefined,
          bloodType: formData.bloodType || undefined,
          religion: formData.religion || undefined,
          occupation: formData.occupation || undefined,
          smokingStatus: formData.smokingStatus || undefined,
          maritalStatus: formData.maritalStatus || undefined,
          allergies: allergiesArray,
          memo: formData.memo || undefined,
          tags: formData.tags,
          changeReason: changeReason || undefined,
        },
      });
      toast.success('환자 정보가 수정되었습니다.');
      onClose();
    } catch {
      toast.error('수정에 실패했습니다.');
    }
  };

  const handleAddContact = async () => {
    if (!newContact.name || !newContact.phone) {
      toast.warning('이름과 전화번호를 입력해주세요.');
      return;
    }
    try {
      await createContactMut.mutateAsync({ patientId, data: newContact });
      toast.success('보호자가 추가되었습니다.');
      setNewContact({ name: '', relationship: 'SPOUSE', phone: '', isEmergencyContact: false, isLegalGuardian: false, isPrimaryContact: false });
      setShowAddContact(false);
    } catch {
      toast.error('보호자 추가에 실패했습니다.');
    }
  };

  const handleDeleteContact = async (contactId: string) => {
    if (!confirm('이 보호자를 삭제하시겠습니까?')) return;
    try {
      await deleteContactMut.mutateAsync({ patientId, contactId });
      toast.success('보호자가 삭제되었습니다.');
    } catch {
      toast.error('삭제에 실패했습니다.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="text-lg font-semibold text-gray-900"><T k="환자 정보 편집" /></h3>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tab Bar */}
        <div className="flex gap-1 px-6 pt-3 border-b border-gray-100">
          {EDIT_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setEditTab(tab.key)}
              className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
                editTab === tab.key
                  ? 'bg-blue-50 text-blue-700 border-b-2 border-blue-600'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}
            >
              <T k={tab.label} />
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {editTab === 'basic' && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <ModalField label="성 *">
                  <input value={formData.familyName} onChange={(e) => updateField('familyName', e.target.value)} className="modal-input" />
                </ModalField>
                <ModalField label="이름 *">
                  <input value={formData.givenName} onChange={(e) => updateField('givenName', e.target.value)} className="modal-input" />
                </ModalField>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <ModalField label="생년월일 *">
                  <input type="date" value={formData.dateOfBirth} onChange={(e) => updateField('dateOfBirth', e.target.value)} className="modal-input" />
                </ModalField>
                <ModalField label="성별 *">
                  <select value={formData.gender} onChange={(e) => updateField('gender', e.target.value)} className="modal-input">
                    <option value="MALE">{tAttr('남성')}</option>
                    <option value="FEMALE">{tAttr('여성')}</option>
                    <option value="OTHER">{tAttr('기타')}</option>
                    <option value="UNKNOWN">{tAttr('미상')}</option>
                  </select>
                </ModalField>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <ModalField label="국적">
                  <select value={formData.nationality} onChange={(e) => updateField('nationality', e.target.value)} className="modal-input">
                    {NATIONALITY_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </ModalField>
                <ModalField label="선호 언어">
                  <select value={formData.preferredLanguage} onChange={(e) => updateField('preferredLanguage', e.target.value)} className="modal-input">
                    {LANGUAGE_OPTIONS.map((l) => <option key={l} value={l}>{l}</option>)}
                  </select>
                </ModalField>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <ModalField label="보험 유형 *">
                  <select value={formData.insuranceType} onChange={(e) => updateField('insuranceType', e.target.value)} className="modal-input">
                    <option value="NHI">{tAttr('국민건강보험')}</option>
                    <option value="MEDICAID">{tAttr('의료급여')}</option>
                    <option value="INDUSTRIAL">{tAttr('산재보험')}</option>
                    <option value="AUTO">{tAttr('자동차보험')}</option>
                    <option value="SELF_PAY">{tAttr('비급여(자비)')}</option>
                  </select>
                </ModalField>
                <ModalField label="보험증번호">
                  <input value={formData.insuranceNumber} onChange={(e) => updateField('insuranceNumber', e.target.value)} className="modal-input" />
                </ModalField>
              </div>
              <div className="pt-3 border-t border-gray-100">
                <ModalField label="변경 사유 *">
                  <ReasonInput domain="patientEdit" required
                    value={changeReason}
                    onChange={setChangeReason}
                    placeholder={tAttr('기본정보 변경 사유를 입력해주세요')}
                    className="modal-input"
                  />
                </ModalField>
              </div>
            </>
          )}

          {editTab === 'contact' && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <ModalField label="전화번호">
                  <input value={formData.phone} onChange={(e) => updateField('phone', e.target.value)} placeholder="010-0000-0000" className="modal-input" />
                </ModalField>
                <ModalField label="이메일">
                  <input type="email" value={formData.email} onChange={(e) => updateField('email', e.target.value)} placeholder="hong@example.com" className="modal-input" />
                </ModalField>
              </div>
              <ModalField label="주소">
                <input value={formData.address} onChange={(e) => updateField('address', e.target.value)} placeholder="서울시 강남구 역삼동 123-45" className="modal-input" />
              </ModalField>
            </>
          )}

          {editTab === 'guardian' && (
            <>
              {contactsList.length === 0 && !showAddContact ? (
                <EmptyState icon="👤" title="등록된 보호자가 없습니다." />
              ) : (
                <div className="space-y-3">
                  {contactsList.map((c: PatientContact) => (
                    <div key={c.id} className="border border-gray-100 rounded-xl p-4 flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-medium text-gray-900">{c.name}</span>
                          <span className="text-xs text-gray-500">({RELATIONSHIP_LABEL[c.relationship] ?? c.relationship})</span>
                          {c.isPrimaryContact && <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-700"><T k="주보호자" /></span>}
                          {c.isEmergencyContact && <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-red-50 text-red-700"><T k="응급" /></span>}
                          {c.isLegalGuardian && <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-purple-50 text-purple-700"><T k="법정대리인" /></span>}
                        </div>
                        <p className="text-xs text-gray-500">{c.phone}</p>
                      </div>
                      <button
                        onClick={() => handleDeleteContact(c.id)}
                        className="text-xs text-red-500 hover:text-red-700"
                      >
                        <T k="삭제" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {showAddContact ? (
                <div className="border border-blue-200 rounded-xl p-4 space-y-3 bg-blue-50/30">
                  <h4 className="text-sm font-medium text-gray-900"><T k="보호자 추가" /></h4>
                  <div className="grid grid-cols-3 gap-3">
                    <ModalField label="이름">
                      <input value={newContact.name} onChange={(e) => setNewContact((p) => ({ ...p, name: e.target.value }))} className="modal-input" />
                    </ModalField>
                    <ModalField label="관계">
                      <select value={newContact.relationship} onChange={(e) => setNewContact((p) => ({ ...p, relationship: e.target.value }))} className="modal-input">
                        {RELATIONSHIP_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                      </select>
                    </ModalField>
                    <ModalField label="전화번호">
                      <input value={newContact.phone} onChange={(e) => setNewContact((p) => ({ ...p, phone: e.target.value }))} className="modal-input" />
                    </ModalField>
                  </div>
                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                      <input type="checkbox" checked={newContact.isEmergencyContact} onChange={(e) => setNewContact((p) => ({ ...p, isEmergencyContact: e.target.checked }))} className="rounded border-gray-300" />
                      <T k="응급연락처" />
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                      <input type="checkbox" checked={newContact.isLegalGuardian} onChange={(e) => setNewContact((p) => ({ ...p, isLegalGuardian: e.target.checked }))} className="rounded border-gray-300" />
                      <T k="법정대리인" />
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                      <input type="checkbox" checked={newContact.isPrimaryContact} onChange={(e) => setNewContact((p) => ({ ...p, isPrimaryContact: e.target.checked }))} className="rounded border-gray-300" />
                      <T k="주보호자" />
                    </label>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={handleAddContact} disabled={createContactMut.isPending} className="px-4 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                      {createContactMut.isPending ? <T k="추가 중..." /> : <T k="추가" />}
                    </button>
                    <button onClick={() => setShowAddContact(false)} className="px-4 py-1.5 text-xs font-medium bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200">
                      <T k="취소" />
                    </button>
                  </div>
                </div>
              ) : (
                contactsList.length < 5 && (
                  <button
                    onClick={() => setShowAddContact(true)}
                    className="w-full py-2.5 border-2 border-dashed border-gray-200 rounded-xl text-sm text-gray-400 hover:border-blue-300 hover:text-blue-500 transition-colors"
                  >
                    + <T k="보호자 추가" />
                  </button>
                )
              )}
            </>
          )}

          {editTab === 'medical' && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <ModalField label="혈액형">
                  <select value={formData.bloodType} onChange={(e) => updateField('bloodType', e.target.value)} className="modal-input">
                    <option value="">{tAttr('선택')}</option>
                    {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((bt) => <option key={bt} value={bt}>{bt}</option>)}
                  </select>
                </ModalField>
                <ModalField label="종교">
                  <input value={formData.religion} onChange={(e) => updateField('religion', e.target.value)} className="modal-input" />
                </ModalField>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <ModalField label="직업">
                  <input value={formData.occupation} onChange={(e) => updateField('occupation', e.target.value)} className="modal-input" />
                </ModalField>
                <ModalField label="결혼상태">
                  <select value={formData.maritalStatus} onChange={(e) => updateField('maritalStatus', e.target.value)} className="modal-input">
                    <option value="">{tAttr('선택')}</option>
                    {MARITAL_STATUS_OPTIONS.map((ms) => <option key={ms.value} value={ms.value}>{ms.label}</option>)}
                  </select>
                </ModalField>
                <ModalField label="흡연상태">
                  <select value={formData.smokingStatus} onChange={(e) => updateField('smokingStatus', e.target.value)} className="modal-input">
                    <option value="">{tAttr('선택')}</option>
                    <option value="NEVER">{tAttr('비흡연')}</option>
                    <option value="FORMER">{tAttr('과거 흡연')}</option>
                    <option value="CURRENT">{tAttr('현재 흡연')}</option>
                    <option value="UNKNOWN">{tAttr('미상')}</option>
                  </select>
                </ModalField>
              </div>
              <ModalField label="알레르기 (쉼표 구분)">
                <input
                  value={formData.allergiesText}
                  onChange={(e) => updateField('allergiesText', e.target.value)}
                  placeholder="페니실린, 아스피린, 땅콩"
                  className="modal-input"
                />
              </ModalField>
            </>
          )}

          {editTab === 'admin' && (
            <>
              <PhotoUploadSection patientId={patientId} currentPhotoUrl={patient.photoUrl} />

              <ModalField label="메모">
                <textarea
                  value={formData.memo}
                  onChange={(e) => updateField('memo', e.target.value)}
                  rows={3}
                  className="modal-input resize-none"
                  placeholder={tAttr('환자 관련 메모를 입력하세요...')}
                />
              </ModalField>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2"><T k="태그" /></label>
                <div className="flex flex-wrap gap-2">
                  {SUGGESTED_TAGS.map((tag) => {
                    const color = TAG_COLORS[tag] ?? DEFAULT_TAG_COLOR;
                    const isSelected = formData.tags.includes(tag);
                    return (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => toggleTag(tag)}
                        className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-all ${
                          isSelected
                            ? `${color.bg} ${color.text} border-current`
                            : 'bg-gray-50 text-gray-400 border-gray-200 hover:bg-gray-100'
                        }`}
                      >
                        {tag}
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100">
          <button onClick={onClose} className="px-5 py-2.5 border border-gray-300 rounded-xl text-sm text-gray-700 hover:bg-gray-50 transition-colors">
            <T k="취소" />
          </button>
          {editTab !== 'guardian' && (
            <button
              onClick={handleSave}
              disabled={updatePatient.isPending}
              className="px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {updatePatient.isPending ? <T k="저장 중..." /> : <T k="저장" />}
            </button>
          )}
        </div>

        <style jsx>{`
          :global(.modal-input) {
            width: 100%;
            padding: 0.5rem 0.75rem;
            border: 1px solid #d1d5db;
            border-radius: 0.5rem;
            font-size: 0.875rem;
            outline: none;
            background: white;
          }
          :global(.modal-input:focus) {
            border-color: #3b82f6;
            box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.3);
          }
        `}</style>
      </div>
    </div>
  );
}
