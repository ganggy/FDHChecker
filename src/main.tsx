import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import ErrorBoundary from './ErrorBoundary.tsx'
import { getEffectiveApiBaseUrl } from './services/apiEndpointService.ts'

const AUTH_TOKEN_KEY = 'fdh-auth-token';

const installApiFallbackFetch = () => {
  const nativeFetch = window.fetch.bind(window);
  const candidatePorts = ['3506', '3001'];

  const isAbortError = (error: unknown) => {
    return error instanceof DOMException && error.name === 'AbortError';
  };

  const buildApiCandidates = (apiPath: string): string[] => {
    const urls: string[] = [];
    const preferredBase = getEffectiveApiBaseUrl();
    const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
    const host = window.location.hostname;
    const currentPort = window.location.port;

    if (preferredBase) {
      const trimmed = preferredBase.replace(/\/+$/, '');
      urls.push(`${trimmed}${apiPath}`);
    }

    for (const port of candidatePorts) {
      if (port !== currentPort) {
        urls.push(`${protocol}//${host}:${port}${apiPath}`);
      }
    }

    return Array.from(new Set(urls));
  };

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const isStringInput = typeof input === 'string';
    const requestUrl = isStringInput
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;

    const parsedRequestUrl = new URL(requestUrl, window.location.origin);
    const isApiPath = parsedRequestUrl.pathname.startsWith('/api/');
    if (!isApiPath) {
      return nativeFetch(input, init);
    }

    const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    const authorizedInit: RequestInit = { ...init, headers };

    const handleUnauthorized = (response: Response) => {
      const isPublicAuthRequest = ['/api/auth/login', '/api/auth/register'].includes(parsedRequestUrl.pathname);
      const appSessionIsInvalid = response.headers.get('x-fdh-auth-status') === 'invalid';
      if (response.status === 401 && appSessionIsInvalid && !isPublicAuthRequest && localStorage.getItem(AUTH_TOKEN_KEY)) {
        localStorage.removeItem(AUTH_TOKEN_KEY);
        window.dispatchEvent(new CustomEvent('fdh:unauthorized'));
      }
      return response;
    };

    let firstResponse: Response | null = null;
    try {
      firstResponse = await nativeFetch(input, authorizedInit);
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
    }
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

    if (!shouldTryFallback && firstResponse) {
      return handleUnauthorized(firstResponse);
    }

    const candidates = buildApiCandidates(`${parsedRequestUrl.pathname}${parsedRequestUrl.search}`);
    let fallbackResponse: Response | null = null;
    for (const candidateUrl of candidates) {
      try {
        const response = await nativeFetch(candidateUrl, authorizedInit);
        if (response.ok) {
          return handleUnauthorized(response);
        }
        fallbackResponse = response;
        const fallbackContentType = response.headers.get('content-type') || '';
        if (!fallbackContentType.toLowerCase().includes('text/html')) {
          return handleUnauthorized(response);
        }
      } catch (error) {
        if (isAbortError(error)) {
          throw error;
        }
        // try next candidate
      }
    }

    if (firstResponse && !looksLikeWrongServerHtml) {
      return handleUnauthorized(firstResponse);
    }
    if (fallbackResponse) {
      return handleUnauthorized(fallbackResponse);
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
