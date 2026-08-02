---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "programming"
source: "src/config/palliativeDiagnosisCatalog.ts"
source_hash: "bebe733638f356f1736a5196a29c251bc15c4d9070d3a9165158a47be902bbad"
managed_by: "sync-ksp-vault"
---
# palliativeDiagnosisCatalog.ts

> Source: `src/config/palliativeDiagnosisCatalog.ts`
> SHA-256: `bebe733638f356f1736a5196a29c251bc15c4d9070d3a9165158a47be902bbad`

````typescript
export interface PalliativeDiagnosisGroup {
    id: string;
    title: string;
    summary: string;
    codes: string[];
    accent: string;
    background: string;
}

const codeList = (value: string) => value.trim().split(/\s+/).filter(Boolean);

export const formatPalliativeIcd10 = (code: string) => {
    const normalized = code.replace('.', '').toUpperCase();
    if (normalized.length <= 3) return normalized;
    return `${normalized.slice(0, 3)}.${normalized.slice(3)}`;
};

export const PALLIATIVE_DIAGNOSIS_GROUPS: PalliativeDiagnosisGroup[] = [
    {
        id: 'hiv',
        title: 'กลุ่ม B — HIV/AIDS',
        summary: 'โรคจากเชื้อ HIV และภาวะแทรกซ้อน',
        codes: codeList(`
            B200 B201 B202 B203 B204 B205 B206 B207 B208 B209 B210 B211 B212 B213 B217
            B218 B219 B220 B221 B222 B227 B238 B24
        `),
        accent: '#dc2626',
        background: '#fef2f2',
    },
    {
        id: 'malignant-neoplasm',
        title: 'กลุ่ม C — มะเร็ง',
        summary: 'มะเร็งอวัยวะต่าง ๆ มะเร็งแพร่กระจาย มะเร็งเม็ดเลือด และมะเร็งระบบน้ำเหลือง',
        codes: codeList(`
            C000 C001 C002 C003 C004 C005 C006 C008 C009 C01 C020 C0210 C0211 C0219 C022 C023 C024 C028 C029 C030 C031
            C039 C040 C041 C048 C049 C050 C051 C052 C058 C059 C060 C0610 C0611 C0612 C0613 C0614 C0615 C0619 C0620 C0621 C0629 C068 C069 C07 C080 C081 C088 C089 C090 C091 C098 C099 C100 C101
            C102 C103 C104 C108 C109 C110 C111 C112 C113 C118 C119 C12 C130 C131 C132 C138 C139 C140 C142 C148 C150 C151 C152 C153 C154 C155 C158 C159 C160 C161 C162 C163 C164 C165
            C166 C168 C169 C170 C171 C172 C173 C178 C179 C180 C181 C182 C183 C184 C185 C186 C187 C188 C189 C19 C20 C210 C211 C212 C218 C220 C221 C222 C223 C224 C227 C229 C23
            C240 C241 C248 C249 C250 C251 C252 C253 C254 C257 C258 C259 C260 C261 C268 C269 C300 C301 C310 C311 C312 C313 C318 C319 C320 C321 C322 C323 C328 C329 C33 C340 C341 C342 C343
            C348 C349 C37 C380 C381 C382 C383 C384 C388 C390 C398 C399 C400 C401 C402 C403 C408 C409 C4100 C4101 C4102 C4108 C4109 C4110 C4111 C4119 C412 C413 C414 C418
            C419 C430 C431 C432 C433 C434 C435 C436 C437 C438 C439 C440 C441 C442 C443 C444 C445 C446 C447 C448 C449 C450 C451 C452 C457 C459 C460 C461 C462 C463 C467
            C468 C469 C470 C471 C472 C473 C474 C475 C476 C478 C479 C480 C481 C482 C488 C490 C491 C492 C493 C494 C495 C496 C498 C499 C500 C501 C502 C503
            C504 C505 C506 C508 C509 C510 C511 C512 C518 C519 C52 C530 C531 C538 C539 C540 C541 C542 C543 C548 C549 C55 C56 C570 C571 C572 C573 C574 C577 C578 C579 C58 C600
            C601 C602 C608 C609 C61 C620 C621 C629 C630 C631 C632 C637 C638 C639 C64 C65 C66 C670 C671 C672 C673 C674 C675 C676 C677 C678 C679 C680 C681 C688 C689 C690 C691 C692
            C693 C694 C695 C696 C698 C699 C700 C701 C709 C710 C711 C712 C713 C714 C715 C716 C717 C718 C719 C720 C721 C722 C723 C724 C725 C728 C729 C73 C740 C741 C749 C750 C751 C752
            C753 C754 C755 C758 C759 C760 C761 C762 C763 C764 C765 C767 C768 C770 C771 C772 C773 C774 C775 C778 C779 C780 C781 C782 C783 C784 C785 C786 C787 C788
            C790 C791 C792 C793 C794 C795 C796 C797 C798 C799 C80 C800 C809 C810 C811 C812 C813 C817 C819 C820 C821 C822 C823 C824 C825
            C826 C827 C829 C830 C831 C833 C835 C837 C838 C839 C840 C841 C844 C845 C846 C847 C848 C849 C851 C852 C857 C859 C860 C861 C862 C863 C864 C865 C866 C880
            C881 C882 C883 C887 C889 C900 C901 C902 C903 C910 C911 C913 C914 C915 C917 C918 C919 C920 C921 C922 C923 C924 C925 C926 C927 C928 C929 C930 C931 C932
            C933 C937 C939 C940 C941 C942 C943 C944 C946 C947 C950 C951 C952 C957 C959 C960 C962 C965 C966 C967 C968 C969 C97
        `),
        accent: '#7c3aed',
        background: '#f5f3ff',
    },
    {
        id: 'uncertain-neoplasm',
        title: 'กลุ่ม D — เนื้องอกพฤติกรรมไม่แน่นอน',
        summary: 'เนื้องอกที่ยังไม่ทราบหรือไม่แน่นอนว่าเป็นชนิดร้าย',
        codes: codeList(`
            D37 D370 D371 D372 D373 D374 D375 D376 D377 D379 D38 D380 D381 D382 D383 D384 D385 D386
            D39 D390 D391 D392 D397 D399 D400 D40 D401 D407 D409 D41 D410 D411 D412 D413 D414 D417 D419
            D42 D420 D421 D429 D43 D430 D431 D432 D433 D434 D437 D439 D44 D440 D441 D442 D443 D444 D445 D446 D447 D448 D449 D45 D46
            D460 D461 D462 D463 D464 D467 D469 D47 D470 D471 D472 D473 D474 D475 D477 D479 D48 D480 D481 D482 D483 D484 D485 D486 D487 D489
        `),
        accent: '#db2777',
        background: '#fdf2f8',
    },
    {
        id: 'heart-failure',
        title: 'กลุ่ม I50 — ภาวะหัวใจล้มเหลว',
        summary: 'หัวใจล้มเหลวชนิดต่าง ๆ',
        codes: codeList('I500 I501 I509'),
        accent: '#e11d48',
        background: '#fff1f2',
    },
    {
        id: 'cerebrovascular',
        title: 'กลุ่ม I60–I69 — โรคหลอดเลือดสมอง',
        summary: 'เลือดออกในสมอง สมองขาดเลือด หลอดเลือดสมองอุดตัน และผลสืบเนื่อง',
        codes: codeList(`
            I600 I601 I602 I603 I604 I605 I606 I607 I608 I609 I610 I611 I612 I613 I614 I615 I616 I618 I619 I620 I621
            I629 I630 I631 I632 I633 I634 I635 I636 I638 I639 I64 I650 I651 I652 I653 I658 I659 I660 I661 I662 I663 I664 I668
            I669 I670 I671 I672 I673 I674 I675 I676 I677 I678 I679 I680 I681 I682 I688 I690 I691 I692 I693 I694 I698
        `),
        accent: '#2563eb',
        background: '#eff6ff',
    },
    {
        id: 'copd',
        title: 'กลุ่ม J44 — COPD',
        summary: 'โรคปอดอุดกั้นเรื้อรัง',
        codes: codeList('J440 J441 J448 J449'),
        accent: '#0891b2',
        background: '#ecfeff',
    },
    {
        id: 'hepatic-failure',
        title: 'กลุ่ม K — ภาวะตับวาย',
        summary: 'ตับวายจากแอลกอฮอล์ สารพิษ ภาวะเฉียบพลัน เรื้อรัง หรือไม่ระบุชนิด',
        codes: codeList('K704 K717 K720 K721 K729'),
        accent: '#d97706',
        background: '#fffbeb',
    },
    {
        id: 'ckd5',
        title: 'กลุ่ม N — ไตเรื้อรังระยะที่ 5',
        summary: 'Chronic kidney disease, stage 5',
        codes: codeList('N185'),
        accent: '#059669',
        background: '#ecfdf5',
    },
    {
        id: 'palliative-service',
        title: 'กลุ่ม Z — รหัสบริการ Palliative',
        summary: 'Z51.5 Palliative care และ Z71.8 Other specified counselling/Advance care planning',
        codes: codeList('Z515 Z718'),
        accent: '#4f46e5',
        background: '#eef2ff',
    },
];

export const PALLIATIVE_DIAGNOSIS_CODE_COUNT = PALLIATIVE_DIAGNOSIS_GROUPS
    .reduce((total, group) => total + group.codes.length, 0);

````
