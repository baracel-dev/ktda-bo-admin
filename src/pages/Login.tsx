import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AuthLayout, Button, Field, Input, Select } from "../ui";
import { ShieldCheck, ClipboardCheck, Lock } from "lucide-react";
import { useAuth } from "../lib/auth";
import { TokApiError } from "../lib/tokApi";
import { StaffDisabledError } from "../lib/staffContract";
import { PENDING_APPROVAL_HINT, type SelfServiceRole } from "../lib/tokenConsole/spec-deviations";

const BULLETS = [
  { label: "Two-person approval on fees, limits and configuration", icon: <Lock size={15} /> },
  { label: "Maker-checker on every payment release", icon: <ClipboardCheck size={15} /> },
  { label: "Every action auditable end to end", icon: <ShieldCheck size={15} /> },
];

/** ADMIN is deliberately not offered: the service rejects it on self-service
 *  signup, so admin only ever comes from the approval workflow. */
const SIGNUP_ROLES: { value: SelfServiceRole; label: string }[] = [
  { value: "ACCOUNTANT", label: "Accountant" },
  { value: "COMPLIANCE", label: "Compliance" },
  { value: "DEVELOPER", label: "Developer" },
  { value: "DEVOPS", label: "DevOps" },
];

function messageOf(err: unknown, fallback: string) {
  return err instanceof TokApiError || err instanceof StaffDisabledError ? err.message : fallback;
}

/** Sign-in with a tokenization account (the staff accounts tokenization-web
 * used). The session is an HttpOnly cookie the service sets, so signing in is
 * a round trip and nothing about it is knowable client-side before that. */
export default function Login() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <AuthLayout
      eyebrow="KTDA Digital Tea Payment Solution"
      title="Back Office"
      description="Onboard farmers, pay their wallets, reconcile the ledger and follow every exception, with two-person control on what moves money."
      bullets={BULLETS}
    >
      <div className="max-w-md w-full relative z-10">
        {mode === "signin" ? (
          <SignInForm notice={notice} onSignup={() => { setNotice(null); setMode("signup"); }} />
        ) : (
          <SignUpForm
            onCancel={() => setMode("signin")}
            onCreated={(email) => {
              setNotice(`Account created for ${email}. An administrator has to approve it before you can sign in.`);
              setMode("signin");
            }}
          />
        )}
      </div>
    </AuthLayout>
  );
}

function SignInForm({ notice, onSignup }: { notice: string | null; onSignup: () => void }) {
  const { login, signedOutReason } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A pending account is not a credentials problem; don't say "check your
  // password" to someone whose password is right.
  const pending = error?.includes(PENDING_APPROVAL_HINT) ?? false;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await login(email.trim(), password);
      navigate("/");
    } catch (err) {
      setError(messageOf(err, "Could not reach the tokenization service."));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <h2 className="text-xl font-display font-semibold text-text mb-1.5">Sign in</h2>
      <p className="text-sm text-text-soft mb-6">
        Use your tokenization account. New sign-ups need administrator approval before they can be used.
      </p>
      {notice && (
        <p role="status" className="text-sm text-success bg-success-bg rounded-lg px-3 py-2 mb-4">
          {notice}
        </p>
      )}
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <Field label="Email" required>
          <Input type="email" value={email} autoComplete="username" autoFocus required onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password" required>
          <Input type="password" value={password} autoComplete="current-password" required onChange={(e) => setPassword(e.target.value)} />
        </Field>

        {/* The directory refused a session that was already open (a disabled member). */}
        {!error && signedOutReason && <p role="alert" className="text-sm text-danger" data-testid="signed-out-reason">{signedOutReason}</p>}
        {error && (
          <p role="alert" className={pending ? "text-sm text-warning" : "text-sm text-danger"}>
            {error}
            {pending && ". You'll be able to sign in once an administrator approves it."}
          </p>
        )}

        <Button type="submit" variant="primary" size="lg" disabled={isSubmitting} className="w-full justify-center mt-1">
          {isSubmitting ? "Signing in…" : "Sign in"}
        </Button>
      </form>
      <p className="text-sm text-text-soft mt-5 text-center">
        No account?{" "}
        <button type="button" onClick={onSignup} className="text-primary-600 font-medium hover:underline">
          Create one
        </button>
      </p>
    </>
  );
}

function SignUpForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: (email: string) => void }) {
  const { signup } = useAuth();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [role, setRole] = useState<SelfServiceRole>("ACCOUNTANT");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Shown next to the field before a round trip; the service still has the
  // final say on the account it creates.
  const mismatch = confirmPassword.length > 0 && password !== confirmPassword;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mismatch) return;
    setError(null);
    setIsSubmitting(true);
    try {
      const created = await signup({ fullName: fullName.trim(), email: email.trim(), password, confirmPassword, role });
      onCreated(created?.email ?? email.trim());
    } catch (err) {
      setError(messageOf(err, "Could not reach the tokenization service."));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <h2 className="text-xl font-display font-semibold text-text mb-1.5">Create an account</h2>
      <p className="text-sm text-text-soft mb-6">New accounts need administrator approval before they can sign in.</p>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <Field label="Full name" required>
          <Input value={fullName} autoComplete="name" autoFocus required onChange={(e) => setFullName(e.target.value)} />
        </Field>
        <Field label="Email" required>
          <Input type="email" value={email} autoComplete="username" required onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Role" required>
          <Select value={role} onChange={(e) => setRole(e.target.value as SelfServiceRole)}>
            {SIGNUP_ROLES.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Password" required>
          <Input type="password" value={password} autoComplete="new-password" required onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label="Confirm password" required error={mismatch ? "Passwords don't match." : undefined}>
          <Input type="password" value={confirmPassword} autoComplete="new-password" required onChange={(e) => setConfirmPassword(e.target.value)} />
        </Field>

        {error && <p role="alert" className="text-sm text-danger">{error}</p>}

        <Button type="submit" variant="primary" size="lg" disabled={isSubmitting || mismatch} className="w-full justify-center mt-1">
          {isSubmitting ? "Creating…" : "Create account"}
        </Button>
      </form>
      <p className="text-sm text-text-soft mt-5 text-center">
        Already have an account?{" "}
        <button type="button" onClick={onCancel} className="text-primary-600 font-medium hover:underline">
          Sign in
        </button>
      </p>
    </>
  );
}
