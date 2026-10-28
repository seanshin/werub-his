'use client';

import { RegistrationConsentCollector } from '@/components/consent/RegistrationConsentCollector';
import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useForm, useFieldArray, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useCreatePatient, useCheckDuplicate } from '@/hooks/usePatients';
import { EmptyState } from '@/components/ui/display';
import { BirthDateInput } from '@/components/ui/BirthDate';
import { ageOf } from '@hospital-run/shared';
import { T, useTAttr } from '@/components/ui/i18n-text';
import {
  SUGGESTED_TAGS,
  TAG_COLORS,
  DEFAULT_TAG_COLOR,
  RELATIONSHIP_OPTIONS,
  NATIONALITY_OPTIONS,
  LANGUAGE_OPTIONS,
  MARITAL_STATUS_OPTIONS,
} from '@/lib/patient-constants';

// ── 주민등록번호 체크디짓 검증 ──
function validateResidentNumber(value: string): boolean {
  if (!value) return true; // 선택 필드
  const cleaned = value.replace(/-/g, '');
  if (cleaned.length !== 13) return false;
  const weights = [2, 3, 4, 5, 6, 7, 8, 9, 2, 3, 4, 5];
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += parseInt(cleaned[i], 10) * weights[i];
  }
  const checkDigit = (11 - (sum % 11)) % 10;
  return checkDigit === parseInt(cleaned[12], 10);
}

// ── Zod 스키마 ──
const contactSchema = z.object({
  name: z.string().min(1, '이름을 입력해주세요'),
  relationship: z.string().min(1, '관계를 선택해주세요'),
  phone: z.string().min(1, '전화번호를 입력해주세요'),
  isEmergencyContact: z.boolean(),
  isLegalGuardian: z.boolean(),
  isPrimaryContact: z.boolean(),
});

const patientSchema = z.object({
  familyName: z.string().min(1, '성을 입력해주세요'),
  givenName: z.string().min(1, '이름을 입력해주세요'),
  residentNumber: z.string().optional().refine(
    (val) => !val || validateResidentNumber(val),
    { message: '유효하지 않은 주민등록번호입니다' }
  ),
  dateOfBirth: z.string().min(1, '생년월일을 선택해주세요'),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER', 'UNKNOWN']),
  nationality: z.string().optional(),
  preferredLanguage: z.string().optional(),
  insuranceType: z.enum(['NHI', 'MEDICAID', 'INDUSTRIAL', 'AUTO', 'SELF_PAY']),
  insuranceNumber: z.string().optional(),
  phone: z.string().optional().refine(
    (val) => !val || /^0\d{1,2}-?\d{3,4}-?\d{4}$/.test(val),
    { message: '올바른 전화번호 형식이 아닙니다 (예: 010-0000-0000)' }
  ),
  email: z.string().email('올바른 이메일을 입력해주세요').optional().or(z.literal('')),
  address: z.string().optional(),
  contacts: z.array(contactSchema).max(5, '보호자는 최대 5명까지 등록 가능합니다'),
  bloodType: z.string().optional(),
  religion: z.string().optional(),
  occupation: z.string().optional(),
  smokingStatus: z.enum(['CURRENT', 'FORMER', 'NEVER', 'UNKNOWN']).optional(),
  maritalStatus: z.enum(['SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED', 'SEPARATED', 'OTHER']).optional(),
  allergies: z.string().optional(),
  memo: z.string().optional(),
  tags: z.array(z.string()).optional(),
  // 🔴 (2026-10-02) 동의 체크박스 10개를 뺐다 — 직원이 체크한 것을 서버가 "환자 서명"으로 기록했다.
  //    동의는 등록 직후 '초진 동의서 받기'(태블릿·환자 휴대폰·종이 스캔)로 **환자가 직접** 한다.
});

type PatientFormValues = z.infer<typeof patientSchema>;

