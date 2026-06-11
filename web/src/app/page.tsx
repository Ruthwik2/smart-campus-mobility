import Link from 'next/link';
import { BrandMark } from '@/components/AppShell';

export default function Landing() {
  return (
    <div className="mx-auto grid min-h-dvh max-w-md place-items-center px-6">
      <div className="w-full space-y-8 text-center">
        <div className="flex flex-col items-center gap-4">
          <BrandMark className="h-16 w-16" />
          <div>
            <h1 className="font-display text-3xl font-bold">Smart Campus Mobility</h1>
            <p className="mt-2 text-[15px] text-slate2">
              Real-time e-rickshaw dispatch for campus. Request, ride, rate — without the wait at the gate.
            </p>
          </div>
        </div>
        <div className="space-y-3">
          <Link href="/login" className="btn-primary w-full">Log in</Link>
          <Link href="/register" className="btn-ghost w-full">Create an account</Link>
        </div>
        <p className="text-[12px] text-slate2/80">Passengers · Drivers · Transport office</p>
      </div>
    </div>
  );
}
