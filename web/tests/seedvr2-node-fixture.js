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
window.testTheme = useThemeStore;
window.testStore = useCanvasStore;
if (!useCanvasStore.getState().projects.some(project => project.id === 'seed-node-test')) {
    const source = { id: 'source', type: 'video', title: '原视频', position: { x: 100, y: 180 }, width: 300, height: 300, metadata: { content: '/__seed-source.mp4', status: 'success', videoWidth: 320, videoHeight: 320, durationMs: 1000 } };
    const project = { id: 'seed-node-test', title: '超分节点隔离验证', nodes: [source], connections: [], chatSessions: [], activeChatId: null, backgroundMode: 'dots', viewport: { x: 0, y: 0, k: 1 }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    useCanvasStore.setState({ projects: [project], hydrated: true });
}
const queryClient = new QueryClient();
function Fixture() {
    const theme = useThemeStore(state => state.theme);
    return React.createElement(ConfigProvider, { theme: getAntThemeConfig(theme === 'dark') }, React.createElement(App, null, React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(MemoryRouter, { initialEntries: ['/canvas/seed-node-test'] }, React.createElement(Routes, null, React.createElement(Route, { path: '/canvas/:id', element: React.createElement(CanvasPage) }))))));
}
createRoot(document.getElementById('root')).render(React.createElement(Fixture));
