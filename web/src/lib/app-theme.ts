import type { ThemeConfig } from "antd";
import { theme as antdTheme } from "antd";

const neutral = {
    light: {
        primary: "#2f5bff",
        primaryHover: "#2448d8",
        primaryText: "#ffffff",
        elevatedBg: "#ffffff",
        itemHoverBg: "#eef1f5",
        itemSelectedBg: "#e9efff",
        itemSelectedHoverBg: "#dce5ff",
        itemText: "#17212b",
        tableSelectedBg: "#e9efff",
        tableSelectedHoverBg: "#dce5ff",
    },
    dark: {
        primary: "#4169ed",
        primaryHover: "#5179ff",
        primaryText: "#ffffff",
        elevatedBg: "#181f2b",
        itemHoverBg: "#222c3b",
        itemSelectedBg: "#233664",
        itemSelectedHoverBg: "#2d4378",
        itemText: "#f1f5f9",
        tableSelectedBg: "#233664",
        tableSelectedHoverBg: "#2d4378",
    },
};

export function getAntThemeConfig(dark: boolean): ThemeConfig {
    const color = dark ? neutral.dark : neutral.light;

    return {
        algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        cssVar: { key: dark ? "infinite-canvas-dark" : "infinite-canvas-light" },
        token: {
            colorPrimary: color.primary,
            colorPrimaryHover: color.primaryHover,
            colorPrimaryActive: dark ? "#3559ce" : "#2448d8",
            colorInfo: color.primary,
            colorLink: dark ? "#a9bdff" : color.primary,
            colorLinkHover: dark ? "#c3d0ff" : color.primaryHover,
            colorLinkActive: color.primary,
            colorTextLightSolid: color.primaryText,
            colorBgElevated: color.elevatedBg,
            colorBgContainer: color.elevatedBg,
            colorBgLayout: dark ? "#11151d" : "#f4f6f8",
            colorText: color.itemText,
            colorTextSecondary: dark ? "#a8b5c9" : "#64748b",
            colorTextPlaceholder: dark ? "#94a3b8" : "#64748b",
            colorBorder: dark ? "#364359" : "#dde2e8",
            colorBorderSecondary: dark ? "#2b3749" : "#eef1f5",
            borderRadius: 8,
            controlItemBgHover: color.itemHoverBg,
            controlItemBgActive: color.itemSelectedBg,
            controlItemBgActiveHover: color.itemSelectedHoverBg,
        },
        components: {
            Tooltip: {
                colorBgSpotlight: dark ? "#2b3749" : "#262626",
                colorTextLightSolid: "#ffffff",
            },
            Button: {
                primaryShadow: "none",
            },
            Segmented: {
                itemSelectedBg: color.itemSelectedBg,
                itemSelectedColor: dark ? "#a9bdff" : color.primary,
                trackBg: dark ? "#11151d" : "#eef1f5",
            },
            Dropdown: {
                colorBgElevated: color.elevatedBg,
                colorText: color.itemText,
                controlItemBgHover: color.itemHoverBg,
                controlItemBgActive: color.itemSelectedBg,
                controlItemBgActiveHover: color.itemSelectedHoverBg,
            },
            Menu: {
                popupBg: color.elevatedBg,
                itemActiveBg: color.itemSelectedBg,
                itemHoverBg: color.itemHoverBg,
                itemSelectedBg: color.itemSelectedBg,
                itemSelectedColor: color.itemText,
                darkPopupBg: neutral.dark.elevatedBg,
                darkItemHoverBg: neutral.dark.itemHoverBg,
                darkItemSelectedBg: neutral.dark.itemSelectedBg,
                darkItemSelectedColor: neutral.dark.itemText,
            },
            Select: {
                optionActiveBg: color.itemHoverBg,
                optionSelectedBg: color.itemSelectedBg,
                optionSelectedColor: color.itemText,
            },
            Table: {
                rowSelectedBg: color.tableSelectedBg,
                rowSelectedHoverBg: color.tableSelectedHoverBg,
            },
        },
    };
}
