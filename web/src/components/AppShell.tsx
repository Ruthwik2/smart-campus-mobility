'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { useAuth } from '@/stores/auth';
import { useLive } from '@/stores/live';
import { getSocket } from '@/lib/socket';
import { Spinner } from './ui';
import type { Role } from '@/lib/types';

/**
 * Wraps every authenticated page: bootstraps the session from the refresh
 * cookie, enforces the expected role, binds socket listeners once, and
 * renders the dispatch-board header.
 */
export function AppShell({ role, title, children }: { role: Role; title: string; children: ReactNode }) {
  const router = useRouter();
  const { user, booted, bootstrap, logout } = useAuth();
  const bind = useLive((s) => s.bind);

  useEffect(() => {
    if (!booted) void bootstrap();
  }, [booted, bootstrap]);

  useEffect(() => {
    if (!booted) return;
    if (!user) {
      router.replace('/login');
      return;
    }
    if (user.role !== role) {
      router.replace(user.role === 'DRIVER' ? '/driver' : user.role === 'ADMIN' ? '/admin' : '/passenger');
    }
  }, [booted, user, role, router]);

  useEffect(() => {
    const socket = getSocket();
    if (socket && user) return bind(socket, user.id);
  }, [user, bind]);

  if (!booted || !user || user.role !== role) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Spinner className="h-7 w-7" />
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-dvh max-w-5xl px-4 pb-16">
      <header className="flex items-center justify-between py-5">
        <div className="flex items-center gap-3">
          <BrandMark />
          <div>
            <p className="font-display text-[15px] font-bold leading-none">Campus Mobility</p>
            <p className="mt-0.5 text-[12px] text-slate2">{title}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden text-[13px] font-medium text-slate2 sm:block">{user.fullName}</span>
          <button
            className="btn-ghost !px-3 !py-2"
            onClick={async () => {
              await logout();
              router.replace('/login');
            }}
            aria-label="Log out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>
      <main className="space-y-4">{children}</main>
    </div>
  );
}

export function BrandMark({ className = 'h-9 w-9' }: { className?: string }) {
  return (
    <svg viewBox="0 0 36 36" className={className} aria-hidden>
      <rect width="36" height="36" rx="9" fill="#0E7A4E" />
      <path d="M8 23c4-9 7-9 10 0M18 23c3-7 5.5-7 8-1" stroke="#F7F6F1" strokeWidth="2.4" strokeLinecap="round" fill="none" />
      <circle cx="11" cy="25.5" r="2.4" fill="#F2B807" />
      <circle cx="24" cy="25.5" r="2.4" fill="#F2B807" />
    </svg>
  );
}
