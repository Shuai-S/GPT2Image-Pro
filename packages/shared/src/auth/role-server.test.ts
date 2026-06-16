import { beforeEach, describe, expect, it, vi } from "vitest";

// 守护审计 C-M25/P3-23：getUserRoleById 含本地超管自动提权后门
// （isSelfUseModeEnabled() + role==='admin' + email===LOCAL_SUPER_ADMIN_EMAIL
// 三重条件满足时升 super_admin）。
// 该函数是 adminAction/superAdminAction/checkAdmin 取角色的唯一入口（授权链根），
// 提权条件须严格——误改邮箱常量/去掉 role 前置/改模糊匹配/去掉自用模式守卫
// 都会成提权后门，故对提权分支与各非提权分支均断言，并断言提权确实落库。

const state = vi.hoisted(() => ({
  userRows: [] as Array<{ email: string | null; role: string | null }>,
}));

const updateCalls = vi.hoisted(
  () => [] as Array<{ values: unknown }>
);

const dbMock = vi.hoisted(() => ({
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(async (count: number) => state.userRows.slice(0, count)),
      })),
    })),
  })),
  update: vi.fn(() => ({
    set: vi.fn((values: unknown) => ({
      where: vi.fn(async () => {
        updateCalls.push({ values });
      }),
    })),
  })),
}));

vi.mock("@repo/database", () => ({
  db: dbMock,
  user: { id: "user.id", email: "user.email", role: "user.role" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => ({})),
}));

// 默认自用模式启用；个别用例覆盖为 false 以测试守卫。
const selfUseModeEnabled = vi.hoisted(() => ({ value: true }));

vi.mock("./self-use-mode", async (importOriginal) => {
  const orig =
    await importOriginal<typeof import("./self-use-mode")>();
  return {
    ...orig,
    isSelfUseModeEnabled: vi.fn(
      async () => selfUseModeEnabled.value
    ),
  };
});

describe("getUserRoleById", () => {
  beforeEach(() => {
    vi.resetModules();
    state.userRows = [];
    updateCalls.length = 0;
    dbMock.select.mockClear();
    dbMock.update.mockClear();
    selfUseModeEnabled.value = true;
  });

  it("把本地超管邮箱的 admin 自动提升为 super_admin 并落库", async () => {
    state.userRows = [{ email: "admin@gpt2image.local", role: "admin" }];

    const { getUserRoleById } = await import("./role-server");
    const role = await getUserRoleById("user-1");

    expect(role).toBe("super_admin");
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]?.values).toMatchObject({ role: "super_admin" });
  });

  it("邮箱比较大小写无关", async () => {
    state.userRows = [{ email: "Admin@GPT2IMAGE.Local", role: "admin" }];

    const { getUserRoleById } = await import("./role-server");
    const role = await getUserRoleById("user-1");

    expect(role).toBe("super_admin");
    expect(updateCalls).toHaveLength(1);
  });

  it("角色非 admin（user）即便邮箱命中也不提权", async () => {
    state.userRows = [{ email: "admin@gpt2image.local", role: "user" }];

    const { getUserRoleById } = await import("./role-server");
    const role = await getUserRoleById("user-1");

    expect(role).toBe("user");
    expect(updateCalls).toHaveLength(0);
  });

  it("邮箱非本地超管即便角色是 admin 也不提权", async () => {
    state.userRows = [{ email: "someone@gmail.com", role: "admin" }];

    const { getUserRoleById } = await import("./role-server");
    const role = await getUserRoleById("user-1");

    expect(role).toBe("admin");
    expect(updateCalls).toHaveLength(0);
  });

  it("自用模式关闭时即便条件满足也不提权", async () => {
    selfUseModeEnabled.value = false;
    state.userRows = [{ email: "admin@gpt2image.local", role: "admin" }];

    const { getUserRoleById } = await import("./role-server");
    const role = await getUserRoleById("user-1");

    expect(role).toBe("admin");
    expect(updateCalls).toHaveLength(0);
  });

  it("未知/缺失的 DB 角色归一为 user", async () => {
    state.userRows = [{ email: "x@gmail.com", role: "bogus-role" }];

    const { getUserRoleById } = await import("./role-server");
    expect(await getUserRoleById("user-1")).toBe("user");

    state.userRows = [];
    vi.resetModules();
    const reloaded = await import("./role-server");
    expect(await reloaded.getUserRoleById("missing")).toBe("user");
    expect(updateCalls).toHaveLength(0);
  });
});
