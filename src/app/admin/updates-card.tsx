"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  Loader2,
  RefreshCw,
  TriangleAlert,
  Upload,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "sonner";

interface ReleaseAsset {
  name: string;
  downloadUrl: string;
  size: number;
}

interface ReleaseInfo {
  latestVersion: string;
  publishedAt: string;
  releaseNotes: string;
  htmlUrl: string;
  assets: ReleaseAsset[];
}

interface UpdateStatus {
  installedVersion: string;
  latest?: ReleaseInfo;
  updateAvailable: boolean;
  checkedAt: string;
  error?: string;
  disabled?: boolean;
  updateCommand?: string;
  installType?: "docker" | "native";
}

/**
 * Updates card — rendered on the admin home page. Shows the installed
 * version + (when an update is available) the latest version + the exact
 * update command for the install type. Read-only: applying an update is
 * always external.
 */
export function UpdatesCard(): JSX.Element {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);

  const fetchStatus = useCallback(async (force: boolean): Promise<void> => {
    if (force) setChecking(true);
    try {
      const url = force ? "/api/admin/updates?force=1" : "/api/admin/updates";
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        toast.error("Failed to load update status", {
          description: `HTTP ${res.status}`,
        });
        return;
      }
      const data = (await res.json()) as UpdateStatus;
      setStatus(data);
    } catch (err) {
      toast.error("Failed to load update status", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setLoading(false);
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void fetchStatus(false);
  }, [fetchStatus]);

  const copyCommand = useCallback(async (cmd: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(cmd);
      toast.success("Update command copied to clipboard");
    } catch {
      toast.error("Couldn't copy — copy the command manually.");
    }
  }, []);

  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Upload className="h-5 w-5" />
          </span>
          <Badge variant="secondary" className="text-[10px] font-mono">
            v{status?.installedVersion ?? "…"}
          </Badge>
        </div>
        <CardTitle className="text-base mt-2">Updates</CardTitle>
        <CardDescription className="text-sm leading-relaxed">
          Check for new ChildCheck releases. Apply updates externally — the
          checker is read-only.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Checking…
          </div>
        ) : status?.disabled ? (
          <div className="space-y-2">
            <div className="flex items-start gap-2 text-sm">
              <TriangleAlert className="h-4 w-4 mt-0.5 text-amber-500 shrink-0" />
              <span className="text-muted-foreground">
                Update checking is disabled.
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Set{" "}
              <code className="px-1 py-0.5 rounded bg-muted font-mono text-[11px]">
                CHILDCHECK_UPDATE_REPO
              </code>{" "}
              (e.g. <span className="font-mono">childcheck/childcheck</span>)
              in your environment to enable.
            </p>
          </div>
        ) : status?.error ? (
          <div className="flex items-start gap-2 text-sm">
            <TriangleAlert className="h-4 w-4 mt-0.5 text-amber-500 shrink-0" />
            <div className="space-y-0.5">
              <p className="text-muted-foreground">{status.error}</p>
              <p className="text-xs text-muted-foreground">
                Checked at{" "}
                {new Date(status.checkedAt).toLocaleString()}
              </p>
            </div>
          </div>
        ) : status?.updateAvailable && status.latest ? (
          <div className="space-y-2">
            <div className="flex items-start gap-2 text-sm">
              <TriangleAlert className="h-4 w-4 mt-0.5 text-emerald-500 shrink-0" />
              <div>
                <p className="font-medium">
                  v{status.latest.latestVersion} is available
                </p>
                <p className="text-xs text-muted-foreground">
                  Published{" "}
                  {new Date(status.latest.publishedAt).toLocaleDateString()}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button asChild size="sm" variant="outline">
                <a
                  href={status.latest.htmlUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                  Release notes
                </a>
              </Button>
            </div>
            {status.updateCommand ? (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">
                  Update command ({status.installType ?? "native"}):
                </p>
                <div className="flex items-stretch gap-1">
                  <code className="flex-1 px-2 py-1.5 rounded bg-muted font-mono text-[11px] overflow-x-auto whitespace-nowrap">
                    {status.updateCommand}
                  </code>
                  <Button
                    size="sm"
                    variant="outline"
                    className="px-2"
                    aria-label="Copy update command"
                    onClick={() => void copyCommand(status.updateCommand!)}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            <span>
              Up to date
              {status?.checkedAt
                ? ` · checked ${new Date(status.checkedAt).toLocaleString()}`
                : null}
            </span>
          </div>
        )}

        <Button
          size="sm"
          variant="ghost"
          className="w-full text-primary"
          disabled={checking}
          onClick={() => void fetchStatus(true)}
        >
          {checking ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          )}
          Check now
        </Button>
      </CardContent>
    </Card>
  );
}
