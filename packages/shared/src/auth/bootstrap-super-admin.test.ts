/**
 * 文件职责：覆盖自用模式本地超管引导的凭据文件与密码入库顺序。
 * 使用方：packages/shared 的 Vitest 测试套件。
 * 关键依赖：mock 的数据库、文件系统、Better Auth 哈希和自用模式开关。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type UserRow = {
  id: string;
  email: string | null;
  role: string | null;
};

type AccountRow = {
  id: string;
};

type InsertCall = {
  table: string;
  values: unknown;
};

type UpdateCall = {
  table: string;
  values: Record<string, unknown>;
};

type TableRef = {
  tableName: string;
};

const state = vi.hoisted(() => ({
  events: [] as string[],
  files: new Map<string, string>(),
  inserts: [] as InsertCall[],
  selectResults: [] as Array<Array<UserRow | AccountRow>>,
  updates: [] as UpdateCall[],
  writeFileError: null as Error | null,
}));

const dbMock = vi.hoisted(() => ({
  insert: vi.fn((table: TableRef) => ({
    values: vi.fn(async (values: unknown) => {
      state.events.push(`insert:${table.tableName}`);
      state.inserts.push({ table: table.tableName, values });
    }),
  })),
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(async (count: number) => {
          return (state.selectResults.shift() ?? []).slice(0, count);
        }),
      })),
    })),
  })),
  update: vi.fn((table: TableRef) => ({
    set: vi.fn((values: Record<string, unknown>) => ({
      where: vi.fn(async () => {
        state.events.push(`update:${table.tableName}`);
        state.updates.push({ table: table.tableName, values });
      }),
    })),
  })),
}));

vi.mock("@repo/database", () => ({
  account: {
    id: "account.id",
    providerId: "account.providerId",
    tableName: "account",
    userId: "account.userId",
  },
  db: dbMock,
  user: {
    email: "user.email",
    id: "user.id",
    role: "user.role",
    tableName: "user",
  },
}));

vi.mock("better-auth/crypto", () => ({
  hashPassword: vi.fn(async (password: string) => `hashed:${password}`),
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn(() => ({})),
  eq: vi.fn(() => ({})),
}));

vi.mock("./self-use-mode", () => ({
  isSelfUseModeEnabled: vi.fn(async () => true),
  LOCAL_SUPER_ADMIN_EMAIL: "admin@gpt2image.local",
}));

vi.mock("node:fs/promises", () => ({
  access: vi.fn(async (filePath: string) => {
    if (state.files.has(filePath)) return;
    throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
  }),
  chmod: vi.fn(async () => {}),
  mkdir: vi.fn(async () => {}),
  rm: vi.fn(async (filePath: string) => {
    state.events.push("rm");
    state.files.delete(filePath);
  }),
  writeFile: vi.fn(async (filePath: string, body: string) => {
    state.events.push("writeFile");
    if (state.writeFileError) throw state.writeFileError;
    state.files.set(filePath, body);
  }),
}));

describe("bootstrapSelfUseSuperAdmin", () => {
  beforeEach(() => {
    vi.resetModules();
    state.events = [];
    state.files = new Map<string, string>();
    state.inserts = [];
    state.selectResults = [];
    state.updates = [];
    state.writeFileError = null;
    delete process.env.GPT2IMAGE_BOOTSTRAP_RESET_LOCAL_ADMIN_PASSWORD;
    process.env.GPT2IMAGE_BOOTSTRAP_CREDENTIALS_PATH =
      "/tmp/gpt2image-test/super-admin-credentials.txt";
  });

  it("凭据文件写入失败时不创建本地超管和密码账号", async () => {
    state.selectResults = [[], []];
    state.writeFileError = Object.assign(new Error("EACCES"), {
      code: "EACCES",
    });

    const { bootstrapSelfUseSuperAdmin } = await import(
      "./bootstrap-super-admin"
    );
    await bootstrapSelfUseSuperAdmin();

    expect(state.events).toEqual(["writeFile"]);
    expect(state.inserts).toHaveLength(0);
    expect(state.files).toHaveProperty("size", 0);
  });

  it("首次创建本地超管时先写凭据文件再写数据库", async () => {
    state.selectResults = [[], []];

    const { bootstrapSelfUseSuperAdmin } = await import(
      "./bootstrap-super-admin"
    );
    await bootstrapSelfUseSuperAdmin();

    expect(state.events).toEqual([
      "writeFile",
      "insert:user",
      "insert:account",
    ]);
    expect(state.inserts.map((call) => call.table)).toEqual([
      "user",
      "account",
    ]);
    expect(
      state.files.get("/tmp/gpt2image-test/super-admin-credentials.txt")
    ).toContain("email=admin@gpt2image.local");
  });

  it("显式恢复开关仅在凭据文件缺失时重置已有本地超管密码", async () => {
    process.env.GPT2IMAGE_BOOTSTRAP_RESET_LOCAL_ADMIN_PASSWORD = "true";
    state.selectResults = [
      [{ email: "admin@gpt2image.local", id: "user-1", role: "super_admin" }],
      [{ id: "account-1" }],
    ];

    const { bootstrapSelfUseSuperAdmin } = await import(
      "./bootstrap-super-admin"
    );
    await bootstrapSelfUseSuperAdmin();

    expect(state.events).toEqual(["writeFile", "update:account"]);
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0]?.values.password).toEqual(
      expect.stringMatching(/^hashed:/)
    );
  });

  it("恢复开关遗留但凭据文件存在时不重复重置密码", async () => {
    process.env.GPT2IMAGE_BOOTSTRAP_RESET_LOCAL_ADMIN_PASSWORD = "true";
    state.files.set(
      "/tmp/gpt2image-test/super-admin-credentials.txt",
      "existing"
    );
    state.selectResults = [
      [{ email: "admin@gpt2image.local", id: "user-1", role: "super_admin" }],
      [{ id: "account-1" }],
    ];

    const { bootstrapSelfUseSuperAdmin } = await import(
      "./bootstrap-super-admin"
    );
    await bootstrapSelfUseSuperAdmin();

    expect(state.events).toEqual([]);
    expect(state.updates).toHaveLength(0);
  });
});
