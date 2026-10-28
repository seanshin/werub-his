import { IsIn, IsOptional, IsString, MaxLength, Matches } from 'class-validator';

/** 구조화 결재 근거 — 유형+식별자 필수, 결재일·결재자·링크 권장 */
export class ConfirmGateDto {
  @IsIn(['APPROVAL_DOC', 'MEETING', 'OFFICIAL_LETTER', 'OTHER'])
  evidenceType!: string; // 전자결재 | 회의록 | 공문 | 기타

  @IsString()
  @MaxLength(120)
  evidenceRef!: string; // 문서번호·회의명 등 식별자

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: '결재일은 YYYY-MM-DD 형식이어야 합니다' })
  approvedOn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  approverName?: string; // 주관 부서 결재자(성명·직책)

  @IsOptional()
  @IsString()
  @MaxLength(300)
  evidenceUrl?: string; // 그룹웨어/문서 링크

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
