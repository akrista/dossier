import type { Metadata } from "next";

import { verifyAdminSession } from "@/lib/auth/session";

import { loadAdminDashboardData } from "./data";
import { AdminScreen } from "./admin-screen";

export const metadata: Metadata = { title: "Admin" };

export default async function AdminPage() {
  const session = await verifyAdminSession();
  const data = await loadAdminDashboardData();
  return <AdminScreen initialUsers={data.users} initialGlobal={data.globalSettings} currentUserId={session.userId ?? ""} />;
}
