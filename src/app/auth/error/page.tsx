import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const ERROR_MESSAGES: Record<string, string> = {
  Configuration:
    "La configuration du fournisseur d'identité est incorrecte. Vérifiez les variables AUTH_MICROSOFT_ENTRA_ID_ID, AUTH_MICROSOFT_ENTRA_ID_SECRET et AUTH_MICROSOFT_ENTRA_ID_ISSUER, ainsi que NEXTAUTH_SECRET.",
  AccessDenied:
    "Accès refusé. Votre compte Microsoft n'est pas autorisé à accéder à SENTINEL.",
  Verification: "Le lien de connexion est invalide ou a expiré.",
  OAuthCallbackError:
    "Microsoft a rejeté la requête de connexion. Vérifiez que l'URI de redirection déclarée dans Entra ID correspond exactement à /api/auth/callback/microsoft-entra-id.",
  OAuthSignInError:
    "Impossible de contacter Microsoft Entra ID. Vérifiez la valeur de AUTH_MICROSOFT_ENTRA_ID_ISSUER.",
  OAuthAccountNotLinked:
    "Cette adresse e-mail est déjà associée à un autre mode de connexion.",
};

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const code = error ?? "Default";
  const message =
    ERROR_MESSAGES[code] ?? "Une erreur inattendue est survenue pendant la connexion.";

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950 p-4">
      <Card className="w-full max-w-md border-zinc-800 bg-zinc-900">
        <CardHeader className="text-center space-y-4">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-500/10">
            <AlertTriangle className="h-8 w-8 text-red-400" />
          </div>
          <div>
            <CardTitle className="text-2xl font-bold tracking-tight text-white">
              Connexion impossible
            </CardTitle>
            <CardDescription className="text-zinc-400 mt-2">{message}</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-center text-xs text-zinc-600">
            Code d&apos;erreur : <span className="font-mono">{code}</span>
          </p>
          <Link
            href="/auth/signin"
            className={cn(
              buttonVariants({ size: "lg" }),
              "w-full bg-blue-600 hover:bg-blue-700 text-white"
            )}
          >
            Réessayer
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
