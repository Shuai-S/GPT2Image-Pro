"use client";

import { Button } from "@repo/ui/components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { Star } from "lucide-react";

export function RepoCard() {
  return (
    <Card className="rounded-xl">
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="text-base font-semibold">tweakcn</CardTitle>
          <p className="text-sm text-muted-foreground">
            面向 shadcn/ui 组件的 AI 主题编辑器。
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-1">
          <Star className="h-3 w-3" />
          收藏
        </Button>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-1">
            <span className="h-3 w-3 rounded-full bg-blue-500" />
            TypeScript
          </div>
          <div className="flex items-center gap-1">
            <Star className="h-3 w-3" />
            1.2k
          </div>
          <div>更新于 2024 年 4 月</div>
        </div>
      </CardContent>
    </Card>
  );
}
