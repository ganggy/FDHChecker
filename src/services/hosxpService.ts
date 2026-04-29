// บริการเชื่อมต่อฐานข้อมูล HOSxP
import type { CheckRecord } from '../mockData';

// การตั้งค่าการเชื่อมต่อ HOSxP
export const HOSXP_CONFIG = {
  host: '192.168.2.254',
  user: 'opd',
  password: 'opd',
  database: 'hos',
};

// ฟังก์ชันเชื่อมต่อและดึงข้อมูล HOSxP
export const fetchHOSxPData = async (
  fundType?: string,
  startDate?: string,
  endDate?: string
): Promise<CheckRecord[]> => {
  try {
    // ตั้งค่า API endpoint สำหรับเรียกข้อมูลจากฐานข้อมูล HOSxP
    const params = new URLSearchParams();
    if (fundType) params.append('fund', fundType);
    if (startDate) params.append('startDate', startDate);
    if (endDate) params.append('endDate', endDate);

    // เรียก API backend ที่เชื่อมต่อ HOSxP
    const response = await fetch(`/api/hosxp/checks?${params.toString()}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`API Error: ${response.statusText}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching HOSxP data:', error);
    throw error;
  }
};

// ฟังก์ชันดึงข้อมูลรายการใบเสร็จจาก opitemrece
export const fetchReceiptData = async (vn: string) => {
  try {
    console.log(`🧾 Fetching receipt data for VN: ${vn} from opitemrece table`);

    const response = await fetch(`/api/hosxp/receipt/${vn}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Receipt API Error: ${response.statusText}`);
    }

    const data = await response.json();
    console.log(`✅ Receipt API response:`, data);
    return data;
  } catch (error) {
    console.error('Error fetching receipt data:', error);
    throw error;
  }
};

