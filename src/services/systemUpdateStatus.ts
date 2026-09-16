export async function fetchSystemUpdateStatus(refreshRemote = false, timeoutMs = refreshRemote ? 60000 : 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`/api/admin/system-update?refresh=${refreshRemote ? '1' : '0'}`, {
      cache: 'no-store', signal: controller.signal,
    });
    if (response.status === 401 || response.status === 403) throw new Error('กรุณาเข้าสู่ระบบด้วยบัญชีผู้ดูแลระบบอีกครั้งเพื่อตรวจผลอัปเดต');
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.success !== true || !payload.data || typeof payload.data.currentCommit !== 'string') {
      throw new Error('ยังอ่านสถานะอัปเดตจากเซิร์ฟเวอร์ไม่ได้ ระบบจะลองเชื่อมต่อใหม่');
    }
    return payload.data;
  } catch (error) {
    if (controller.signal.aborted) throw new Error('เซิร์ฟเวอร์ตอบสถานะช้า ระบบจะลองเชื่อมต่อใหม่');
    throw error;
  } finally { clearTimeout(timer); }
}
