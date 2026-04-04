import { useState, useEffect } from 'react';
import { fetchHOSxPData } from '../services/hosxpService';
import businessRules from '../config/business_rules.json';
import type { CheckRecord } from '../mockData';
import '../styles/FundAnalysis.css';

const rules = businessRules as any;

// กองทุนหลักและย่อย
const FUND_HIERARCHY = rules.fund_hierarchy || {};

// เงื่อนไขการเบิกจ่าย
const CLAIM_CONDITIONS = rules.claim_conditions || {};

interface FundAnalysis {
  mainFund: string;
  subfund: string;
  totalRecords: number;
  eligibleRecords: number;
  ineligibleRecords: number;
  eligibleAmount: number;
  ineligibleAmount: number;
  eligibilityRate: number;
  issues: string[];
}

// ฟังก์ชันตรวจสอบเงื่อนไขการเบิกจ่าย
function checkEligibility(record: CheckRecord, fundName: string) {
  const issues: string[] = [];
  let eligible = true;

  // หาเงื่อนไขกองทุนหลัก
  let conditions: any;

  // ค้นหากองทุนในเงื่อนไข
  for (const [key, value] of Object.entries(CLAIM_CONDITIONS)) {
    if (fundName.includes(key) || key.includes(fundName)) {
      conditions = value;
      break;
    }
  }

  if (!conditions) {
    conditions = (CLAIM_CONDITIONS as any)['UCS']; // default
  }

  // ตรวจสอบตามเงื่อนไข
  if (conditions.requireHN && !record.hn) {
    issues.push('❌ ขาด HN');
    eligible = false;
  }

  if (conditions.requirePatientName && !record.patientName) {
    issues.push('❌ ขาดชื่อผู้ป่วย');
    eligible = false;
  }

  if (conditions.requireServiceType && !record.serviceType) {
    issues.push('❌ ขาดประเภทบริการ');
    eligible = false;
  }

  if (conditions.requireDrugCode && !record.details?.drugCode) {
    issues.push('❌ ขาด Drug Code');
    eligible = false;
  }

  if (conditions.requireProcedureCode && !record.details?.procedureCode) {
    issues.push('❌ ขาด Procedure Code');
    eligible = false;
  }

  if (record.price < conditions.minAmount || record.price > conditions.maxAmount) {
    issues.push(`❌ ราคาไม่อยู่ในเกณฑ์ (${conditions.minAmount}-${conditions.maxAmount})`);
    eligible = false;
  }

  if (eligible) {
    issues.push('✓ เข้าเงื่อนไขการเบิกจ่าย');
  }

  return { eligible, issues };
}

// ฟังก์ชันวิเคราะห์กองทุน
function analyzeFunds(records: CheckRecord[]): Map<string, FundAnalysis> {
  const analysis = new Map<string, FundAnalysis>();

  // วนลูปทุกกองทุนหลัก
  for (const [mainFundKey, mainFundData] of Object.entries(FUND_HIERARCHY as Record<string, { subfunds: string[] }>)) {
    // วนลูปทุกกองทุนย่อย
    for (const subfund of mainFundData.subfunds) {
      const key = `${mainFundKey}|${subfund}`;
      const fundRecords = records.filter(r => r.fund === subfund || r.fund.includes(subfund));

      let eligibleCount = 0;
      let ineligibleCount = 0;
      let eligibleAmount = 0;
      let ineligibleAmount = 0;
      const allIssues: string[] = [];

      fundRecords.forEach(record => {
        const { eligible, issues } = checkEligibility(record, subfund);

        if (eligible) {
          eligibleCount++;
          eligibleAmount += record.price || 0;
        } else {
          ineligibleCount++;
          ineligibleAmount += record.price || 0;
          issues.forEach(issue => {
            if (!allIssues.includes(issue)) {
              allIssues.push(issue);
            }
          });
        }
      });

      analysis.set(key, {
        mainFund: mainFundKey,
        subfund: subfund,
        totalRecords: fundRecords.length,
        eligibleRecords: eligibleCount,
        ineligibleRecords: ineligibleCount,
        eligibleAmount: eligibleAmount,
        ineligibleAmount: ineligibleAmount,
        eligibilityRate: fundRecords.length > 0 ? (eligibleCount / fundRecords.length) * 100 : 0,
        issues: [...new Set(allIssues)]
      });
    }
  }

  return analysis;
}

