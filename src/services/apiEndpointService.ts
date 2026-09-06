import { Capacitor } from '@capacitor/core';

export const API_BASE_URL_KEY = 'fdh-api-base-url';

const bundledApiBase = (import.meta.env.VITE_API_URL as string | undefined)?.trim() || '';

const normalizeApiBaseUrl = (value: string) => {
  const rawValue = value.trim();
  if (!rawValue) return '';

  let parsed: URL;
  try {
    parsed = new URL(rawValue);
  } catch {
    throw new Error('URL เซิร์ฟเวอร์ไม่ถูกต้อง');
  }

  if (!['https:', 'http:'].includes(parsed.protocol)) {
    throw new Error('รองรับเฉพาะ URL แบบ HTTPS');
  }
  if (Capacitor.isNativePlatform() && parsed.protocol !== 'https:') {
    throw new Error('แอปมือถือต้องเชื่อมต่อเซิร์ฟเวอร์ผ่าน HTTPS เท่านั้น');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('URL ต้องไม่มี username, password, query หรือ hash');
  }

  parsed.pathname = parsed.pathname.replace(/\/+$/, '').replace(/\/api$/i, '');
  return parsed.toString().replace(/\/+$/, '');
};

export const getSavedApiBaseUrl = () => localStorage.getItem(API_BASE_URL_KEY)?.trim() || '';

export const getEffectiveApiBaseUrl = () => getSavedApiBaseUrl() || bundledApiBase;

export const saveApiBaseUrl = (value: string) => {
  const normalized = normalizeApiBaseUrl(value);
  if (normalized) localStorage.setItem(API_BASE_URL_KEY, normalized);
  else localStorage.removeItem(API_BASE_URL_KEY);
  return normalized;
};

export const clearSavedApiBaseUrl = () => localStorage.removeItem(API_BASE_URL_KEY);

export const isNativeApp = () => Capacitor.isNativePlatform();
