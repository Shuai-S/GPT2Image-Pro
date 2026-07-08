import {
  BookOpen,
  Bot,
  Clock,
  Coins,
  GalleryHorizontalEnd,
  Gift,
  Headset,
  Image,
  ImagePlus,
  KeyRound,
  Layers,
  LayoutDashboard,
  type LucideIcon,
  Megaphone,
  MessageSquare,
  Settings,
  Ticket,
  Users,
  Video,
  Wand2,
  Workflow,
} from "lucide-react";

/**
 * 导航链接类型
 */
export interface NavItem {
  title: string;
  labelKey?: string;
  href: string;
  disabled?: boolean;
  external?: boolean;
  icon?: LucideIcon;
  description?: string;
  children?: NavItem[];
}

/**
 * 导航分组类型
 */
export interface NavGroup {
  title: string;
  labelKey?: string;
  items: NavItem[];
}

/**
 * Products 下拉菜单项类型
 */
export interface ProductNavItem {
  title: string;
  href: string;
  description: string;
  icon: LucideIcon;
}

/**
 * Products 下拉菜单分组类型
 */
export interface ProductNavGroup {
  title: string;
  items: ProductNavItem[];
}

// ============================================
// Marketing 导航配置
// ============================================

/**
 * Products 下拉菜单内容
 */
export const productsNav: ProductNavGroup[] = [
  {
    title: "Core features",
    items: [
      {
        title: "Chat to Image",
        href: "/dashboard",
        description: "Generate images from natural language",
        icon: Image,
      },
      {
        title: "Gallery",
        href: "/dashboard",
        description: "Browse and manage your creations",
        icon: GalleryHorizontalEnd,
      },
      {
        title: "Batch Generation",
        href: "/dashboard",
        description: "Generate multiple images at once",
        icon: Layers,
      },
    ],
  },
  {
    title: "Platform",
    items: [
      {
        title: "GPT Image 2",
        href: "/#features",
        description: "Next-generation image model with stunning quality",
        icon: Bot,
      },
      {
        title: "Multi-model Support",
        href: "/#features",
        description: "Access multiple image generation models",
        icon: Bot,
      },
      {
        title: "Credits System",
        href: "/pricing",
        description: "Flexible pay-as-you-go credits",
        icon: Coins,
      },
    ],
  },
];

/**
 * 主导航链接 (Header)
 */
export const mainNav: NavItem[] = [
  { title: "Pricing", href: "/pricing" },
  { title: "Docs", href: "/docs" },
  { title: "Blog", href: "/blog" },
];

/**
 * Footer 导航配置
 */
export const footerNav = {
  /** 产品 (Product) */
  product: [
    { title: "Pricing", href: "/pricing" },
    { title: "Docs", href: "/docs" },
    { title: "Contact Us", href: "mailto:hello@gpt2image.com" },
  ] as NavItem[],

  /** 法律 (Legal) */
  legal: [
    { title: "Terms of Service", href: "/legal/terms" },
    { title: "Privacy Policy", href: "/legal/privacy" },
    { title: "Cookie Policy", href: "/legal/cookie-policy" },
  ] as NavItem[],
};

// ============================================
// Dashboard 导航配置
// ============================================

/**
 * Dashboard 侧边栏导航分组
 */
export const dashboardNav: NavGroup[] = [
  {
    title: "Dashboard",
    labelKey: "nav.dashboard",
    items: [
      {
        title: "Dashboard",
        labelKey: "nav.dashboard",
        href: "/dashboard",
        icon: LayoutDashboard,
      },
      {
        title: "Create",
        labelKey: "nav.create",
        href: "/dashboard/create?mode=text",
        icon: ImagePlus,
        children: [
          {
            title: "Text to Image",
            labelKey: "nav.createTextToImage",
            href: "/dashboard/create?mode=text",
            icon: Wand2,
          },
          {
            title: "Image to Image",
            labelKey: "nav.createImageToImage",
            href: "/dashboard/create?mode=image",
            icon: Image,
          },
          {
            title: "Chat",
            labelKey: "nav.createChat",
            href: "/dashboard/create?mode=chat",
            icon: MessageSquare,
          },
          {
            title: "Agent",
            labelKey: "nav.createAgent",
            href: "/dashboard/create?mode=agent",
            icon: Bot,
          },
          {
            title: "Waterfall",
            labelKey: "nav.createWaterfall",
            href: "/dashboard/create?mode=waterfall",
            icon: Layers,
          },
          {
            title: "Video",
            labelKey: "nav.createVideo",
            href: "/dashboard/create?mode=video",
            icon: Video,
          },
        ],
      },
      {
        title: "Infinite Canvas",
        labelKey: "nav.infiniteCanvas",
        href: "/dashboard/canvas",
        icon: Workflow,
      },
      {
        title: "Gallery",
        labelKey: "nav.gallery",
        href: "/dashboard/gallery",
        icon: GalleryHorizontalEnd,
      },
      {
        title: "Usage Records",
        labelKey: "nav.history",
        href: "/dashboard/history",
        icon: Clock,
      },
      {
        title: "System Docs",
        labelKey: "nav.backendHelp",
        href: "/dashboard/backend-help",
        icon: BookOpen,
      },
      {
        title: "External API",
        labelKey: "nav.externalApi",
        href: "/dashboard/external-api",
        icon: KeyRound,
      },
      {
        title: "Billing & Usage",
        labelKey: "nav.billing",
        href: "/dashboard/billing",
        icon: Coins,
      },
      {
        title: "Referral",
        labelKey: "nav.referral",
        href: "/dashboard/referral",
        icon: Gift,
      },
      {
        title: "Announcements",
        labelKey: "nav.announcements",
        href: "/dashboard/announcements",
        icon: Megaphone,
      },
      {
        title: "Settings",
        labelKey: "nav.settings",
        href: "/dashboard/settings",
        icon: Settings,
      },
      {
        title: "Support",
        labelKey: "nav.support",
        href: "/dashboard/support",
        icon: Headset,
      },
    ],
  },
];

// ============================================
// Admin 导航配置
// ============================================

/**
 * Admin 侧边栏导航分组
 */
export const adminNav: NavGroup[] = [
  {
    title: "Admin",
    items: [
      {
        title: "Dashboard",
        href: "/admin",
        icon: LayoutDashboard,
      },
      {
        title: "Users",
        href: "/admin/users",
        icon: Users,
      },
      {
        title: "Tickets",
        href: "/admin/tickets",
        icon: Ticket,
      },
    ],
  },
];

// ============================================
// 导出配置对象
// ============================================

/**
 * Marketing 页面配置
 */
export const marketingConfig = {
  mainNav,
  footerNav,
};

/**
 * Dashboard 页面配置
 */
export const dashboardConfig = {
  sidebarNav: dashboardNav,
};

/**
 * Admin 页面配置
 */
export const adminConfig = {
  sidebarNav: adminNav,
};