export default function FundAnalysisPage() {
  const [fundAnalysis, setFundAnalysis] = useState<Map<string, FundAnalysis>>(new Map());
  const [selectedFund, setSelectedFund] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        const records = await fetchHOSxPData();
        const analysis = analyzeFunds(records);
        setFundAnalysis(analysis);
      } catch (error) {
        console.error('Error loading data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);
  if (loading) {
    return <div className="fund-analysis-container">กำลังโหลดข้อมูล...</div>;
  }

  return (
    <div className="fund-analysis-container">
      <div className="fund-analysis-header">
        <h1>📊 วิเคราะห์เงื่อนไขการเบิกจ่ายตามกองทุน</h1>
        <p>แยกตามกองทุนหลักและกองทุนย่อย พร้อมตรวจสอบเงื่อนไขการเบิกจ่าย</p>
      </div>

      <div className="fund-analysis-content">
        {/* Main Fund Summary */}
        <div className="main-fund-summary">
          <h2>📋 สรุปตามกองทุนหลัก</h2>
          <div className="main-fund-grid">
            {Object.entries(FUND_HIERARCHY).map(([key, fundData]: [string, any]) => {
              const subfundAnalysis = Array.from(fundAnalysis.values()).filter(
                (a: FundAnalysis) => a.mainFund === key
              );
              const totalRecords = subfundAnalysis.reduce((sum, a: FundAnalysis) => sum + a.totalRecords, 0);
              const totalEligible = subfundAnalysis.reduce((sum, a: FundAnalysis) => sum + a.eligibleRecords, 0);
              const eligibilityRate = totalRecords > 0 ? (totalEligible / totalRecords) * 100 : 0;

              return (
                <div
                  key={key}
                  className="main-fund-card"
                  style={{ borderTopColor: fundData.color }}
                  onClick={() => setSelectedFund(key === selectedFund ? null : key)}
                >
                  <div className="fund-card-header">
                    <h3>{fundData.label}</h3>
                    <div className="fund-badge" style={{ backgroundColor: fundData.color }}>
                      {totalRecords}
                    </div>
                  </div>

                  <div className="fund-stats">
                    <div className="stat">
                      <span>เข้าเงื่อนไข</span>
                      <strong style={{ color: '#10b981' }}>{totalEligible}</strong>
                    </div>
                    <div className="stat">
                      <span>ไม่เข้าเงื่อนไข</span>
                      <strong style={{ color: '#ef4444' }}>
                        {totalRecords - totalEligible}
                      </strong>
                    </div>
                    <div className="stat">
                      <span>อัตรา (%)</span>
                      <strong style={{ color: fundData.color }}>
                        {eligibilityRate.toFixed(1)}%
                      </strong>
                    </div>
                  </div>

                  {selectedFund === key && (
                    <div className="subfund-details">
                      <h4>📌 กองทุนย่อย:</h4>
                      {subfundAnalysis.map((analysis: FundAnalysis) => (
                        <div key={`${analysis.mainFund}|${analysis.subfund}`} className="subfund-row">
                          <div className="subfund-name">{analysis.subfund}</div>
                          <div className="subfund-stats">
                            <span className="eligible">✓ {analysis.eligibleRecords}</span>
                            <span className="ineligible">✗ {analysis.ineligibleRecords}</span>
                            <span className="rate">
                              {analysis.eligibilityRate.toFixed(1)}%
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Detailed Fund Analysis */}
        <div className="detailed-fund-analysis">
          <h2>🔍 รายละเอียดเงื่อนไขการเบิกจ่าย</h2>

          <div className="fund-details-grid">
            {Array.from(fundAnalysis.values())
              .filter((a: FundAnalysis) => !selectedFund || a.mainFund === selectedFund)
              .map((analysis: FundAnalysis) => (
                <div key={`${analysis.mainFund}|${analysis.subfund}`} className="fund-detail-card">
                  <div className="detail-header">
                    <h3>{analysis.subfund}</h3>
                    <div className="detail-badges">
                      <span className="badge-eligible">เข้า {analysis.eligibleRecords}</span>
                      <span className="badge-ineligible">ไม่เข้า {analysis.ineligibleRecords}</span>
                    </div>
                  </div>

                  <div className="detail-stats">
                    <div className="stat-row">
                      <span>📊 รวม</span>
                      <strong>{analysis.totalRecords}</strong>
                    </div>
                    <div className="stat-row">
                      <span>💰 เบิกได้</span>
                      <strong>฿{analysis.eligibleAmount.toLocaleString()}</strong>
                    </div>
                    <div className="stat-row">
                      <span>🚫 เบิกไม่ได้</span>
                      <strong>฿{analysis.ineligibleAmount.toLocaleString()}</strong>
                    </div>
                  </div>

                  {/* Conditions */}
                  <div className="conditions-section">
                    <h4>✓ เงื่อนไขการเบิกจ่าย</h4>
                    {analysis.issues.map((issue: string, idx: number) => (
                      <div key={idx} className="condition-item">
                        {issue.includes('❌') ? (
                          <span className="issue-ineligible">{issue}</span>
                        ) : (
                          <span className="issue-eligible">{issue}</span>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Progress Bar */}
                  <div className="progress-bar">
                    <div
                      className="progress-fill"
                      style={{
                        width: `${analysis.eligibilityRate}%`,
                        backgroundColor: analysis.eligibilityRate >= 80 ? '#10b981' :
                          analysis.eligibilityRate >= 50 ? '#f59e0b' :
                            '#ef4444'
                      }}
                    />
                    <span className="progress-text">
                      {analysis.eligibilityRate.toFixed(1)}%
                    </span>
                  </div>
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}
