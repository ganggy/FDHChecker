# 🚀 QUICK START GUIDE - Fund Analysis Page

## 30-Second Setup

```bash
# Terminal 1: Start Backend
cd c:\xampp\htdocs\fdh_rect\server
node fast_server.js

# Terminal 2: Start Frontend
cd c:\xampp\htdocs\fdh_rect
npm run dev
```

**Open Browser**: http://localhost:5174

---

## 🎯 Quick Navigation

| Page | URL | Button |
|------|-----|--------|
| **Fund Analysis** | `#/fund-analysis` | 💰 Fund Analysis |
| Admin Dashboard | `#/admin` | 📊 Admin |
| Staff Page | `#/staff` | 👤 Staff |
| Test Page | `#/test` | 🧪 Test |

---

## 📊 What You'll See

### Main Fund Summary
```
🔵 สวัสดิการสังคม        [15 records]  ✓95%
🟣 ประกันสังคม           [10 records]  ✓90%
🔷 ประกันสุขภาพ          [25 records]  ✓98%
🟠 ทหารผ่านศึก           [20 records]  ✓92%
🔷 อสม                  [30 records]  ✓96%
```

### Subfund Details (Click to expand)
- Total records count
- Eligible vs ineligible breakdown
- Eligibility percentage
- Eligible and ineligible amounts
- Specific conditions required

### Color Coding
🟢 **Green (>80%)** - High eligibility  
🟡 **Amber (50-79%)** - Medium eligibility  
🔴 **Red (<50%)** - Low eligibility

---

## 🔍 Understanding the Data

### Example Record
```
VN: 690326080002
HN: 000013485
ผู้ป่วยนอก (Outpatient)
Fund: บัตรประกันสุขภาพ
Amount: ฿200
Status: เข้าเงื่อนไข (Eligible) ✓
```

### Eligibility Checks
- ✓ HN Present
- ✓ Patient Name Present
- ✓ Service Type Present
- ✓ Amount in Range (฿30-5000 for health insurance)
- ✓ Fund-specific requirements met

---

## 📈 Statistics Explained

| Label | Meaning |
|-------|---------|
| **📊 รวม** | Total records |
| **💚 เข้า** | Records meeting eligibility |
| **❌ ไม่เข้า** | Records not meeting eligibility |
| **💰 เบิกได้** | Total eligible amount (Baht) |
| **🚫 เบิกไม่ได้** | Total ineligible amount (Baht) |
| **📈 %** | Eligibility percentage |

---

## 🎨 UI Features

### Cards
- Click to expand/collapse subfund details
- Hover for shadow effect
- Color-coded by main fund

### Progress Bars
- Show eligibility percentage
- Color changes by rate
- Smooth animation

### Statistics
- Real-time calculations
- Formatted with Thai currency symbol (฿)
- Displayed in expandable sections

---

## 🔧 Troubleshooting

| Issue | Solution |
|-------|----------|
| Page won't load | Check backend: `http://localhost:3001/api/health` |
| No data showing | Verify API: `http://localhost:3001/api/hosxp/checks` |
| Thai text garbled | Ensure UTF-8 encoding in browser |
| API timeout | Restart backend server |
| Port in use | Change port in `server/fast_server.js` |

---

## 📞 API Endpoints

```bash
# Health Check
curl http://localhost:3001/api/health

# Get All Checks
curl http://localhost:3001/api/hosxp/checks

# Get All Funds
curl http://localhost:3001/api/hosxp/funds

# Get Fund Specific
curl "http://localhost:3001/api/hosxp/checks?fund=UCS"
```

---

## 💡 Tips

1. **Expand cards** by clicking on main fund names
2. **Sort** by eligibility percentage (highest first)
3. **Filter** using browser DevTools (F12)
4. **Export** data by opening browser console
5. **Mobile view** - responsive on all devices

---

## 🎓 Key Information

- **Backend Port**: 3001
- **Frontend Port**: 5174
- **Database**: HOSxP (192.168.2.254)
- **Total Records**: 100
- **Total Funds**: 11 (5 main × 12 subfunds)
- **Eligibility Rate**: ~95%

---

## ✅ Verification

Check if everything is working:

```powershell
# Backend running?
Invoke-WebRequest http://localhost:3001/api/health

# Frontend running?
Invoke-WebRequest http://localhost:5174/

# Data available?
Invoke-WebRequest http://localhost:3001/api/hosxp/checks
```

All returning status **200** = ✅ Ready to go!

---

## 🚀 You're All Set!

Your Fund Analysis Page is ready to use. Navigate to:

**http://localhost:5174/#/fund-analysis**

Enjoy! 🎉

---

**Last Updated**: March 18, 2026  
**Version**: 1.0.0
