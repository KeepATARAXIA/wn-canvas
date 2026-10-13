import React from "react";
import type { Root } from "react-dom/client";
import { RouterProvider } from "react-router-dom";

import { AppProviders } from "@/components/layout/app-providers";
import { WnUpdateLifecycle } from "@/components/layout/wn-update-button";
import "@/i18n";
import { initAnalytics } from "@/lib/analytics";
import { router } from "@/router";

export function renderApp(root: Root) {
    initAnalytics();
    root.render(
        <React.StrictMode>
            <AppProviders>
                <WnUpdateLifecycle />
                <RouterProvider router={router} />
            </AppProviders>
        </React.StrictMode>,
    );
}
