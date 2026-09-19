import { Router } from 'express';
import type { Request, Response } from 'express';
import { getUTFConnection } from '../db.js';
import {
  getIcd9Chapter,
  getIcd9FundTags,
  COMMON_ICD9_PRESETS,
  ICD9_CHAPTERS,
  type Icd9Item,
} from '../icd9Service.js';

export const icd9Router = Router();

// GET /api/icd9/presets
icd9Router.get('/presets', (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      chapters: ICD9_CHAPTERS,
      presets: COMMON_ICD9_PRESETS,
    },
  });
});

// GET /api/icd9/search?q=...&category=...&fundTag=...&limit=50
icd9Router.get('/search', async (req: Request, res: Response) => {
  const queryText = String(req.query.q || '').trim();
  const categoryFilter = String(req.query.category || '').trim();
  const fundTagFilter = String(req.query.fundTag || '').trim();
  const rawLimit = Number(req.query.limit || 50);
  const limit = Math.min(Math.max(rawLimit, 1), 200);

  let connection;
  try {
    connection = await getUTFConnection();
    let sql = `
      SELECT code, name, active_status
      FROM icd9cm1
      WHERE 1=1
    `;
    const params: unknown[] = [];

    if (queryText) {
      const cleanCode = queryText.replace(/[^0-9a-zA-Z]/g, '');
      const codeLike = `%${cleanCode}%`;
      const textLike = `%${queryText}%`;
      sql += ` AND (
        code LIKE ?
        OR REPLACE(code, '.', '') LIKE ?
        OR name LIKE ?
      )`;
      params.push(codeLike, codeLike, textLike);
    }

    sql += ' ORDER BY code ASC LIMIT ?';
    params.push(limit * 2); // fetch extra to allow client/category filtering

    const [rows] = await connection.query(sql, params) as [Array<{ code: string; name: string }>, unknown];

    let items: Icd9Item[] = (rows || []).map((row) => {
      const code = String(row.code || '').trim();
      const name = String(row.name || '').trim();
      const category = getIcd9Chapter(code);
      const fundTags = getIcd9FundTags(code, name);
      return {
        code,
        name,
        category,
        fundTags,
      };
    });

    if (categoryFilter) {
      items = items.filter((item) => item.category.includes(categoryFilter));
    }

    if (fundTagFilter) {
      items = items.filter((item) => item.fundTags.some((t) => t.includes(fundTagFilter)));
    }

    res.json({
      success: true,
      total: items.length,
      data: items.slice(0, limit),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: `ไม่สามารถค้นหาข้อมูล ICD-9 ได้: ${message}` });
  } finally {
    if (connection) connection.release();
  }
});

// GET /api/icd9/top-used
icd9Router.get('/top-used', async (_req: Request, res: Response) => {
  let connection;
  try {
    connection = await getUTFConnection();
    const [rows] = await connection.query(`
      SELECT icd9 as code, COUNT(*) as usage_count
      FROM (
        SELECT icd9 FROM doctor_operation WHERE icd9 IS NOT NULL AND TRIM(icd9) <> ''
        UNION ALL
        SELECT icd9 FROM iptoprt WHERE icd9 IS NOT NULL AND TRIM(icd9) <> ''
      ) all_op
      GROUP BY icd9
      ORDER BY usage_count DESC
      LIMIT 30
    `) as [Array<{ code: string; usage_count: number }>, unknown];

    const codes = (rows || []).map((r) => r.code);
    let nameMap: Record<string, string> = {};
    if (codes.length > 0) {
      const placeholders = codes.map(() => '?').join(',');
      const [nameRows] = await connection.query(
        `SELECT code, name FROM icd9cm1 WHERE code IN (${placeholders})`,
        codes
      ) as [Array<{ code: string; name: string }>, unknown];
      nameMap = Object.fromEntries((nameRows || []).map((nr) => [nr.code, nr.name]));
    }

    const items = (rows || []).map((r) => ({
      code: r.code,
      name: nameMap[r.code] || '',
      category: getIcd9Chapter(r.code),
      fundTags: getIcd9FundTags(r.code, nameMap[r.code] || ''),
      usageCount: Number(r.usage_count || 0),
    }));

    res.json({
      success: true,
      data: items,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: `ไม่สามารถดึงข้อมูลสถิติหัตถการได้: ${message}` });
  } finally {
    if (connection) connection.release();
  }
});
