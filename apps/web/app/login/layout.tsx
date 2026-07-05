import { redirect } from "next/navigation";
import { ownerExists } from "@/lib/localAuth";

// Before an owner exists there's nothing to log in to — send first-run
// visitors to /setup instead.
export default async function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!(await ownerExists())) redirect("/setup");
  return <>{children}</>;
}
