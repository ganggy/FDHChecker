import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import ErrorBoundary from './ErrorBoundary.tsx'

const installApiFallbackFetch = () => {
  const nativeFetch = window.fetch.bind(window);
  const candidatePorts = ['3506', '3001'];
  const envBase = (import.meta.env.VITE_API_URL as string | undefined)?.trim();

  const buildApiCandidates = (apiPath: string): string[] => {
    const urls: string[] = [];
    const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
    const host = window.location.hostname;
    const currentPort = window.location.port;

    if (envBase) {
      const trimmed = envBase.replace(/\/+$/, '');
      urls.push(`${trimmed}${apiPath}`);
    }

    for (const port of candidatePorts) {
      if (port !== currentPort) {
        urls.push(`${protocol}//${host}:${port}${apiPath}`);
      }
    }

    return Array.from(new Set(urls));
  };

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const isStringInput = typeof input === 'string';
    const requestUrl = isStringInput
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;

    const isApiPath = requestUrl.startsWith('/api/');
    if (!isApiPath) {
      return nativeFetch(input, init);
    }

    const firstResponse = await nativeFetch(input, init).catch(() => null);
    const contentType = firstResponse?.headers.get('content-type') || '';
    const looksLikeWrongServerHtml =
      !!firstResponse &&
      firstResponse.ok &&
      contentType.toLowerCase().includes('text/html');

    const shouldTryFallback =
      !firstResponse ||
      firstResponse.status === 404 ||
      firstResponse.status === 502 ||
      firstResponse.status === 503 ||
      looksLikeWrongServerHtml;

    if (!shouldTryFallback) {
      return firstResponse;
    }

    const candidates = buildApiCandidates(requestUrl);
    for (const candidateUrl of candidates) {
      try {
        const response = await nativeFetch(candidateUrl, init);
        if (response.ok) {
          return response;
        }
      } catch {
        // try next candidate
      }
    }

    if (firstResponse) {
      return firstResponse;
    }

    throw new Error('ไม่สามารถเชื่อมต่อ API ได้');
  };
};

installApiFallbackFetch();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
