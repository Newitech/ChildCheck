import { ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * BrandMark — the ChildCheck logo glyph, used across headers and footers.
 * In Stage 2 this will optionally render a custom uploaded logo from
 * Organisation.branding.logoUrl when present.
 */
export function BrandMark({
  size = "md",
  className,
}: {
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const box =
    size === "sm" ? "h-6 w-6" : size === "lg" ? "h-12 w-12" : "h-9 w-9";
  const icon = size === "sm" ? "h-4 w-4" : size === "lg" ? "h-7 w-7" : "h-5 w-5";
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm shrink-0",
        box,
        className
      )}
      aria-hidden
    >
      <ShieldCheck className={icon} />
    </span>
  );
}
