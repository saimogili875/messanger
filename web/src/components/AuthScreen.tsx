// web/src/components/AuthScreen.tsx
// Authentication screen featuring Login & Register tabs, password strength calculation, and rate-limit countdown.

import React, { useState, useEffect } from "react";
import { Eye, EyeOff, Lock, Mail, User, ShieldCheck, AlertCircle } from "lucide-react";
import { api, setAccessToken, setStoredRefreshToken } from "../services/api";
import { useChatStore } from "../store/useChatStore";

export const AuthScreen: React.FC = () => {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);

  const setCurrentUser = useChatStore((s) => s.setCurrentUser);

  // Active rate-limit countdown timer
  useEffect(() => {
    if (countdown === null || countdown <= 0) return;
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev === null || prev <= 1) {
          setError(null);
          return null;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  // Evaluates password strength metrics
  const getPasswordStrength = (pass: string) => {
    let score = 0;
    if (pass.length >= 8) score++;
    if (/[A-Z]/.test(pass)) score++;
    if (/[a-z]/.test(pass)) score++;
    if (/[0-9]/.test(pass)) score++;
    if (/[^A-Za-z0-9]/.test(pass)) score++;
    return score;
  };

  const strength = getPasswordStrength(password);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (mode === "login") {
        const { data } = await api.post("/auth/login", { email, password });
        setAccessToken(data.accessToken);
        setStoredRefreshToken(data.refreshToken);

        // Fetch current user details
        const meRes = await api.get("/me");
        setCurrentUser(meRes.data);
      } else {
        await api.post("/auth/register", { email, password, displayName });
        // Automatically sign in upon registration
        const loginRes = await api.post("/auth/login", { email, password });
        setAccessToken(loginRes.data.accessToken);
        setStoredRefreshToken(loginRes.data.refreshToken);

        const meRes = await api.get("/me");
        setCurrentUser(meRes.data);
      }
    } catch (err: any) {
      if (err.response?.status === 429) {
        const retryAfter = err.response.data?.retryAfter || 60;
        setCountdown(retryAfter);
        setError(`Rate limit reached. Please wait ${retryAfter}s before retrying.`);
      } else {
        const msg = err.response?.data?.message || err.response?.data?.error || "Authentication failed. Please verify your credentials.";
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        backgroundColor: "var(--bg-app)",
        padding: "var(--space-4)",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "420px",
          backgroundColor: "var(--bg-card)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-lg)",
          padding: "var(--space-6)",
          border: "1px solid var(--border-subtle)",
        }}
      >
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: "var(--space-6)" }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: "56px",
              height: "56px",
              borderRadius: "var(--radius-full)",
              backgroundColor: "var(--accent-primary)",
              color: "#ffffff",
              marginBottom: "var(--space-3)",
            }}
          >
            <ShieldCheck size={32} />
          </div>
          <h1 style={{ fontSize: "var(--text-xl)", fontWeight: 700, color: "var(--text-primary)" }}>
            Messenger
          </h1>
          <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", marginTop: "4px" }}>
            Secure, end-to-end engineered messaging
          </p>
        </div>

        {/* Tab switch */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            backgroundColor: "var(--bg-input)",
            borderRadius: "var(--radius-md)",
            padding: "4px",
            marginBottom: "var(--space-5)",
          }}
        >
          <button
            type="button"
            onClick={() => { setMode("login"); setError(null); }}
            style={{
              padding: "8px",
              borderRadius: "var(--radius-sm)",
              fontSize: "var(--text-sm)",
              fontWeight: mode === "login" ? 600 : 500,
              backgroundColor: mode === "login" ? "var(--bg-card)" : "transparent",
              color: mode === "login" ? "var(--accent-primary)" : "var(--text-secondary)",
              boxShadow: mode === "login" ? "var(--shadow-sm)" : "none",
              transition: "var(--transition-fast)",
            }}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => { setMode("register"); setError(null); }}
            style={{
              padding: "8px",
              borderRadius: "var(--radius-sm)",
              fontSize: "var(--text-sm)",
              fontWeight: mode === "register" ? 600 : 500,
              backgroundColor: mode === "register" ? "var(--bg-card)" : "transparent",
              color: mode === "register" ? "var(--accent-primary)" : "var(--text-secondary)",
              boxShadow: mode === "register" ? "var(--shadow-sm)" : "none",
              transition: "var(--transition-fast)",
            }}
          >
            Register
          </button>
        </div>

        {/* Error alert */}
        {error && (
          <div
            role="alert"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "10px 14px",
              borderRadius: "var(--radius-md)",
              backgroundColor: "rgba(239, 68, 68, 0.1)",
              border: "1px solid var(--accent-danger)",
              color: "var(--accent-danger)",
              fontSize: "var(--text-xs)",
              marginBottom: "var(--space-4)",
            }}
          >
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          {mode === "register" && (
            <div>
              <label
                htmlFor="displayName"
                style={{ display: "block", fontSize: "var(--text-xs)", fontWeight: 600, marginBottom: "6px", color: "var(--text-secondary)" }}
              >
                Display Name
              </label>
              <div style={{ position: "relative" }}>
                <User size={18} style={{ position: "absolute", left: "12px", top: "12px", color: "var(--text-muted)" }} />
                <input
                  id="displayName"
                  type="text"
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Your Name"
                  style={{
                    width: "100%",
                    padding: "10px 12px 10px 38px",
                    borderRadius: "var(--radius-md)",
                    border: "1px solid var(--border-strong)",
                    backgroundColor: "var(--bg-input)",
                    fontSize: "var(--text-sm)",
                  }}
                />
              </div>
            </div>
          )}

          <div>
            <label
              htmlFor="email"
              style={{ display: "block", fontSize: "var(--text-xs)", fontWeight: 600, marginBottom: "6px", color: "var(--text-secondary)" }}
            >
              Email Address
            </label>
            <div style={{ position: "relative" }}>
              <Mail size={18} style={{ position: "absolute", left: "12px", top: "12px", color: "var(--text-muted)" }} />
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                style={{
                  width: "100%",
                  padding: "10px 12px 10px 38px",
                  borderRadius: "var(--radius-md)",
                  border: "1px solid var(--border-strong)",
                  backgroundColor: "var(--bg-input)",
                  fontSize: "var(--text-sm)",
                }}
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="password"
              style={{ display: "block", fontSize: "var(--text-xs)", fontWeight: 600, marginBottom: "6px", color: "var(--text-secondary)" }}
            >
              Password
            </label>
            <div style={{ position: "relative" }}>
              <Lock size={18} style={{ position: "absolute", left: "12px", top: "12px", color: "var(--text-muted)" }} />
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                style={{
                  width: "100%",
                  padding: "10px 38px 10px 38px",
                  borderRadius: "var(--radius-md)",
                  border: "1px solid var(--border-strong)",
                  backgroundColor: "var(--bg-input)",
                  fontSize: "var(--text-sm)",
                }}
              />
              <button
                type="button"
                aria-label={showPassword ? "Hide password" : "Show password"}
                onClick={() => setShowPassword(!showPassword)}
                style={{ position: "absolute", right: "8px", top: "6px", color: "var(--text-muted)" }}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>

            {/* Password strength bar */}
            {mode === "register" && password.length > 0 && (
              <div style={{ marginTop: "6px" }}>
                <div style={{ display: "flex", gap: "4px", height: "4px" }}>
                  {[1, 2, 3, 4, 5].map((lvl) => (
                    <div
                      key={lvl}
                      style={{
                        flex: 1,
                        borderRadius: "2px",
                        backgroundColor:
                          lvl <= strength
                            ? strength <= 2
                              ? "var(--accent-danger)"
                              : strength <= 4
                              ? "var(--accent-warning)"
                              : "var(--accent-online)"
                            : "var(--border-subtle)",
                        transition: "var(--transition-fast)",
                      }}
                    />
                  ))}
                </div>
                <span style={{ fontSize: "11px", color: "var(--text-muted)", display: "block", marginTop: "4px" }}>
                  {strength <= 2 ? "Weak" : strength <= 4 ? "Good" : "Strong"} password
                </span>
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={loading || countdown !== null}
            style={{
              marginTop: "var(--space-2)",
              padding: "12px",
              borderRadius: "var(--radius-md)",
              backgroundColor: "var(--accent-primary)",
              color: "#ffffff",
              fontWeight: 600,
              fontSize: "var(--text-sm)",
              opacity: loading || countdown !== null ? 0.7 : 1,
              transition: "var(--transition-fast)",
            }}
          >
            {loading ? "Authenticating..." : countdown !== null ? `Locked (${countdown}s)` : mode === "login" ? "Sign In" : "Create Account"}
          </button>
        </form>
      </div>
    </div>
  );
};

