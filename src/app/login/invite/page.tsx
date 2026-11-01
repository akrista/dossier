import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { BrandMark } from "@/components/brand-mark";
import { hashInviteToken } from "@/lib/auth/invite";
import { getSession } from "@/lib/auth/session";
import { runUnscoped } from "@/lib/auth/user-context";
import { prisma } from "@/lib/prisma";

import { loginMessages } from "../messages";
import { InviteForm } from "./invite-form";

export const metadata: Metadata = { title: "Accept invitation" };

export default async function InvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  if (await getSession()) redirect("/");
  const { token } = await searchParams;
  const rawToken = typeof token === "string" ? token.trim() : "";

  const now = new Date();
  const invitedUser = rawToken
    ? await runUnscoped(() =>
        prisma.user.findUnique({
          where: { inviteTokenHash: hashInviteToken(rawToken) },
          select: { email: true, name: true, disabledAt: true, inviteExpiresAt: true },
        }),
      )
    : null;

  const valid =
    invitedUser &&
    invitedUser.disabledAt === null &&
    invitedUser.inviteExpiresAt !== null &&
    invitedUser.inviteExpiresAt > now;

  return (
    <main className="grid min-h-screen bg-surface min-[960px]:grid-cols-2">
      <div className="flex items-center justify-center px-8 py-12">
        <div className="flex w-full max-w-[400px] flex-col gap-8">
          <div className="flex flex-col items-start gap-2">
            <BrandMark className="size-10" />
            <div className="flex flex-col">
              <div className="font-serif text-[30px] font-medium tracking-[-0.01em]">Dossier</div>
              <div className="text-sm text-muted">Your job search, on your server</div>
            </div>
          </div>

          {valid ? (
            <InviteForm token={rawToken} email={invitedUser.email} initialName={invitedUser.name} />
          ) : (
            <div className="flex flex-col gap-4">
              <h1 className="font-serif text-[28px] leading-[1.15] tracking-[-0.01em]">Invitation unavailable</h1>
              <p className="text-sm text-muted">{loginMessages.invalidInvite}</p>
              <Link href="/login" className="text-sm font-medium underline underline-offset-3 hover:text-ink">
                Go to sign in
              </Link>
            </div>
          )}
        </div>
      </div>
      <div
        aria-hidden="true"
        className="hidden bg-[linear-gradient(to_left,color-mix(in_srgb,var(--color-ink)_9%,transparent)_0%,transparent_65%)] min-[960px]:grid min-[960px]:place-items-center"
      >
        <BrandMark className="size-40 opacity-90 shadow-dialog rounded-[36px]" />
      </div>
    </main>
  );
}
