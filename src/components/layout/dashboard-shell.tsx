"use client";

import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Users,
  ShieldCheck,
  CreditCard,
  Wallet,
  Building2,
  AlertTriangle,
  BarChart3,
  Megaphone,
  Settings,
  LogOut,
  Sun,
  Moon,
  Monitor,
  ChevronLeft,
  Menu,
} from "lucide-react";
import { useState, useEffect } from "react";

const navItems = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Users", href: "/dashboard/users", icon: Users },
  { label: "Verifications", href: "/dashboard/verifications", icon: ShieldCheck },
  { label: "Payments", href: "/dashboard/payments", icon: CreditCard },
  { label: "Agent Payouts", href: "/dashboard/payouts", icon: Wallet },
  { label: "Properties", href: "/dashboard/properties", icon: Building2 },
  { label: "Issues", href: "/dashboard/issues", icon: AlertTriangle },
  { label: "Analytics", href: "/dashboard/analytics", icon: BarChart3 },
  { label: "Announcements", href: "/dashboard/announcements", icon: Megaphone },
  { label: "Settings", href: "/dashboard/settings", icon: Settings },
];

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, isAdmin, loading, signOut } = useAuth();
  const { theme, setTheme } = useTheme();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!loading && (!user || !isAdmin)) {
      router.replace("/login");
    }
  }, [user, isAdmin, loading, router]);

  if (loading || !user || !isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[rgb(var(--background))]">
        <div className="w-8 h-8 border-3 border-[rgb(var(--brand))] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const themeOptions = [
    { key: "light", icon: Sun, label: "Light" },
    { key: "dark", icon: Moon, label: "Dark" },
    { key: "system", icon: Monitor, label: "System" },
  ];

  return (
    <div className="min-h-screen bg-[rgb(var(--background))] flex">
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed top-0 left-0 h-full z-50 flex flex-col border-r border-[rgb(var(--border))] bg-[rgb(var(--surface))] transition-all duration-300",
          collapsed ? "w-[72px]" : "w-64",
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
      >
        {/* Logo */}
        <div className={cn("flex items-center h-16 px-4 border-b border-[rgb(var(--border))]", collapsed && "justify-center")}>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[rgb(var(--brand))] flex items-center justify-center shrink-0">
              <span className="text-white font-display font-bold text-sm">CR</span>
            </div>
            {!collapsed && (
              <div className="overflow-hidden">
                <h2 className="font-display font-bold text-sm text-[rgb(var(--text-primary))] leading-tight">ClearRent</h2>
                <p className="text-[10px] text-[rgb(var(--text-hint))] leading-tight">Admin Dashboard</p>
              </div>
            )}
          </div>
        </div>

        {/* Nav links */}
        <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = pathname === item.href || (item.href !== "/dashboard" && pathname?.startsWith(item.href));
            return (
              <button
                key={item.href}
                onClick={() => {
                  router.push(item.href);
                  setMobileOpen(false);
                }}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150",
                  isActive
                    ? "bg-[rgb(var(--brand))]/10 text-[rgb(var(--brand))]"
                    : "text-[rgb(var(--text-secondary))] hover:bg-[rgb(var(--background))] hover:text-[rgb(var(--text-primary))]",
                  collapsed && "justify-center px-0"
                )}
                title={collapsed ? item.label : undefined}
              >
                <item.icon size={20} className="shrink-0" />
                {!collapsed && <span>{item.label}</span>}
              </button>
            );
          })}
        </nav>

        {/* Bottom section */}
        <div className="p-3 border-t border-[rgb(var(--border))] space-y-2">
          {/* Theme switcher */}
          {mounted && !collapsed && (
            <div className="flex items-center gap-1 p-1 rounded-xl bg-[rgb(var(--background))]">
              {themeOptions.map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => setTheme(opt.key)}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium transition-all",
                    theme === opt.key
                      ? "bg-[rgb(var(--surface))] text-[rgb(var(--text-primary))] shadow-sm"
                      : "text-[rgb(var(--text-hint))] hover:text-[rgb(var(--text-secondary))]"
                  )}
                >
                  <opt.icon size={13} />
                  {opt.label}
                </button>
              ))}
            </div>
          )}

          {/* Collapse toggle */}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="hidden lg:flex w-full items-center justify-center gap-2 py-2 rounded-xl text-xs text-[rgb(var(--text-hint))] hover:bg-[rgb(var(--background))] transition-colors"
          >
            <ChevronLeft size={14} className={cn("transition-transform", collapsed && "rotate-180")} />
            {!collapsed && "Collapse"}
          </button>

          {/* Sign out */}
          <button
            onClick={signOut}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-red-500 hover:bg-red-500/10 transition-colors",
              collapsed && "justify-center px-0"
            )}
            title={collapsed ? "Sign Out" : undefined}
          >
            <LogOut size={18} />
            {!collapsed && "Sign Out"}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main
        className={cn(
          "flex-1 min-h-screen transition-all duration-300",
          collapsed ? "lg:ml-[72px]" : "lg:ml-64"
        )}
      >
        {/* Top bar (mobile) */}
        <header className="sticky top-0 z-30 h-16 flex items-center justify-between px-4 lg:px-8 border-b border-[rgb(var(--border))] bg-[rgb(var(--surface))]/80 backdrop-blur-xl lg:hidden">
          <button onClick={() => setMobileOpen(true)} className="p-2 rounded-lg hover:bg-[rgb(var(--background))]">
            <Menu size={20} className="text-[rgb(var(--text-primary))]" />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-[rgb(var(--brand))] flex items-center justify-center">
              <span className="text-white font-display font-bold text-xs">CR</span>
            </div>
            <span className="font-display font-bold text-sm text-[rgb(var(--text-primary))]">ClearRent</span>
          </div>
          <div className="w-10" /> {/* Spacer for centering */}
        </header>

        <div className="p-4 lg:p-8">{children}</div>
      </main>
    </div>
  );
}
