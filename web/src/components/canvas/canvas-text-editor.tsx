import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Bold, ChevronDown, Italic, List, ListOrdered, Maximize2, Minimize2, Strikethrough, Type, Underline, X } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { plainTextToHtml, richTextFromElement, sanitizeRichTextHtml, textContentHtml } from "@/lib/canvas/text-rich-content";
import type { CanvasRichText } from "@/types/canvas";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import "./canvas-text-editor.css";

type Props = {
    nodeId: string;
    content: string;
    richText?: CanvasRichText;
    className?: string;
    style?: CSSProperties;
    references: CanvasResourceReference[];
    onChange: (content: string, richText: CanvasRichText) => void;
    onStopEditing: () => void;
};

const formatTools = [
    { command: "insertUnorderedList", label: "无序列表", Icon: List },
    { command: "insertOrderedList", label: "有序列表", Icon: ListOrdered },
    { command: "bold", label: "加粗", Icon: Bold },
    { command: "strikeThrough", label: "删除线", Icon: Strikethrough },
    { command: "italic", label: "斜体", Icon: Italic },
    { command: "underline", label: "下划线", Icon: Underline },
] as const;
const blocks = [{ value: "p", label: "正文" }, { value: "h1", label: "标题 1" }, { value: "h2", label: "标题 2" }, { value: "h3", label: "标题 3" }];

