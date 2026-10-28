'use client';

/**
 * 부서(진료과) 콤보 정본 훅 (2026-08-24 · 입력 보조 UX P1 — input-assist-ux.plan.md §4)
 *
 * 🔴 실측: 마스터 `department_codes` 36행과 `GET /api/v1/codes/departments` EP 가 다 있는데
 *    **FE 소비 0건** — 화면 13곳이 각자 `const DEPARTMENTS = [...]` 를 들고 있었고, 목록이 서로 달랐다
 *    (front-desk 16과 · dept-catalog 10과 · staff-management 25부서 …). 관리자가 마스터에 과를
 *    추가해도 어느 화면에도 나타나지 않았다.
 *
 * 규약:
 *  · 진료과 목록은 이 훅으로만 가져온다 — 화면 로컬 배열 재정의 금지(가드: department-canon-guard)
 *  · 🔴 **마스터 + 현재 저장값 합집합**(`include`) — 운영 실측에서 실사용 어휘 51종이 마스터 밖이다
 *    (간호부 병동·검사실 파트 = 근무 배치 단위). 마스터로 좁히면 기존 행이 콤보에서 사라져
 *    선택·표시 불가가 된다(whitelist 함정). 어휘 정비는 사람 판단(기획서 §6)이고, 그때까지 화면은
 *    양쪽을 다 보여준다.
 *  · 🔴 조회 실패를 빈 목록으로 접지 않는다 — `isError` 를 화면이 말한다(`<DeptLoadError>`).
 *    실패 시에도 `include` 값은 남는다(현재 행의 표시가 깨지지 않게).
 *
 * 예외(이 훅을 쓰지 않는 곳 — 사유를 여기 적는다):
 *  · ReferralTab: `/consultations/departments`(활성 의사 보유 과)가 정본 — 의뢰는 "받을 의사가 있는 과"로만
 *  · portal SelfCheckIn: 환자 인증이라 스태프 EP 호출 불가 — 공개 EP 신설은 설계 판단(잔여 대장)
 */
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

export interface DepartmentCode {
  code: string;
  nameKo: string;
  nameEn?: string | null;
  category: 'CLINICAL' | 'SUPPORT' | 'ADMIN';
  sortOrder: number;
}

export function useDepartments(opts?: {
  /** CLINICAL(진료과)만 / 미지정=전 부서(지원·행정 포함) */
  category?: 'CLINICAL' | 'SUPPORT' | 'ADMIN';
  /** 현재 저장값 등 목록에 반드시 남아야 하는 값(마스터 밖 어휘 보존) */
  include?: readonly (string | null | undefined)[];
}) {
  const q = useQuery({
    queryKey: ['codes', 'departments', opts?.category ?? 'ALL'],
    queryFn: () =>
      apiClient.get<{ data: DepartmentCode[] }>(
        '/api/v1/codes/departments',
        opts?.category ? { category: opts.category } : undefined,
      ),
    staleTime: 10 * 60 * 1000, // 마스터는 자주 안 변한다
  });
  const master: DepartmentCode[] = q.data?.data ?? [];
  const masterNames = master.map((d) => d.nameKo);
  const extra = Array.from(
    new Set((opts?.include ?? []).filter((v): v is string => !!v && !masterNames.includes(v))),
  ).sort();
  return {
    /** 마스터 원본(코드·카테고리 필요 시) */
    departments: master,
    /** 화면 옵션용: 마스터(sortOrder순) + 현재값(마스터 밖·정렬) */
    names: [...masterNames, ...extra],
    isLoading: q.isLoading,
    isError: q.isError,
    refetch: q.refetch,
  };
}

/** 부서 목록 조회 실패 표시 — 조용히 빈 콤보가 되지 않게 화면이 이것을 함께 렌더한다 */
export function DeptLoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <p className="mt-1 text-[11px] text-red-600">
      부서 목록을 불러오지 못했습니다.{' '}
      <button type="button" onClick={onRetry} className="underline">재시도</button>
    </p>
  );
}
