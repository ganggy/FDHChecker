import { getEligibleVisits } from './db.js';
import { boundedInteger } from './httpClient.js';

interface CacheEntry {
    data: Record<string, unknown>[];
    timestamp: number;
}

// In-Memory Database (Cache Temp)
const dailyCache = new Map<string, CacheEntry>();
const maxCachedDays = boundedInteger(process.env.HOSXP_CACHE_MAX_DAYS, 400, 31, 730);
const maxQueryDays = boundedInteger(process.env.HOSXP_QUERY_MAX_DAYS, 93, 1, 366);

const parseIsoDate = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return date;
};

const saveDailyCache = (date: string, entry: CacheEntry) => {
    if (!dailyCache.has(date) && dailyCache.size >= maxCachedDays) {
        const oldestKey = dailyCache.keys().next().value as string | undefined;
        if (oldestKey) dailyCache.delete(oldestKey);
    }
    dailyCache.delete(date);
    dailyCache.set(date, entry);
};

export const clearCache = () => {
    dailyCache.clear();
    console.log('[Cache] In-memory cache cleared.');
};

/**
 * ดึงข้อมูลทีละวันแล้วนำมาเก็บในหน่วยความจำ RAM (Cache)
 * ป้องกันไม่ให้การดึงข้อมูลทั้งเดือนทำให้ฐานข้อมูล HOSxP หลักค้าง
 */
export const getVisitsCached = async (
    startDate: string,
    endDate: string,
    fund: string | undefined
): Promise<Record<string, unknown>[]> => {

    const start = parseIsoDate(startDate);
    const end = parseIsoDate(endDate);
    if (!start || !end) throw new Error('รูปแบบวันที่ต้องเป็น YYYY-MM-DD และเป็นวันที่ที่ถูกต้อง');
    if (start > end) throw new Error('วันที่เริ่มต้องไม่มากกว่าวันที่สิ้นสุด');
    const requestedDays = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
    if (requestedDays > maxQueryDays) throw new Error(`รองรับช่วงข้อมูลไม่เกิน ${maxQueryDays} วันต่อครั้ง`);
    const datesToFetch: string[] = [];

    const current = new Date(start);
    while (current <= end) {
        const yyyy = current.getFullYear();
        const mm = String(current.getMonth() + 1).padStart(2, '0');
        const dd = String(current.getDate()).padStart(2, '0');
        datesToFetch.push(`${yyyy}-${mm}-${dd}`);
        current.setDate(current.getDate() + 1);
    }

    const allData: Record<string, unknown>[] = [];
    const now = Date.now();

    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    for (const date of datesToFetch) {
        const isTodayOrFuture = date >= todayStr;
        // ข้อมูลย้อนหลังเก็บใน Temp ได้ 12 ชั่วโมง, ข้อมูลวันนี้เก็บแค่ 5 นาทีแล้วดึงใหม่
        const ttl = isTodayOrFuture ? 5 * 60 * 1000 : 12 * 60 * 60 * 1000;

        const cachedEntry = dailyCache.get(date);
        let dayData: Record<string, unknown>[];

        if (cachedEntry && now - cachedEntry.timestamp < ttl) {
            console.log(`[Cache] ⚡ DATA HIT for ${date} (${cachedEntry.data.length} visits)`);
            dayData = cachedEntry.data;
        } else {
            console.log(`[Cache] ⏳ FETCHING from HOSxP for ${date}...`);
            // ดึงข้อมูลทั้งหมดของวันนั้น (applyLimit = false) แบบไม่สนกองทุนมาเก็บไว้ก่อน (เอาแค่วันเดียว HOSxP ไม่ค้างแน่นอน)
            dayData = await getEligibleVisits(date, date, undefined, false);
            saveDailyCache(date, { data: dayData, timestamp: now });
            console.log(`[Cache] ✅ SAVED ${date} (${dayData.length} visits)`);
        }

        allData.push(...dayData);
    }

    // หลังจากรวมข้อมูลครบทุกวันแล้วค่อยมา Filter กองทุนใน RAM ทีหลัง (ไวกว่าให้ SQL หาให้)
    if (fund && fund !== 'ทั้งหมด') {
        return allData.filter(item => item.fund === fund);
    }

    return allData;
};
