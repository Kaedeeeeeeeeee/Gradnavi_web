"use client";

import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      className="text-zinc-500 hover:text-foreground"
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
