const React = (await import('react')).default;
const { createRoot } = await import('react-dom/client');
const { App, ConfigProvider } = await import('antd');
const { MemoryRouter, Routes, Route } = await import('react-router-dom');
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
await import('/src/styles/globals.css');
await import('/src/i18n/index.ts');

const { useCanvasStore } = await import('/src/stores/canvas/use-canvas-store.ts');
await useCanvasStore.persist.rehydrate();
const { useThemeStore } = await import('/src/stores/use-theme-store.ts');
const { useCanvasSidePanelStore } = await import('/src/stores/use-canvas-side-panel-store.ts');
const { getAntThemeConfig } = await import('/src/lib/app-theme.ts');
const { default: CanvasPage } = await import('/src/pages/canvas/project.tsx');
useCanvasSidePanelStore.setState({ panelOpen: false, panelMounted: false });
useThemeStore.setState({ theme: 'dark' });
document.documentElement.classList.add('dark');

const image = (color) => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="240" height="360"><rect width="240" height="360" fill="#f4f0e5"/><circle cx="120" cy="98" r="34" fill="#d3ae92"/><path d="M50 160 Q120 130 190 160 L195 310 H45Z" fill="${color}"/><path d="M65 310 H175 V360 H65Z" fill="#243753"/></svg>`);
const images = ['#568a75', '#6a8f80', '#4e806f', '#619382'].map((color, index) => ({ id: `image-${index}`, status: 'success', content: image(color), naturalWidth: 240, naturalHeight: 360, bytes: 100, mimeType: 'image/svg+xml' }));
const state = new URLSearchParams(location.search).get('state');
if (state === 'failure') images[1] = { ...images[1], status: 'error', content: '', errorDetails: '生成失败' };
if (state === 'queue') images[2] = { ...images[2], status: 'idle', content: '' };
if (new URLSearchParams(location.search).get('count') === '15') for (let index = 4; index < 15; index++) images.push({ ...images[index % 4], id: `image-${index}` });
const node = { id: 'batch-image', type: 'image', title: '图片节点操作栏验证', position: { x: 220, y: 190 }, width: 240, height: 360, metadata: { content: images[0].content, images, primaryImageId: images[0].id, generationType: 'generation', status: 'success' } };
const project = { id: 'batch-toolbar-test', title: '图片节点操作栏验证', nodes: [node], connections: [], chatSessions: [], activeChatId: null, backgroundMode: 'dots', showImageInfo: false, viewport: { x: 0, y: 0, k: 1 }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
useCanvasStore.setState({ projects: [project], hydrated: true });

function Fixture() {
    const theme = useThemeStore((state) => state.theme);
    return React.createElement(ConfigProvider, { theme: getAntThemeConfig(theme === 'dark') }, React.createElement(App, null, React.createElement(QueryClientProvider, { client: new QueryClient() }, React.createElement(MemoryRouter, { initialEntries: ['/canvas/batch-toolbar-test'] }, React.createElement(Routes, null, React.createElement(Route, { path: '/canvas/:id', element: React.createElement(CanvasPage) }))))));
}
createRoot(document.getElementById('root')).render(React.createElement(Fixture));
