import { useState, useEffect } from 'react';
import type { CheckRecord } from '../mockData';
import { fetchHOSxPData } from '../services/hosxpService';

interface UseHOSxPDataProps {
  fund?: string;
  startDate?: string;
  endDate?: string;
}

export const useHOSxPData = ({ fund, startDate, endDate }: UseHOSxPDataProps = {}) => {
  const [data, setData] = useState<CheckRecord[]>([]);
  const [totalFromDB, setTotalFromDB] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadData = async () => {
      if (startDate && startDate.length >= 4 && parseInt(startDate.substring(0, 4)) < 2000) return;
      if (endDate && endDate.length >= 4 && parseInt(endDate.substring(0, 4)) < 2000) return;

      setLoading(true);
      setError(null);

      try {
        const apiResponse = await fetchHOSxPData(fund, startDate, endDate);

        let result: CheckRecord[];
        let dataSource = 'Unknown';

        if (apiResponse && typeof apiResponse === 'object') {
          if ('data' in apiResponse && Array.isArray(apiResponse.data)) {
            result = apiResponse.data;
            dataSource = (apiResponse as { dataSource?: string }).dataSource || 'Unknown';
            setTotalFromDB((apiResponse as { totalRecords?: number }).totalRecords ?? result.length);
            console.log(`Data received from: ${dataSource}`);
          } else if (Array.isArray(apiResponse)) {
            result = apiResponse;
            setTotalFromDB(apiResponse.length);
            dataSource = 'Legacy-Format';
          } else {
            throw new Error('Invalid API response format');
          }
        } else {
          throw new Error('No data received from API');
        }

        const validatedResult = result.map((record): CheckRecord => {
          if (record.status) {
            return {
              ...record,
              status: record.status,
              issues: record.issues || [],
            };
          }

          const issues: string[] = [];
          if (!record.hn) issues.push('ขาดเลขประจำตัวผู้ป่วย (HN)');
          if (!record.patientName) issues.push('ขาดชื่อผู้ป่วย');
          if (!record.fund) issues.push('ขาดข้อมูลกองทุน');
          if (!record.price || Number(record.price) <= 0) issues.push('ขาดหรือราคาไม่ถูกต้อง');
          if (!record.serviceDate) issues.push('ขาดวันที่บริการ');
          if (!record.serviceType) issues.push('ขาดประเภทบริการ');

          return {
            ...record,
            status: (issues.length === 0 ? 'ready' : 'rejected'),
            issues,
          };
        });

        setData(validatedResult);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
        console.error('Error loading HOSxP data:', err);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [fund, startDate, endDate]);

  return { data, totalFromDB, loading, error };
};
