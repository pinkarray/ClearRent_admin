"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

export default function RootPage() {
  const { user, isAdmin, loading } = useAuth();
  const router = useRouter();
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (redirecting) return;

    setRedirecting(true);

    if (user && isAdmin) {
      router.replace("/dashboard");
    } else {
      router.replace("/login");
    }
  }, [user, isAdmin, loading, redirecting, router]);

  // Safety fallback — if stuck loading for >5s, go to login
  useEffect(() => {
    const timeout = setTimeout(() => {
      if (loading && !redirecting) {
        setRedirecting(true);
        router.replace("/login");
      }
    }, 5000);
    return () => clearTimeout(timeout);
  }, [loading, redirecting, router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[rgb(var(--background))]">
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 rounded-full border-[3px] border-[rgb(var(--brand))] border-t-transparent animate-spin" />
        <p className="text-sm text-[rgb(var(--text-hint))]">Loading ClearRent Admin...</p>
      </div>
    </div>
  );
}