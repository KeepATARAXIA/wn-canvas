import type { CSSProperties } from "react";
import { APP_VERSION } from "@/constant/env";
import { WnUpdateButton } from "@/components/layout/wn-update-button";

export function VersionReleaseModal({ className, style }: { className?: string; style?: CSSProperties }) {
    return <WnUpdateButton className={className || "shrink-0 cursor-pointer text-xs font-medium text-muted-foreground transition hover:text-foreground"} style={style} label={APP_VERSION} />;
}
