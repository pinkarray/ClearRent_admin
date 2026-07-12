"use client";

import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  User,
} from "firebase/auth";
import { auth } from "@/lib/firebase";

export type AdminRole = "superAdmin" | "admin" | "viewer";

/** Resolve the effective admin-panel role from a user's custom claims. */
function roleFromClaims(claims: Record<string, unknown>): AdminRole | null {
  if (claims.superAdmin === true) return "superAdmin";
  if (claims.admin === true) return "admin";
  if (claims.viewer === true) return "viewer";
  return null;
}

interface AuthContextType {
  user: User | null;
  role: AdminRole | null;
  /** Has access to the admin panel at all (any recognized role). */
  isAdmin: boolean;
  /** May perform mutating actions (superAdmin or admin). */
  canWrite: boolean;
  /** Signed in as a read-only viewer. */
  isReadOnly: boolean;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  role: null,
  isAdmin: false,
  canWrite: false,
  isReadOnly: false,
  loading: true,
  signIn: async () => ({ success: false }),
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<AdminRole | null>(null);
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
          setRole(roleFromClaims(result.claims));
        } catch {
          setRole(null);
        }
      } else {
        setRole(null);
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
      if (roleFromClaims(tokenResult.claims) === null) {
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

  const isAdmin = role !== null;
  const canWrite = role === "superAdmin" || role === "admin";
  const isReadOnly = role === "viewer";

  return (
    <AuthContext.Provider
      value={{ user, role, isAdmin, canWrite, isReadOnly, loading: effectiveLoading, signIn, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);