"use client";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@repo/ui/components/accordion";
import { useTranslations } from "next-intl";

interface FAQSectionProps {
  /** 管理员在系统设置中配置的品牌名称。 */
  brandName: string;
}

export function FAQSection({ brandName }: FAQSectionProps) {
  const t = useTranslations("FAQ");
  const faqItems = t.raw("items") as Array<{
    question: string;
    answer: string;
  }>;

  return (
    <section className="container py-24">
      <div className="mx-auto max-w-3xl">
        {/* Header */}
        <div className="mb-12 text-center">
          <p className="mb-2 text-sm font-medium uppercase tracking-wider text-foreground">
            {t("label")}
          </p>
          <h2 className="mb-4 text-balance font-serif text-3xl font-medium tracking-tight md:text-4xl">
            {t("title")}
          </h2>
          <p className="mx-auto max-w-2xl text-muted-foreground">
            {t("subtitle", { brandName })}
          </p>
        </div>

        {/* FAQ Accordion */}
        <Accordion type="single" collapsible className="w-full">
          {faqItems.map((faq, index) => (
            <AccordionItem key={faq.question} value={`item-${index}`}>
              <AccordionTrigger className="text-left">
                {faq.question.replaceAll("{brandName}", brandName)}
              </AccordionTrigger>
              <AccordionContent className="text-muted-foreground">
                {faq.answer.replaceAll("{brandName}", brandName)}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}
