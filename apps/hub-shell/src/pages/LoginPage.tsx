import { useState } from "react";
import { Navigate, useNavigate } from "react-router";
import { Button, Icon, Input, cn, ui } from "@agenthub/hub-ui-kit";
import { ArrowUpRight } from "lucide-react";
import { useAuth } from "../auth/AuthProvider.js";

export function LoginPage() {
  const { user, loading, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("admin@example.com");
  const [password, setPassword] = useState("admin-password-change-me");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (!loading && user) return <Navigate to="/" replace />;

  return (
    <div className="relative grid min-h-full place-items-center overflow-hidden bg-[#f4f6f9] px-4 py-8">
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(900px_420px_at_12%_-10%,#dce6ff,transparent_58%),radial-gradient(720px_360px_at_92%_8%,#e7eef8,transparent_55%),linear-gradient(#f7f9fc,#eef2f6)]"
        aria-hidden
      />
      <div className={cn(ui.surface, "relative z-1 w-full max-w-[420px] px-[26px] py-7 pb-[22px]")}>
        <div className="mb-[22px] flex items-center gap-3">
          <span className="relative inline-flex h-[31px] w-[29px] items-center justify-center rounded-lg bg-ah-accent text-[17px] text-white">
            a
            <Icon
              icon={ArrowUpRight}
              size="xs"
              className="absolute -top-0.5 right-0.5 text-white"
            />
          </span>
          <div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-[22px] font-bold tracking-[-0.6px] text-[#182230]">
                AgentHub
              </span>
              <span className="-ml-0.5 rounded bg-[#f8fafc] px-1 py-[3px] text-[9px] tracking-[0.5px] text-[#475467]">
                EX
              </span>
            </div>
            <p className="mt-1 text-[10px] text-[#8d9a90]">工作有边界，协作无阻碍。</p>
          </div>
        </div>

        <h1 className="m-0 mb-1.5 text-[22px] font-[650] tracking-[-0.4px] text-[#182230]">
          登录控制台
        </h1>
        <p className="mb-[18px] text-[11px] leading-[1.7] text-ah-muted">
          内网部署 · 静态资源自托管 · 无外链字体与脚本
        </p>

        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            setPending(true);
            setError(null);
            void login(email, password)
              .then(() => navigate("/"))
              .catch((err: unknown) =>
                setError(err instanceof Error ? err.message : "登录失败"),
              )
              .finally(() => setPending(false));
          }}
        >
          <label className={ui.field}>
            邮箱
            <Input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label className={ui.field}>
            密码
            <Input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          {error ? <p className="m-0 text-[11px] text-[#b42318]">{error}</p> : null}
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "登录中…" : "进入控制台"}
          </Button>
        </form>

        <p className="mt-4 text-[9px] leading-[1.7] text-[#9aa79d]">
          演示账号见 <code className="font-mono text-[9px]">.env.example</code> · Facade
          代理运行时，浏览器不持有 Provider Key
        </p>
      </div>
    </div>
  );
}
