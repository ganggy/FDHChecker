import businessRules from './src/config/business_rules.json' assert { type: 'json' };

console.log('📊 === FUND DEFINITIONS VERIFICATION ===\n');

const funds = businessRules.fund_definitions;
console.log(`✅ Total Funds: ${funds.length}\n`);

funds.forEach((fund, idx) => {
  console.log(`${idx + 1}. 🏷️ ${fund.id.toUpperCase()}`);
  console.log(`   Name: ${fund.name}`);
  console.log(`   Desc: ${fund.description}`);
  console.log('');
});

console.log('📝 Summary:');
console.log(`✅ Palliative Care - ต้อง UCS + Z515, Z718 + ADP (30001, Cons01, Eva001)`);
console.log(`✅ Telemedicine - ต้อง UCS + ADP TELMED`);
console.log(`✅ Drug P (EMS) - ต้อง UCS + ADP DRUGP`);
console.log(`✅ Herb - ต้อง UCS/WEL + ยาสมุนไพร หมวด 3,4 + ttmt_code`);
console.log(`✅ Knee - อายุ >= 40 + รหัส Thai massage เข่า`);
console.log(`✅ Instrument - อุปกรณ์ nhso_adp_type_id=2`);
console.log(`✅ Preg Test - Lab UPT/Preg + ADP 31101, 30014`);
console.log(`✅ ANC - Z34, Z35 + ADP 30011-30013`);
console.log(`✅ Ca Cervix - Z124, Z014 + ADP 1B004, 1B005`);
console.log(`✅ FP - Z30 + ADP FPxxx`);
console.log(`✅ Postpartum - Z39 + ADP 30015`);
console.log(`✅ Ca Oral - Z128 + ADP 90004`);
console.log(`✅ ER Emergency - project_code = "OP AE"`);
console.log(`✅ Chemo - Z511, Z512`);
console.log(`✅ HepC - B18.2`);
console.log(`✅ Rehab - Z50`);
console.log(`✅ CRRT - Z49`);
console.log(`✅ Robot - Robotic Surgery`);
console.log(`✅ Proton - Z51.0`);
console.log(`✅ CXR - Chest X-Ray`);
console.log(`✅ Clopidogrel - ยา Clopidogrel (Name LIKE หรือ ADP 3799977101)`);
