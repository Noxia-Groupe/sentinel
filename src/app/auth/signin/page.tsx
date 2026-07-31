"use client";

import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Shield } from "lucide-react";

export default function SignIn() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950">
      <Card className="w-full max-w-md border-zinc-800 bg-zinc-900">
        <CardHeader className="text-center space-y-4">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-blue-500/10">
            <Shield className="h-8 w-8 text-blue-400" />
          </div>
          <div>
            <CardTitle className="text-2xl font-bold tracking-tight text-white">
              SENTINEL
            </CardTitle>
            <CardDescription className="text-zinc-400 mt-2">
              Centre de contrôle des enregistreurs Dahua
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <Button
            onClick={() => signIn("microsoft-entra-id", { callbackUrl: "/" })}
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
        </CardContent>
      </Card>
    </div>
  );
}
