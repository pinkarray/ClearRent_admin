"use client";

import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  User,
} from "firebase/auth";
import { auth } from "@/lib/firebase";

interface AuthContextType {
  user: User | null;
  isAdmin: boolean;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isAdmin: false,
  loading: true,
  signIn: async () => ({ success: false }),
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState(false);

  // Track hydration
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    // Don't subscribe until client-side mounted
    if (!mounted) return;

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        // Force-refresh so a freshly-granted claim takes effect without
        // waiting for the hourly token rotation.
        try {
          const result = await firebaseUser.getIdTokenResult(true);
          const claims = result.claims;
          setIsAdmin(claims.superAdmin === true || claims.admin === true);
        } catch {
          setIsAdmin(false);
        }
      } else {
        setIsAdmin(false);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, [mounted]);

  const signIn = useCallback(async (email: string, password: string) => {
    try {
      const result = await signInWithEmailAndPassword(auth, email, password);
      // Force-refresh the token so any claim set within the last hour is visible.
      const tokenResult = await result.user.getIdTokenResult(true);
      const claims = tokenResult.claims;
      const hasAdminClaim = claims.superAdmin === true || claims.admin === true;
      if (!hasAdminClaim) {
        await fbSignOut(auth);
        return { success: false, error: "Access denied. Admin accounts only." };
      }
      return { success: true };
    } catch (err: any) {
      const code = err?.code || "";
      let message = "An error occurred. Please try again.";
      if (code === "auth/invalid-credential" || code === "auth/wrong-password") {
        message = "Invalid email or password.";
      } else if (code === "auth/user-not-found") {
        message = "No account found with this email.";
      } else if (code === "auth/too-many-requests") {
        message = "Too many attempts. Please try again later.";
      }
      return { success: false, error: message };
    }
  }, []);

  const signOut = useCallback(async () => {
    await fbSignOut(auth);
  }, []);

  // While not mounted (SSR), always show loading
  const effectiveLoading = !mounted || loading;

  return (
    <AuthContext.Provider value={{ user, isAdmin, loading: effectiveLoading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);