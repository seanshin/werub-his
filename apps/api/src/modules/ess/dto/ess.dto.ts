import { IsIn, IsOptional, IsString, IsNumber, IsDateString, MaxLength, IsObject, IsBoolean, IsUUID } from 'class-validator';

/** 임상 기록지 전자결재 상신(간호·행정 기안) — 증명서 요청을 담당의 확약으로 상신 */
export class SubmitClinicalApprovalDto {
  @IsUUID() requestId!: string;
  @IsOptional() @IsUUID() approverUserId?: string; // 미지정 시 근거 진료의(§17) 자동 해소
}

/** 동의서 의사 확약 전자결재 상신(간호 기안) — 담당의 doctorSign 확약(§24-2) */
export class SubmitConsentApprovalDto {
  @IsUUID() consentId!: string;
  @IsOptional() @IsUUID() approverUserId?: string; // 미지정 시 consentForm.doctorId 사용
}

/** 간호기록 의사 공동서명(co-sign) 전자결재 상신(간호 기안) — 담당의 확약 */
export class SubmitNoteCosignDto {
  @IsUUID() noteId!: string;
  @IsOptional() @IsUUID() approverUserId?: string; // 미지정 시 입원 담당의(attending ?? admitting) 자동 해소
}

/** 의무기록 사본 발급 승인 전자결재 상신(행정 기안) — 담당의 발급 승인 */
export class SubmitRecordCopyApprovalDto {
  @IsUUID() requestId!: string;
  @IsUUID() approverUserId!: string; // A그룹 사본은 단일 담당의 없어 승인 의사 지정 필수
}

export class DependentDto {
  @IsString() @MaxLength(100) name!: string;
  @IsString() @MaxLength(20) relation!: string;
  @IsOptional() @IsDateString() birthDate?: string;
  @IsOptional() @IsBoolean() isDependent?: boolean;
  @IsOptional() @IsString() @MaxLength(30) deductionType?: string;
  @IsOptional() @IsString() @MaxLength(200) note?: string;
}

export class PayrollIdentityDto {
  @IsOptional() @IsString() @MaxLength(40) bankName?: string;
  @IsOptional() @IsString() @MaxLength(30) bankAccount?: string;
  @IsOptional() @IsString() @MaxLength(60) bankHolder?: string;
  @IsOptional() @IsString() @MaxLength(20) residentId?: string;
}

export class UploadStaffDocDto {
  @IsOptional() @IsString() @MaxLength(30) category?: string;
}

export class ClockDto {
  @IsIn(['CLOCK_IN', 'CLOCK_OUT']) type!: string;
  // 🔴 근태 인증수단(법정 기록) — 화면이 선언한 값은 증거가 아니다. 서버(clockFromClient)가
  //    WEB/QR 외에는 채택하지 않고 'WEB' 으로 기록한다. 기존 호출자(구 화면)가 보내던
  //    'BIO'/'MANUAL' 은 400 으로 깨뜨리지 않고 받되 서버에서 정규화된다.
  @IsOptional() @IsIn(['WEB', 'QR', 'BIO', 'MANUAL']) method?: string;
  @IsOptional() @IsNumber() lat?: number;
  @IsOptional() @IsNumber() lng?: number;
}

export class LeaveRequestDto {
  @IsIn(['ANNUAL', 'SICK', 'HALF', 'OUTING', 'CORRECTION']) type!: string;
  @IsDateString() fromDate!: string;
  @IsDateString() toDate!: string;
  @IsNumber() days!: number;
  @IsOptional() @IsString() @MaxLength(300) reason?: string;
  @IsOptional() @IsUUID() attachmentDocId?: string;
}

export class CertificateDto {
  @IsIn(['EMPLOYMENT', 'CAREER']) kind!: string;
}

// Clinic/ERP → HIS 결재 결과 콜백 (§9.6.2)
export class LeaveCallbackDto {
  @IsOptional() @IsString() approvalId?: string;
  @IsObject() ref!: { source_module: string; source_ref: string };
  @IsOptional() @IsIn(['APPROVED', 'REJECTED', 'WITHDRAWN']) status?: string;
  @IsOptional() @IsString() approver?: string;
  @IsOptional() @IsDateString() decidedAt?: string;
  @IsOptional() @IsString() @MaxLength(300) comment?: string;

  // EApprovalRelay deliverCallback 스네이크 표기 수용 (C-3 리허설 발견 — status/result 이형)
  @IsOptional() @IsString() approval_id?: string;
  @IsOptional() @IsIn(['APPROVED', 'REJECTED', 'WITHDRAWN']) result?: string;
  @IsOptional() @IsString() approved_by?: string;
  @IsOptional() @IsDateString() decided_at?: string;
  @IsOptional() @IsString() event_id?: string;
}

export class DecideApprovalDto {
  @IsIn(['APPROVED', 'REJECTED']) decision!: 'APPROVED' | 'REJECTED';
  @IsOptional() @IsString() @MaxLength(300) comment?: string;
}

export class AttendanceCorrectionDto {
  @IsOptional() @IsUUID() targetRecordId?: string;
  @IsDateString() workDate!: string;
  @IsIn(['CLOCK_IN', 'CLOCK_OUT']) correctedType!: string;
  @IsDateString() correctedAt!: string;
  @IsString() @MaxLength(300) reason!: string;
}

export class OvertimeRequestDto {
  @IsDateString() workDate!: string;
  @IsIn(['EXTENDED', 'NIGHT', 'HOLIDAY']) otType!: string;
  @IsDateString() startAt!: string;
  @IsDateString() endAt!: string;
  @IsString() @MaxLength(300) reason!: string;
}

export class LeaveCancelDto {
  @IsString() @MaxLength(300) reason!: string;
}

export class DelegationDto {
  @IsUUID() delegateStaffId!: string;
  @IsDateString() fromDate!: string;
  @IsDateString() toDate!: string;
  @IsString() @MaxLength(300) reason!: string;
}
