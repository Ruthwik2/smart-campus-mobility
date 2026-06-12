'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '@/stores/auth';
import { errorMessage } from '@/lib/api';
import { Field, Spinner } from '@/components/ui';
import { BrandMark } from '@/components/AppShell';

const schema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});
type FormData = z.infer<typeof schema>;

const homeFor = (role: string) => (role === 'DRIVER' ? '/driver' : role === 'ADMIN' ? '/admin' : '/passenger');

export default function LoginPage() {
  const router = useRouter();
  const { login, loading, user, booted, bootstrap } = useAuth();
  const [serverError, setServerError] = useState<string | null>(null);

  // Already signed in (refresh cookie) → skip the form.
  useEffect(() => {
    if (!booted) void bootstrap();
    else if (user) router.replace(homeFor(user.role));
  }, [booted, user, bootstrap, router]);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  const onSubmit = handleSubmit(async (data) => {
    setServerError(null);
    try {
      const u = await login(data.email, data.password);
      router.replace(homeFor(u.role));
    } catch (e) {
      setServerError(errorMessage(e, 'Login failed'));
    }
  });

  return (
    <div className="mx-auto grid min-h-dvh max-w-md place-items-center px-6">
      <div className="w-full space-y-6">
        <div className="flex items-center gap-3">
          <BrandMark />
          <h1 className="font-display text-2xl font-bold">Welcome back</h1>
        </div>

        <form onSubmit={onSubmit} className="card space-y-4 p-5">
          <Field label="Email" error={errors.email?.message}>
            <input className="input" type="email" placeholder="you@campus.test" {...register('email')} />
          </Field>
          <Field label="Password" error={errors.password?.message}>
            <input className="input" type="password" placeholder="••••••••" {...register('password')} />
          </Field>
          {serverError && (
            <p className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] font-medium text-danger">{serverError}</p>
          )}
          <button className="btn-primary w-full" disabled={loading}>
            {loading ? <Spinner /> : 'Log in'}
          </button>
        </form>

        <p className="text-center text-[13px] text-slate2">
          New here?{' '}
          <Link href="/register" className="font-semibold text-primary underline-offset-2 hover:underline">
            Create an account
          </Link>
        </p>
      </div>
    </div>
  );
}
