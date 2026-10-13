import { useRef, useState } from "react";
import { App } from "antd";
import { Maximize2, Pause, Play, Volume2, VolumeX } from "lucide-react";

// The media element never receives drag input. Only the separate controls consume
// pointer events, leaving the picture available to the canvas's normal node drag.
export function CanvasVideoPlayer({ src, nodeId, onDimensions }: { src: string; nodeId: string; onDimensions?: (width: number, height: number) => void }) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const frameRef = useRef<HTMLDivElement>(null);
    const [playing, setPlaying] = useState(false);
    const [muted, setMuted] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const { message } = App.useApp();
    const togglePlay = async () => {
        const video = videoRef.current;
        if (!video) return;
        if (!video.paused) return video.pause();
        try {
            await video.play();
        } catch {
            message.error("视频无法播放，请检查文件是否可用。");
        }
    };
    const toggleFullscreen = async () => {
        try {
            if (document.fullscreenElement === frameRef.current) await document.exitFullscreen();
            else await frameRef.current?.requestFullscreen();
        } catch {
            message.error("当前浏览器无法进入全屏。");
        }
    };
    return (
        <div ref={frameRef} className="relative h-full w-full cursor-grab overflow-hidden rounded-[inherit] bg-black active:cursor-grabbing" onDragStart={(event) => event.preventDefault()}>
            <video
                ref={videoRef}
                src={src}
                playsInline
                preload="metadata"
                draggable={false}
                tabIndex={-1}
                className="pointer-events-none h-full w-full select-none object-contain"
                data-canvas-video={nodeId}
                onLoadedMetadata={(event) => {
                    const video = event.currentTarget;
                    setDuration(Number.isFinite(video.duration) ? video.duration : 0);
                    onDimensions?.(video.videoWidth, video.videoHeight);
                }}
                onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onEnded={() => setPlaying(false)}
                onVolumeChange={(event) => setMuted(event.currentTarget.muted)}
            />
            <div
                data-canvas-no-zoom
                className="absolute inset-x-2 bottom-2 flex cursor-default flex-wrap items-center gap-1 rounded-xl bg-black/55 px-2 py-1.5 text-white backdrop-blur-sm"
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                onDoubleClick={(event) => event.stopPropagation()}
            >
                <input
                    aria-label="视频播放进度"
                    type="range"
                    min={0}
                    max={duration || 1}
                    step={0.01}
                    value={Math.min(currentTime, duration || 1)}
                    disabled={!duration}
                    className="h-1 w-full cursor-pointer accent-white"
                    onChange={(event) => {
                        if (videoRef.current) videoRef.current.currentTime = Number(event.target.value);
                    }}
                />
                <button type="button" className="grid size-7 place-items-center rounded-full hover:bg-white/15" aria-label={playing ? "暂停视频" : "播放视频"} onClick={() => void togglePlay()}>
                    {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
                </button>
                <span className="min-w-0 flex-1 text-[10px] tabular-nums">
                    {timeLabel(currentTime)} / {timeLabel(duration)}
                </span>
                <button
                    type="button"
                    className="grid size-7 place-items-center rounded-full hover:bg-white/15"
                    aria-label={muted ? "取消静音" : "静音"}
                    onClick={() => {
                        if (videoRef.current) videoRef.current.muted = !videoRef.current.muted;
                    }}
                >
                    {muted ? <VolumeX className="size-3.5" /> : <Volume2 className="size-3.5" />}
                </button>
                <button type="button" className="grid size-7 place-items-center rounded-full hover:bg-white/15" aria-label="全屏视频" onClick={() => void toggleFullscreen()}>
                    <Maximize2 className="size-3.5" />
                </button>
            </div>
        </div>
    );
}

function timeLabel(seconds: number) {
    const value = Math.max(0, Math.floor(seconds));
    return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}
