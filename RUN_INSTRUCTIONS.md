# 🚀 FDH RECT SYSTEM - RUN INSTRUCTIONS

**Date:** March 24, 2026  
**Status:** ✅ Ready to Run  
**Project:** FDH Checker System (95% Complete - Testing Phase)

---

## ⚡ QUICK START (Recommended)

### Option 1: Click & Run (Easiest)

Simply double-click this file:
```
d:\react\fdh_rect\RUN_SYSTEM.bat
```

**This will:**
- Start Backend Server (Port 3506) in a new window
- Start Frontend Dev Server (Port 3507) in a new window  
- Show status messages
- Tell you when to open the browser

**Wait 2-3 minutes**, then open: `http://localhost:3507`

---

## 📝 Alternative: Start Servers Separately

### Option 2A: Start Backend Only
```
d:\react\fdh_rect\START_BACKEND.bat
```

Then start frontend in a different terminal.

### Option 2B: Start Frontend Only
```
d:\react\fdh_rect\START_FRONTEND.bat
```

Then start backend in a different terminal.

---

## 🖥️ Manual Command Line Start

### Terminal 1 - Backend Server (Port 3506)
```bash
cd d:\react\fdh_rect\server
npm run dev
```

Expected output:
```
Server running on port 3506
✅ Database connected
```

### Terminal 2 - Frontend Server (Port 3507)
```bash
cd d:\react\fdh_rect
npm run dev
```

Expected output:
```
ready in 45ms (Vite dev server)
```

---

## 📊 System Ports

| Service | URL | Status |
|---------|-----|--------|
| Backend API | http://localhost:3506 | ✅ Ready |
| Frontend App | http://localhost:3507 | ✅ Ready |
| Database | Configured in .env | ✅ Ready |

---

## ⏱️ Startup Timeline

| Step | Time | Notes |
|------|------|-------|
| Backend Start | ~5-10s | Shows "Server running on port 3506" |
| Frontend Build | ~30-60s | First time takes longer |
| Total Startup | ~2-3 min | Subsequent restarts are faster |

---

## ✅ What to Do After Startup

### 1. Monitor the Startup Process
- Watch both terminal windows for errors
- Backend should show "Server running on port 3506"
- Frontend should show "ready in X ms"

### 2. Open in Browser
Once both servers show "ready" messages, open:
```
http://localhost:3507
```

### 3. Test Core Features
- [ ] Check if page loads
- [ ] Test navigation
- [ ] Verify no console errors (Press F12)
- [ ] Test drug data display
- [ ] Test summary cards position
- [ ] Test 16-file export

### 4. Monitor Logs
- Backend terminal: Watch for API calls and errors
- Frontend terminal: Watch for build warnings
- Browser Console (F12): Should be clean

---

## 🔍 Troubleshooting

### Backend Won't Start

**Problem:** "Port 3506 already in use"
```powershell
# Kill existing Node processes
taskkill /IM node.exe /F

# Then try again
npm run dev
```

**Problem:** "Database connection error"
- Check `.env` file in `/server` folder
- Verify database credentials
- Verify database is running

**Problem:** "Cannot find module 'mysql2'"
```bash
cd d:\react\fdh_rect\server
npm install
```

### Frontend Won't Start

**Problem:** "Port 3507 already in use"
```bash
# Kill Node and try again
taskkill /IM node.exe /F
npm run dev
```

**Problem:** "npm ERR! ENOENT: no such file or directory"
```bash
cd d:\react\fdh_rect
npm install
```

**Problem:** "Compilation failed"
```bash
# Clear cache and rebuild
npm cache clean --force
npm install
npm run dev
```

### Database Connection Issues

**Problem:** Can't connect to database
1. Check database is running
2. Check connection string in `.env`
3. Check credentials are correct
4. Check network connectivity
5. Check firewall rules

---

## 📚 Documentation

**Get started with:**
1. `BACKUP_COMPLETE.md` - Quick overview (5 min)
2. `MASTER_PROJECT_INDEX_MARCH_23.md` - Navigation guide (15 min)
3. `FINAL_STATUS_REPORT.md` - Detailed status (10 min)
4. `SETUP_AND_RUN_GUIDE.md` - Full setup instructions

**For recovery:**
- `BACKUP_RESTORATION_GUIDE.md` - How to restore backups

**For reference:**
- All 25+ documentation files in project root

---

## 🎯 Next Testing Steps

After system is running:

### Priority 1: System Verification (5-10 min)
- Verify servers are responding
- Check database connection
- Monitor console for errors

### Priority 2: Core Features Test (15-20 min)
- Drug data display (no mock data)
- Summary cards position
- Navigation and UI rendering
- No console errors

### Priority 3: Export Functionality (15-20 min)
- Test 16-file export
- Verify ZIP generation
- Check all 16 files present
- Verify file data accuracy

### Priority 4: Performance Check (10-15 min)
- Response times < 2 seconds
- No memory leaks
- CPU usage reasonable
- No database errors

---

## 📋 Files Created

All in `d:\react\fdh_rect\`:

| File | Purpose |
|------|---------|
| `RUN_SYSTEM.bat` | Start both servers (RECOMMENDED) |
| `START_BACKEND.bat` | Start only backend |
| `START_FRONTEND.bat` | Start only frontend |
| `RUN_INSTRUCTIONS.md` | This file |

---

## 🎉 You're Ready!

### Start the System Now:
```
👉 Double-click: d:\react\fdh_rect\RUN_SYSTEM.bat
```

Or from PowerShell:
```powershell
& 'd:\react\fdh_rect\RUN_SYSTEM.bat'
```

---

## 📞 Quick Reference

### URLs After Startup
- **Frontend:** http://localhost:3507 ← Open this in browser
- **API Docs:** http://localhost:3506 (if available)
- **Database:** Check .env for connection

### Key Commands
```bash
# View backend logs
# (Check backend terminal window)

# View frontend logs  
# (Check frontend terminal window)

# Stop servers
# Close the terminal windows or press Ctrl+C

# Restart servers
# Close windows and run RUN_SYSTEM.bat again
```

### Important Paths
- Project Root: `d:\react\fdh_rect`
- Backend: `d:\react\fdh_rect\server`
- Frontend: `d:\react\fdh_rect\src`
- Config: `d:\react\fdh_rect\.env`

---

**Generated:** March 24, 2026  
**Status:** ✅ System Ready for Testing  
**Completion:** 95% (Testing Phase)