export function CanvasTextEditor({ nodeId, content, richText, className = "", style, references, onChange, onStopEditing }: Props) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const mountRef = useRef<HTMLDivElement>(null);
    const editorRef = useRef<HTMLDivElement>(null);
    const rangeRef = useRef<Range | null>(null);
    const composingRef = useRef(false);
    const renderedRef = useRef<{ editor: HTMLElement; content: string; html?: string } | null>(null);
    const finishEditingRef = useRef(() => {});
    const [expanded, setExpanded] = useState(false);
    const [hasSelection, setHasSelection] = useState(false);
    const [blockMenu, setBlockMenu] = useState(false);
    const [block, setBlock] = useState("p");
    const [active, setActive] = useState<Record<string, boolean>>({});
    const [position, setPosition] = useState({ left: 0, top: 0 });
    const [bounds, setBounds] = useState({ left: 0, top: 0, width: 0, height: 0, scale: 1 });
    const [mention, setMention] = useState<{ query: string; range: Range; left: number; top: number } | null>(null);
    const [mentionIndex, setMentionIndex] = useState(0);
    const candidates = useMemo(() => mention ? references.filter((item) => item.active && `${item.label} ${item.title} ${item.text || ""}`.toLowerCase().includes(mention.query.toLowerCase())) : [], [mention, references]);
    const owns = useCallback((target: EventTarget | null) => target instanceof Element && target.closest("[data-rich-text-owner]")?.getAttribute("data-rich-text-owner") === nodeId, [nodeId]);

    const updatePosition = useCallback(() => {
        const editor = editorRef.current;
        const mount = mountRef.current;
        if (!editor || !mount) return;
        const rect = (expanded ? editor : mount).getBoundingClientRect();
        if (!expanded) {
            const next = { left: rect.left, top: rect.top, width: mount.offsetWidth, height: mount.offsetHeight, scale: mount.offsetWidth ? rect.width / mount.offsetWidth : 1 };
            setBounds((previous) => Object.keys(next).every((key) => previous[key as keyof typeof next] === next[key as keyof typeof next]) ? previous : next);
        }
        const left = Math.max(178, Math.min(window.innerWidth - 178, rect.left + rect.width / 2));
        const top = expanded ? 24 : Math.max(8, rect.top - 72);
        setPosition((previous) => previous.left === left && previous.top === top ? previous : { left, top });
        setMention((previous) => {
            if (!previous || !editor.contains(previous.range.commonAncestorContainer)) return previous;
            const caret = previous.range.getBoundingClientRect();
            const mentionLeft = Math.max(8, Math.min(window.innerWidth - 264, caret.left));
            const mentionTop = Math.max(8, Math.min(window.innerHeight - 232, caret.bottom + 6));
            return previous.left === mentionLeft && previous.top === mentionTop ? previous : { ...previous, left: mentionLeft, top: mentionTop };
        });
    }, [expanded]);

    const updateSelection = useCallback(() => {
        const editor = editorRef.current;
        const selection = window.getSelection();
        if (!editor || !selection?.rangeCount) { setHasSelection(false); return; }
        const range = selection.getRangeAt(0);
        if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) {
            if (!owns(document.activeElement)) { setHasSelection(false); setBlockMenu(false); setMention(null); }
            return;
        }
        rangeRef.current = range.cloneRange();
        setHasSelection(!range.collapsed);
        setActive(Object.fromEntries(formatTools.map(({ command }) => [command, document.queryCommandState(command)])));
        const element = selection.anchorNode instanceof Element ? selection.anchorNode : selection.anchorNode?.parentElement;
        const paragraph = element?.closest("h1,h2,h3,p,div");
        setBlock(paragraph && editor.contains(paragraph) && /^H[1-3]$/.test(paragraph.tagName) ? paragraph.tagName.toLowerCase() : "p");
        updatePosition();
    }, [owns, updatePosition]);

    // Do not replace the editable DOM after our own keystrokes: native selection,
    // IME composition and the browser undo history must survive React updates.
    useLayoutEffect(() => {
        const editor = editorRef.current;
        if (!editor || composingRef.current) return;
        const previous = renderedRef.current;
        if (previous?.editor === editor && previous.content === content && previous.html === richText?.html) return;
        editor.innerHTML = textContentHtml(content, richText);
        renderedRef.current = { editor, content, html: richText?.html };
        editor.focus({ preventScroll: true });
        const range = document.createRange();
        range.selectNodeContents(editor);
        range.collapse(false);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        rangeRef.current = range;
    }, [content, richText]);

    useLayoutEffect(updatePosition);

    useEffect(() => {
        let frame = 0;
        let positionFrame = 0;
        // The editor stays in one body portal so expanding never resets native
        // undo. Track its node while the canvas is zoomed, panned or resized.
        const followNode = () => { updatePosition(); positionFrame = requestAnimationFrame(followNode); };
        positionFrame = requestAnimationFrame(followNode);
        const onSelection = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(updateSelection);
        };
        const onOutside = (event: PointerEvent) => {
            if (!owns(event.target)) finishEditingRef.current();
        };
        document.addEventListener("selectionchange", onSelection);
        document.addEventListener("pointerdown", onOutside, true);
        window.addEventListener("resize", updatePosition);
        window.addEventListener("scroll", updatePosition, true);
        return () => {
            cancelAnimationFrame(frame);
            cancelAnimationFrame(positionFrame);
            document.removeEventListener("selectionchange", onSelection);
            document.removeEventListener("pointerdown", onOutside, true);
            window.removeEventListener("resize", updatePosition);
            window.removeEventListener("scroll", updatePosition, true);
        };
    }, [owns, updatePosition, updateSelection]);

    const sync = (force = false) => {
        const editor = editorRef.current;
        if (!editor || (composingRef.current && !force)) return;
        const next = richTextFromElement(editor);
        renderedRef.current = { editor, content: next.content, html: next.richText.html };
        onChange(next.content, next.richText);
        updateSelection();
    };

    const finishEditing = () => {
        // Blurring commits an active IME session before the node switches back
        // to display mode; also flush the current DOM if composition is pending.
        editorRef.current?.blur();
        sync(true);
        onStopEditing();
    };
    finishEditingRef.current = finishEditing;

    const restoreSelection = () => {
        const editor = editorRef.current;
        const range = rangeRef.current;
        if (!editor || !range || !editor.contains(range.commonAncestorContainer)) return false;
        editor.focus({ preventScroll: true });
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        return true;
    };

    const command = (name: string, value?: string) => {
        if (composingRef.current || !restoreSelection()) return;
        // Native editing commands retain undo history in the bundled Chromium.
        // https://developer.mozilla.org/en-US/docs/Web/API/Document/execCommand
        document.execCommand("styleWithCSS", false, "false");
        document.execCommand(name, false, value);
        setBlockMenu(false);
        setMention(null);
        sync();
    };

    const updateMention = () => {
        const selection = window.getSelection();
        const editor = editorRef.current;
        if (!editor || !selection?.isCollapsed || selection.anchorNode?.nodeType !== Node.TEXT_NODE || !editor.contains(selection.anchorNode)) { setMention(null); return; }
        const text = selection.anchorNode.textContent?.slice(0, selection.anchorOffset) || "";
        const match = /(?:^|\s)@([^\s@]*)$/.exec(text);
        if (!match || !references.some((item) => item.active)) { setMention(null); return; }
        const range = selection.getRangeAt(0).cloneRange();
        range.setStart(selection.anchorNode, selection.anchorOffset - match[1].length - 1);
        const rect = range.getBoundingClientRect();
        setMention({ query: match[1], range, left: Math.max(8, Math.min(window.innerWidth - 264, rect.left)), top: Math.max(8, Math.min(window.innerHeight - 232, rect.bottom + 6)) });
        setMentionIndex(0);
    };

    const insertMention = (reference: CanvasResourceReference) => {
        if (!mention) return;
        rangeRef.current = mention.range;
        command("insertText", `${reference.label} `);
    };

    const toolbarVisible = hasSelection || blockMenu || expanded;
    const editor = (
        <div
            data-rich-text-owner={nodeId}
            data-rich-text-formatting={toolbarVisible ? "true" : undefined}
            data-canvas-no-zoom
            data-canvas-shortcuts-ignore
            className={expanded ? "canvas-text-editor-expanded" : "canvas-text-editor-inline"}
            style={expanded ? { background: theme.canvas.background } : { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height, transform: `scale(${bounds.scale})` }}
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => {
                event.stopPropagation();
                if (event.target === event.currentTarget) { event.preventDefault(); restoreSelection(); }
            }}
            onDoubleClick={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
        >
            {expanded ? <button type="button" className="canvas-text-editor-close" aria-label="关闭放大编辑" title="关闭放大编辑" style={{ color: theme.node.text }} onMouseDown={(event) => event.preventDefault()} onClick={() => { restoreSelection(); setExpanded(false); setBlockMenu(false); setMention(null); }}><X size={20} /></button> : null}
            <div
                ref={editorRef}
                role="textbox"
                aria-label="文本正文"
                aria-multiline="true"
                contentEditable
                suppressContentEditableWarning
                data-canvas-rich-editor
                className={`canvas-rich-text thin-scrollbar cursor-text select-text overflow-y-auto overscroll-contain outline-none ${expanded ? "canvas-text-editor-page" : className}`}
                style={expanded ? { ...style, padding: 32, fontSize: 16, lineHeight: 1.8 } : style}
                onInput={() => { if (!composingRef.current) { sync(); updateMention(); } }}
                onCompositionStart={() => { composingRef.current = true; setMention(null); }}
                onCompositionEnd={() => { composingRef.current = false; sync(); updateMention(); }}
                onBlur={(event) => { if (event.relatedTarget && !owns(event.relatedTarget)) { sync(true); onStopEditing(); } }}
                onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.nativeEvent.isComposing || composingRef.current || event.keyCode === 229) return;
                    if (mention && candidates.length) {
                        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                            event.preventDefault();
                            setMentionIndex((index) => (index + (event.key === "ArrowDown" ? 1 : candidates.length - 1)) % candidates.length);
                            return;
                        }
                        if (event.key === "Enter") { event.preventDefault(); insertMention(candidates[mentionIndex % candidates.length]); return; }
                        if (event.key === "Escape") { event.preventDefault(); setMention(null); return; }
                    }
                    if (event.key === "Escape") {
                        event.preventDefault();
                        if (blockMenu) setBlockMenu(false);
                        else if (expanded) setExpanded(false);
                        else finishEditing();
                    }
                    if ((event.ctrlKey || event.metaKey) && !event.altKey && ["b", "i", "u"].includes(event.key.toLowerCase())) {
                        event.preventDefault();
                        command(({ b: "bold", i: "italic", u: "underline" })[event.key.toLowerCase() as "b" | "i" | "u"]);
                    }
                }}
                onKeyUp={(event) => { event.stopPropagation(); if (!composingRef.current) updateSelection(); }}
                onPointerUp={() => { updateSelection(); updateMention(); }}
                onPaste={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    updateSelection();
                    const html = event.clipboardData.getData("text/html");
                    command("insertHTML", html ? sanitizeRichTextHtml(html) : plainTextToHtml(event.clipboardData.getData("text/plain")));
                }}
                onDrop={(event) => { event.preventDefault(); event.stopPropagation(); }}
            />
        </div>
    );

    return <>
        <div ref={mountRef} className="h-full w-full" />
        {createPortal(editor, document.body)}
        {toolbarVisible ? createPortal(
            <div
                role="toolbar"
                aria-label="文本格式"
                data-rich-text-owner={nodeId}
                data-canvas-no-zoom
                data-canvas-shortcuts-ignore
                className="canvas-text-format-toolbar"
                style={{ left: position.left, top: position.top, background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
                onPointerDown={(event) => event.stopPropagation()}
                onMouseDown={(event) => { event.preventDefault(); event.stopPropagation(); }}
                onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Escape") { setBlockMenu(false); restoreSelection(); } }}
            >
                <div className="relative">
                    <button type="button" aria-label="正文或标题" title="正文或标题" aria-expanded={blockMenu} aria-haspopup="menu" className="canvas-text-format-button canvas-text-block-button" onClick={() => setBlockMenu(!blockMenu)}>
                        {block === "p" ? <Type size={16} /> : <span className="text-xs font-semibold">{block.toUpperCase()}</span>}<ChevronDown size={12} />
                    </button>
                    {blockMenu ? <div role="menu" aria-label="段落格式" className="canvas-text-block-menu" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border }}>
                        {blocks.map((item) => <button key={item.value} type="button" role="menuitemradio" aria-checked={block === item.value} onClick={() => command("formatBlock", item.value)}>{item.label}</button>)}
                    </div> : null}
                </div>
                {formatTools.map(({ command: name, label, Icon }) => <button key={name} type="button" className="canvas-text-format-button" aria-label={label} title={label} aria-pressed={Boolean(active[name])} onClick={() => command(name)}><Icon size={16} /></button>)}
                <span className="mx-1 h-4 border-l border-current opacity-20" />
                <button type="button" className="canvas-text-format-button" aria-label={expanded ? "收起编辑" : "放大编辑文本"} title={expanded ? "收起编辑" : "放大编辑"} onClick={() => { restoreSelection(); setExpanded(!expanded); setBlockMenu(false); setMention(null); }}>{expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button>
            </div>, document.body,
        ) : null}
        {mention && candidates.length ? createPortal(
            <div data-rich-text-owner={nodeId} data-canvas-no-zoom data-canvas-shortcuts-ignore role="listbox" aria-label="引用内容" className="canvas-text-mention-menu thin-scrollbar" style={{ left: mention.left, top: mention.top, background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }} onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => { event.preventDefault(); event.stopPropagation(); }}>
                {candidates.map((item, index) => <button key={item.id} type="button" role="option" aria-selected={index === mentionIndex} onClick={() => insertMention(item)}><strong>{item.label}</strong><span>{item.title}</span></button>)}
            </div>, document.body,
        ) : null}
    </>;
}
