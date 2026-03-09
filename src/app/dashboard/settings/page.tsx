"use client";

import { useEffect, useState } from "react";
import {
  doc,
  getDoc,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db, ADMIN_UID } from "@/lib/firebase";
import { auth } from "@/lib/firebase";
import {
  sendPasswordResetEmail,
  updateProfile,
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
} from "firebase/auth";
import { cn } from "@/lib/utils";
import {
  Settings,
  User,
  Lock,
  Bell,
  Shield,
  LogOut,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  ChevronRight,
  Eye,
  EyeOff,
  Mail,
  Palette,
  Info,
} from "lucide-react";
import { useTheme } from "next-themes";

// ─── Section types ────────────────────────────────────────────────────────────

type ActiveSection = "profile" | "password" | "appearance" | "about";

interface AdminProfile {
  displayName: string;
  email: string;
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [activeSection, setActiveSection] = useState<ActiveSection>("profile");

  const navItems: { id: ActiveSection; label: string; icon: any; desc: string }[] = [
    { id: "profile",    label: "Profile",    icon: User,    desc: "Your admin name and email" },
    { id: "password",   label: "Password",   icon: Lock,    desc: "Change your password" },
    { id: "appearance", label: "Appearance", icon: Palette, desc: "Theme preferences" },
    { id: "about",      label: "About",      icon: Info,    desc: "App version and info" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold text-[rgb(var(--text-primary))]">
          Settings
        </h1>
        <p className="text-sm text-[rgb(var(--text-secondary))] mt-1">
          Manage your admin account and preferences.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Sidebar nav */}
        <div className="lg:col-span-1 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                onClick={() => setActiveSection(item.id)}
                className={cn(
                  "w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all",
                  activeSection === item.id
                    ? "bg-[rgb(var(--brand))]/10 text-[rgb(var(--brand))]"
                    : "text-[rgb(var(--text-secondary))] hover:bg-[rgb(var(--background))]"
                )}
              >
                <Icon size={16} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{item.label}</p>
                  <p className="text-[11px] opacity-60 truncate">{item.desc}</p>
                </div>
                <ChevronRight size={14} className="shrink-0 opacity-40" />
              </button>
            );
          })}

          {/* Sign out — separate */}
          <div className="pt-2 mt-2 border-t border-[rgb(var(--border))]">
            <SignOutButton />
          </div>
        </div>

        {/* Content panel */}
        <div className="lg:col-span-3">
          {activeSection === "profile"    && <ProfileSection />}
          {activeSection === "password"   && <PasswordSection />}
          {activeSection === "appearance" && <AppearanceSection />}
          {activeSection === "about"      && <AboutSection />}
        </div>
      </div>
    </div>
  );
}

// ─── Profile Section ──────────────────────────────────────────────────────────

