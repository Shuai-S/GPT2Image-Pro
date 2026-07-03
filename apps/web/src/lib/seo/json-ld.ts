import { siteConfig } from "@repo/shared/config";
import type { BrandingConfig } from "@repo/shared/config/branding";

type LocaleType = "en" | "zh";
type JsonLdBranding = Pick<BrandingConfig, "name" | "description" | "logoUrl">;

// Base URL helper
const getBaseUrl = () => siteConfig.url;

function getBranding(branding?: JsonLdBranding): JsonLdBranding {
  return {
    name: branding?.name || siteConfig.name,
    description: branding?.description || siteConfig.description,
    logoUrl: branding?.logoUrl || siteConfig.logo,
  };
}

function toAbsoluteUrl(url: string) {
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }

  return `${getBaseUrl()}${url.startsWith("/") ? url : `/${url}`}`;
}

/**
 * WebSite Schema - for site-wide search/branding
 *
 * @param locale - 当前页面语言。
 * @param branding - 管理员配置的品牌信息；未传入时使用静态兜底配置。
 * @returns WebSite 结构化数据。
 * @sideEffects 无。
 */
export function generateWebSiteSchema(
  locale: LocaleType,
  branding?: JsonLdBranding
) {
  const brand = getBranding(branding);

  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: brand.name,
    url: getBaseUrl(),
    description:
      locale === "en"
        ? brand.description
        : "AI驱动的对话生图平台，通过自然对话将你的想法转化为精美视觉图片。",
    inLanguage: locale === "en" ? "en-US" : "zh-CN",
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${getBaseUrl()}/{locale}/blog?q={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  };
}

/**
 * Organization Schema - for brand identity
 *
 * @param branding - 管理员配置的品牌信息；未传入时使用静态兜底配置。
 * @returns Organization 结构化数据。
 * @sideEffects 无。
 */
export function generateOrganizationSchema(branding?: JsonLdBranding) {
  const brand = getBranding(branding);

  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: brand.name,
    url: getBaseUrl(),
    logo: toAbsoluteUrl(brand.logoUrl),
    sameAs: [siteConfig.links.twitter, siteConfig.links.github].filter(Boolean),
    contactPoint: {
      "@type": "ContactPoint",
      contactType: "customer support",
      email: siteConfig.author.email,
    },
  };
}

/**
 * Article Schema Input
 */
export interface ArticleSchemaInput {
  title: string;
  description: string;
  slug: string;
  locale: LocaleType;
  publishedAt: string;
  updatedAt?: string;
  author?: string;
  image?: string;
  tags?: string[];
}

/**
 * Article Schema - for blog posts
 */
export function generateArticleSchema(input: ArticleSchemaInput) {
  const brand = getBranding();
  const {
    title,
    description,
    slug,
    locale,
    publishedAt,
    updatedAt,
    author,
    image,
    tags,
  } = input;

  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: title,
    description,
    url: `${getBaseUrl()}/${locale}/blog/${slug}`,
    inLanguage: locale === "en" ? "en-US" : "zh-CN",
    datePublished: publishedAt,
    dateModified: updatedAt || publishedAt,
    author: {
      "@type": "Person",
      name: author || siteConfig.author.name,
    },
    publisher: {
      "@type": "Organization",
      name: brand.name,
      logo: {
        "@type": "ImageObject",
        url: toAbsoluteUrl(brand.logoUrl),
      },
    },
    ...(image && {
      image: {
        "@type": "ImageObject",
        url: image.startsWith("http") ? image : `${getBaseUrl()}${image}`,
      },
    }),
    ...(tags && tags.length > 0 && { keywords: tags.join(", ") }),
  };
}

/**
 * FAQ Item type
 */
export interface FAQItem {
  question: string;
  answer: string;
}

/**
 * FAQ Schema - for FAQ sections
 */
export function generateFAQSchema(faqs: FAQItem[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.answer,
      },
    })),
  };
}

/**
 * Breadcrumb Item type
 */
export interface BreadcrumbItem {
  name: string;
  url: string;
}

/**
 * Breadcrumb Schema - for navigation
 */
export function generateBreadcrumbSchema(items: BreadcrumbItem[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url.startsWith("http")
        ? item.url
        : `${getBaseUrl()}${item.url}`,
    })),
  };
}

/**
 * SoftwareApplication Schema - for the product itself
 *
 * @param locale - 当前页面语言。
 * @param branding - 管理员配置的品牌信息；未传入时使用静态兜底配置。
 * @returns SoftwareApplication 结构化数据。
 * @sideEffects 无。
 */
export function generateSoftwareApplicationSchema(
  locale: LocaleType,
  branding?: JsonLdBranding
) {
  const brand = getBranding(branding);

  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: brand.name,
    applicationCategory: "MultimediaApplication",
    operatingSystem: "Web",
    url: getBaseUrl(),
    description:
      locale === "en"
        ? brand.description
        : "AI驱动的对话生图平台，通过自然对话创建精美视觉图片",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "CNY",
      description: locale === "en" ? "Free tier available" : "提供免费版本",
    },
  };
}
