export const siteConfig = {
  name: process.env.NEXT_PUBLIC_APP_NAME?.trim() || "GPT2IMAGE",

  description:
    process.env.NEXT_PUBLIC_APP_DESCRIPTION?.trim() ||
    "AI-powered chat-to-image generation platform. Transform your words into stunning visuals through natural conversation.",

  url: process.env.NEXT_PUBLIC_APP_URL || "https://gpt2image.com",

  logo: process.env.NEXT_PUBLIC_APP_LOGO_URL?.trim() || "/assets/icon.png",

  ogImage: process.env.NEXT_PUBLIC_APP_OG_IMAGE?.trim() || "/og-image.png",

  author: {
    name: "GPT2IMAGE Team",
    url: "https://gpt2image.com",
    email: "hello@gpt2image.com",
  },

  links: {
    twitter: "https://twitter.com/gpt2image",
    github: "https://github.com/MoYeRanqianzhi/GPT2Image",
    discord: "",
  },

  keywords: [
    "AI Image Generation",
    "Chat to Image",
    "Text to Image",
    "AI Art",
    "GPT2IMAGE",
    "Image Generation API",
    "Creative AI",
  ],
} as const;

export type SiteConfig = typeof siteConfig;
