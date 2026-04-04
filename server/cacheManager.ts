import { getEligibleVisits } from './db.js';

interface CacheEntry {
    data: Record<string, unknown>[];
    timestamp: number;
}

// In-Memory Database (Cache Temp)
const dailyCache = new Map<string, CacheEntry>();

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

    const start = new Date(startDate);
    const end = new Date(endDate);
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
            dailyCache.set(date, { data: dayData, timestamp: now });
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
