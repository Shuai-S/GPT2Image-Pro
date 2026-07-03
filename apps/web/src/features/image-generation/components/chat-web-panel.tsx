"use client";

/**
 * chat(web) tab 面板:自包含的会话式生成界面(对标官方 ChatGPT 网页对话)。
 *
 * 用户在一个对话里选择要生成的内容(图像 / PPT / PSD)+ 输入提示词(PSD 必须、图像可选传参考图),
 * 提交后结果以对话消息呈现(图像内联展示;PPT/PSD 给出可下载链接)。
 *
 * WHY 自包含:本面板自管一套简单消息状态,不复用创作页 9000+ 行的 chat/agent 共享状态机
 *   (那套耦合深、风险高),与 video-create-panel 同为"独立 tab 面板"范式。
 * 后端:图像走 /api/images/generate(SSE keep-alive);PPT/PSD 走 /api/editable-file/generate
 *   (JSON keep-alive,session 鉴权,内部只调付费 web 账号)。计费/账号池/存储全在服务端。
 */

import { Button } from "@repo/ui/components/button";
import { Label } from "@repo/ui/components/label";
import { Textarea } from "@repo/ui/components/textarea";
import { Download, ImageIcon, Loader2, Paperclip, X } from "lucide-react";
import { useLocale } from "next-intl";
import { useCallback, useRef, useState } from "react";

type GenKind = "image" | "ppt" | "psd";

type ChatFile = { label: string; url: string };

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  kind: GenKind;
  text?: string;
  images?: string[]; // data URL 或签名 URL
  files?: ChatFile[];
  credits?: number;
  error?: string;
  pending?: boolean;
};

const KIND_OPTIONS: Array<{ value: GenKind; en: string; zh: string }> = [
  { value: "ppt", en: "PPT", zh: "PPT" },
  { value: "psd", en: "PSD", zh: "PSD" },
  { value: "image", en: "Image", zh: "图像" },
];

let messageSeq = 0;
function nextId() {
  messageSeq += 1;
  return `m${messageSeq}-${messageSeq * 2654435761}`;
}

/** File -> data URL(base64),供上传参考图/PSD 素材。 */
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

/** 读 createJsonKeepAliveResponse 的响应:去掉 keep-alive 填充,解析尾部 JSON。 */
async function readKeepAliveJson(response: Response): Promise<unknown> {
  const text = await response.text();
  const start = text.indexOf("{");
  if (start < 0) throw new Error("空响应");
  return JSON.parse(text.slice(start));
}

/**
 * 消费图像 SSE(createImageStreamResponse:`data: {json}\n\n`),收集 completed/error 与产出图。
 * 返回内联图(b64/url)或抛错。
 */
async function consumeImageStream(response: Response): Promise<string[]> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("无响应流");
  const decoder = new TextDecoder();
  const images: string[] = [];
  let buffer = "";
  let errorMessage = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      let event: {
        type?: string;
        b64_json?: string;
        url?: string;
        imageUrl?: string;
        error?: string;
      };
      try {
        event = JSON.parse(line.slice(6));
      } catch {
        continue;
      }
      if (event.type === "error") {
        errorMessage = event.error || "生成失败";
      } else if (event.b64_json) {
        images.push(`data:image/png;base64,${event.b64_json}`);
      } else if (event.url || event.imageUrl) {
        images.push(String(event.url || event.imageUrl));
      }
    }
  }
  if (errorMessage) throw new Error(errorMessage);
  if (!images.length) throw new Error("未返回图像");
  return images;
}

/** 参考图上限(本地上传 + 从最近生成挑选合计)。 */
const MAX_CHAT_WEB_REFS = 6;

type ChatWebPanelProps = {
  // 参考图(data URL 数组)受控于父组件:本地上传与"点最近生成作参考"共用同一份状态,
  // 后者由创作页 handleRecentClick 在 chat-web 模式下写入(见 create-page-client)。
  attachments: string[];
  onAttachmentsChange: (next: string[]) => void;
};

