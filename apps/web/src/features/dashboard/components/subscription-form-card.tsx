"use client";

import { useState } from "react";
import { Button } from "@repo/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@repo/ui/components/card";
import { Checkbox } from "@repo/ui/components/checkbox";
import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";
import { RadioGroup, RadioGroupItem } from "@repo/ui/components/radio-group";
import { Textarea } from "@repo/ui/components/textarea";

export function SubscriptionFormCard() {
  const [plan, setPlan] = useState("starter");

  return (
    <Card className="rounded-xl">
      <CardHeader>
        <CardTitle className="text-lg">升级订阅</CardTitle>
        <p className="text-sm text-muted-foreground">
          你当前使用的是免费版。
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="name">姓名</Label>
            <Input id="name" placeholder="请输入姓名" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">邮箱</Label>
            <Input id="email" type="email" placeholder="email@example.com" />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="card">卡号</Label>
          <Input id="card" placeholder="1234 5678 9012 3456" />
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="month">到期月份</Label>
            <Input id="month" placeholder="月份" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="year">到期年份</Label>
            <Input id="year" placeholder="年份" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cvc">CVC</Label>
            <Input id="cvc" placeholder="123" />
          </div>
        </div>

        <RadioGroup
          value={plan}
          onValueChange={setPlan}
          className="grid gap-4 md:grid-cols-2"
        >
          <div>
            <RadioGroupItem
              value="starter"
              id="starter"
              className="peer sr-only"
            />
            <Label
              htmlFor="starter"
              className="flex cursor-pointer flex-col rounded-lg border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary"
            >
              <span className="font-medium">入门版</span>
              <span className="text-sm text-muted-foreground">$9 / 月</span>
            </Label>
          </div>
          <div>
            <RadioGroupItem value="pro" id="pro" className="peer sr-only" />
            <Label
              htmlFor="pro"
              className="flex cursor-pointer flex-col rounded-lg border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary"
            >
              <span className="font-medium">专业版</span>
              <span className="text-sm text-muted-foreground">$29 / 月</span>
            </Label>
          </div>
        </RadioGroup>

        <div className="space-y-2">
          <Label htmlFor="notes">备注</Label>
          <Textarea id="notes" placeholder="填写其他补充说明..." />
        </div>

        <div className="flex items-center space-x-2">
          <Checkbox id="terms" />
          <Label htmlFor="terms" className="text-sm">
            我同意服务条款和使用规则
          </Label>
        </div>

        <Button className="w-full">升级套餐</Button>
      </CardContent>
    </Card>
  );
}
