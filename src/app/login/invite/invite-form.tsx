"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";

import { toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { controlClassName } from "@/components/ui/field";
import { cn } from "@/lib/cn";

import { acceptInvite } from "../actions";

export function InviteForm({
  token,
  email,
  initialName,
}: {
  token: string;
  email: string;
  initialName: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    if (password.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }

    startTransition(async () => {
      const result = await acceptInvite({ token, name: name.trim() || undefined, password });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toastResult(result);
      router.replace(result.data.redirectTo);
    });
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <h1 className="font-serif text-[28px] leading-[1.15] tracking-[-0.01em]">Set up your account</h1>
        <p className="text-sm text-muted">
          Choose a password for <span className="font-medium text-ink">{email}</span>.
        </p>
      </div>

      <div className="flex flex-col gap-[7px]">
        <label htmlFor="invite-name" className="text-label text-muted">
          Your name
        </label>
        <input
          id="invite-name"
          name="name"
          type="text"
          autoComplete="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          className={cn(controlClassName, "h-10 px-3")}
        />
      </div>

      <div className="flex flex-col gap-[7px]">
        <div className="flex justify-between text-label text-muted">
          <label htmlFor="invite-password">New password</label>
          <button
            type="button"
            onClick={() => setVisible((shown) => !shown)}
            className="underline underline-offset-3 hover:text-ink"
          >
            {visible ? "Hide" : "Show"}
          </button>
        </div>
        <input
          id="invite-password"
          name="password"
          type={visible ? "text" : "password"}
          autoComplete="new-password"
          autoFocus
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            setError(null);
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "invite-error" : undefined}
          className={cn(controlClassName, "h-10 px-3")}
        />
        {error && (
          <p id="invite-error" role="alert" className="text-meta text-error">
            {error}
          </p>
        )}
      </div>

      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Setting password…" : "Continue to Dossier"}
      </Button>
    </form>
  );
}
