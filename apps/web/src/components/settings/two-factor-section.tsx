"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, Copy, ShieldCheck, ShieldOff } from "lucide-react";
import QRCode from "qrcode";

import { authClient } from "@repo/auth/client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Input,
  Label,
  PasswordInput,
  Separator,
  toast,
} from "@repo/design-system";

const CONVEX_SITE_URL =
  process.env.NEXT_PUBLIC_CONVEX_SITE_URL ?? "http://localhost:3210";

type Step = "idle" | "password-enable" | "totp-uri" | "verify-code" | "backup-codes" | "password-disable" | "password-regenerate";

export function TwoFactorSection() {
  const t2 = useTranslations("dashboard.twoFactor");
  const tcp = useTranslations("dashboard.changePassword");
  const tc = useTranslations("common");

  const [step, setStep] = React.useState<Step>("idle");
  const [enabled, setEnabled] = React.useState(false);
  const [password, setPassword] = React.useState("");
  const [totpUri, setTotpUri] = React.useState("");
  const [qrDataUrl, setQrDataUrl] = React.useState("");
  const [code, setCode] = React.useState("");
  const [backupCodes, setBackupCodes] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [statusLoading, setStatusLoading] = React.useState(true);
  const [disableDialogOpen, setDisableDialogOpen] = React.useState(false);
  const [regenerateDialogOpen, setRegenerateDialogOpen] = React.useState(false);

  // Check 2FA status on mount
  React.useEffect(() => {
    (async () => {
      try {
        const session = await authClient.getSession();
        const user = session.data?.user as Record<string, unknown> | undefined;
        setEnabled(user?.twoFactorEnabled === true);
      } catch {
        // Ignore
      } finally {
        setStatusLoading(false);
      }
    })();
  }, []);

  // Extract just the secret key from the otpauth:// URI
  const secretKey = React.useMemo(() => {
    try {
      const url = new URL(totpUri);
      return url.searchParams.get("secret") ?? "";
    } catch {
      return "";
    }
  }, [totpUri]);

  const handleCopySecret = async () => {
    if (!secretKey) return;
    try {
      await globalThis.navigator.clipboard.writeText(secretKey);
      toast.success(t2("copied"));
    } catch {
      // Fallback: select text
    }
  };

  const handleEnable = async () => {
    if (!password) return;
    setLoading(true);
    try {
      const result = await authClient.twoFactor.enable({ password });
      if (result.error) {
        toast.error(tcp("errorCurrentPassword"));
        return;
      }
      const uri = (result.data as { totpURI?: string })?.totpURI ?? "";
      setTotpUri(uri);
      if (uri) {
        const dataUrl = await QRCode.toDataURL(uri, { width: 200, margin: 2 });
        setQrDataUrl(dataUrl);
      }
      setStep("totp-uri");
      setPassword("");
    } catch {
      toast.error(tc("error"));
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    if (!code || code.length !== 6) return;
    setLoading(true);
    try {
      const result = await authClient.twoFactor.verifyTotp({ code });
      if (result.error) {
        toast.error(tc("error"));
        return;
      }
      const data = result.data as { backupCodes?: string[] } | undefined;
      setBackupCodes(data?.backupCodes ?? []);
      setEnabled(true);
      setStep("backup-codes");
      setCode("");
    } catch {
      toast.error(tc("error"));
    } finally {
      setLoading(false);
    }
  };

  const handleDisable = async () => {
    if (!password) return;
    setLoading(true);
    try {
      const result = await authClient.twoFactor.disable({ password });
      if (result.error) {
        toast.error(tcp("errorCurrentPassword"));
        return;
      }
      setEnabled(false);
      setStep("idle");
      setPassword("");
      toast.success(t2("disabled"));
    } catch {
      toast.error(tc("error"));
    } finally {
      setLoading(false);
    }
  };

  const handleViewBackupCodes = async () => {
    setLoading(true);
    try {
      // Custom endpoint — Better Auth v1.4.12 bug: viewBackupCodes has no HTTP path
      const res = await fetch(`${CONVEX_SITE_URL}/api/two-factor/backup-codes`, {
        credentials: "include",
      });
      if (!res.ok) {
        toast.error(tc("error"));
        return;
      }
      const data = (await res.json()) as { backupCodes?: string[] };
      setBackupCodes(data.backupCodes ?? []);
      setStep("backup-codes");
    } catch {
      toast.error(tc("error"));
    } finally {
      setLoading(false);
    }
  };

  const handleRegenerateBackupCodes = async () => {
    if (!password) return;
    setLoading(true);
    try {
      const result = await authClient.twoFactor.generateBackupCodes({ password });
      if (result.error) {
        toast.error(tcp("errorCurrentPassword"));
        return;
      }
      const data = result.data as { backupCodes?: string[] } | undefined;
      setBackupCodes(data?.backupCodes ?? []);
      setStep("backup-codes");
      setPassword("");
    } catch {
      toast.error(tc("error"));
    } finally {
      setLoading(false);
    }
  };

  if (statusLoading) {
    return <div className="text-sm text-muted-foreground">{tc("loading")}</div>;
  }

  // Idle state: show status and enable/disable button
  if (step === "idle") {
    return (
      <div className="space-y-4 max-w-md">
        <div className="flex items-center gap-3">
          {enabled ? (
            <ShieldCheck className="h-5 w-5 text-green-500" />
          ) : (
            <ShieldOff className="h-5 w-5 text-muted-foreground" />
          )}
          <div>
            <p className="text-sm font-medium">
              {enabled ? t2("enabled") : t2("disabled")}
            </p>
            <p className="text-xs text-muted-foreground">{t2("description")}</p>
          </div>
        </div>

        {enabled ? (
          <div className="space-y-3">
            {/* Backup codes actions */}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={handleViewBackupCodes}
                disabled={loading}
              >
                {loading ? tc("loading") : t2("viewBackupCodes")}
              </Button>
              <Button
                variant="outline"
                onClick={() => setRegenerateDialogOpen(true)}
              >
                {t2("regenerateBackupCodes")}
              </Button>
            </div>

            <Separator />

            {/* Disable 2FA */}
            <Button
              variant="outline"
              onClick={() => setDisableDialogOpen(true)}
            >
              {t2("disable")}
            </Button>

            {/* Regenerate confirmation dialog */}
            <AlertDialog open={regenerateDialogOpen} onOpenChange={setRegenerateDialogOpen}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t2("regenerateBackupCodes")}</AlertDialogTitle>
                  <AlertDialogDescription>{t2("regenerateConfirm")}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
                  <AlertDialogAction onClick={() => setStep("password-regenerate")}>
                    {t2("regenerateBackupCodes")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            {/* Disable confirmation dialog */}
            <AlertDialog open={disableDialogOpen} onOpenChange={setDisableDialogOpen}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t2("disable")}</AlertDialogTitle>
                  <AlertDialogDescription>{t2("disableConfirm")}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
                  <AlertDialogAction onClick={() => setStep("password-disable")}>
                    {t2("disable")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        ) : (
          <Button onClick={() => setStep("password-enable")}>
            {t2("enable")}
          </Button>
        )}
      </div>
    );
  }

  // Password prompt for enable
  if (step === "password-enable") {
    return (
      <form className="space-y-4 max-w-md" onSubmit={(e) => { e.preventDefault(); handleEnable(); }}>
        <p className="text-sm text-muted-foreground">{t2("enterPassword")}</p>
        <div className="space-y-2">
          <Label htmlFor="2fa-password">{tcp("currentPassword")}</Label>
          <PasswordInput
            id="2fa-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
          />
        </div>
        <div className="flex gap-2">
          <Button type="submit" disabled={loading || !password}>
            {loading ? tc("loading") : t2("enable")}
          </Button>
          <Button type="button" variant="outline" onClick={() => { setStep("idle"); setPassword(""); }}>
            {tc("cancel")}
          </Button>
        </div>
      </form>
    );
  }

  // Show TOTP QR code + manual entry
  if (step === "totp-uri") {
    return (
      <div className="space-y-4 max-w-md">
        <p className="text-sm text-muted-foreground">{t2("scanQrCode")}</p>

        {/* QR Code */}
        {qrDataUrl && (
          <div className="flex justify-center rounded-md border bg-white p-4">
            <img src={qrDataUrl} alt="TOTP QR Code" width={200} height={200} />
          </div>
        )}

        {/* Collapsible manual entry */}
        <Collapsible>
          <CollapsibleTrigger className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ChevronDown className="h-4 w-4" />
            {t2("manualEntry")}
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 space-y-2">
            <p className="text-xs text-muted-foreground">{t2("manualEntryDescription")}</p>
            <div className="space-y-1">
              <Label className="text-xs">{t2("secretKey")}</Label>
              <div className="flex items-center gap-2">
                <code className="flex-1 break-all rounded-md border bg-muted px-3 py-2 text-xs font-mono">
                  {secretKey}
                </code>
                <Button variant="ghost" size="sm" onClick={handleCopySecret} className="shrink-0">
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Verification code input */}
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); handleVerify(); }}>
          <div className="space-y-2">
            <Label htmlFor="totp-code">{t2("enterCode")}</Label>
            <Input
              id="totp-code"
              placeholder={t2("codePlaceholder")}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              maxLength={6}
              autoFocus
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={loading || code.length !== 6}>
              {loading ? tc("loading") : t2("verify")}
            </Button>
            <Button type="button" variant="outline" onClick={() => { setStep("idle"); setCode(""); setTotpUri(""); setQrDataUrl(""); }}>
              {tc("cancel")}
            </Button>
          </div>
        </form>
      </div>
    );
  }

  // Backup codes display
  if (step === "backup-codes") {
    return (
      <div className="space-y-4 max-w-md">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-green-500" />
          <Badge variant="outline" className="border-green-500/30 text-green-600">
            {t2("enabled")}
          </Badge>
        </div>
        <div className="space-y-2">
          <Label>{t2("backupCodes")}</Label>
          <p className="text-xs text-muted-foreground">{t2("backupCodesDescription")}</p>
          <div className="grid grid-cols-2 gap-2 rounded-md border bg-muted p-3">
            {backupCodes.map((bc) => (
              <code key={bc} className="text-xs font-mono">
                {bc}
              </code>
            ))}
          </div>
        </div>
        <Button variant="outline" onClick={() => { setStep("idle"); setBackupCodes([]); }}>
          {tc("save")}
        </Button>
      </div>
    );
  }

  // Password prompt for regenerating backup codes
  if (step === "password-regenerate") {
    return (
      <form className="space-y-4 max-w-md" onSubmit={(e) => { e.preventDefault(); handleRegenerateBackupCodes(); }}>
        <p className="text-sm text-muted-foreground">{t2("enterPassword")}</p>
        <div className="space-y-2">
          <Label htmlFor="2fa-regen-password">{tcp("currentPassword")}</Label>
          <PasswordInput
            id="2fa-regen-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
          />
        </div>
        <div className="flex gap-2">
          <Button type="submit" disabled={loading || !password}>
            {loading ? tc("loading") : t2("regenerateBackupCodes")}
          </Button>
          <Button type="button" variant="outline" onClick={() => { setStep("idle"); setPassword(""); }}>
            {tc("cancel")}
          </Button>
        </div>
      </form>
    );
  }

  // Password prompt for disable
  if (step === "password-disable") {
    return (
      <form className="space-y-4 max-w-md" onSubmit={(e) => { e.preventDefault(); handleDisable(); }}>
        <p className="text-sm text-muted-foreground">{t2("enterPassword")}</p>
        <div className="space-y-2">
          <Label htmlFor="2fa-disable-password">{tcp("currentPassword")}</Label>
          <PasswordInput
            id="2fa-disable-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
          />
        </div>
        <div className="flex gap-2">
          <Button type="submit" variant="destructive" disabled={loading || !password}>
            {loading ? tc("loading") : t2("disable")}
          </Button>
          <Button type="button" variant="outline" onClick={() => { setStep("idle"); setPassword(""); }}>
            {tc("cancel")}
          </Button>
        </div>
      </form>
    );
  }

  return null;
}
