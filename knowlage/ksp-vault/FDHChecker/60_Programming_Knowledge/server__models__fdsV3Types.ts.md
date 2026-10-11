---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "programming"
source: "server/models/fdsV3Types.ts"
source_hash: "f373b8dcd8ca60184808e18fc54ea0dbcc7d91d6a539e17651e98f4e00e0d630"
managed_by: "sync-ksp-vault"
---
# fdsV3Types.ts

> Source: `server/models/fdsV3Types.ts`
> SHA-256: `f373b8dcd8ca60184808e18fc54ea0dbcc7d91d6a539e17651e98f4e00e0d630`

````typescript
/**
 * Types and Constants for MOPH Financial Data Set (FDS) v3.0.0.59
 * Standardized by Office of the Permanent Secretary, Ministry of Public Health (สป.สธ.)
 * Fiscal Year 2569 Revision 2 (05/10/2569)
 */

export interface FdsV3Metadata {
  fdhVersion: string; // e.g. "3.0.0.59"
  generatedDateTime: string; // YYYY-MM-DDThh:mm:ss
  hcode: string; // 5-digit hospital code
  hisSecret: string; // Token NewAuthenCode NHSO (client_secret)
  hisName: string; // e.g. "HOSxP"
  hisSourceKey: string; // Key from NHSO Digital Platform (x-sourceid-key)
  hisVersion: string; // e.g. "4.5.2"
  hospitalName: string; // Hospital name
  transactionId: string; // hcode(5)-YYYYMMDDHHMMSS(14)-NNNNNN(6) = 27 chars
  auditSoftName?: string; // "FDHChecker"
  auditSoftVersion?: string; // e.g. "1.0.2"
  totalVisits: FdsV3TotalVisits;
}

export interface FdsV3TotalVisits {
  total: number;
  totalUcVisits?: number;
  totalCsopVisits?: number;
  totalSsopVisits?: number;
  totalCipnVisits?: number;
  totalAipnVisits?: number;
}

export interface FdsV3PatientName {
  given: string;
  family: string;
  prefix?: string;
  line?: string;
}

export interface FdsV3PatientAddress {
  city: string; // 2-digit province code
  district: string; // 2-digit amphur code
  subdistrict?: string; // 2-digit tambon code
  postalCode: string;
  line: string;
}

export interface FdsV3Patient {
  birthDate: string; // YYYY-MM-DD
  gender: '1' | '2'; // 1=Male, 2=Female
  hn: string;
  id: string; // 13-digit CID or Passport
  idType: string; // CM-001 (1=Thai CID, 2=Passport, etc.)
  name: FdsV3PatientName;
  maritalStatus: string; // CM-002 (1=Single, 2=Married, etc.)
  nationality: string; // 99=Thai, etc.
  occupation?: string;
  address: FdsV3PatientAddress;
  bloodGroup?: string;
  phone?: string;
}

export interface FdsV3Practitioner {
  cid: string;
  pvType: string; // 1=Doctor, 2=Dentist, etc.
  professionId?: string; // e.g. ว12345
  name?: {
    given?: string;
    family?: string;
  };
}

export interface FdsV3EncounterOpd {
  clinic: string; // 5 digits Code_CLINIC
  dateTime: string; // YYYY-MM-DDThh:mm:ss
  seq: string; // VN or Visit Seq
  typeIn?: string; // CM-003 (1=Walk-in, 2=Appointment, 3=Refer)
  typeOut?: string; // CM-004 (1=Discharged home, 2=Admit, 3=Refer)
  typeServ?: string; // Appendix A3
}

export interface FdsV3LeaveDay {
  dateTimeOut: string; // YYYY-MM-DDThh:mm:ss
  dateTimeIn: string; // YYYY-MM-DDThh:mm:ss
  qtyDay: number;
  seqLvd: number;
}

export interface FdsV3EncounterIpd {
  an: string;
  admDateTime: string; // YYYY-MM-DDThh:mm:ss
  dscDateTime: string; // YYYY-MM-DDThh:mm:ss
  dischStat: string; // 1=Complete recovery, 2=Improved, 9=Dead, etc.
  dischType: string; // CM-006 (1=With approval, 2=Against advice, etc.)
  seq?: string;
  svcType?: string; // I=IPD, A=Ambulatory Care
  dept?: string; // 01=Med, 02=Surg, etc. (Mandatory for OFC/SSS)
  admType?: string; // A=Accident, E=Emergency, C=Elective, etc. (Mandatory for OFC/SSS)
  admSource?: string; // O=OPD, E=ER, R=Refer (Mandatory for OFC/SSS)
  wardDsc?: string; // Ward code
  adjRw?: number;
  drgCode?: string;
  drgVersion?: string;
  ods?: string; // Y/N One Day Surgery
  orsFlag?: string; // Y/N Outlier qualified
  orsType?: 'COST' | 'LOS' | 'BOTH';
  outlierLosDays?: number;
  totalLeaveDay?: number;
  leaveDay?: FdsV3LeaveDay[];
}

export interface FdsV3EncounterClinical {
  chiefComplaint: string;
  bodyWeight?: number; // Mandatory for IPD
  bodyHeight?: number;
  comaScore?: number;
}

export interface FdsV3DiagnosisIcd10 {
  dateTime: string;
  diagType: string; // CM-008 (1=Princ, 2=Co-morb, 3=Compl, 4=Other, 5=Ext)
  icd10: string; // Without dot, e.g. "I10", "E119"
  professionId: string; // Doctor license e.g. "ว12345"
  severityLevel?: string; // CM-009 (1-9)
}

export interface FdsV3Procedure {
  clinic: string;
  dateTimein: string;
  dateTimeOut: string;
  professionId: string;
  Oper: Array<{ code: string }>;
}

