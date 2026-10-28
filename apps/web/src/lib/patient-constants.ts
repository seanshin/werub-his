// ── 환자 태그 색상 매핑 ──

export const TAG_COLORS: Record<string, { bg: string; text: string }> = {
  '감염주의': { bg: 'bg-red-100', text: 'text-red-700' },
  '낙상위험': { bg: 'bg-orange-100', text: 'text-orange-700' },
  '약물알레르기': { bg: 'bg-purple-100', text: 'text-purple-700' },
  '수혈거부': { bg: 'bg-red-100', text: 'text-red-700' },
  'VIP': { bg: 'bg-yellow-100', text: 'text-yellow-700' },
  '미성년': { bg: 'bg-blue-100', text: 'text-blue-700' },
  '고령': { bg: 'bg-gray-100', text: 'text-gray-600' },
  '임산부': { bg: 'bg-pink-100', text: 'text-pink-700' },
  '다제내성균': { bg: 'bg-red-100', text: 'text-red-700' },
};

export const DEFAULT_TAG_COLOR = { bg: 'bg-gray-100', text: 'text-gray-600' };

export const SUGGESTED_TAGS = ['감염주의', '낙상위험', 'VIP', '미성년', '고령', '임산부'];

export const RELATIONSHIP_OPTIONS = [
  { value: 'SPOUSE', label: '배우자' },
  { value: 'PARENT', label: '부모' },
  { value: 'CHILD', label: '자녀' },
  { value: 'SIBLING', label: '형제/자매' },
  { value: 'GRANDPARENT', label: '조부모' },
  { value: 'GRANDCHILD', label: '손자녀' },
  { value: 'FRIEND', label: '친구' },
  { value: 'GUARDIAN', label: '후견인' },
  { value: 'OTHER', label: '기타' },
];

export const RELATIONSHIP_LABEL: Record<string, string> = Object.fromEntries(
  RELATIONSHIP_OPTIONS.map(r => [r.value, r.label])
);

export const MARITAL_STATUS_OPTIONS = [
  { value: 'SINGLE', label: '미혼' },
  { value: 'MARRIED', label: '기혼' },
  { value: 'DIVORCED', label: '이혼' },
  { value: 'WIDOWED', label: '사별' },
  { value: 'SEPARATED', label: '별거' },
  { value: 'OTHER', label: '기타' },
];

export const NATIONALITY_OPTIONS = [
  '대한민국', '미국', '중국', '일본', '베트남', '태국', '필리핀',
  '인도네시아', '우즈베키스탄', '캄보디아', '몽골', '러시아', '기타',
];

export const LANGUAGE_OPTIONS = [
  '한국어', '영어', '중국어', '일본어', '베트남어', '태국어',
  '타갈로그어', '인도네시아어', '러시아어', '기타',
];
