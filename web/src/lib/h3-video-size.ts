export function normalizeH3Resolution(value: string) {
    const number = Number(String(value).replace(/p$/i, ""));
    if ([480, 720, 1080].includes(number)) return String(number);
    if (number > 0 && number <= 2) return number <= 0.5 ? "480" : number <= 1 ? "720" : "1080";
    return "480";
}

export function h3VideoDimensions(size: string, quality: string) {
    const custom = size.match(/^(\d+)x(\d+)$/i);
    const even = (value: number) => Math.max(32, Math.round(value / 2) * 2);
    if (custom) return { width: even(Number(custom[1])), height: even(Number(custom[2])) };
    const [w, h] = (/^\d+:\d+$/.test(size) ? size : "16:9").split(":").map(Number);
    const shortSide = Number(normalizeH3Resolution(quality));
    const scale = shortSide / Math.min(w || 16, h || 9);
    return { width: even((w || 16) * scale), height: even((h || 9) * scale) };
}
