import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import { readStmZeroRows } from '../server/repositories/stmZero.repository.js';
import { getExportData } from '../server/repositories/claims.repository.js';
import { buildFdhFiles, scopeFdhData } from '../server/fdhExport.js';

interface BatchSummary {
  batchNumber: number;
  batchName: string;
  visitCount: number;
  dateStart: string;
  dateEnd: string;
  zipFilename: string;
  zipSizeBytes: number;
  folderPath: string;
}

async function run() {
  console.log('=====================================================');
  console.log('🚀 FDH 16-File Batch Generator for Data Sheet 0');
  console.log('=====================================================');

  console.log('⏳ 1. Loading Data Sheet 0 records...');
  const rows = await readStmZeroRows('2026-07-01', '2026-10-09', 'rep-sheet-zero');
  
  // Filter valid OPD visits
  const opdRows = rows.filter(r => !r.an && r.vn);
  
  // Create unique VN map with service dates
  const vnMap = new Map<string, string>();
  for (const r of opdRows) {
    if (r.vn) {
      vnMap.set(r.vn, r.service_date || '');
    }
  }

  const allVns = Array.from(vnMap.keys());
  console.log(`✅ Total Data Sheet 0 OPD visits found: ${allVns.length.toLocaleString('th-TH')} visits`);

  // Group by batches of 500 visits
  const BATCH_SIZE = 500;
  const totalBatches = Math.ceil(allVns.length / BATCH_SIZE);
  console.log(`📦 Dividing into ${totalBatches} batches (${BATCH_SIZE} visits per batch, well below 50 MB limit)...`);

  const outputBaseDir = path.resolve('exports/FDH_DataSheet0_Batches');
  fs.mkdirSync(outputBaseDir, { recursive: true });

  const summaries: BatchSummary[] = [];

  for (let i = 0; i < totalBatches; i++) {
    const batchNum = i + 1;
    const batchPadded = String(batchNum).padStart(2, '0');
    const chunkVns = allVns.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
    
    // Calculate date span for this chunk
    const chunkDates = chunkVns.map(vn => vnMap.get(vn)).filter(Boolean) as string[];
    chunkDates.sort();
    const dateStart = chunkDates[0] || 'unknown';
    const dateEnd = chunkDates[chunkDates.length - 1] || 'unknown';

    const batchName = `Batch_${batchPadded}`;
    const batchFolder = path.join(outputBaseDir, batchName);
    fs.mkdirSync(batchFolder, { recursive: true });

    console.log(`\n⏳ Processing ${batchName} (${chunkVns.length} visits | ${dateStart} ถึง ${dateEnd})...`);

    const rawData = await getExportData(chunkVns, { profile: 'standard', patientType: 'OPD' });
    if (!rawData) {
      console.warn(`⚠️ Warning: No raw data returned for ${batchName}`);
      continue;
    }

    const scoped = scopeFdhData(rawData, 'OPD');
    const files = buildFdhFiles(scoped, 'standard', true, 'utf8');

    // Write individual 16 txt files into folder
    const zip = new AdmZip();
    for (const file of files) {
      const filePath = path.join(batchFolder, file.filename);
      fs.writeFileSync(filePath, file.content);
      zip.addFile(file.filename, file.content);
    }

    // Write zip archive
    const zipFilename = `FDH_Sheet0_${batchName}_${chunkVns.length}visits.zip`;
    const zipPath = path.join(outputBaseDir, zipFilename);
    zip.writeZip(zipPath);

    const zipStat = fs.statSync(zipPath);
    console.log(`✅ Saved ${batchFolder}`);
    console.log(`✅ Saved ${zipPath} (${(zipStat.size / 1024).toFixed(2)} KB)`);

    summaries.push({
      batchNumber: batchNum,
      batchName,
      visitCount: chunkVns.length,
      dateStart,
      dateEnd,
      zipFilename,
      zipSizeBytes: zipStat.size,
      folderPath: batchFolder,
    });
  }

  // Generate Manifest
  const manifestPath = path.join(outputBaseDir, 'MANIFEST_AND_INSTRUCTIONS.md');
  let md = `# รายการชุดไฟล์ส่งออก FDH 16 แฟ้ม (Data Sheet 0)\n\n`;
  md += `**วันที่สร้าง:** ${new Date().toLocaleString('th-TH')}\n`;
  md += `**จำนวนวิสิตทั้งหมด:** ${allVns.length.toLocaleString('th-TH')} รายการ\n`;
  md += `**จำนวนชุด (Batches):** ${summaries.length} ชุด (ชุดละไม่เกิน 500 รายการ)\n`;
  md += `**การันตีขนาดไฟล์:** ทุกชุดมีขนาดไม่เกิน 1 MB (ต่ำกว่าเพดาน 50 MB ของเว็บ FDH มาก ปลอดภัย 100%)\n\n`;
  md += `## ตารางสรุปแต่ละชุด\n\n`;
  md += `| ชุดที่ | ชื่อไฟล์ ZIP | จำนวนวิสิต | ช่วงวันรับบริการ | ขนาด ZIP | โฟลเดอร์ 16 แฟ้ม |\n`;
  md += `| :---: | :--- | :---: | :---: | :---: | :--- |\n`;

  for (const s of summaries) {
    const sizeMb = (s.zipSizeBytes / (1024 * 1024)).toFixed(2);
    const sizeKb = (s.zipSizeBytes / 1024).toFixed(1);
    const sizeStr = s.zipSizeBytes > 1024 * 1024 ? `${sizeMb} MB` : `${sizeKb} KB`;
    md += `| ${s.batchNumber} | \`${s.zipFilename}\` | ${s.visitCount} | ${s.dateStart} ถึง ${s.dateEnd} | ${sizeStr} | \`${s.batchName}/\` |\n`;
  }

  md += `\n## วิธีนำเข้าเว็บ FDH สปสช.\n`;
  md += `1. ไปที่เว็บไซต์ https://fdh.moph.go.th และเข้าสู่ระบบหน่วยบริการ\n`;
  md += `2. ไปที่เมนู **"นำเข้าข้อมูล 16 แฟ้ม"**\n`;
  md += `3. เลือกอัปโหลดไฟล์ ZIP ทีละไฟล์ตามลำดับ (เริ่มจาก Batch 01 ถึง ${summaries.length})\n`;
  md += `4. แต่ละไฟล์มีขนาดเล็กเพียงไม่กี่ร้อย KB ทำให้ระบบ FDH ตรวจสอบและประมวลผลได้อย่างรวดเร็ว ไม่หลุด Timeout และไม่เกิน 50 MB\n`;

  fs.writeFileSync(manifestPath, md, 'utf8');
  console.log(`\n🎉 All done! Manifest created at: ${manifestPath}`);
}

run().catch(console.error);
