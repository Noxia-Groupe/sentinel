import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import {
  LayoutDashboard,
  Server,
  Settings,
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
  { name: "Tableau de bord", href: "/", icon: LayoutDashboard },
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
      <div className="flex min-h-screen bg-[#000726] text-[#dde1e4]">
        {/* Sidebar Desktop */}
        <aside className="hidden lg:fixed lg:inset-y-0 lg:flex lg:w-64 lg:flex-col border-r border-[#132255] bg-[#080d24]/80 backdrop-blur-xl">
          {/* Logo */}
          <div className="flex items-center gap-3 px-5 py-4 border-b border-[#132255]">
            <div className="relative w-32 h-7">
              <Image
                src="/brand/logos/NOXIA GROUPE BLANC.jpg"
                alt="Noxia Groupe"
                fill
                className="object-contain object-left"
              />
            </div>
          </div>

          {/* Titre SENTINEL */}
          <div className="px-5 py-3">
            <p className="text-[10px] font-semibold tracking-[0.2em] text-[#0251a1] uppercase">
              Sentinel
            </p>
            <p className="text-xs text-[#8896b4]">Centre de contrôle NVR</p>
          </div>

          {/* Navigation */}
          <nav className="flex-1 space-y-1 px-3 py-2">
            {navigation.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-[#8896b4] hover:bg-[#132255] hover:text-[#dde1e4] transition-all duration-200"
                >
                  <Icon className="h-4 w-4" />
                  {item.name}
                </Link>
              );
            })}
          </nav>

          {/* User */}
          <div className="border-t border-[#132255] p-4">
            <DropdownMenu>
              <DropdownMenuTrigger className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-[#8896b4] hover:bg-[#132255] hover:text-[#dde1e4] transition-colors cursor-pointer">
                <Avatar className="h-8 w-8 ring-2 ring-[#0251a1]/30">
                  <AvatarImage src={session.user?.image ?? ""} />
                  <AvatarFallback className="bg-[#0251a1]/20 text-[#0251a1] text-xs font-bold">
                    {session.user.name
                      ?.split(" ")
                      .map((n) => n[0])
                      .join("")
                      .toUpperCase() ?? "U"}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 text-left min-w-0">
                  <p className="text-sm font-medium text-[#dde1e4] truncate">
                    {session.user.name ?? "Utilisateur"}
                  </p>
                  <p className="text-xs text-[#8896b4] truncate">
                    {session.user.email}
                  </p>
                </div>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 border-[#132255] bg-[#0d1537]">
                <DropdownMenuItem disabled className="text-xs text-[#8896b4]">
                  {session.user.email}
                </DropdownMenuItem>
                <DropdownMenuSeparator className="bg-[#132255]" />
                <DropdownMenuItem
                  className="text-red-400 cursor-pointer hover:bg-red-500/10"
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
        <div className="lg:hidden fixed top-0 left-0 right-0 z-40 flex h-14 items-center gap-3 border-b border-[#132255] bg-[#080d24]/90 backdrop-blur-xl px-4">
          <Sheet>
            <SheetTrigger className="inline-flex items-center justify-center h-9 w-9 rounded-md text-[#8896b4] hover:bg-[#132255] hover:text-[#dde1e4]">
              <Menu className="h-5 w-5" />
            </SheetTrigger>
            <SheetContent side="left" className="w-64 bg-[#080d24] border-[#132255] p-0">
              <div className="flex items-center gap-3 px-4 py-4 border-b border-[#132255]">
                <div className="relative w-28 h-5">
                  <Image
                    src="/brand/logos/NOXIA GROUPE BLANC.jpg"
                    alt="Noxia Groupe"
                    fill
                    className="object-contain object-left"
                  />
                </div>
              </div>
              <div className="px-4 pt-3 pb-1">
                <p className="text-[10px] font-semibold tracking-[0.2em] text-[#0251a1] uppercase">Sentinel</p>
              </div>
              <nav className="space-y-1 p-3">
                {navigation.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.name}
                      href={item.href}
                      className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-[#8896b4] hover:bg-[#132255] hover:text-[#dde1e4]"
                    >
                      <Icon className="h-4 w-4" />
                      {item.name}
                    </Link>
                  );
                })}
              </nav>
            </SheetContent>
          </Sheet>
          <span className="font-bold text-sm tracking-wider text-[#dde1e4]">SENTINEL</span>
        </div>

        {/* Main Content */}
        <main className="flex-1 lg:pl-64">
          <div className="pt-14 lg:pt-0">{children}</div>
        </main>
      </div>
    </TooltipProvider>
  );
}