export function ChatWebPanel({
  attachments,
  onAttachmentsChange,
}: ChatWebPanelProps) {
  const isZh = useLocale() === "zh";
  const t = useCallback(
    (en: string, zh: string) => (isZh ? zh : en),
    [isZh]
  );

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [kind, setKind] = useState<GenKind>("ppt");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const onPickFiles = useCallback(
    async (files: FileList | null) => {
      if (!files?.length) return;
      const urls = await Promise.all(
        Array.from(files)
          .filter((f) => f.type.startsWith("image/"))
          .slice(0, MAX_CHAT_WEB_REFS)
          .map(fileToDataUrl)
      );
      onAttachmentsChange(
        [...attachments, ...urls].slice(0, MAX_CHAT_WEB_REFS)
      );
    },
    [attachments, onAttachmentsChange]
  );

  const send = useCallback(async () => {
    const text = prompt.trim();
    if (!text || busy) return;
    if (kind === "psd" && attachments.length === 0) {
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          role: "assistant",
          kind,
          error: t(
            "PSD generation needs at least one reference image.",
            "生成 PSD 需要至少一张参考图。"
          ),
        },
      ]);
      return;
    }

    const userImages = attachments;
    setMessages((prev) => [
      ...prev,
      { id: nextId(), role: "user", kind, text, images: userImages },
    ]);
    const pendingId = nextId();
    setMessages((prev) => [
      ...prev,
      { id: pendingId, role: "assistant", kind, pending: true },
    ]);
    setPrompt("");
    onAttachmentsChange([]);
    setBusy(true);

    try {
      if (kind === "image") {
        const response = await fetch("/api/images/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: text, n: 1 }),
        });
        const images = await consumeImageStream(response);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === pendingId ? { ...m, pending: false, images } : m
          )
        );
      } else {
        const response = await fetch("/api/editable-file/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind,
            prompt: text,
            base64Images: userImages,
          }),
        });
        const data = (await readKeepAliveJson(response)) as {
          error?: { message?: string };
          result?: { primary_url?: string; zip_url?: string | null };
          credits_charged?: number;
        };
        if (!response.ok || data.error) {
          throw new Error(data.error?.message || t("Failed", "生成失败"));
        }
        const files: ChatFile[] = [];
        if (data.result?.primary_url) {
          files.push({
            label: kind === "psd" ? "PSD" : "PPTX",
            url: data.result.primary_url,
          });
        }
        if (data.result?.zip_url) {
          files.push({ label: t("Assets ZIP", "素材 ZIP"), url: data.result.zip_url });
        }
        setMessages((prev) =>
          prev.map((m) =>
            m.id === pendingId
              ? { ...m, pending: false, files, credits: data.credits_charged }
              : m
          )
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "生成失败";
      setMessages((prev) =>
        prev.map((m) =>
          m.id === pendingId ? { ...m, pending: false, error: message } : m
        )
      );
    } finally {
      setBusy(false);
    }
  }, [prompt, busy, kind, attachments, onAttachmentsChange, t]);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        {t(
          "Conversational generation via ChatGPT web accounts: pick a type, describe what you want, and get an image, editable PPT, or layered PSD.",
          "基于 ChatGPT 网页账号的对话式生成:选择类型、描述需求,即可得到图像、可编辑 PPT 或分层 PSD。"
        )}
      </p>

      {/* 消息列表 */}
      <div className="flex min-h-[240px] flex-col gap-3 rounded-lg border border-border bg-muted/20 p-4">
        {messages.length === 0 ? (
          <div className="m-auto text-sm text-muted-foreground">
            {t("Start a conversation below.", "在下方开始对话。")}
          </div>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                  m.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "border border-border bg-background"
                }`}
              >
                <div className="mb-1 text-xs opacity-70">
                  {m.role === "user"
                    ? t("You", "你")
                    : `chat(web) · ${m.kind.toUpperCase()}`}
                </div>
                {m.text && <div className="whitespace-pre-wrap">{m.text}</div>}
                {m.images && m.images.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {m.images.map((src) => (
                      // biome-ignore lint/performance/noImgElement: 生成图为 data/签名 URL,next/image 不适用
                      <img
                        key={src.slice(-24)}
                        src={src}
                        alt="generated"
                        className="max-h-64 rounded border border-border"
                      />
                    ))}
                  </div>
                )}
                {m.files && m.files.length > 0 && (
                  <div className="mt-2 flex flex-col gap-2">
                    {m.files.map((f) => (
                      <a
                        key={f.url}
                        href={f.url}
                        download
                        className="inline-flex items-center gap-2 rounded border border-border px-2 py-1 text-sm hover:bg-muted"
                      >
                        <Download className="h-4 w-4" />
                        {t("Download", "下载")} {f.label}
                      </a>
                    ))}
                  </div>
                )}
                {typeof m.credits === "number" && m.credits > 0 && (
                  <div className="mt-1 text-xs opacity-70">
                    {t("Credits", "积分")}: {m.credits}
                  </div>
                )}
                {m.pending && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t("Generating (may take minutes)…", "生成中(可能需几分钟)…")}
                  </div>
                )}
                {m.error && (
                  <div className="text-destructive">{m.error}</div>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* 组合区:类型选择 + 附件 + 提示词 + 发送 */}
      <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Label className="text-sm">{t("Generate", "生成")}:</Label>
          {KIND_OPTIONS.map((opt) => (
            <Button
              key={opt.value}
              type="button"
              size="sm"
              variant={kind === opt.value ? "default" : "outline"}
              onClick={() => setKind(opt.value)}
            >
              {t(opt.en, opt.zh)}
            </Button>
          ))}
          <span className="text-xs text-muted-foreground">
            {kind === "psd"
              ? t("(reference image required)", "(需参考图)")
              : t("(reference optional)", "(参考图可选)")}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          {t(
            "Add reference images below, or click any image in Recent to attach it.",
            "在下方上传参考图,或直接点「最近生成」里的图片添加为参考。"
          )}
        </p>

        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {attachments.map((src, i) => (
              <div key={src.slice(-24)} className="relative">
                {/* biome-ignore lint/performance/noImgElement: 本地预览 data URL,next/image 不适用 */}
                <img
                  src={src}
                  alt="attachment"
                  className="h-16 w-16 rounded border border-border object-cover"
                />
                <button
                  type="button"
                  onClick={() =>
                    onAttachmentsChange(attachments.filter((_, j) => j !== i))
                  }
                  className="-right-2 -top-2 absolute rounded-full bg-background p-0.5 shadow"
                  aria-label={t("Remove", "移除")}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={
            kind === "ppt"
              ? t(
                  "e.g. A Q2 e-commerce review deck, ≤8 slides, with GMV trend and channel mix.",
                  "例如:一份 2026 Q2 电商运营复盘 PPT,8 页以内,含 GMV 趋势与渠道结构。"
                )
              : kind === "psd"
                ? t(
                    "Describe the layered PSD to produce from the reference image(s).",
                    "描述要基于参考图生成的分层 PSD。"
                  )
                : t("Describe the image to generate.", "描述要生成的图像。")
          }
          rows={3}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") send();
          }}
        />

        <div className="flex items-center justify-between">
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                onPickFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
            >
              <Paperclip className="mr-1 h-4 w-4" />
              {t("Add image", "加参考图")}
            </Button>
          </div>
          <Button onClick={send} disabled={busy || !prompt.trim()}>
            {busy ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <ImageIcon className="mr-1 h-4 w-4" />
            )}
            {t("Send", "发送")}
          </Button>
        </div>
      </div>
    </div>
  );
}
