document.getElementById('btnSync').addEventListener('click', async () => {
  const btn = document.getElementById('btnSync');
  const statusDiv = document.getElementById('status');

  btn.disabled = true;
  statusDiv.className = 'info';
  statusDiv.innerText = '⏳ กำลังดึง Cookie จาก CSOP...';

  try {
    // 1. Get cookies by URL and by domain to ensure nothing is missed
    const [byUrl, byDomain] = await Promise.all([
      chrome.cookies.getAll({ url: 'https://cs8.chi.or.th/csopupload' }).catch(() => []),
      chrome.cookies.getAll({ domain: 'cs8.chi.or.th' }).catch(() => []),
    ]);

    const cookieMap = new Map();
    for (const c of [...(byUrl || []), ...(byDomain || [])]) {
      if (c && c.name) cookieMap.set(c.name, c.value);
    }

    if (cookieMap.size === 0) {
      statusDiv.className = 'error';
      statusDiv.innerHTML = '❌ <strong>ไม่พบ Cookie ของ CSOP</strong><br>กรุณาเปิดแท็บ cs8.chi.or.th แล้วเข้าสู่ระบบก่อนครับ';
      btn.disabled = false;
      return;
    }

    const authCookieVal = cookieMap.get('CSOP.AspNetCore.Cookie') || '';
    if (!authCookieVal || authCookieVal.trim().length < 30) {
      statusDiv.className = 'error';
      statusDiv.innerHTML = '⚠️ <strong>ยังไม่ได้เข้าสู่ระบบในแท็บ CSOP</strong><br>กรุณาสลับไปที่แท็บ CSOP พิมพ์รหัสผู้ใช้/รหัสผ่าน กดกล่องยืนยัน และกดปุ่ม <strong>"เข้าสู่ระบบ"</strong> ให้เข้าไปในระบบก่อน แล้วค่อยกดปุ่มนี้อีกครั้งครับ';
      btn.disabled = false;
      return;
    }

    const cookieParts = [];
    for (const [name, val] of cookieMap.entries()) {
      cookieParts.push(`${name}=${val}`);
    }
    const cookieHeader = cookieParts.join('; ');

    statusDiv.innerText = '⏳ กำลังส่งข้อมูลเซสชันเข้า FDH Checker...';

    // Find FDH Checker tab or fallback to origin
    const tabs = await chrome.tabs.query({});
    let targetOrigin = 'http://147.50.107.211:3507';
    for (const t of tabs) {
      if (t.url && (t.url.includes(':3507') || t.url.includes('fdh') || t.title?.includes('FDH'))) {
        try {
          const u = new URL(t.url);
          targetOrigin = u.origin;
          break;
        } catch {}
      }
    }

    const res = await fetch(`${targetOrigin}/api/csop/session-cookie`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cookie: cookieHeader }),
    });

    const data = await res.json().catch(() => ({}));
    if (data.valid) {
      statusDiv.className = 'success';
      statusDiv.innerHTML = '✅ <strong>ส่งเซสชันสำเร็จ!</strong><br>เชื่อมต่อ CSOP เรียบร้อยแล้ว สลับกลับไปที่แท็บ FDH Checker ได้เลยครับ';
    } else {
      statusDiv.className = 'error';
      statusDiv.innerHTML = `❌ <strong>การตรวจสอบเซสชันไม่สำเร็จ:</strong><br>${data.message || data.error || 'กรุณาล็อกอินใหม่ในแท็บ CSOP'}`;
      btn.disabled = false;
    }
  } catch (err) {
    statusDiv.className = 'error';
    statusDiv.innerText = `❌ เกิดข้อผิดพลาด: ${err.message}`;
    btn.disabled = false;
  }
});
