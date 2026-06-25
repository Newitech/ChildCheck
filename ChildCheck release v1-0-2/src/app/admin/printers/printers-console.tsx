"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Printer, LayoutTemplate, Link2, Info } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PrintersTab } from "./printers-tab";
import { RoomAssignmentsTab } from "./room-assignments-tab";
import { LabelTemplatesTab } from "./label-templates-tab";

/**
 * Top-level admin console for the printing subsystem.
 *
 * Three tabs:
 *   1. Printers           — CRUD list (name, driver, queue, purpose, default).
 *   2. Room assignments   — which printer(s) are assigned to which room(s).
 *   3. Label templates    — form-based editor with live preview.
 */
export function PrintersConsole() {
  return (
    <div className="space-y-6">
      <Card className="bg-muted/30">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Info className="h-4 w-4 text-primary" /> Driver quick reference
          </CardTitle>
          <CardDescription className="text-sm leading-relaxed">
            <span className="font-medium text-foreground">Browser</span> —
            zero-dependency fallback. Server returns HTML; the kiosk opens a
            hidden iframe and calls <code>window.print()</code>. Works on
            every device. &nbsp;·&nbsp;
            <span className="font-medium text-foreground">QZ Tray</span> —
            requires the <a
              className="underline"
              href="https://qz.io"
              target="_blank"
              rel="noreferrer"
            >QZ Tray</a> Java app running on each kiosk for direct printer
            control. &nbsp;·&nbsp;
            <span className="font-medium text-foreground">Thermal raw</span> —
            ESC/POS byte commands (base64). Send via QZ Tray RAW mode or a
            CUPS raw queue.
          </CardDescription>
        </CardHeader>
      </Card>

      <Tabs defaultValue="printers" className="w-full">
        <TabsList className="grid w-full sm:w-auto grid-cols-3">
          <TabsTrigger value="printers" className="gap-1.5">
            <Printer className="h-4 w-4" /> Printers
          </TabsTrigger>
          <TabsTrigger value="assignments" className="gap-1.5">
            <Link2 className="h-4 w-4" /> Room assignments
          </TabsTrigger>
          <TabsTrigger value="templates" className="gap-1.5">
            <LayoutTemplate className="h-4 w-4" /> Label templates
          </TabsTrigger>
        </TabsList>
        <TabsContent value="printers" className="mt-4">
          <PrintersTab />
        </TabsContent>
        <TabsContent value="assignments" className="mt-4">
          <RoomAssignmentsTab />
        </TabsContent>
        <TabsContent value="templates" className="mt-4">
          <LabelTemplatesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