export interface FdsV3EncounterAer {
  ucAe?: string;
  referNo?: string;
  refMainIn?: string;
}

export interface FdsV3Encounter {
  opd?: FdsV3EncounterOpd;
  ipd?: FdsV3EncounterIpd;
  clinical: FdsV3EncounterClinical;
  diagnosisIcd10: FdsV3DiagnosisIcd10[];
  procedure: FdsV3Procedure[];
  aer?: FdsV3EncounterAer;
}

export interface FdsV3BenefitsClaim {
  hcode: string;
  hmain: string;
  permitNo?: string; // Authen code
  hType: string; // CM-011 (1=Main, 2=Sub, 3=Supra)
  inscl: string; // CM-010 (UCS, OFC, SSS, LGO, SSI, FRG, PVT)
  isUsedDm: '0' | '1';
  isUsedHt: '0' | '1';
  uuc: '1' | '2'; // 1=Use right, 2=Self pay
  projCode?: string; // CM-012
  serviceType?: string; // CM-013
}

export interface FdsV3Cht {
  invoiceNo: string;
  total: number;
}

export interface FdsV3ChaItem {
  chargeAmt: number;
  codeSys: string; // CM-014 (TMT, TTMT, TMLT, ICD9CM, ICD10PCS, CSMBS, NHSO, UCEP, SE)
  descript: string;
  localCode: string;
  qty: number;
  reimbPrice?: number;
  serviceDate: string;
  stdCode: string; // TMT 24 digits, TMLT code, etc.
  unitPrice: number;
}

export interface FdsV3Cha {
  amount: number;
  chrgItem: string; // Standard FDH 2-char code: 11-K1
  date: string;
  invoiceNo: string;
  items: FdsV3ChaItem[];
}

export interface FdsV3Benefits {
  claim: FdsV3BenefitsClaim;
  cht: FdsV3Cht[];
  cha: FdsV3Cha[];
}

export interface FdsV3PrenNewborn {
  birthDate: string;
  isTwin: 'Y' | 'N';
  pregnantAge: number;
  newbornCid?: string;
  pregnantWomenCid?: string;
  twinNo?: number;
  weight?: number;
}

export interface FdsV3Pren {
  edc: string; // YYYY-MM-DD
  gravida: string;
  lmp: string; // YYYY-MM-DD
  pregnantWomenCid: string;
  dcipEScreen?: number; // 28=positive, 29=negative, 30=not done
  gaWeek?: number;
  husbandCid?: string;
  nb?: FdsV3PrenNewborn[];
}

export interface FdsV3Cmhs {
  dateTimeVisit: string;
  riskAssessResult: string;
  smiVResult: string;
  visitAssessResult: string;
}

export interface FdsV3Disa {
  defectTypeId: string; // DF1-DF7
  dischargeDate: string;
  patientIopd: 'O' | 'E';
  targetId: string; // TG1-TG5
  adl?: number;
  impairment?: string;
  status?: string;
}

export interface FdsV3Dmis {
  ckdStage: string;
  dateApprove: string;
  egfr?: number;
  serumCreatinine?: number;
  hd?: Record<string, unknown>;
  capd?: Record<string, unknown>;
}

export interface FdsV3Ntip {
  ageYearMonth: string;
  dateRegis: string;
  diagDate: string;
  diagnosisResult: 'TB' | 'NOT_TB';
  dotType: 'D' | 'V' | 'S';
  regimen: string;
  hiv_coinfection: 'Y' | 'N';
  month_number: number;
  case_finding_flag?: string;
  dispensing?: Array<{
    daysOfDispensation: number;
    drugId: string;
    isDispensing: 'Y' | 'N';
  }>;
}

export interface FdsV3NapsAdvise {
  groupService: string;
  hcode: string;
  pattern: string;
  postTest: 'Y' | 'N';
  preTest: 'Y' | 'N';
  riskBehavior: string;
  serviceType: string;
  vctId: string;
  cd4_count?: string;
  cd4_date?: string;
  viral_load?: string;
  vl_date?: string;
  arv_regimen?: string;
  arv_line?: string;
  prep_start_date?: string;
  pep_start_date?: string;
  pep_exposure_type?: string;
}

export interface FdsV3Visit {
  uniqueId: string;
  patient: FdsV3Patient;
  practitioner: FdsV3Practitioner[];
  encounter: FdsV3Encounter;
  benefits: FdsV3Benefits;
  pren?: FdsV3Pren;
  cmhs?: FdsV3Cmhs;
  disa?: FdsV3Disa;
  dmis?: FdsV3Dmis;
  ntip?: FdsV3Ntip;
  napsAdvise?: FdsV3NapsAdvise;
}

export interface FdsV3Payload {
  fdhVersion: string;
  generatedDateTime: string;
  hcode: string;
  hisSecret: string;
  hisName: string;
  hisSourceKey: string;
  hisVersion: string;
  hospitalName: string;
  transactionId: string;
  auditSoftName: string;
  auditSoftVersion: string;
  totalVisits: FdsV3TotalVisits;
  data: FdsV3Visit[];
}

export interface FdsV3ValidationIssue {
  severity: 'error' | 'warning';
  rule: string;
  path: string;
  vn?: string;
  message: string;
}

export interface FdsV3ValidationResult {
  valid: boolean;
  totalVisits: number;
  ucVisits: number;
  ofcVisits: number;
  sssVisits: number;
  cipnVisits: number;
  aipnVisits: number;
  errors: FdsV3ValidationIssue[];
  warnings: FdsV3ValidationIssue[];
  specialModulesDetected: {
    pren: number;
    cmhs: number;
    disa: number;
    dmis: number;
    ntip: number;
    napsAdvise: number;
  };
}

````
