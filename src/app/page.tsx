import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { HOME_ROUTE } from "@/lib/rbac";

export default async function RootPage() {
  const session = await getSession();
  redirect(session ? HOME_ROUTE[session.role] : "/login");
}
