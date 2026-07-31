import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Shield,
  Server,
  Settings,
  Activity,
  LogOut,
  Menu,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { TooltipProvider } from "@/components/ui/tooltip";
import { auth, signOut } from "@/lib/auth";

export const metadata: Metadata = {
  title: "SENTINEL — Centre de contrôle",
  description: "Centre de contrôle des enregistreurs Dahua",
};

const navigation = [
  { name: "Tableau de bord", href: "/", icon: Activity },
  { name: "Enregistreurs", href: "/nvrs", icon: Server },
  { name: "Paramètres", href: "/settings", icon: Settings },
];

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user) {
    redirect("/auth/signin");
  }

  return (
    <TooltipProvider>
      <div className="flex min-h-screen bg-zinc-950 text-zinc-100">
        {/* Sidebar Desktop */}
        <aside className="hidden lg:fixed lg:inset-y-0 lg:flex lg:w-64 lg:flex-col border-r border-zinc-800 bg-zinc-900/50">
          <div className="flex h-16 items-center gap-3 px-6 border-b border-zinc-800">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-500/10">
              <Shield className="h-5 w-5 text-blue-400" />
            </div>
            <span className="font-bold text-lg tracking-tight">SENTINEL</span>
          </div>
          <nav className="flex-1 space-y-1 px-3 py-4">
            {navigation.map((item) => (
              <Link
                key={item.name}
                href={item.href}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 transition-colors"
              >
                <item.icon className="h-5 w-5" />
                {item.name}
              </Link>
            ))}
          </nav>
          <div className="border-t border-zinc-800 p-4">
            <DropdownMenu>
              <DropdownMenuTrigger>
                <span className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 transition-colors cursor-pointer">
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={session.user?.image ?? ""} />
                    <AvatarFallback className="bg-blue-500/20 text-blue-400 text-xs">
                      {session.user.name
                        ?.split(" ")
                        .map((n) => n[0])
                        .join("")
                        .toUpperCase() ?? "U"}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 text-left">
                    <p className="text-sm font-medium text-zinc-100 truncate">
                      {session.user.name ?? "Utilisateur"}
                    </p>
                    <p className="text-xs text-zinc-500 truncate">
                      {session.user.email}
                    </p>
                  </div>
                </span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem disabled className="text-xs text-zinc-500">
                  {session.user.email}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-red-400 cursor-pointer"
                  onClick={async () => {
                    "use server";
                    await signOut({ redirectTo: "/auth/signin" });
                  }}
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  Déconnexion
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </aside>

        {/* Mobile Header */}
        <div className="lg:hidden fixed top-0 left-0 right-0 z-40 flex h-14 items-center gap-3 border-b border-zinc-800 bg-zinc-950 px-4">
          <Sheet>
            <SheetTrigger className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 hover:bg-zinc-800 hover:text-zinc-100 h-9 w-9 text-zinc-400">
              <Menu className="h-5 w-5" />
            </SheetTrigger>
            <SheetContent side="left" className="w-64 bg-zinc-900 border-zinc-800 p-0">
              <div className="flex h-14 items-center gap-3 px-4 border-b border-zinc-800">
                <Shield className="h-5 w-5 text-blue-400" />
                <span className="font-bold">SENTINEL</span>
              </div>
              <nav className="space-y-1 p-3">
                {navigation.map((item) => (
                  <Link
                    key={item.name}
                    href={item.href}
                    className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                  >
                    <item.icon className="h-5 w-5" />
                    {item.name}
                  </Link>
                ))}
              </nav>
            </SheetContent>
          </Sheet>
          <Shield className="h-5 w-5 text-blue-400" />
          <span className="font-bold">SENTINEL</span>
        </div>

        {/* Main Content */}
        <main className="flex-1 lg:pl-64">
          <div className="pt-14 lg:pt-0">{children}</div>
        </main>
      </div>
    </TooltipProvider>
  );
}