// ฟังก์ชันดึงข้อมูลการวินิจฉัยและหัตถการ
export const fetchDiagsAndProceduresData = async (vn: string) => {
  try {
    const response = await fetch(`/api/hosxp/visit/${vn}/diags`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`API Error: ${response.statusText}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching diags and procedures data:', error);
    throw error;
  }
};

// ฟังก์ชันดึงข้อมูลค่าบริการ ADP Code
export const fetchServiceADPData = async (vn: string) => {
  try {
    const response = await fetch(`/api/hosxp/services/${vn}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`API Error: ${response.statusText}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching service ADP data:', error);
    throw error;
  }
};

// ฟังก์ชันดึงข้อมูลยาและการรักษา  
export const fetchPrescriptionData = async (vn: string) => {
  try {
    const response = await fetch(`/api/hosxp/prescriptions/${vn}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`API Error: ${response.statusText}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching prescription data:', error);
    throw error;
  }
};

// ฟังก์ชันดึงข้อมูลผู้ป่วย
export const fetchPatientData = async (hn: string) => {
  try {
    const response = await fetch(`/api/hosxp/patients/${hn}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`API Error: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error(`Error fetching patient data for HN ${hn}:`, error);
    throw error;
  }
};

// ฟังก์ชันดึงข้อมูลรายการบริการ
export const fetchServiceData = async (serviceCode: string) => {
  try {
    const response = await fetch(`/api/hosxp/services/${serviceCode}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`API Error: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error(`Error fetching service data:`, error);
    throw error;
  }
};

// ฟังก์ชันดึงข้อมูลยา
export const fetchDrugData = async (drugCode: string) => {
  try {
    const response = await fetch(`/api/hosxp/drugs/${drugCode}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`API Error: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error(`Error fetching drug data:`, error);
    throw error;
  }
};

// ฟังก์ชันตรวจสอบความสมบูรณ์ของข้อมูล
export const validateCheckData = async (checkRecord: CheckRecord): Promise<{ valid: boolean; issues: string[] }> => {
  const issues: string[] = [];

  try {
    // ตรวจสอบข้อมูลพื้นฐาน
    if (!checkRecord.hn) {
      issues.push('ขาดเลขประจำตัวผู้ป่วย (HN)');
    }

    if (!checkRecord.patientName) {
      issues.push('ขาดชื่อผู้ป่วย');
    }

    if (!checkRecord.fund) {
      issues.push('ขาดข้อมูลกองทุน');
    }

    // ตรวจสอบราคา (ถ้ามี)
    if (checkRecord.price && checkRecord.price < 0) {
      issues.push('ราคาไม่ถูกต้อง');
    }

    return {
      valid: issues.length === 0,
      issues,
    };
  } catch (error) {
    console.error('Error validating check data:', error);
    return {
      valid: false,
      issues: ['เกิดข้อผิดพลาดในการตรวจสอบข้อมูล'],
    };
  }
};

// ฟังก์ชันเชื่อมต่อฐานข้อมูล rcmdb (สำหรับข้อมูล REP/STM/INV)
export const fetchRcmdbData = async (dataType: 'REP' | 'STM' | 'INV', limit = 200) => {
  try {
    const params = new URLSearchParams();
    params.set('limit', String(limit));

    const response = await fetch(`/api/repstm/${dataType}?${params.toString()}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`API Error: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error(`Error fetching rcmdb data (${dataType}):`, error);
    throw error;
  }
};

export const fetchAppSettings = async <T = Record<string, unknown>>() => {
  const response = await fetch('/api/config/app-settings', {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  const json = await response.json();
  if (!response.ok || !json.success) {
    throw new Error(json.error || 'ไม่สามารถอ่านการตั้งค่าระบบได้');
  }

  return {
    data: json.data as T | null,
    source: json.source as string | undefined,
  };
};

export const saveAppSettings = async (settings: Record<string, unknown>) => {
  const response = await fetch('/api/config/app-settings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(settings),
  });

  const json = await response.json();
  if (!response.ok || !json.success) {
    throw new Error(json.error || 'ไม่สามารถบันทึกการตั้งค่าระบบได้');
  }

  return json;
};

export const importRepstmData = async (payload: {
  dataType: 'REP' | 'STM' | 'INV';
  sourceFilename: string;
  sheetName?: string;
  importedBy?: string;
  notes?: string;
  rows: Record<string, unknown>[];
}) => {
  const response = await fetch('/api/repstm/import', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  let json: any = null;
  let text = '';
  try {
    json = await response.json();
  } catch {
    text = await response.text().catch(() => '');
  }

  if (!response.ok || !json?.success) {
    if (json?.error) {
      throw new Error(json.error);
    }

    if (text.includes('<!DOCTYPE') || text.includes('<html')) {
      throw new Error('backend ส่งกลับเป็นหน้า HTML แทน JSON มักเกิดจาก request ใหญ่เกินไปหรือ server ยังไม่ได้รีสตาร์ต');
    }

    throw new Error('ไม่สามารถนำเข้า REP/STM/INV ได้');
  }
  return json;
};

export const fetchRepstmBatches = async (dataType?: 'REP' | 'STM' | 'INV', limit = 20) => {
  const params = new URLSearchParams();
  if (dataType) params.set('dataType', dataType);
  params.set('limit', String(limit));

  const response = await fetch(`/api/repstm/batches?${params.toString()}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  const json = await response.json();
  if (!response.ok || !json.success) {
    throw new Error(json.error || 'ไม่สามารถอ่านประวัติการนำเข้า REP/STM/INV ได้');
  }
  return json.data || [];
};

export interface ReceivableCandidate {
  patient_type: 'OPD' | 'IPD' | string;
  vn?: string | null;
  an?: string | null;
  hn?: string | null;
  cid?: string | null;
  patient_name?: string | null;
  pttype?: string | null;
  pttype_name?: string | null;
  hipdata_code?: string | null;
  service_date?: string | null;
  total_income?: number | string | null;
  claimable_amount?: number | string | null;
  item_count?: number | string | null;
  claim_summary?: string | null;
  hosxp_right_code?: string | null;
  hosxp_right_name?: string | null;
  finance_right_code?: string | null;
  finance_right_name?: string | null;
  debtor_code?: string | null;
  revenue_code?: string | null;
  receipt_no?: string | null;
  receipt_amount?: number | string | null;
  receipt_date?: string | null;
  payment_type_code?: string | null;
  payment_type_name?: string | null;
  rep_amount?: number | string | null;
  diff_amount?: number | string | null;
  rep_no?: string | null;
  compare_status?: string | null;
}

export interface ReceivableFilterOption {
  code: string;
  name: string;
  hipdata_code?: string | null;
}

export interface ReceivableFilterOptions {
  hosxpRights: ReceivableFilterOption[];
  financeRights: ReceivableFilterOption[];
}

export const fetchReceivableCandidates = async (params: {
  startDate: string;
  endDate: string;
  patientType?: string;
  patientRight?: string;
  hosxpRight?: string;
  financeRight?: string;
}): Promise<ReceivableCandidate[]> => {
  const query = new URLSearchParams();
  query.set('startDate', params.startDate);
  query.set('endDate', params.endDate);
  if (params.patientType) query.set('patientType', params.patientType);
  if (params.patientRight) query.set('patientRight', params.patientRight);
  if (params.hosxpRight) query.set('hosxpRight', params.hosxpRight);
  if (params.financeRight) query.set('financeRight', params.financeRight);

  const response = await fetch(`/api/receivables/candidates?${query.toString()}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });

  const json = await response.json();
  if (!response.ok || !json.success) {
    throw new Error(json.error || 'ไม่สามารถอ่านข้อมูลตั้งลูกหนี้สิทธิ์ได้');
  }
  return json.data || [];
};

export const fetchReceivableFilterOptions = async (): Promise<ReceivableFilterOptions> => {
  const response = await fetch('/api/receivables/filter-options', {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });

  const json = await response.json();
  if (!response.ok || !json.success) {
    throw new Error(json.error || 'ไม่สามารถอ่านตัวเลือกสิทธิ์บัญชีลูกหนี้ได้');
  }
  return json.data || { hosxpRights: [], financeRights: [] };
};

export const fetchReceivableBatches = async (limit = 50) => {
  const response = await fetch(`/api/receivables/batches?limit=${limit}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });

  const json = await response.json();
  if (!response.ok || !json.success) {
    throw new Error(json.error || 'ไม่สามารถอ่านประวัติบัญชีลูกหนี้ได้');
  }
  return json.data || [];
};

export const saveReceivableBatch = async (payload: {
  startDate: string;
  endDate: string;
  patientType: string;
  patientRight?: string;
  hosxpRight?: string;
  financeRight?: string;
  createdBy?: string;
  notes?: string;
  items: ReceivableCandidate[];
}) => {
  const response = await fetch('/api/receivables/batches', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const json = await response.json();
  if (!response.ok || !json.success) {
    throw new Error(json.error || 'ไม่สามารถบันทึกชุดบัญชีลูกหนี้ได้');
  }
  return json;
};

// ฟังก์ชันส่งข้อมูลไปที่ระบบ FDH
export const submitToFDH = async (records: CheckRecord[]) => {
  try {
    const response = await fetch('/api/fdh/submit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        records,
        submittedAt: new Date().toISOString(),
        count: records.length,
      }),
    });

    if (!response.ok) {
      throw new Error(`API Error: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error submitting to FDH:', error);
    throw error;
  }
};
