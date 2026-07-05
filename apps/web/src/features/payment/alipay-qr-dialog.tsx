"use client";

/*
 * 职责：展示支付宝当面付预下单返回的二维码内容，避免把 qr_code 当普通 URL 跳转。
 * 使用方：定价页订阅下单与积分购买页。
 * 关键依赖：qrcode 本地生成二维码图片，@repo/ui Dialog/Button 提供弹窗与操作。
 */

import { Button } from "@repo/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/components/dialog";
import { Loader2 } from "lucide-react";
import Image from "next/image";
import QRCode from "qrcode";
import { useEffect, useState } from "react";

type AlipayQrDialogProps = {
  open: boolean;
  qrCode: string | null;
  onOpenChange: (open: boolean) => void;
  onCompleted?: () => void;
  isChecking?: boolean;
  statusText?: string;
};

/**
 * 渲染支付宝扫码支付弹窗。
 *
 * @param props.open 弹窗是否打开。
 * @param props.qrCode 支付宝 precreate 返回的二维码内容。
 * @param props.onOpenChange 弹窗开关回调。
 * @param props.onCompleted 用户点击已完成支付时触发主动查单。
 * @param props.isChecking 是否正在查询支付宝订单状态。
 * @param props.statusText 当前支付状态提示。
 * @returns 支付宝二维码弹窗。
 * @sideEffects qrCode 变化时在浏览器中生成 data URL；点击完成可触发查单与履约。
 */
export function AlipayQrDialog({
  open,
  qrCode,
  onOpenChange,
  onCompleted,
  isChecking = false,
  statusText,
}: AlipayQrDialogProps) {
  const [qrImage, setQrImage] = useState<string>("");
  const [renderError, setRenderError] = useState<string>("");

  useEffect(() => {
    let canceled = false;
    setQrImage("");
    setRenderError("");

    if (!qrCode) return;

    QRCode.toDataURL(qrCode, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 280,
      color: {
        dark: "#111827",
        light: "#ffffff",
      },
    })
      .then((dataUrl) => {
        if (!canceled) setQrImage(dataUrl);
      })
      .catch(() => {
        if (!canceled) setRenderError("二维码生成失败，请重新发起支付。");
      });

    return () => {
      canceled = true;
    };
  }, [qrCode]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>支付宝扫码支付</DialogTitle>
          <DialogDescription>
            {statusText ?? "请使用支付宝扫描二维码完成支付。"}
          </DialogDescription>
        </DialogHeader>

        <div className="flex justify-center rounded-lg border bg-white p-4">
          {qrImage ? (
            <Image
              src={qrImage}
              alt="支付宝支付二维码"
              width={280}
              height={280}
              unoptimized
              className="h-[280px] w-[280px]"
            />
          ) : (
            <div className="flex h-[280px] w-[280px] items-center justify-center text-sm text-muted-foreground">
              {renderError || "正在生成二维码..."}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            关闭
          </Button>
          <Button type="button" disabled={isChecking} onClick={onCompleted}>
            {isChecking ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                正在确认
              </>
            ) : (
              "我已完成支付"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
