import assert from 'node:assert/strict';
import test from 'node:test';
import type { HospitalConnection } from './hospitalDatabase.js';
import {
  generateHosxpUpdateSql,
  queryHospitalMasterData,
} from './hospitalMasterData.js';

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

test('queryHospitalMasterData flags missing TMT 24-digit drugs', async () => {
  const mockSchema = {
    drugitems: ['icode', 'name', 'strength', 'units', 'didstd', 'did'],
  };

  const connection = fakeConnection(mockSchema, (sql) => {
    if (sql.includes('FROM drugitems')) {
      return [
        { icode: '1001', name: 'Paracetamol 500mg', strength: '500mg', units: 'tab', didstd: '123456789012345678901234' }, // 24 chars -> complete
        { icode: '1002', name: 'Amoxicillin 500mg', strength: '500mg', units: 'cap', didstd: '12345' }, // 5 chars -> incomplete
        { icode: '1003', name: 'Omeprazole 20mg', strength: '20mg', units: 'cap', didstd: '' }, // empty -> incomplete
      ];
    }
    return [];
  });

  const result = await queryHospitalMasterData(connection, {
    catalog: 'drugs',
    filter: 'incomplete',
    overrides: {},
  });

  assert.equal(result.summary.total, 3);
  assert.equal(result.summary.completed, 1);
  assert.equal(result.summary.incomplete, 2);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].code, '1002');
  assert.equal(result.items[0].isComplete, false);
  assert.equal(result.items[1].code, '1003');
  assert.equal(result.items[1].isComplete, false);
});

test('queryHospitalMasterData flags missing ADP/billcode nondrugs', async () => {
  const mockSchema = {
    nondrugitems: ['icode', 'name', 'price', 'nhso_adp_code', 'billcode'],
  };

  const connection = fakeConnection(mockSchema, (sql) => {
    if (sql.includes('FROM nondrugitems')) {
      return [
        { icode: '3001', name: 'CBC Complete Blood Count', price: 100, nhso_adp_code: '30001', billcode: '' }, // complete
        { icode: '3002', name: 'ตรวจน้ำตาลในเลือด FBS', price: 50, nhso_adp_code: '', billcode: '' }, // incomplete
      ];
    }
    return [];
  });

  const result = await queryHospitalMasterData(connection, {
    catalog: 'nondrugs',
    filter: 'incomplete',
    overrides: {},
  });

  assert.equal(result.summary.total, 2);
  assert.equal(result.summary.completed, 1);
  assert.equal(result.summary.incomplete, 1);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].code, '3002');
});

test('generateHosxpUpdateSql produces safe valid update statements', () => {
  const sql = generateHosxpUpdateSql('drugs', [
    { code: '1002', tmt_code: '123456789012345678901234' },
  ]);
  assert.equal(sql, "UPDATE drugitems SET didstd = '123456789012345678901234' WHERE icode = '1002';");

  const pttypeSql = generateHosxpUpdateSql('pttypes', [
    { code: '10', hipdata_code: 'UCS', pcode: 'UC' },
  ]);
  assert.equal(pttypeSql, "UPDATE pttype SET hipdata_code = 'UCS', pcode = 'UC' WHERE pttype = '10';");
});