function ProfileSection() {
  const user = auth?.currentUser;
  const [displayName, setDisplayName] = useState(user?.displayName || "Admin");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const handleSave = async () => {
    if (!user || !displayName.trim()) return;
    setSaving(true);
    setError("");
    try {
      await updateProfile(user, { displayName: displayName.trim() });
      await updateDoc(doc(db, "users", ADMIN_UID), {
        fullName: displayName.trim(),
        updatedAt: serverTimestamp(),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e: any) {
      setError(e.message || "Failed to update profile.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card space-y-6">
      <div>
        <h2 className="font-display font-semibold text-[rgb(var(--text-primary))]">Profile</h2>
        <p className="text-sm text-[rgb(var(--text-secondary))] mt-0.5">Update your admin display name.</p>
      </div>

      {/* Avatar */}
      <div className="flex items-center gap-4">
        <div className="w-16 h-16 rounded-2xl bg-[rgb(var(--brand))]/10 flex items-center justify-center">
          <span className="text-2xl font-bold text-[rgb(var(--brand))]">
            {(displayName || "A").charAt(0).toUpperCase()}
          </span>
        </div>
        <div>
          <p className="font-semibold text-[rgb(var(--text-primary))]">{displayName || "Admin"}</p>
          <p className="text-sm text-[rgb(var(--text-hint))]">{user?.email}</p>
          <span className="inline-block mt-1 px-2 py-0.5 rounded-lg bg-[rgb(var(--brand))]/10 text-[rgb(var(--brand))] text-[10px] font-semibold">
            Super Admin
          </span>
        </div>
      </div>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[rgb(var(--text-hint))] uppercase tracking-wider">
            Display Name
          </label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="input w-full"
            placeholder="Admin name"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[rgb(var(--text-hint))] uppercase tracking-wider">
            Email Address
          </label>
          <input
            type="email"
            value={user?.email || ""}
            disabled
            className="input w-full opacity-50 cursor-not-allowed"
          />
          <p className="text-[11px] text-[rgb(var(--text-hint))]">Email cannot be changed.</p>
        </div>
      </div>

      {error && <Toast type="error" message={error} />}
      {saved && <Toast type="success" message="Profile updated successfully." />}

      <button
        onClick={handleSave}
        disabled={saving || !displayName.trim()}
        className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[rgb(var(--brand))] text-white text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-40"
      >
        {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
        Save Changes
      </button>
    </div>
  );
}

// ─── Password Section ─────────────────────────────────────────────────────────

function PasswordSection() {
  const user = auth?.currentUser;
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNext, setShowNext] = useState(false);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");
  const [resetSent, setResetSent] = useState(false);

  const handleChange = async () => {
    if (!user?.email) return;
    if (next !== confirm) { setError("New passwords do not match."); return; }
    if (next.length < 8) { setError("Password must be at least 8 characters."); return; }
    setSaving(true);
    setError("");
    try {
      const cred = EmailAuthProvider.credential(user.email, current);
      await reauthenticateWithCredential(user, cred);
      await updatePassword(user, next);
      setSuccess(true);
      setCurrent(""); setNext(""); setConfirm("");
      setTimeout(() => setSuccess(false), 4000);
    } catch (e: any) {
      if (e.code === "auth/wrong-password") setError("Current password is incorrect.");
      else setError(e.message || "Failed to update password.");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!user?.email) return;
    try {
      await sendPasswordResetEmail(auth, user.email);
      setResetSent(true);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const isValid = current && next && confirm && next === confirm && next.length >= 8;

  return (
    <div className="card space-y-6">
      <div>
        <h2 className="font-display font-semibold text-[rgb(var(--text-primary))]">Change Password</h2>
        <p className="text-sm text-[rgb(var(--text-secondary))] mt-0.5">Update your admin account password.</p>
      </div>

      <div className="space-y-4">
        <PasswordField label="Current Password" value={current} onChange={setCurrent} show={showCurrent} onToggle={() => setShowCurrent(v => !v)} />
        <PasswordField label="New Password" value={next} onChange={setNext} show={showNext} onToggle={() => setShowNext(v => !v)} hint="Minimum 8 characters" />
        <PasswordField label="Confirm New Password" value={confirm} onChange={setConfirm} show={showNext}
          error={confirm && next !== confirm ? "Passwords don't match" : undefined}
        />
      </div>

      {error && <Toast type="error" message={error} />}
      {success && <Toast type="success" message="Password updated successfully." />}
      {resetSent && <Toast type="success" message={`Reset link sent to ${user?.email}`} />}

      <div className="flex flex-col sm:flex-row gap-3">
        <button
          onClick={handleChange}
          disabled={!isValid || saving}
          className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-[rgb(var(--brand))] text-white text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-40"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Lock size={14} />}
          Update Password
        </button>
        <button
          onClick={handleReset}
          disabled={resetSent}
          className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl border border-[rgb(var(--border))] text-sm text-[rgb(var(--text-secondary))] hover:bg-[rgb(var(--background))] transition-colors disabled:opacity-40"
        >
          <Mail size={14} />
          Send Reset Email Instead
        </button>
      </div>
    </div>
  );
}

function PasswordField({ label, value, onChange, show, onToggle, hint, error }: {
  label: string; value: string; onChange: (v: string) => void;
  show: boolean; onToggle?: () => void; hint?: string; error?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-[rgb(var(--text-hint))] uppercase tracking-wider">{label}</label>
      <div className="relative">
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={cn("input w-full pr-10", error && "border-red-500/50")}
        />
        {onToggle && (
          <button onClick={onToggle} className="absolute right-3 top-1/2 -translate-y-1/2 text-[rgb(var(--text-hint))] hover:text-[rgb(var(--text-secondary))]">
            {show ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        )}
      </div>
      {hint && !error && <p className="text-[11px] text-[rgb(var(--text-hint))]">{hint}</p>}
      {error && <p className="text-[11px] text-red-500">{error}</p>}
    </div>
  );
}

// ─── Appearance Section ───────────────────────────────────────────────────────

function AppearanceSection() {
  const { theme, setTheme } = useTheme();

  const themes = [
    { value: "light", label: "Light", desc: "Clean white interface", preview: "bg-white border-gray-200" },
    { value: "dark",  label: "Dark",  desc: "Easy on the eyes",     preview: "bg-gray-900 border-gray-700" },
    { value: "system",label: "System",desc: "Follows device setting", preview: "bg-gradient-to-br from-white to-gray-900 border-gray-400" },
  ];

  return (
    <div className="card space-y-6">
      <div>
        <h2 className="font-display font-semibold text-[rgb(var(--text-primary))]">Appearance</h2>
        <p className="text-sm text-[rgb(var(--text-secondary))] mt-0.5">Choose how the dashboard looks.</p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {themes.map((t) => (
          <button
            key={t.value}
            onClick={() => setTheme(t.value)}
            className={cn(
              "flex flex-col items-center gap-3 p-4 rounded-xl border-2 transition-all",
              theme === t.value
                ? "border-[rgb(var(--brand))] bg-[rgb(var(--brand))]/5"
                : "border-[rgb(var(--border))] hover:border-[rgb(var(--text-hint))]"
            )}
          >
            <div className={cn("w-12 h-8 rounded-lg border-2", t.preview)} />
            <div className="text-center">
              <p className={cn("text-sm font-medium", theme === t.value ? "text-[rgb(var(--brand))]" : "text-[rgb(var(--text-primary))]")}>
                {t.label}
              </p>
              <p className="text-[10px] text-[rgb(var(--text-hint))] mt-0.5">{t.desc}</p>
            </div>
            {theme === t.value && (
              <CheckCircle2 size={14} className="text-[rgb(var(--brand))]" />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── About Section ────────────────────────────────────────────────────────────

function AboutSection() {
  const rows = [
    { label: "Platform",        value: "ClearRent" },
    { label: "Admin Dashboard", value: "Web v1.0.0" },
    { label: "Mobile App",      value: "Flutter (Android)" },
    { label: "Backend",         value: "Firebase Firestore" },
    { label: "Media Storage",   value: "Cloudinary" },
    { label: "Maps",            value: "OpenStreetMap / Nominatim" },
    { label: "Target Market",   value: "Lagos, Nigeria" },
  ];

  return (
    <div className="card space-y-6">
      <div>
        <h2 className="font-display font-semibold text-[rgb(var(--text-primary))]">About ClearRent</h2>
        <p className="text-sm text-[rgb(var(--text-secondary))] mt-0.5">Platform information and tech stack.</p>
      </div>

      <div className="space-y-1">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between py-3 border-b border-[rgb(var(--border))] last:border-0">
            <p className="text-sm text-[rgb(var(--text-hint))]">{row.label}</p>
            <p className="text-sm font-medium text-[rgb(var(--text-primary))]">{row.value}</p>
          </div>
        ))}
      </div>

      <div className="p-4 rounded-xl bg-[rgb(var(--brand))]/5 border border-[rgb(var(--brand))]/20">
        <p className="text-sm text-[rgb(var(--text-secondary))] leading-relaxed">
          ClearRent eliminates fraud in Nigeria's rental market by connecting verified landlords directly with verified tenants — making agents optional, not mandatory.
        </p>
      </div>
    </div>
  );
}

// ─── Sign Out Button ──────────────────────────────────────────────────────────

function SignOutButton() {
  const [loading, setLoading] = useState(false);

  const handleSignOut = async () => {
    if (!confirm("Sign out of the admin dashboard?")) return;
    setLoading(true);
    try {
      await auth.signOut();
    } catch {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleSignOut}
      disabled={loading}
      className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-red-500 hover:bg-red-500/5 transition-colors disabled:opacity-50"
    >
      {loading ? <Loader2 size={16} className="animate-spin" /> : <LogOut size={16} />}
      <span className="text-sm font-medium">Sign Out</span>
    </button>
  );
}

// ─── Toast ────────────────────────────────────────────────────────────────────

function Toast({ type, message }: { type: "success" | "error"; message: string }) {
  return (
    <div className={cn(
      "flex items-center gap-2 px-4 py-3 rounded-xl border text-sm",
      type === "success"
        ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400"
        : "bg-red-500/10 border-red-500/20 text-red-500"
    )}>
      {type === "success" ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
      {message}
    </div>
  );
}