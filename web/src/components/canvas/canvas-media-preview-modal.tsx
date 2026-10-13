import { CanvasMediaViewer } from "./canvas-image-viewer";

type Props = { kind: "image" | "video"; src: string; title: string; images?: { id: string; content: string }[]; initialImageId?: string | null; onClose: () => void };

export function CanvasMediaPreviewModal(props: Props) {
    return <CanvasMediaViewer {...props} />;
}
