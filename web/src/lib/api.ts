import axios, { AxiosError } from 'axios';
import type { ApiError } from './types';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/**
 * Access token lives in memory only — never localStorage — so XSS can't
 * exfiltrate a long-lived credential. Persistence across reloads comes from
 * the httpOnly refresh cookie: on boot the auth store calls /auth/refresh
 * and re-hydrates the session server-side.
 */
let accessToken: string | null = null;
export const setAccessToken = (t: string | null) => {
  accessToken = t;
};
export const getAccessToken = () => accessToken;

export const api = axios.create({
  baseURL: `${API_URL}/api/v1`,
  withCredentials: true, // carries the scm_refresh cookie to /auth/*
});

api.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

// ---- 401 → refresh → retry (single-flight) -----------------------------------
let refreshing: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  try {
    const { data } = await axios.post<{ accessToken: string }>(
      `${API_URL}/api/v1/auth/refresh`,
      {},
      { withCredentials: true },
    );
    setAccessToken(data.accessToken);
    return data.accessToken;
  } catch {
    setAccessToken(null);
    return null;
  }
}

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError<ApiError>) => {
    const original = error.config as typeof error.config & { _retried?: boolean };
    const code = error.response?.data?.error?.code;

    if (
      error.response?.status === 401 &&
      (code === 'TOKEN_INVALID' || code === 'UNAUTHENTICATED') &&
      original &&
      !original._retried &&
      !original.url?.includes('/auth/')
    ) {
      original._retried = true;
      refreshing ??= refreshAccessToken().finally(() => {
        refreshing = null;
      });
      const token = await refreshing;
      if (token) {
        original.headers = original.headers ?? {};
        (original.headers as Record<string, string>).Authorization = `Bearer ${token}`;
        return api(original);
      }
    }
    return Promise.reject(error);
  },
);

export function errorMessage(e: unknown, fallback = 'Something went wrong') {
  if (axios.isAxiosError<ApiError>(e)) return e.response?.data?.error?.message ?? e.message ?? fallback;
  if (e instanceof Error) return e.message;
  return fallback;
}
