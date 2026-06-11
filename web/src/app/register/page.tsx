'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '@/stores/auth';
import { errorMessage } from '@/lib/api';
import { Field, Spinner, Tabs, TabsContent, TabsList, TabsTrigger, ZoneSelect } from '@/components/ui';
import { BrandMark } from '@/components/AppShell';

const password = z
  .string()
  .min(8, 'At least 8 characters')
  .regex(/[a-zA-Z]/, 'Needs a letter')
  .regex(/[0-9]/, 'Needs a number');

const phonePattern = /^[0-9+\-\s]{8,15}$/;

const passengerSchema = z.object({
  fullName: z.string().min(2, 'Your name'),
  email: z.string().email('Enter a valid email'),
  phone: z
    .string()
    .regex(phonePattern, 'Digits only, 8–15 characters')
    .optional()
    .or(z.literal('')),
  password,
});

const driverSchema = z.object({
  fullName: z.string().min(2, 'Your name'),
  email: z.string().email('Enter a valid email'),
  phone: z.string().regex(phonePattern, 'Digits only, 8–15 characters'),
  password,
  vehicleType: z.enum(['E_RICKSHAW', 'AUTO', 'CAB', 'SHUTTLE']),
  vehiclePlate: z.string().min(4, 'Plate number'),
  vehicleModel: z.string().min(2, 'Vehicle model'),
  licenseNumber: z.string().min(5, 'License number'),
});

type PassengerForm = z.infer<typeof passengerSchema>;
type DriverForm = z.infer<typeof driverSchema>;

const VEHICLES = [
  { value: 'E_RICKSHAW', label: 'E-rickshaw' },
  { value: 'AUTO', label: 'Auto' },
  { value: 'CAB', label: 'Cab' },
  { value: 'SHUTTLE', label: 'Shuttle' },
];

export default function RegisterPage() {
  return (
    <div className="mx-auto min-h-dvh max-w-md px-6 py-10">
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <BrandMark />
          <h1 className="font-display text-2xl font-bold">Create your account</h1>
        </div>

        <Tabs defaultValue="passenger">
          <TabsList>
            <TabsTrigger value="passenger">I need rides</TabsTrigger>
            <TabsTrigger value="driver">I drive</TabsTrigger>
          </TabsList>
          <TabsContent value="passenger" className="mt-4">
            <PassengerForm />
          </TabsContent>
          <TabsContent value="driver" className="mt-4">
            <DriverForm />
          </TabsContent>
        </Tabs>

        <p className="text-center text-[13px] text-slate2">
          Already registered?{' '}
          <Link href="/login" className="font-semibold text-primary underline-offset-2 hover:underline">
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}

function PassengerForm() {
  const router = useRouter();
  const { registerPassenger, loading } = useAuth();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<PassengerForm>({ resolver: zodResolver(passengerSchema) });

  const onSubmit = handleSubmit(async (data) => {
    setServerError(null);
    try {
      await registerPassenger({ ...data, phone: data.phone || undefined });
      router.replace('/passenger');
    } catch (e) {
      setServerError(errorMessage(e, 'Registration failed'));
    }
  });

  return (
    <form onSubmit={onSubmit} className="card space-y-4 p-5">
      <Field label="Full name" error={errors.fullName?.message}>
        <input className="input" {...register('fullName')} />
      </Field>
      <Field label="Email" error={errors.email?.message}>
        <input className="input" type="email" {...register('email')} />
      </Field>
      <Field label="Phone (optional)" error={errors.phone?.message}>
        <input className="input" type="tel" {...register('phone')} />
      </Field>
      <Field label="Password" error={errors.password?.message}>
        <input className="input" type="password" {...register('password')} />
      </Field>
      {serverError && (
        <p className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] font-medium text-danger">{serverError}</p>
      )}
      <button className="btn-primary w-full" disabled={loading}>
        {loading ? <Spinner /> : 'Create passenger account'}
      </button>
    </form>
  );
}

function DriverForm() {
  const router = useRouter();
  const { registerDriver, loading } = useAuth();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<DriverForm>({
    resolver: zodResolver(driverSchema),
    defaultValues: { vehicleType: 'E_RICKSHAW' },
  });

  const onSubmit = handleSubmit(async (data) => {
    setServerError(null);
    try {
      await registerDriver(data);
      router.replace('/driver');
    } catch (e) {
      setServerError(errorMessage(e, 'Registration failed'));
    }
  });

  return (
    <form onSubmit={onSubmit} className="card space-y-4 p-5">
      <Field label="Full name" error={errors.fullName?.message}>
        <input className="input" {...register('fullName')} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Email" error={errors.email?.message}>
          <input className="input" type="email" {...register('email')} />
        </Field>
        <Field label="Phone" error={errors.phone?.message}>
          <input className="input" type="tel" {...register('phone')} />
        </Field>
      </div>
      <Field label="Password" error={errors.password?.message}>
        <input className="input" type="password" {...register('password')} />
      </Field>

      <p className="label pt-1">Vehicle & verification</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Vehicle type" error={errors.vehicleType?.message}>
          <ZoneSelect
            value={watch('vehicleType')}
            onChange={(v) => setValue('vehicleType', v as DriverForm['vehicleType'])}
            options={VEHICLES}
            placeholder="Type"
          />
        </Field>
        <Field label="Plate number" error={errors.vehiclePlate?.message}>
          <input className="input" placeholder="UK17 ER 1234" {...register('vehiclePlate')} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Vehicle model" error={errors.vehicleModel?.message}>
          <input className="input" placeholder="Mahindra Treo" {...register('vehicleModel')} />
        </Field>
        <Field label="License number" error={errors.licenseNumber?.message}>
          <input className="input" {...register('licenseNumber')} />
        </Field>
      </div>

      <p className="rounded-lg bg-amber-soft px-3 py-2 text-[12px] leading-relaxed text-[#6a5200]">
        New driver accounts start as <b>pending verification</b>. Upload your documents from the driver console; the
        transport office approves before you can go online.
      </p>

      {serverError && (
        <p className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] font-medium text-danger">{serverError}</p>
      )}
      <button className="btn-primary w-full" disabled={loading}>
        {loading ? <Spinner /> : 'Create driver account'}
      </button>
    </form>
  );
}
