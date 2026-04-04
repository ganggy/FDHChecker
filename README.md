# 🏥 HOSxP Fund Check System

ระบบตรวจสอบความสมบูรณ์ของข้อมูลการเบิกจ่ายกองทุนต่างๆ จากฐานข้อมูล HOSxP

![Status](https://img.shields.io/badge/status-production%20ready-brightgreen)
![Version](https://img.shields.io/badge/version-1.0.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)

## 🎯 วัตถุประสงค์

- ✅ ตรวจสอบความสมบูรณ์ของข้อมูลเบิกจ่ายแบบ Real-time
- ✅ ระบุปัญหาและข้อมูลที่ขาดหาย
- ✅ ส่งข้อมูลไปยังระบบ FDH อย่างถูกต้อง
- ✅ ให้ภาพรวมแก่ผู้บริหารและรายละเอียดแก่เจ้าหน้าที่
- ✅ รองรับทุกกองทุน (16+ กองทุนและกองทุนย่อย)

## 🎓 ระบบตรวจสอบสามชั้น

### 1. Basic Validation (6 ฟิลด์)
```
✅ HN (เลขประจำตัวผู้ป่วย)
✅ ชื่อผู้ป่วย
✅ กองทุน
✅ ราคา
✅ วันที่บริการ
✅ ประเภทบริการ
```

### 2. Detailed Validation (+ 3 รหัส)
```
✅ รหัสยา (Drug Code)
✅ รหัสหัตถการ (Procedure Code)
✅ รหัสสิทธิ์ (Right Code)
```

### 3. Sub-fund Intelligence
```
✅ Auto-detect กองทุนย่อย (AE suffix)
✅ Categorize fund type
✅ Track complex fund names
```

## 🚀 เริ่มต้นอย่างรวดเร็ว

### ติดตั้ง
```bash
cd c:\xampp\htdocs\fdh_rect
npm install
```

### รัน Frontend
```bash
npm run dev
```
จากนั้นเปิด: **http://localhost:5174**

### รัน Backend Server (ตัวเลือก)
```bash
npm run server
```
Server จะรัน: **http://localhost:3001**

## 📋 ฟีเจอร์

### 👤 หน้างานเจ้าหน้าที่
- ค้นหารายการตามเลขที่ HN หรือชื่อผู้ป่วย
- กรองตามสถานะ (สมบูรณ์/ไม่สมบูรณ์)
- กรองตามช่วงวันที่
- ดูรายละเอียดเชิงลึก (Modal)
- Export CSV และ Excel
- รายการปัญหาและข้อเสนอแนะ

### 📊 แดชบอร์ดผู้บริหาร
- สถิติรวม (ทั้งหมด, สมบูรณ์, ไม่สมบูรณ์, ตรวจสอบแล้ว)
- อัตราความสมบูรณ์
- มูลค่ารวมของเบิกจ่าย
- แยกสถิติตามกองทุน
- ข้อมูลสำคัญและการเตือน

## 🔧 โครงสร้างเทคนิค

```
Frontend: React 19 + TypeScript + Vite
Backend: Node.js + Express.js
Database: MySQL (HOSxP + rcmdb)
API: RESTful API
```

## 📁 โครงสร้างไฟล์

```
fdh_rect/
├── src/
│   ├── components/          # React Components
│   ├── pages/               # Pages (Staff, Admin)
│   ├── services/            # API Services
│   ├── hooks/               # Custom Hooks
│   ├── mockData.ts          # Mock Data
│   └── App.tsx              # Main App
├── server/
│   └── index.ts             # Express Server
├── public/                  # Static Assets
└── package.json             # Dependencies
```

## 🌐 API Endpoints

| Endpoint | Method | ใช้งาน |
|----------|--------|-------|
| `/api/hosxp/checks` | GET | ดึงรายการตรวจสอบ |
| `/api/hosxp/patients/:hn` | GET | ดึงข้อมูลผู้ป่วย |
| `/api/hosxp/services/:code` | GET | ดึงข้อมูลบริการ |
| `/api/hosxp/drugs/:code` | GET | ดึงข้อมูลยา |
| `/api/rcmdb/:type` | GET | ดึงข้อมูล REP/STM/INV |
| `/api/fdh/submit` | POST | ส่งข้อมูลไปยัง FDH |
| `/api/health` | GET | Health Check |

## 🔐 การตั้งค่าฐานข้อมูล

### ไฟล์ `.env`
```env
HOSXP_HOST=192.168.2.254
HOSXP_USER=opd
HOSXP_PASSWORD=opd
HOSXP_DB=hos

RCMDB_HOST=localhost
RCMDB_USER=root
RCMDB_PASSWORD=
RCMDB_DB=rcmdb

PORT=3001
```

## 📊 ตัวอย่างข้อมูล

```json
{
  "id": 1,
  "hn": "123456",
  "patientName": "นายสมชาย ใจดี",
  "fund": "UCS",
  "serviceDate": "2026-03-15",
  "serviceType": "OPD",
  "status": "สมบูรณ์",
  "issues": [],
  "price": 1200
}
```

## 🎨 UI Preview

- **Navbar**: Navigation ระหว่าง Staff และ Admin
- **CheckTable**: ตารางรายการตรวจสอบสี
- **DetailModal**: Pop-up รายละเอียดเชิงลึก
- **DashboardStats**: บัตรสถิติแดชบอร์ด
- **Filters**: ค้นหา กรอง วันที่

## 📝 Scripts

```bash
npm run dev          # รัน dev server
npm run build        # Build for production
npm run server       # รัน backend server
npm run lint         # Run ESLint
npm run preview      # Preview production build
```

## 🔄 Real-time Updates

ระบบสามารถอัปเดตข้อมูลแบบ Real-time:
- Polling ทุก 5 นาที
- Manual refresh
- WebSocket (future)

## ⚠️ สถานะข้อมูล

| สถานะ | ความหมาย |
|------|---------|
| สมบูรณ์ | ข้อมูลครบถ้วน พร้อมเบิก |
| ไม่สมบูรณ์ | ขาดข้อมูล ต้องแก้ไข |
| ตรวจสอบแล้ว | ผ่านการตรวจสอบ ส่งไปแล้ว |

## 🐛 Troubleshooting

### Port 5173 อยู่ใช้งาน
```bash
npm run dev -- --port 5174
```

### ไม่สามารถเชื่อมต่อฐานข้อมูล
- ตรวจสอบไฟล์ `.env`
- ตรวจสอบ IP address และ port
- ตรวจสอบ username/password

### API ไม่ตอบสนอง
- ตรวจสอบว่า backend server กำลังรัน
- ตรวจสอบ proxy ใน vite.config.ts
- ดูข้อมูล CORS settings

## 📚 เอกสารเพิ่มเติม

- [DEVELOPMENT.md](./DEVELOPMENT.md) - คู่มือการพัฒนา
- [SERVER_SETUP.md](./SERVER_SETUP.md) - การตั้งค่าเซิร์ฟเวอร์
- API Documentation (ในไฟล์ services)

## 🤝 การมีส่วนร่วม

ยินดีต้อนรับการมีส่วนร่วม! โปรดส่ง Pull Request หรือเปิด Issue

## 📄 License

MIT License - ใช้ได้ตามสิทธิ์

## 👨‍💻 Developer

สร้างโดย GitHub Copilot  
เขียนวันที่: 15 มีนาคม 2026

## 📞 ติดต่อ

สำหรับคำถามหรือปัญหา:
- Email: support@example.com
- GitHub Issues: https://github.com/example/issues
- Documentation: Wiki

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
#   F D H C h e c k e r  
 