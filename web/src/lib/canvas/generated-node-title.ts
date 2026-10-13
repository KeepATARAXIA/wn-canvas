export function nextGeneratedNodeTitle(kind: "image" | "video", titles: readonly string[], reserved = 0) {
    const prefix = kind === "image" ? "图片" : "视频";
    const pattern = new RegExp(`^${prefix}([1-9]\\d*)$`);
    const highest = titles.reduce((max, title) => {
        const match = pattern.exec(title);
        return match ? Math.max(max, Number(match[1])) : max;
    }, reserved);
    const sequence = highest + 1;
    return { title: `${prefix}${sequence}`, sequence };
}
