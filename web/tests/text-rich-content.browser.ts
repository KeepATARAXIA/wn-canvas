import { plainTextToHtml, readTextNodeContent, richTextFromElement, richTextFromHtml, sanitizeRichTextHtml, textContentHtml } from "../src/lib/canvas/text-rich-content";
import type { CanvasNodeData, CanvasRichText } from "../src/types/canvas";

// Import into an isolated browser page and call runTextRichContentTests(). This
// tests real inert HTML parsing without loading a project, storage or model API.
export function runTextRichContentTests() {
    const passed: string[] = [];
    function equal(actual: unknown, expected: unknown) {
        if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
    function test(name: string, check: () => void) {
        try {
            check();
            passed.push(name);
        } catch (error) {
            throw new Error(`${name}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    function node(metadata: CanvasNodeData["metadata"]): CanvasNodeData {
        return { id: "test", type: "text", title: "Text", position: { x: 0, y: 0 }, width: 300, height: 200, metadata };
    }

    const plainCases = ["", "\n", "\n\n", "one", "one\n", "\none", "one\n\ntwo\n\n", "  first  \n  second", '<img onerror="bad"> & text', "中文😀\t测试"];
    for (const content of plainCases) {
        test(`plain roundtrip ${JSON.stringify(content)}`, () => {
            const saved = richTextFromHtml(plainTextToHtml(content));
            equal(saved.content, content);
            equal(richTextFromHtml(textContentHtml(saved.content, saved.richText)), saved);
        });
    }
    test("normalizes platform newlines", () => equal(richTextFromHtml(plainTextToHtml("a\r\nb\rc")).content, "a\nb\nc"));
    test("preserves leading, middle and trailing empty paragraphs", () => equal(richTextFromHtml("<p><br></p><p>first</p><p><br></p><p>third</p><p><br></p>").content, "\nfirst\n\nthird\n"));
    test("recognizes empty formatted paragraphs", () => equal(richTextFromHtml("<p>one</p><p><b><br></b></p>").content, "one\n"));
    test("separates Chromium div paragraphs", () => equal(richTextFromHtml("first<div>second</div><div><br></div>").content, "first\nsecond\n"));
    test("preserves explicit inline line breaks", () => equal(richTextFromHtml("<p>first<br>second<br><br>fourth</p>").content, "first\nsecond\n\nfourth"));
    test("headings and mixed inline formatting become clean text", () => equal(richTextFromHtml("<h1>Title</h1><h2>Subtitle</h2><p><strong>bold</strong> <em>italic</em> <u>under</u> <s>strike</s></p>").content, "Title\nSubtitle\nbold italic under strike"));
    test("numbered, bulleted and nested lists retain text markers", () => equal(richTextFromHtml("<ul><li>A</li><li>B<ul><li>C</li></ul></li></ul><ol><li>D</li><li>E</li></ol>").content, "• A\n• B\n  • C\n1. D\n2. E"));
    test("lists and surrounding paragraphs remain separate", () => equal(richTextFromHtml("<p>Before</p><ol><li>One</li><li>Two</li></ol><p>After</p>").content, "Before\n1. One\n2. Two\nAfter"));
    function liveListTree(tag: string, listTag = "ul") {
        const editor = document.createElement("div");
        const paragraph = document.createElement(tag);
        const list = document.createElement(listTag);
        for (const value of ["One", "Two"]) {
            const item = document.createElement("li");
            item.append(document.createTextNode(value));
            list.append(item);
        }
        paragraph.append(list);
        editor.append(paragraph);
        return { editor, paragraph, list };
    }
    test("normalizes live Chromium P/list nesting without phantom blank lines", () => {
        const { editor } = liveListTree("p");
        const saved = richTextFromElement(editor);
        equal(saved.content, "• One\n• Two");
        equal(saved.richText.html, "<ul><li>One</li><li>Two</li></ul>");
        equal(richTextFromHtml(textContentHtml(saved.content, saved.richText)), saved);
        // Sanitizing must not replace or mutate the live editable DOM.
        equal(editor.firstElementChild?.localName, "p");
        equal(editor.firstElementChild?.firstElementChild?.localName, "ul");
    });
    test("normalizes headings containing lists and keeps real empty paragraphs", () => {
        const { editor } = liveListTree("h2", "ol");
        const leading = document.createElement("p");
        leading.append(document.createElement("br"));
        editor.prepend(leading);
        editor.append(document.createElement("p"));
        const saved = richTextFromElement(editor);
        equal(saved.content, "\n1. One\n2. Two\n");
        equal(saved.richText.html, "<p><br></p><ol><li>One</li><li>Two</li></ol><p></p>");
        equal(richTextFromHtml(saved.richText.html), saved);
    });
    test("splits real paragraph text around an embedded block", () => {
        const { editor, paragraph } = liveListTree("p");
        paragraph.prepend(document.createTextNode("Before"));
        paragraph.append(document.createTextNode("After"));
        const saved = richTextFromElement(editor);
        equal(saved.content, "Before\n• One\n• Two\nAfter");
        equal(saved.richText.html, "<p>Before</p><ul><li>One</li><li>Two</li></ul><p>After</p>");
        equal(richTextFromHtml(saved.richText.html), saved);
    });
    test("keeps formatting when lifting blocks out of inline wrappers", () => {
        const { editor, paragraph, list } = liveListTree("p");
        const bold = document.createElement("b");
        bold.append(list);
        paragraph.append(bold);
        const saved = richTextFromElement(editor);
        equal(saved.richText.html, "<ul><li><b>One</b></li><li><b>Two</b></li></ul>");
        equal(saved.content, "• One\n• Two");
        equal(richTextFromHtml(saved.richText.html), saved);
    });
    test("supported rich HTML is stable after multiple saves", () => {
        const first = richTextFromHtml("<h2>Title</h2><p><strong>Bold</strong> and <u><em>both</em></u></p><ul><li>A</li><li>B</li></ul><p><br></p>");
        const second = richTextFromHtml(textContentHtml(first.content, first.richText));
        equal(second, first);
        equal(richTextFromHtml(textContentHtml(second.content, second.richText)), first);
    });
    test("discards executable nodes and every imported attribute", () => {
        const clean = sanitizeRichTextHtml('<p id="x" class="x" onclick="bad()" style="color:red"><script>bad()</script><style>body{display:none}</style><img src=x onerror=bad()><a href="javascript:bad()">safe</a><iframe src="https://invalid.test"></iframe><svg><script>bad()</script></svg></p>');
        equal(clean, "<p>safe</p>");
        equal(sanitizeRichTextHtml(clean), clean);
    });
    test("converts browser formatting spans without retaining CSS", () => {
        const clean = sanitizeRichTextHtml('<span style="font-weight:700;font-style:italic;text-decoration:underline line-through;color:red;background:url(https://invalid.test)" onmouseover="bad()">styled</span>');
        equal(clean, "<s><u><em><strong>styled</strong></em></u></s>");
        equal(sanitizeRichTextHtml(clean), clean);
        equal(richTextFromHtml(clean).content, "styled");
    });
    for (const weight of ["normal", "400"]) {
        test(`keeps the exact ${weight} heading weight reset after reload`, () => {
            const saved = richTextFromHtml(`<h2>Bold <span style="font-weight:${weight};color:red;background:url(https://invalid.test);position:fixed" onclick="bad()" data-extra="bad">normal</span></h2>`);
            equal(saved.richText.html, '<h2>Bold <span style="font-weight: normal;">normal</span></h2>');
            equal(richTextFromHtml(textContentHtml(saved.content, saved.richText)), saved);
            const restored = document.createElement("div");
            restored.style.fontWeight = "700";
            restored.innerHTML = textContentHtml(saved.content, saved.richText);
            document.body.append(restored);
            try {
                const normal = restored.querySelector("span")!;
                equal(Array.from(normal.attributes, (attribute) => [attribute.name, attribute.value]), [["style", "font-weight: normal;"]]);
                equal(getComputedStyle(normal).fontWeight, "400");
            } finally { restored.remove(); }
        });
    }
    test("does not preserve arbitrary font weight CSS values", () => {
        equal(sanitizeRichTextHtml('<span style="font-weight:var(--injected);color:red">plain</span>'), "plain");
        equal(sanitizeRichTextHtml('<span style="font-weight:inherit;position:fixed">plain</span>'), "plain");
    });
    test("escaping and entities remain literal user text", () => {
        equal(richTextFromHtml("<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;quote&#39;</p>").content, '<script>alert("x")</script> & \'quote\'');
        equal(sanitizeRichTextHtml("<!-- comment --><p>safe</p>"), "<p>safe</p>");
    });
    test("stale rich content yields to newly replaced plain text", () => equal(textContentHtml("new", { version: 1, text: "old", html: "<b>old</b>" }), "<p>new</p>"));
    test("unknown rich format versions fall back to plain text", () => equal(textContentHtml("plain", { version: 2, text: "plain", html: "<b>formatted</b>" } as unknown as CanvasRichText), "<p>plain</p>"));
    test("matching snapshots are sanitized before rendering", () => equal(textContentHtml("safe", { version: 1, text: "safe", html: '<p onclick="bad()">safe</p><script>bad()</script>' }), "<p>safe</p>"));
    test("active batch entry wins even when intentionally empty", () => {
        const result = readTextNodeContent(node({ content: "metadata", texts: [{ id: "a", status: "success", content: "first" }, { id: "b", status: "success", content: "" }], primaryTextId: "b" }));
        equal(result.content, "");
    });
    test("missing active ID falls back to the first batch entry", () => equal(readTextNodeContent(node({ content: "metadata", texts: [{ id: "a", status: "success", content: "first" }], primaryTextId: "missing" })).content, "first"));
    test("absent active ID keeps an empty first entry", () => equal(readTextNodeContent(node({ content: "metadata", texts: [{ id: "a", status: "success", content: "" }, { id: "b", status: "success", content: "second" }] })).content, ""));
    test("legacy metadata and missing content still read normally", () => {
        equal(readTextNodeContent(node({ content: "legacy", texts: [] })).content, "legacy");
        equal(readTextNodeContent(node(undefined)).content, "");
    });
    test("active batch formatting stays paired with its content", () => {
        const richText = { version: 1 as const, text: "second", html: "<b>second</b>" };
        equal(readTextNodeContent(node({ content: "metadata", richText: { version: 1, text: "metadata", html: "<i>metadata</i>" }, texts: [{ id: "a", status: "success", content: "first" }, { id: "b", status: "success", content: "second", richText }], primaryTextId: "b" })), { content: "second", richText });
    });
    return { passed: passed.length, tests: passed };
}
