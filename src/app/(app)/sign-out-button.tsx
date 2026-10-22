"use client";

import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      className="shrink-0 rounded-md px-2 py-1 text-muted hover:bg-subtle hover:text-foreground"
      onClick={async () => {
        await authClient.signOut();
        router.replace("/login");
        router.refresh();
      }}
    >
      退出登录
    </button>
  );
}