export default function NewPatientPage() {
  const tAttr = useTAttr();
  const router = useRouter();
  const createPatient = useCreatePatient();
  const checkDuplicate = useCheckDuplicate();

  const [showMedicalInfo, setShowMedicalInfo] = useState(false);
  const [showMemo, setShowMemo] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState<{ id: string; mrn: string; name: string; dob: string } | null>(null);
  const [ignoreDuplicate, setIgnoreDuplicate] = useState(false);
  const [minorWarning, setMinorWarning] = useState(false);
  const [created, setCreated] = useState<{ id: string; name: string; mrn: string } | null>(null);

  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
    formState: { errors },
  } = useForm<PatientFormValues>({
    resolver: zodResolver(patientSchema),
    defaultValues: {
      gender: 'MALE',
      insuranceType: 'NHI',
      nationality: '대한민국',
      preferredLanguage: '한국어',
      contacts: [],
      tags: [],
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'contacts' });

  const familyName = watch('familyName');
  const givenName = watch('givenName');
  const dateOfBirth = watch('dateOfBirth');
  const residentNumber = watch('residentNumber');
  const contacts = watch('contacts');
  const tags = watch('tags') ?? [];

  // ── 주민등록번호 → 생년월일/성별 자동 채움 ──
  useEffect(() => {
    if (!residentNumber) return;
    const cleaned = residentNumber.replace(/-/g, '');

    // 앞 6자리 → 생년월일
    if (cleaned.length >= 6) {
      const yymmdd = cleaned.slice(0, 6);
      const yy = parseInt(yymmdd.slice(0, 2), 10);
      const mm = yymmdd.slice(2, 4);
      const dd = yymmdd.slice(4, 6);

      if (cleaned.length >= 7) {
        const genderDigit = parseInt(cleaned[6], 10);
        const century = (genderDigit <= 2) ? 1900 : 2000;
        const fullYear = century + yy;
        setValue('dateOfBirth', `${fullYear}-${mm}-${dd}`);

        // 성별 자동 설정
        if (genderDigit === 1 || genderDigit === 3) {
          setValue('gender', 'MALE');
        } else if (genderDigit === 2 || genderDigit === 4) {
          setValue('gender', 'FEMALE');
        }
      } else {
        // 뒷자리 없으면 2000년대 기본 가정
        const fullYear = yy > 30 ? 1900 + yy : 2000 + yy;
        setValue('dateOfBirth', `${fullYear}-${mm}-${dd}`);
      }
    }
  }, [residentNumber, setValue]);

  // ── 미성년자 경고 ──
  useEffect(() => {
    if (!dateOfBirth) { setMinorWarning(false); return; }
    const age = ageOf(dateOfBirth);
    setMinorWarning(age !== null && age < 18);
  }, [dateOfBirth]);

  // ── 중복 감지 (이름 + 생년월일 입력 완료 시) ──
  const debouncedCheckDuplicate = useCallback(() => {
    if (!familyName || !givenName || !dateOfBirth || ignoreDuplicate) return;
    checkDuplicate.mutate(
      { familyName, givenName, dateOfBirth },
      {
        onSuccess: (result) => {
          const data = result?.data;
          if (data?.isDuplicate && data.matches?.length > 0) {
            const match = data.matches[0];
            setDuplicateWarning({
              id: match.id,
              mrn: match.mrn,
              name: `${match.familyName}${match.givenName}`,
              dob: match.dateOfBirth,
            });
          } else {
            setDuplicateWarning(null);
          }
        },
        onError: () => setDuplicateWarning(null),
      }
    );
  }, [familyName, givenName, dateOfBirth, ignoreDuplicate, checkDuplicate]);

  useEffect(() => {
    if (!familyName || !givenName || !dateOfBirth) return;
    const timer = setTimeout(debouncedCheckDuplicate, 500);
    return () => clearTimeout(timer);
  }, [familyName, givenName, dateOfBirth, debouncedCheckDuplicate]);

  // ── 태그 토글 ──
  const toggleTag = (tag: string) => {
    const current = tags;
    if (current.includes(tag)) {
      setValue('tags', current.filter((t) => t !== tag));
    } else {
      setValue('tags', [...current, tag]);
    }
  };

  // ── 제출 ──
  const onSubmit = async (data: PatientFormValues) => {
    try {
      const allergiesArray = data.allergies
        ? data.allergies.split(',').map((s) => s.trim()).filter(Boolean)
        : [];

      const result = await createPatient.mutateAsync({
        familyName: data.familyName,
        givenName: data.givenName,
        dateOfBirth: data.dateOfBirth,
        gender: data.gender,
        insuranceType: data.insuranceType,
        insuranceNumber: data.insuranceNumber,
        phone: data.phone,
        email: data.email || undefined,
        address: data.address,
        bloodType: data.bloodType || undefined,
        allergies: allergiesArray,
        residentNumber: data.residentNumber,
        nationality: data.nationality,
        preferredLanguage: data.preferredLanguage,
        occupation: data.occupation,
        smokingStatus: data.smokingStatus,
        religion: data.religion,
        maritalStatus: data.maritalStatus,
        memo: data.memo,
        tags: data.tags,
        contacts: data.contacts.map((c) => ({
          name: c.name,
          relationship: c.relationship,
          phone: c.phone,
          isEmergencyContact: c.isEmergencyContact,
          isLegalGuardian: c.isLegalGuardian,
          isPrimaryContact: c.isPrimaryContact,
        })),
      } as unknown as Parameters<typeof createPatient.mutateAsync>[0]);
      // 등록 직후 바로 동의서 받기로 — 차트로 넘어가면 동의는 잊힌다
      setCreated({ id: result.data.id, name: `${data.familyName}${data.givenName}`, mrn: (result.data as { mrn?: string }).mrn ?? '' });
      window.scrollTo({ top: 0 });
    } catch {
      // error handled by mutation
    }
  };

  if (created) {
    return (
      <div className="max-w-3xl space-y-4" data-registered>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4">
          <p className="text-sm font-bold text-emerald-800"><T k="환자를 등록했습니다" /></p>
          <p className="mt-0.5 text-xs text-emerald-700">{created.name}{created.mrn ? ` · ${created.mrn}` : ''}</p>
        </div>
        <RegistrationConsentCollector patientId={created.id} />
        <div className="flex flex-wrap gap-2">
          <Link href={`/patients/${created.id}`} className="min-h-[44px] rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700"><T k="환자 차트로" /></Link>
          <Link href={`/patients/${created.id}?tab=consent`} className="min-h-[44px] rounded-xl border border-gray-200 px-5 py-2.5 text-sm text-gray-700 hover:bg-gray-50"><T k="나중에 받기(차트 동의서 탭)" /></Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <Link href="/patients" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors mb-4">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
        </svg>
        <T k="환자 목록" />
      </Link>

      <h2 className="text-2xl font-bold text-gray-900 mb-6"><T k="환자 등록" /></h2>

      {/* 중복 감지 배너 */}
      {duplicateWarning && !ignoreDuplicate && (
        <div className="mb-5 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-amber-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
            <div>
              <p className="text-sm font-medium text-amber-800"><T k="유사한 환자가 있습니다" /></p>
              <p className="text-xs text-amber-600">
                {duplicateWarning.name} ({duplicateWarning.mrn}, {duplicateWarning.dob})
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 ml-4">
            <Link
              href={`/patients/${duplicateWarning.id}`}
              className="px-3 py-1.5 text-xs font-medium bg-amber-600 text-white rounded-lg hover:bg-amber-700"
            >
              <T k="기존 환자 보기" />
            </Link>
            <button
              type="button"
              onClick={() => setIgnoreDuplicate(true)}
              className="px-3 py-1.5 text-xs font-medium bg-white text-amber-700 border border-amber-300 rounded-lg hover:bg-amber-50"
            >
              <T k="무시하고 등록" />
            </button>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        {/* ═══ 기본 정보 ═══ */}
        <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <svg className="w-4 h-4 text-blue-600" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
            </svg>
            <T k="기본 정보" />
          </h3>

          <div className="grid grid-cols-2 gap-4 mb-4">
            <Field label="성 *" error={errors.familyName?.message}>
              <input {...register('familyName')} placeholder="홍" className="input" />
            </Field>
            <Field label="이름 *" error={errors.givenName?.message}>
              <input {...register('givenName')} placeholder="길동" className="input" />
            </Field>
          </div>

          <div className="mb-4">
            <Field label="주민등록번호" error={errors.residentNumber?.message}>
              <input
                {...register('residentNumber')}
                placeholder="______-_______"
                maxLength={14}
                className="input font-mono"
              />
              <p className="text-[11px] text-gray-400 mt-1"><T k="선택 입력. 입력 시 생년월일/성별 자동 설정됩니다." /></p>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-4">
            <Field label="생년월일 *" error={errors.dateOfBirth?.message}>
              {/* 직접 입력(주민번호 보고 타이핑)과 콤보박스(환자 구술) 둘 다 — 공용 부품 */}
              <BirthDateInput
                value={dateOfBirth ?? ''}
                onChange={(v) => setValue('dateOfBirth', v, { shouldValidate: true })}
              />
            </Field>
            <Field label="성별 *">
              <select {...register('gender')} className="input">
                <option value="MALE"><T k="남성" /></option>
                <option value="FEMALE"><T k="여성" /></option>
                <option value="OTHER"><T k="기타" /></option>
                <option value="UNKNOWN"><T k="미상" /></option>
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="국적">
              <select {...register('nationality')} className="input">
                {NATIONALITY_OPTIONS.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </Field>
            <Field label="선호 언어">
              <select {...register('preferredLanguage')} className="input">
                {LANGUAGE_OPTIONS.map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
            </Field>
          </div>
        </section>

        {/* ═══ 보험 정보 ═══ */}
        <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <svg className="w-4 h-4 text-emerald-600" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
            </svg>
            <T k="보험 정보" />
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <Field label="보험 유형 *">
              <select {...register('insuranceType')} className="input">
                <option value="NHI"><T k="국민건강보험" /></option>
                <option value="MEDICAID"><T k="의료급여" /></option>
                <option value="INDUSTRIAL"><T k="산재보험" /></option>
                <option value="AUTO"><T k="자동차보험" /></option>
                <option value="SELF_PAY"><T k="비급여(자비)" /></option>
              </select>
            </Field>
            <Field label="보험증번호">
              <input {...register('insuranceNumber')} placeholder={tAttr("암호화 저장됩니다")} className="input" />
            </Field>
          </div>
        </section>

        {/* ═══ 연락처 ═══ */}
        <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <svg className="w-4 h-4 text-violet-600" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
            </svg>
            <T k="연락처" />
          </h3>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <Field label="전화번호" error={errors.phone?.message}>
              <input {...register('phone')} placeholder="010-0000-0000" className="input" />
            </Field>
            <Field label="이메일" error={errors.email?.message}>
              <input type="email" {...register('email')} placeholder="hong@example.com" className="input" />
            </Field>
          </div>
          <Field label="주소">
            <input {...register('address')} placeholder="서울시 강남구 역삼동 123-45" className="input" />
          </Field>
        </section>

        {/* ═══ 보호자/응급연락처 ═══ */}
        <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
              <svg className="w-4 h-4 text-amber-600" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
              </svg>
              <T k="보호자 / 응급연락처" />
              <span className="text-xs font-normal text-gray-400">({fields.length}/5)</span>
            </h3>
            {fields.length < 5 && (
              <button
                type="button"
                onClick={() =>
                  append({
                    name: '',
                    relationship: 'SPOUSE',
                    phone: '',
                    isEmergencyContact: false,
                    isLegalGuardian: false,
                    isPrimaryContact: fields.length === 0,
                  })
                }
                className="px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-1"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                <T k="보호자 추가" />
              </button>
            )}
          </div>

          {/* 미성년자 경고 */}
          {minorWarning && contacts.length === 0 && (
            <div className="mb-4 px-3 py-2.5 bg-orange-50 border border-orange-200 rounded-xl flex items-center gap-2">
              <svg className="w-4 h-4 text-orange-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
              <p className="text-xs text-orange-700 font-medium"><T k="미성년자(만 18세 미만)인 경우 보호자 1명 이상 등록을 권장합니다." /></p>
            </div>
          )}

          {fields.length === 0 ? (
            <EmptyState icon="👤" title="등록된 보호자가 없습니다." hint="위 버튼으로 추가해주세요." />
          ) : (
            <div className="space-y-3">
              {fields.map((field, index) => (
                <div key={field.id} className="border border-gray-100 rounded-xl p-4">
                  <div className="grid grid-cols-3 gap-3 mb-3">
                    <Field label="이름" error={errors.contacts?.[index]?.name?.message}>
                      <input {...register(`contacts.${index}.name`)} placeholder="홍순자" className="input" />
                    </Field>
                    <Field label="관계" error={errors.contacts?.[index]?.relationship?.message}>
                      <select {...register(`contacts.${index}.relationship`)} className="input">
                        {RELATIONSHIP_OPTIONS.map((r) => (
                          <option key={r.value} value={r.value}>{r.label}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="전화번호" error={errors.contacts?.[index]?.phone?.message}>
                      <input {...register(`contacts.${index}.phone`)} placeholder="010-0000-0000" className="input" />
                    </Field>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                        <input type="checkbox" {...register(`contacts.${index}.isEmergencyContact`)} className="rounded border-gray-300 text-blue-600" />
                        <T k="응급연락처" />
                      </label>
                      <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                        <input type="checkbox" {...register(`contacts.${index}.isLegalGuardian`)} className="rounded border-gray-300 text-blue-600" />
                        <T k="법정대리인" />
                      </label>
                      <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                        <input type="checkbox" {...register(`contacts.${index}.isPrimaryContact`)} className="rounded border-gray-300 text-blue-600" />
                        <T k="주보호자" />
                      </label>
                    </div>
                    <button
                      type="button"
                      onClick={() => remove(index)}
                      className="text-xs text-red-500 hover:text-red-700 transition-colors"
                    >
                      <T k="삭제" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ═══ 의료 정보 (접기/펼치기) ═══ */}
        <section className="bg-white rounded-2xl shadow-sm border border-gray-100">
          <button
            type="button"
            onClick={() => setShowMedicalInfo(!showMedicalInfo)}
            className="w-full p-6 flex items-center justify-between text-left"
          >
            <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
              <svg className="w-4 h-4 text-pink-600" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
              </svg>
              <T k="의료 정보" />
              <span className="text-xs font-normal text-gray-400"><T k="(선택)" /></span>
            </h3>
            <svg className={`w-4 h-4 text-gray-400 transition-transform ${showMedicalInfo ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
            </svg>
          </button>
          {showMedicalInfo && (
            <div className="px-6 pb-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Field label="혈액형">
                  <select {...register('bloodType')} className="input">
                    <option value=""><T k="선택" /></option>
                    {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((bt) => (
                      <option key={bt} value={bt}>{bt}</option>
                    ))}
                  </select>
                </Field>
                <Field label="종교">
                  <input {...register('religion')} placeholder={tAttr("예: 불교, 기독교, 천주교")} className="input" />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field label="직업">
                  <input {...register('occupation')} placeholder={tAttr("예: 회사원, 학생")} className="input" />
                </Field>
                <Field label="결혼상태">
                  <select {...register('maritalStatus')} className="input">
                    <option value=""><T k="선택" /></option>
                    {MARITAL_STATUS_OPTIONS.map((ms) => (
                      <option key={ms.value} value={ms.value}>{ms.label}</option>
                    ))}
                  </select>
                </Field>
                <Field label="흡연상태">
                  <select {...register('smokingStatus')} className="input">
                    <option value=""><T k="선택" /></option>
                    <option value="NEVER"><T k="비흡연" /></option>
                    <option value="FORMER"><T k="과거 흡연" /></option>
                    <option value="CURRENT"><T k="현재 흡연" /></option>
                    <option value="UNKNOWN"><T k="미상" /></option>
                  </select>
                </Field>
              </div>
              <Field label="알레르기">
                <input {...register('allergies')} placeholder={tAttr("쉼표로 구분 (예: 페니실린, 아스피린, 땅콩)")} className="input" />
                <p className="text-[11px] text-gray-400 mt-1"><T k="쉼표(,)로 구분하여 입력해주세요." /></p>
              </Field>
            </div>
          )}
        </section>

        {/* ═══ 관리자 메모 (접기/펼치기) ═══ */}
        <section className="bg-white rounded-2xl shadow-sm border border-gray-100">
          <button
            type="button"
            onClick={() => setShowMemo(!showMemo)}
            className="w-full p-6 flex items-center justify-between text-left"
          >
            <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
              <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
              </svg>
              <T k="관리자 메모" />
              <span className="text-xs font-normal text-gray-400"><T k="(선택)" /></span>
            </h3>
            <svg className={`w-4 h-4 text-gray-400 transition-transform ${showMemo ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
            </svg>
          </button>
          {showMemo && (
            <div className="px-6 pb-6 space-y-4">
              <Field label="메모">
                <textarea
                  {...register('memo')}
                  rows={3}
                  placeholder={tAttr("환자 관련 메모를 입력하세요...")}
                  className="input resize-none"
                />
              </Field>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2"><T k="태그" /></label>
                <div className="flex flex-wrap gap-2">
                  {SUGGESTED_TAGS.map((tag) => {
                    const color = TAG_COLORS[tag] ?? DEFAULT_TAG_COLOR;
                    const isSelected = tags.includes(tag);
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
                        {isSelected && '+ '}{tag}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </section>

        {/* 동의서 — 등록 직후 '초진 동의서 받기'(태블릿·환자 휴대폰·종이 스캔)에서 받는다(직원 체크박스 제거 · 2026-10-02) */}
        <p className="rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-3 text-xs text-blue-800" data-consent-after-register>
          <T k="초진 동의서는 등록 직후 태블릿·환자 휴대폰·종이(스캔 등록)로 환자에게 직접 받습니다." />
        </p>

        {/* ═══ 에러 / 제출 ═══ */}
        {createPatient.isError && (
          <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-xl">
            <p className="text-sm text-red-600">
              {(createPatient.error instanceof Error ? createPatient.error.message : null) || '등록에 실패했습니다.'}
            </p>
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={createPatient.isPending}
            className="px-6 py-2.5 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {createPatient.isPending ? '등록 중...' : '환자 등록'}
          </button>
          <button
            type="button"
            onClick={() => router.back()}
            className="px-6 py-2.5 border border-gray-300 rounded-xl text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <T k="취소" />
          </button>
        </div>
      </form>

      <style jsx>{`
        :global(.input) {
          width: 100%;
          padding: 0.5rem 0.75rem;
          border: 1px solid #d1d5db;
          border-radius: 0.5rem;
          font-size: 0.875rem;
          outline: none;
          background: white;
        }
        :global(.input:focus) {
          border-color: #3b82f6;
          box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.3);
        }
      `}</style>
    </div>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {children}
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  );
}
