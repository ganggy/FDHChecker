document.getElementById('btnSync').addEventListener('click', async () => {
  const btn = document.getElementById('btnSync');
  const statusDiv = document.getElementById('status');

  btn.disabled = true;
  statusDiv.className = 'info';
  statusDiv.innerText = '⏳ กำลังดึง Cookie จาก CSOP...';

  try {
    const cookies = await chrome.cookies.getAll({ domain: 'cs8.chi.or.th' });
    if (!cookies || cookies.length === 0) {
      statusDiv.className = 'error';
      statusDiv.innerText = '❌ ไม่พบ Cookie ของ CSOP กรุณาเปิดแท็บ cs8.chi.or.th แล้วเข้าสู่ระบบก่อน';
      btn.disabled = false;
      return;
    }

    const cookieParts = cookies.map((c) => `${c.name}=${c.value}`);
    const cookieHeader = cookieParts.join('; ');

    const hasAuthCookie = cookieParts.some((c) => c.startsWith('CSOP.AspNetCore.Cookie='));
    if (!hasAuthCookie) {
      statusDiv.className = 'error';
      statusDiv.innerText = '⚠️ ยังไม่พบเซสชันการล็อกอิน CSOP.AspNetCore.Cookie กรุณาเข้าสู่ระบบในแท็บ CSOP ก่อนกดส่ง';
      btn.disabled = false;
      return;
    }

    statusDiv.innerText = '⏳ กำลังส่งข้อมูลเซสชันเข้า FDH Checker...';

    // Check active tab to find FDH Checker origin
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

    const data = await res.json();
    if (data.valid) {
      statusDiv.className = 'success';
      statusDiv.innerHTML = '✅ <strong>ส่งเซสชันสำเร็จ!</strong><br>สลับกลับไปที่หน้าจอ FDH Checker ได้เลยครับ';
    } else {
      statusDiv.className = 'error';
      statusDiv.innerText = `❌ ${data.message || 'การตรวจสอบเซสชันล้มเหลว'}`;
      btn.disabled = false;
    }
  } catch (err) {
    statusDiv.className = 'error';
    statusDiv.innerText = `❌ เกิดข้อผิดพลาด: ${err.message}`;
    btn.disabled = false;
  }
});
