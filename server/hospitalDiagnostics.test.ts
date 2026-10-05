import assert from 'node:assert/strict';
import test from 'node:test';
import type { HospitalConnection } from './hospitalDatabase.js';
import { inspectHospitalReadiness } from './hospitalDiagnostics.js';

function fakeConnection(
  schema: Record<string, string[]>,
  queryHandler: (sql: string, values: unknown[]) => unknown[]
): HospitalConnection {
  return {
    query: async (sql: string, values: unknown[]) => {
      if (sql.includes('information_schema.columns')) {
        const rows = Object.entries(schema).flatMap(([table_name, columns]) =>
          columns.map(column_name => ({ table_name, column_name }))
        );
        return [rows, []];
      }
      return [queryHandler(sql, values || []), []];
    },
  } as unknown as HospitalConnection;
}

test('inspectHospitalReadiness calculates readiness score and identifies core schema', async () => {
  const mockSchema: Record<string, string[]> = {
    opdconfig: ['hospitalcode', 'hospitalname'],
    patient: ['hn', 'cid', 'pname', 'fname', 'lname', 'birthday'],
    ovst: ['vn', 'hn', 'vstdate', 'vsttime', 'pttype', 'claim_code'],
    ovstdiag: ['vn', 'icd10', 'diagtype'],
    opitemrece: ['vn', 'hn', 'an', 'icode', 'qty', 'unitprice', 'sum_price'],
    drugitems: ['icode', 'name', 'didstd', 'did', 'istatus'],
    nondrugitems: ['icode', 'name', 'nhso_adp_code', 'billcode', 'istatus'],
    pttype: ['pttype', 'name', 'hipdata_code', 'pcode'],
    authenhos: ['claim_code', 'pid', 'vn'],
    ipt: ['an', 'hn', 'vn', 'dchdate', 'dchtime', 'regdate'],
    iptdiag: ['an', 'icd10', 'diagtype'],
    income: ['income', 'name'],
    spclty: ['spclty', 'name'],
    ward: ['ward', 'name'],
    ovstist: ['ovstist', 'name'],
    dtmain: ['vn', 'hn'],
  };

  const connection = fakeConnection(mockSchema, (sql) => {
    if (sql.includes('FROM opdconfig')) {
      return [{ hospitalcode: '12345', hospitalname: 'โรงพยาบาลทดสอบ' }];
    }
    if (sql.includes('FROM drugitems')) {
      return [{ total: 100, ready: 90 }];
    }
    if (sql.includes('FROM nondrugitems')) {
      return [{ total: 50, ready: 45 }];
    }
    if (sql.includes('FROM pttype')) {
      return [{ total: 20, ready: 18 }];
    }
    return [];
  });

  const report = await inspectHospitalReadiness(connection, {
    fdhApiConfigured: true,
    localAiAvailable: true,
    siteSettings: { uc_walkin_pttypes: ['UC1'] },
  });

  assert.equal(report.hospital.hospital_code, '12345');
  assert.equal(report.hospital.hospital_name, 'โรงพยาบาลทดสอบ');
  assert.equal(report.readinessLevel, 'READY');
  assert.ok(report.overallScore >= 85, `Expected score >= 85, got ${report.overallScore}`);

  // Authen source
  assert.ok(report.authenSource.detectedSources.includes('authenhos (Kiosk BMS)'));
  assert.ok(report.authenSource.detectedSources.includes('ovst.claim_code'));

  // Capabilities
  const fdhExport = report.capabilities.find(c => c.id === 'fdh_export');
  assert.equal(fdhExport?.status, 'ready');

  const fdhApi = report.capabilities.find(c => c.id === 'fdh_api');
  assert.equal(fdhApi?.status, 'ready');

  // Catalogs
  const drugCatalog = report.catalogChecks.find(c => c.catalog.includes('drugitems'));
  assert.equal(drugCatalog?.percent, 90);
  assert.equal(drugCatalog?.status, 'good');
});

test('inspectHospitalReadiness gracefully flags missing tables and unmapped settings', async () => {
  // Minimal / degraded schema
  const mockSchema: Record<string, string[]> = {
    patient: ['hn'],
  };

  const connection = fakeConnection(mockSchema, () => []);

  const report = await inspectHospitalReadiness(connection, {
    fdhApiConfigured: false,
    localAiAvailable: false,
  });

  assert.equal(report.readinessLevel, 'INCOMPLETE');
  assert.ok(report.overallScore < 50);

  const missingOvst = report.schemaChecks.find(s => s.table === 'ovst');
  assert.equal(missingOvst?.exists, false);

  const fdhExport = report.capabilities.find(c => c.id === 'fdh_export');
  assert.equal(fdhExport?.status, 'needs_config');

  assert.ok(report.recommendations.length > 0);
});
