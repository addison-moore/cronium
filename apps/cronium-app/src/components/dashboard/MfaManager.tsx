"use client";

import { useState } from "react";
import { ShieldCheck, ShieldAlert, Copy, Check } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button, Input, Label, toast } from "@cronium/ui";
import { SettingsCard } from "@/components/dashboard";

function RecoveryCodes({ codes }: { codes: string[] }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard.writeText(codes.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="border-warning/40 bg-warning/10 space-y-3 rounded-md border p-4">
      <p className="text-sm font-medium">
        Save these recovery codes now — each works once and they will not be
        shown again. Use one if you lose access to your authenticator.
      </p>
      <div className="grid grid-cols-2 gap-2 font-mono text-sm">
        {codes.map((code) => (
          <code key={code} className="bg-muted rounded px-2 py-1">
            {code}
          </code>
        ))}
      </div>
      <Button type="button" variant="outline" size="sm" onClick={copy}>
        {copied ? (
          <Check className="mr-2 h-4 w-4" />
        ) : (
          <Copy className="mr-2 h-4 w-4" />
        )}
        Copy codes
      </Button>
    </div>
  );
}

export default function MfaManager() {
  const status = trpc.mfa.getStatus.useQuery();
  const utils = trpc.useUtils();

  const [enrollment, setEnrollment] = useState<{
    secret: string;
    otpauthUri: string;
  } | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");

  const begin = trpc.mfa.beginEnrollment.useMutation({
    onSuccess: (data) => setEnrollment(data),
    onError: (e) =>
      toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const confirm = trpc.mfa.confirmEnrollment.useMutation({
    onSuccess: (data) => {
      setRecoveryCodes(data.recoveryCodes);
      setEnrollment(null);
      setPassword("");
      setCode("");
      void utils.mfa.getStatus.invalidate();
      toast({ title: "MFA enabled", variant: "success" });
    },
    onError: (e) =>
      toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const disable = trpc.mfa.disable.useMutation({
    onSuccess: () => {
      setPassword("");
      setCode("");
      setRecoveryCodes(null);
      void utils.mfa.getStatus.invalidate();
      toast({ title: "MFA disabled", variant: "success" });
    },
    onError: (e) =>
      toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const regenerate = trpc.mfa.regenerateRecoveryCodes.useMutation({
    onSuccess: (data) => {
      setRecoveryCodes(data.recoveryCodes);
      setPassword("");
      void utils.mfa.getStatus.invalidate();
    },
    onError: (e) =>
      toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const enabled = status.data?.enabled ?? false;

  return (
    <SettingsCard
      title="Two-Factor Authentication (TOTP)"
      description="Require a time-based code from an authenticator app when signing in."
    >
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-sm">
          {enabled ? (
            <>
              <ShieldCheck className="text-success h-5 w-5" />
              <span>
                Two-factor authentication is <strong>enabled</strong>
                {status.data
                  ? ` (${status.data.recoveryCodesRemaining} recovery codes left)`
                  : ""}
                .
              </span>
            </>
          ) : (
            <>
              <ShieldAlert className="text-muted-foreground h-5 w-5" />
              <span>Two-factor authentication is not enabled.</span>
            </>
          )}
        </div>

        {recoveryCodes && <RecoveryCodes codes={recoveryCodes} />}

        {/* Not enabled: enrollment flow */}
        {!enabled && !enrollment && (
          <Button
            type="button"
            onClick={() => begin.mutate()}
            disabled={begin.isPending}
          >
            Set up authenticator
          </Button>
        )}

        {!enabled && enrollment && (
          <div className="space-y-3">
            <p className="text-sm">
              Add this secret to your authenticator app (manual entry), then
              enter the current 6-digit code and your password to confirm.
            </p>
            <div className="space-y-1">
              <Label>Secret key</Label>
              <code className="bg-muted block rounded px-2 py-1 font-mono text-sm break-all">
                {enrollment.secret}
              </code>
            </div>
            <div className="space-y-1">
              <Label htmlFor="mfa-code">Authenticator code</Label>
              <Input
                id="mfa-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode="numeric"
                placeholder="123456"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="mfa-password">Current password</Label>
              <Input
                id="mfa-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                onClick={() => confirm.mutate({ password, code })}
                disabled={confirm.isPending || !password || !code}
              >
                Confirm &amp; enable
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEnrollment(null)}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Enabled: disable + regenerate */}
        {enabled && (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="mfa-password2">Current password</Label>
              <Input
                id="mfa-password2"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="mfa-code2">
                Authenticator or recovery code (to disable)
              </Label>
              <Input
                id="mfa-code2"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="123456"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="destructive"
                onClick={() => disable.mutate({ password, code })}
                disabled={disable.isPending || !password || !code}
              >
                Disable MFA
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => regenerate.mutate({ password })}
                disabled={regenerate.isPending || !password}
              >
                Regenerate recovery codes
              </Button>
            </div>
          </div>
        )}
      </div>
    </SettingsCard>
  );
}
