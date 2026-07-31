"use client";

import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";

export function SignInButton({ callbackUrl }: { callbackUrl: string }) {
  return (
    <Button
      onClick={() => signIn("microsoft-entra-id", { callbackUrl })}
      className="w-full bg-[#0251a1] hover:bg-[#0363c2] text-white font-medium tracking-wide h-12 rounded-lg transition-all duration-300 hover:shadow-lg hover:shadow-[#0251a1]/25"
    >
      <svg className="mr-3 h-5 w-5" viewBox="0 0 21 21" fill="currentColor">
        <rect x="1" y="1" width="9" height="9" />
        <rect x="11" y="1" width="9" height="9" />
        <rect x="1" y="11" width="9" height="9" />
        <rect x="11" y="11" width="9" height="9" />
      </svg>
      Connexion Microsoft
    </Button>
  );
}
