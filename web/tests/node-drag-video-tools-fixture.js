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
window.testTheme = useThemeStore;
window.testStore = useCanvasStore;
const tool = new URLSearchParams(location.search).get('tool') || 'upscale';
const state = new URLSearchParams(location.search).get('state');
const node = (id, type, x, y, width, height, metadata) => ({ id, type, title: id, position: { x, y }, width, height, metadata });
const nodes = [
    node('source', 'video', 110, 150, 300, 170.5, { content: state === 'portrait' ? '/__clip/portrait' : '/__clip/landscape', status: 'success' }),
    node('tool', 'video-tool:' + tool, 540, 150, 380, 440, { videoToolSettings: { prompt: '第一段测试', anime: false }, ...(state === 'output' ? { content: '/__clip/square', status: 'success' } : {}) }),
    node('text', 'text', 130, 530, 300, 230, { content: Array.from({ length: 20 }, (_, i) => '文本正文拖动检查 ' + i).join('\n'), status: 'success' }),
    node('image', 'image', 1020, 180, 244, 164, { content: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160"><rect width="240" height="160" fill="#85e82e"/></svg>'), status: 'success' }),
];
const project = { id: 'node-drag-test', title: '节点交互隔离验证', nodes, connections: state === 'empty' ? [] : [{ id: 'input', fromNodeId: 'source', toNodeId: 'tool' }], chatSessions: [], activeChatId: null, backgroundMode: 'dots', showImageInfo: false, viewport: { x: 0, y: 0, k: 1 }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
useCanvasStore.setState({ projects: [project], hydrated: true });
const queryClient = new QueryClient();
function Fixture() {
    const theme = useThemeStore(state => state.theme);
    return React.createElement(ConfigProvider, { theme: getAntThemeConfig(theme === 'dark') }, React.createElement(App, null, React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(MemoryRouter, { initialEntries: ['/canvas/node-drag-test'] }, React.createElement(Routes, null, React.createElement(Route, { path: '/canvas/:id', element: React.createElement(CanvasPage) }))))));
}
createRoot(document.getElementById('root')).render(React.createElement(Fixture));
