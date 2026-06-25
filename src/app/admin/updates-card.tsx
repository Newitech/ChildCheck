"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Download, ExternalLink, RefreshCw, AlertCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface UpdateStatus {
  installedVersion: string;
  latest?: {
    latestVersion: string;
    publishedAt: string;
    releaseNotes: string;
    htmlUrl: string;
  };
  updateAvailable: boolean;
  checkedAt: string;
  error?: string;
  disabled?: boolean;
  updateCommand?: string;
  installType?: string;
}

export function UpdatesCard() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [loading, setLoading] = useState(true);

  async function fetchStatus(force = false) {
    setLoading(true);
    try {
      const url = force ? "/api/admin/updates?force=1" : "/api/admin/updates";
      const res = await fetch(url, { cache: "no-store" });
      const data = (await res.json()) as UpdateStatus;
      setStatus(data);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchStatus(false);
  }, []);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Download className="h-4 w-4" /> Updates
            </CardTitle>
            <CardDescription className="text-sm mt-1">
              Check for new ChildCheck releases.
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => fetchStatus(true)}
            disabled={loading}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            <span className="ml-1.5">Check now</span>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {status?.disabled ? (
          <div className="flex items-start gap-2 text-sm text-muted-foreground">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              <p>Update checking is disabled.</p>
              <p className="text-xs mt-1">
                Set <code className="text-xs">CHILDCHETECK_UPDATE_REPO</code> in your{" "}
                <code className="text-xs">.env</code> (e.g.{" "}
                <code className="text-xs">Newitech/childcheck</code>) + restart.
              </p>
            </div>
          </div>
        ) : status?.error ? (
          <div className="flex items-start gap-2 text-sm text-muted-foreground">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              <p>Could not check for updates.</p>
              <p className="text-xs mt-1">{status.error}</p>
            </div>
          </div>
        ) : status?.updateAvailable && status.latest ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Badge variant="default" className="gap-1">
                <Download className="h-3 w-3" /> v{status.latest.latestVersion} available
              </Badge>
              <span className="text-xs text-muted-foreground">
                (you have v{status.installedVersion})
              </span>
            </div>
            <a
              href={status.latest.htmlUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
            >
              View release notes <ExternalLink className="h-3 w-3" />
            </a>
            <div className="rounded-md border bg-muted/30 p-3">
              <p className="text-xs font-medium mb-1">Update command ({status.installType}):</p>
              <code className="text-xs block break-all">{status.updateCommand}</code>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <span>
              Up to date — v{status?.installedVersion ?? "..."}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
