import { redirect } from "next/navigation";
import { sesiSah } from "@/lib/auth";
import { HOME_ROUTE } from "@/lib/rbac";

export default async function RootPage() {
  const session = await sesiSah();
  redirect(session ? HOME_ROUTE[session.role] : "/login");
}
