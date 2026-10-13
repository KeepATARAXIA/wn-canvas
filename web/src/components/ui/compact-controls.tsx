import { useId, useState, type ReactNode } from "react";
import { Button, Popover, Tooltip, type ButtonProps } from "antd";
import { Info } from "lucide-react";

export function IconAction({ label, ...props }: ButtonProps & { label: string }) {
    return <Tooltip title={label} trigger={["hover", "focus"]}><Button {...props} aria-label={label} /></Tooltip>;
}

// Click-to-open help remains available on touch screens and allows selecting its text.
export function InfoPopover({ label, children }: { label: string; children: ReactNode }) {
    const [open, setOpen] = useState(false);
    const id = useId();
    return <Popover open={open} onOpenChange={setOpen} trigger="click" title={label} content={
        <div id={id} className="max-h-[50dvh] w-72 max-w-[calc(100vw-48px)] overflow-y-auto whitespace-pre-wrap break-words text-xs leading-6" data-canvas-shortcuts-ignore data-canvas-no-zoom onPointerDown={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()} onWheel={e => e.stopPropagation()} onKeyDown={e => { e.stopPropagation(); if (e.key === "Escape") setOpen(false); }}>{children}</div>
    }>
        <button type="button" aria-label={label} aria-expanded={open} aria-controls={open ? id : undefined} onKeyDown={e => { if (e.key === "Escape") setOpen(false); }} className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"><Info className="size-3.5" /></button>
    </Popover>;
}
