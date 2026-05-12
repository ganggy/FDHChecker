export interface FundRuleCondition {
    id: string;
    label: string;
    detail?: string;
}

export interface FundRuleBand {
    id: string;
    label: string;
    ageLabel: string;
    labLabel: string;
    diagnosisLabel: string;
    adpLabel: string;
    fullCondition: string;
    shortLabel: string;
}

export interface FundRuleCatalogItem {
    id: string;
    name: string;
    summary: string;
    conditions: string[];
    caution?: string;
    bands?: FundRuleBand[];
}

export const FUND_RULE_CATALOG: Record<string, FundRuleCatalogItem> = {
    anemia_screening: {
        id: 'anemia_screening',
        name: 'คัดกรองโลหิตจาง',
        summary: 'คัดกรองโลหิตจางจากการขาดธาตุเหล็กตามช่วงอายุและชนิด Lab ที่กำหนด',
        conditions: [
            'อายุ 13-24 ปี ต้องมี Lab CBC + Diagnosis Z130/Z138 + ADP 13001',
            'อายุ 6-12 เดือน ต้องมี Lab Hb/Hct + Diagnosis Z130/Z138 + ADP 13001',
            'อายุ 3-6 ปี ต้องมี Lab Hb/Hct + Diagnosis Z130/Z138 + ADP 13001',
        ],
        caution: 'ระบบจะแจ้งเฉพาะ visit ที่มีหลักฐานใกล้เข้าเงื่อนไข เช่น มี Lab, Diagnosis หรือ ADP อย่างใดอย่างหนึ่ง และจะแยกบอกว่าขาดช่วงอายุ, Lab, Diagnosis หรือ ADP ใด',
        bands: [
            {
                id: 'cbc_13_24y',
                label: 'CBC 13-24 ปี',
                ageLabel: '13-24 ปี',
                labLabel: 'Lab CBC',
                diagnosisLabel: 'Diagnosis Z130/Z138',
                adpLabel: 'ADP 13001',
                fullCondition: 'คัดกรองโลหิตจางจากการขาดธาตุเหล็ก Lab CBC 13-24 ปี Diagnosis Z130/Z138 ADP 13001',
                shortLabel: 'คัดกรองโลหิตจาง CBC 13-24 ปี',
            },
            {
                id: 'hbhct_6_12m',
                label: 'Hb/Hct 6-12 เดือน',
                ageLabel: '6-12 เดือน',
                labLabel: 'Lab Hb/Hct',
                diagnosisLabel: 'Diagnosis Z130/Z138',
                adpLabel: 'ADP 13001',
                fullCondition: 'คัดกรองโลหิตจางจากการขาดธาตุเหล็ก Lab Hb/Hct 6-12 เดือน Diagnosis Z130/Z138 ADP 13001',
                shortLabel: 'คัดกรองโลหิตจาง Hb/Hct 6-12 เดือน',
            },
            {
                id: 'hbhct_3_6y',
                label: 'Hb/Hct 3-6 ปี',
                ageLabel: '3-6 ปี',
                labLabel: 'Lab Hb/Hct',
                diagnosisLabel: 'Diagnosis Z130/Z138',
                adpLabel: 'ADP 13001',
                fullCondition: 'คัดกรองโลหิตจางจากการขาดธาตุเหล็ก Lab Hb/Hct 3-6 ปี Diagnosis Z130/Z138 ADP 13001',
                shortLabel: 'คัดกรองโลหิตจาง Hb/Hct 3-6 ปี',
            },
        ],
    },
};

export const getFundRule = (fundId: string) => FUND_RULE_CATALOG[fundId];

export const getAnemiaRuleBand = (item: any): FundRuleBand | undefined => {
    const bands = FUND_RULE_CATALOG.anemia_screening?.bands || [];
    const source = String(item?.anemia_match_source ?? '').toUpperCase();
    const backendBand = String(item?.anemia_age_band ?? '').trim();
    const ageMonths = Number(item?.age_month ?? item?.ageMonths ?? item?.age_months ?? -1);
    const ageYears = Number(item?.age_y ?? item?.age ?? -1);

    if (source.includes('13-24') || backendBand === '13-24 ปี' || (ageYears >= 13 && ageYears <= 24)) {
        return bands.find((band) => band.id === 'cbc_13_24y');
    }
    if (source.includes('6-12') || backendBand === '6-12 เดือน' || (ageMonths >= 6 && ageMonths <= 12)) {
        return bands.find((band) => band.id === 'hbhct_6_12m');
    }
    if (source.includes('3-6') || backendBand === '3-6 ปี' || (ageYears >= 3 && ageYears <= 6)) {
        return bands.find((band) => band.id === 'hbhct_3_6y');
    }

    return undefined;
};
