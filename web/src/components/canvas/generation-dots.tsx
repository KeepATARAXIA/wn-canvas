import { useId } from "react";
import "./generation-dots.css";

// A fixed grid with two moving light fields: only the masks animate, not each dot.
export function GenerationDots() {
    const id = useId().replace(/:/g, "");
    return (
        <svg className="generation-dots" width="100%" height="100%" aria-hidden="true">
            <defs>
                <pattern id={`${id}-grid`} width="8" height="8" patternUnits="userSpaceOnUse">
                    <circle cx="4" cy="4" r="1.25" fill="currentColor" />
                </pattern>
                <radialGradient id={`${id}-light`}>
                    <stop offset="0" stopColor="white" />
                    <stop offset="0.45" stopColor="white" stopOpacity="0.95" />
                    <stop offset="1" stopColor="white" stopOpacity="0" />
                </radialGradient>
                <mask id={`${id}-mask`}>
                    <ellipse className="generation-dots-wave" cx="32%" cy="34%" rx="32%" ry="40%" fill={`url(#${id}-light)`} />
                    <ellipse className="generation-dots-wave generation-dots-wave-secondary" cx="68%" cy="68%" rx="30%" ry="42%" fill={`url(#${id}-light)`} />
                </mask>
            </defs>
            <rect width="100%" height="100%" fill={`url(#${id}-grid)`} opacity="0.22" />
            <rect width="100%" height="100%" fill={`url(#${id}-grid)`} mask={`url(#${id}-mask)`} />
        </svg>
    );
}
