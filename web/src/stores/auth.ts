'use client';

import { create } from 'zustand';
import axios from 'axios';
import { api, API_URL, setAccessToken } from '@/lib/api';
import { connectSocket, disconnectSocket } from '@/lib/socket';
import type { User } from '@/lib/types';

interface AuthState {
  user: User | null;
  booted: boolean; // initial refresh attempt finished
  loading: boolean;
  bootstrap: () => Promise<void>;
  login: (email: string, password: string) => Promise<User>;
  registerPassenger: (input: { fullName: string; email: string; password: string; phone?: string }) => Promise<User>;
  registerDriver: (input: {
    fullName: string;
    email: string;
    password: string;
    phone?: string;
    vehicleType: string;
    vehiclePlate: string;
    vehicleModel: string;
    licenseNumber: string;
    capacity?: number;
  }) => Promise<User>;
  logout: () => Promise<void>;
  setUser: (u: User) => void;
}

/** The role hint cookie lets Next middleware route '/' to the right home. UX only — authz lives at the API. */
function setRoleCookie(role: string | null) {
  if (typeof document === 'undefined') return;
  if (role) document.cookie = `scm_role=${role}; path=/; max-age=${7 * 86400}; samesite=lax`;
  else document.cookie = 'scm_role=; path=/; max-age=0';
}

function adoptSession(set: (p: Partial<AuthState>) => void, user: User, accessToken: string) {
  setAccessToken(accessToken);
  setRoleCookie(user.role);
  set({ user });
  connectSocket();
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  booted: false,
  loading: false,

  /** On first load, try to mint a session from the httpOnly refresh cookie. */
  bootstrap: async () => {
    try {
      const { data } = await axios.post<{ accessToken: string; user: User }>(
        `${API_URL}/api/v1/auth/refresh`,
        {},
        { withCredentials: true },
      );
      adoptSession(set, data.user, data.accessToken);
    } catch {
      setAccessToken(null);
      setRoleCookie(null);
      set({ user: null });
    } finally {
      set({ booted: true });
    }
  },

  login: async (email, password) => {
    set({ loading: true });
    try {
      const { data } = await api.post<{ accessToken: string; user: User }>('/auth/login', { email, password });
      adoptSession(set, data.user, data.accessToken);
      return data.user;
    } finally {
      set({ loading: false });
    }
  },

  registerPassenger: async (input) => {
    set({ loading: true });
    try {
      const { data } = await api.post<{ accessToken: string; user: User }>('/auth/register', input);
      adoptSession(set, data.user, data.accessToken);
      return data.user;
    } finally {
      set({ loading: false });
    }
  },

  registerDriver: async (input) => {
    set({ loading: true });
    try {
      const { data } = await api.post<{ accessToken: string; user: User }>('/auth/register/driver', input);
      adoptSession(set, data.user, data.accessToken);
      return data.user;
    } finally {
      set({ loading: false });
    }
  },

  logout: async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      /* best effort */
    }
    setAccessToken(null);
    setRoleCookie(null);
    disconnectSocket();
    set({ user: null });
  },

  setUser: (u) => set({ user: u }),
}));
