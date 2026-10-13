function tableCells(line: string, splitPipes = true): string[] | null {
    const cells: string[] = [];
    let cell = "", codeTicks = 0;
    for (let index = 0; index < line.length; index++) {
        const char = line[index], next = line[index + 1];
        if (char === "\\" && (next === "|" || !codeTicks && (next === "\\" || next === "`"))) {
            cell += next; index++;
        } else if (char === "`") {
            let count = 1;
            while (line[index + count] === "`") count++;
            if (!codeTicks) codeTicks = count;
            else if (codeTicks === count) codeTicks = 0;
            else cell += "`".repeat(count);
            index += count - 1;
        } else if (char === "|" && !codeTicks && splitPipes) {
            cells.push(cell.trim()); cell = "";
        } else cell += char;
    }
    if (codeTicks) return null;
    cells.push(cell.trim());
    if (splitPipes && cells[0] === "") cells.shift();
    if (splitPipes && cells[cells.length - 1] === "") cells.pop();
    return cells;
}

// The API supplies RELEASES.md's Unreleased section. Also accept a full document
// without importing frozen history. Older tables and current dated lists coexist.
export function releaseNotesFromRecords(markdown: string): string {
    const normalized = markdown.replace(/\r\n?/g, "\n");
    const section = normalized.match(/(?:^|\n)## Unreleased[^\n]*\n([\s\S]*?)(?=\n## |$)/)?.[1] ?? normalized;
    const lines = section.split("\n"), notes: string[] = [];
    let inTable = false;
    for (let index = 0; index < lines.length; index++) {
        const line = lines[index].trim();
        if (/^## /.test(line)) break;
        if (!inTable) {
            const record = line.match(/^[-*]\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}[：:]\s*(.*)$/);
            if (record) {
                let body = record[1];
                while (/^\s{2,}\S/.test(lines[index + 1] || "")) body += lines[++index].trim();
                // A dated prose record puts verification after the user-facing
                // sentences. Keep compatibility details before that boundary.
                const verification = body.search(/(?:^|(?<=。))\s*(?:验证(?:与限制)?[：:]|(?:\d+\/\d+|\d+项)(?:相关)?(?:回归|测试|Node|检查)|TypeScript|实际Chromium)/);
                if (verification >= 0) body = body.slice(0, verification);
                const text = tableCells(body.trim(), false)?.[0];
                if (!text) return "";
                notes.push(text);
                continue;
            }
            const header = tableCells(line), separator = tableCells(lines[index + 1] || "");
            if (header?.length === 4 && header[0] === "时间" && /^(本轮变化|迭代)$/.test(header[1]) && /^用户可感知(?:行为|变化)/.test(header[2]) && /^验证/.test(header[3]) && separator?.length === 4 && separator.every(cell => /^:?-{3,}:?$/.test(cell))) {
                inTable = true; index++;
            }
            continue;
        }
        if (!line || !line.includes("|")) { inTable = false; index--; continue; }
        const cells = tableCells(line);
        // A malformed row must not produce a partial release summary.
        if (cells?.length !== 4 || !cells[1] || !cells[2]) return "";
        notes.push(`${cells[1]}\n${cells[2]}`);
    }
    return notes.join("\n\n");
}
