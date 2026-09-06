# FDH Checker Mobile

โปรเจกต์นี้ใช้ React/Vite ชุดเดียวกับเว็บและแพ็กเป็นแอป iOS, iPadOS และ Android ด้วย Capacitor

## สิ่งที่เพิ่มแล้ว

- Adaptive navigation สำหรับโทรศัพท์และแท็บเล็ต
- Bottom navigation สำหรับเมนูงานหลัก และ drawer สำหรับทุกเมนู
- Safe area สำหรับจอที่มี notch/home indicator
- Touch target ขั้นต่ำ 44px และตารางแบบเลื่อนด้วยการสัมผัส
- รองรับแนวตั้ง แนวนอน และ reduced motion
- Native projects ใน `ios/` และ `android/`
- ไอคอนและ splash screen ของ FDH Checker
- Bearer authentication สำหรับ API และ AI บน native WebView
- ตั้งค่า HTTPS API endpoint จากหน้า Login ได้ โดยไม่ต้อง build แอปใหม่

## เตรียม API ก่อน build

แอปไม่เชื่อมต่อ MySQL/HOSxP โดยตรง ทุกคำขอต้องผ่าน FDH Checker API บน HTTPS

สามารถกำหนด API ล่วงหน้าใน `.env.production` สำหรับ frontend build:

```env
VITE_API_URL=https://fdh-api.example.go.th
```

บนเครื่อง API ให้เพิ่ม origin ของเว็บและ native app:

```env
NODE_ENV=production
CORS_ORIGINS=https://fdh.example.go.th,capacitor://localhost,https://localhost
TRUST_PROXY=1
```

ห้ามใช้ `localhost` เป็น `VITE_API_URL` สำหรับ build ที่ติดตั้งบนอุปกรณ์ เพราะ localhost จะหมายถึงโทรศัพท์หรือแท็บเล็ตเครื่องนั้น

หากไม่ได้กำหนด `VITE_API_URL` แอปจะเปิดหน้าตั้งค่าเซิร์ฟเวอร์อัตโนมัติก่อน Login และยอมรับเฉพาะ HTTPS URL

หาก API อยู่เฉพาะเครือข่ายโรงพยาบาล อุปกรณ์ต้องเชื่อม Wi-Fi ภายในหรือ VPN และใบรับรอง HTTPS ต้องได้รับความเชื่อถือจากอุปกรณ์

## คำสั่งที่ใช้บ่อย

```bash
# build เว็บและคัดลอกเข้า native projects
npm run mobile:sync

# ตรวจ dependency และ native projects
npm run mobile:doctor

# เปิดโปรเจกต์
npm run mobile:open:ios
npm run mobile:open:android

```

ทุกครั้งที่แก้ React/CSS หรือเปลี่ยน `VITE_API_URL` ให้รัน `npm run mobile:sync` ก่อน build ใน Xcode/Android Studio

## Android

ต้องมี Android Studio พร้อม Android SDK และ JDK ที่รองรับ Gradle ของโปรเจกต์

1. รัน `npm run mobile:open:android`
2. เลือก emulator หรือ Android device ที่เปิด USB debugging
3. กด Run เพื่อทดสอบ
4. สร้างไฟล์ติดตั้งภายในด้วย `Build > Build APK(s)`
5. สำหรับ Play Store ใช้ `Build > Generate Signed Bundle / APK > Android App Bundle`

เมื่อติดตั้ง JDK แล้ว สามารถสร้าง debug APK จาก command line ได้ด้วย:

```bash
npm run mobile:build:android
```

ไฟล์จะอยู่ที่ `android/app/build/outputs/apk/debug/app-debug.apk`

## iOS และ iPadOS

ต้องมี Xcode ตัวเต็ม ไม่ใช่ Command Line Tools อย่างเดียว

หลังติดตั้ง Xcode ครั้งแรก ต้องเปิด Xcode และยอมรับ license/first-launch setup ให้ครบก่อน

1. รัน `npm run mobile:open:ios`
2. เลือก Team ใน Signing & Capabilities
3. ตรวจ Bundle Identifier ก่อนเผยแพร่
4. ทดสอบทั้ง iPhone และ iPad simulator/device
5. ใช้ Product > Archive เพื่อส่ง TestFlight/App Store

Simulator build จาก command line:

```bash
npm run mobile:build:ios:sim
```

## ค่าที่ต้องยืนยันก่อนเผยแพร่จริง

- `appId` ใน `capacitor.config.ts` ปัจจุบันคือ `com.fdhchecker.mobile`
- Bundle Identifier/Application ID ต้องกำหนดให้ถาวรก่อนสร้างรายการใน Store
- ชื่อโรงพยาบาลและข้อความ privacy policy
- App Store/Play Store screenshots สำหรับโทรศัพท์และแท็บเล็ต
- Apple signing certificate, provisioning profile และ Android upload key
- ทดสอบ login, logout, session expiry, upload/download และทุก workflow ที่ใช้ไฟล์บนอุปกรณ์จริง
- ตรวจนโยบายเก็บข้อมูลผู้ป่วย ห้าม cache/export ข้อมูลเกินความจำเป็น

## สถานะการตรวจสอบใน workspace นี้

- TypeScript/Vite production build: ผ่าน
- Capacitor Doctor สำหรับ iOS/Android: ผ่าน
- Adaptive shell: ผ่านที่ 390x844, 820x1180 และ 1440x900
- Android debug APK: build, verify signature, install และเปิดบน Android 16 emulator สำเร็จ
- Android artifact: `mobile-builds/FDHChecker-android-debug-1.0.apk`
- iOS Simulator build: build, install และเปิดบน iPhone 17 Pro และ iPad Air 11-inch Simulator สำเร็จ
- iOS Simulator artifact: `mobile-builds/FDHChecker-ios-simulator-1.0.zip`
- ภาพผลทดสอบ iOS: `mobile-builds/FDHChecker-ios-iphone-simulator.png` และ `mobile-builds/FDHChecker-ios-ipad-simulator.png`
- การสร้างไฟล์สำหรับเครื่องจริง/TestFlight ยังต้องเลือก Apple Developer Team และตั้งค่า signing ใน Xcode
