"use client";

import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";

export function SignInButton({ callbackUrl }: { callbackUrl: string }) {
  return (
    <Button
      onClick={() => signIn("microsoft-entra-id", { callbackUrl })}
      className="w-full bg-blue-600 hover:bg-blue-700 text-white"
      size="lg"
    >
      <svg className="mr-2 h-5 w-5" viewBox="0 0 21 21" fill="currentColor">
        <rect x="1" y="1" width="9" height="9" fill="currentColor" />
        <rect x="11" y="1" width="9" height="9" fill="currentColor" />
        <rect x="1" y="11" width="9" height="9" fill="currentColor" />
        <rect x="11" y="11" width="9" height="9" fill="currentColor" />
      </svg>
      Connexion avec Microsoft
    </Button>
  );
}
