import type { CanvasNodeData, CanvasRichText } from "@/types/canvas";

const allowedTags = new Set(["p", "div", "h1", "h2", "h3", "ul", "ol", "li", "br", "strong", "b", "em", "i", "u", "s", "strike"]);
const blockTags = new Set(["p", "div", "h1", "h2", "h3", "ul", "ol", "li"]);
const paragraphTags = new Set(["p", "h1", "h2", "h3"]);
const discardedTags = new Set(["script", "style", "iframe", "object", "embed", "svg", "math", "template", "noscript", "head", "meta", "link", "base", "img", "video", "audio", "source", "track", "canvas", "input", "textarea", "select", "button"]);

function escapeHtml(text: string): string {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function plainTextToHtml(text: string): string {
    return text.replace(/\r\n?/g, "\n").split("\n").map((line) => `<p>${line ? escapeHtml(line) : "<br>"}</p>`).join("");
}

function parseHtml(html: string): HTMLTemplateElement {
    // Template content stays inert: imported media, scripts and event handlers
    // never enter the live document, even before the whitelist is applied.
    const template = document.createElement("template");
    template.innerHTML = html;
    return template;
}

function wrapInlineNodes(nodes: Node[], createWrapper: () => HTMLElement, paragraph = false): Node[] {
    const result: Node[] = [];
    let inline: Node[] = [];
    const flush = () => {
        if (!inline.length) return;
        const wrapper = createWrapper();
        wrapper.append(...inline);
        result.push(wrapper);
        inline = [];
    };
    for (const node of nodes) {
        if (node.nodeType === Node.ELEMENT_NODE && blockTags.has((node as Element).localName)) {
            flush();
            if (!paragraph) {
                // Move inline formatting inside block descendants rather than
                // creating invalid <strong><p> or <span><ul> structures.
                const block = node.cloneNode(false) as HTMLElement;
                block.append(...wrapInlineNodes(Array.from(node.childNodes), createWrapper));
                result.push(block);
            } else result.push(node);
        } else inline.push(node);
    }
    flush();
    // Keep genuine empty paragraphs. A paragraph containing only a list must
    // not acquire empty paragraphs before and after that list during parsing.
    if (!result.length && paragraph) result.push(createWrapper());
    return result;
}

function sanitizeNode(node: Node): Node[] {
    if (node.nodeType === Node.TEXT_NODE) return [document.createTextNode(node.nodeValue || "")];
    if (node.nodeType !== Node.ELEMENT_NODE) return [];
    const element = node as HTMLElement;
    const tag = element.localName.toLowerCase();
    if (element.namespaceURI !== "http://www.w3.org/1999/xhtml" || discardedTags.has(tag)) return [];
    let children = Array.from(element.childNodes).flatMap(sanitizeNode);
    const wrap = (name: string) => { children = wrapInlineNodes(children, () => document.createElement(name)); };
    if (tag === "span") {
        // Chromium may use styled spans for execCommand formatting. Preserve
        // supported semantics and an exact normal-weight reset for headings.
        // All other pasted attributes and CSS are discarded.
        const weight = element.style.fontWeight;
        const decoration = `${element.style.textDecoration} ${element.style.textDecorationLine}`;
        if (weight === "bold" || weight === "bolder" || Number(weight) >= 600) wrap("strong");
        if (weight === "normal" || weight === "400") children = wrapInlineNodes(children, () => {
            const reset = document.createElement("span");
            reset.setAttribute("style", "font-weight: normal;");
            return reset;
        });
        if (element.style.fontStyle === "italic" || element.style.fontStyle === "oblique") wrap("em");
        if (/\bunderline\b/.test(decoration)) wrap("u");
        if (/\bline-through\b/.test(decoration)) wrap("s");
        return children;
    }
    if (!allowedTags.has(tag)) return children;
    if (paragraphTags.has(tag)) return wrapInlineNodes(children, () => document.createElement(tag), true);
    if (!blockTags.has(tag) && tag !== "br") return wrapInlineNodes(children, () => document.createElement(tag));
    const clean = document.createElement(tag);
    clean.append(...children);
    return [clean];
}

function sanitizeNodes(nodes: NodeListOf<ChildNode>): string {
    const template = document.createElement("template");
    template.content.append(...Array.from(nodes).flatMap(sanitizeNode));
    return template.innerHTML;
}

export function sanitizeRichTextHtml(html: string): string {
    return sanitizeNodes(parseHtml(html).content.childNodes);
}

function isEmptyLine(element: Element): boolean {
    // An editable empty paragraph contains one BR, sometimes inside formatting
    // tags. It represents an empty line, not a second newline within that line.
    return element.textContent === "" && element.querySelectorAll("br").length <= 1 && !element.querySelector("p, div, h1, h2, h3, ul, ol, li");
}

function readFlow(nodes: NodeListOf<ChildNode>, listDepth = 0): string {
    const parts: string[] = [];
    let inline = "";
    let hasInline = false;
    for (const node of Array.from(nodes)) {
        if (node.nodeType === Node.ELEMENT_NODE && blockTags.has((node as Element).localName)) {
            if (hasInline) {
                parts.push(inline);
                inline = "";
                hasInline = false;
            }
            parts.push(readBlock(node as Element, listDepth));
        } else {
            inline += readInline(node, listDepth);
            hasInline = true;
        }
    }
    if (hasInline) parts.push(inline);
    return parts.join("\n");
}

function readInline(node: Node, listDepth: number): string {
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || "";
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const element = node as Element;
    return element.localName === "br" ? "\n" : readFlow(element.childNodes, listDepth);
}

function readBlock(element: Element, listDepth: number): string {
    if (element.localName === "ul" || element.localName === "ol") {
        let index = 0;
        return Array.from(element.childNodes).map((child) => {
            if (child.nodeType === Node.ELEMENT_NODE && (child as Element).localName === "li") {
                const marker = element.localName === "ol" ? `${++index}. ` : "• ";
                const item = child as Element;
                return `${"  ".repeat(listDepth)}${marker}${isEmptyLine(item) ? "" : readFlow(item.childNodes, listDepth + 1)}`;
            }
            return readInline(child, listDepth);
        }).join("\n");
    }
    return isEmptyLine(element) ? "" : readFlow(element.childNodes, listDepth);
}

export function richTextFromHtml(html: string): { content: string; richText: CanvasRichText } {
    const sanitized = sanitizeRichTextHtml(html);
    const content = readFlow(parseHtml(sanitized).content.childNodes);
    return { content, richText: { version: 1, html: sanitized, text: content } };
}

export function richTextFromElement(editor: HTMLElement): { content: string; richText: CanvasRichText } {
    // Native list commands can put a UL inside a P in the live DOM. Sanitize
    // that tree before serializing it, so the HTML parser cannot invent blank P's.
    const sanitized = sanitizeNodes(editor.childNodes);
    const content = readFlow(parseHtml(sanitized).content.childNodes);
    return { content, richText: { version: 1, html: sanitized, text: content } };
}

export function textContentHtml(content: string, richText?: CanvasRichText): string {
    // Generation and old clients may replace the plain content without knowing
    // about richText. Its text snapshot keeps stale formatting from winning.
    if (richText?.version === 1 && richText.text === content && typeof richText.html === "string") return sanitizeRichTextHtml(richText.html);
    return plainTextToHtml(content);
}

export function readTextNodeContent(node: CanvasNodeData): { content: string; richText?: CanvasRichText } {
    const metadata = node.metadata;
    const texts = metadata?.texts;
    const active = texts?.find((item) => item.id === metadata?.primaryTextId) ?? texts?.[0];
    if (active) return { content: active.content, richText: active.richText };
    return { content: metadata?.content ?? "", richText: metadata?.richText };
}
