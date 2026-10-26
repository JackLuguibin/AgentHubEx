import { useState } from "react";
import {
  Badge,
  Banner,
  Button,
  Icon,
  PageHeader,
  Tabs,
  cn,
  ui,
} from "@agenthub/hub-ui-kit";
import { KeyRound, Plus, Shield } from "lucide-react";

const CREDENTIALS = [
  {
    id: 1,
    label: "团队 Anthropic",
    provider: "Anthropic",
    baseUrl: "https://api.anthropic.com",
    scope: "project" as const,
    status: "有效",
    default: true,
  },
  {
    id: 2,
    label: "团队 OpenAI",
    provider: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    scope: "project" as const,
    status: "有效",
  },
  {
    id: 3,
    label: "我的 OpenAI",
    provider: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    scope: "user" as const,
    status: "有效",
  },
];

type Tab = "project" | "personal";

export function CredentialsPage() {
  const [tab, setTab] = useState<Tab>("project");
  const own = tab === "personal";
  const list = CREDENTIALS.filter((c) => c.scope === (own ? "user" : "project"));

  return (
    <>
      <PageHeader
        eyebrow="项目配置"
        title="凭据管理"
        description="按项目策略选择凭据，会话创建后锁定来源与版本。"
        actions={
          <Button disabled title="P1">
            <Icon icon={Plus} size="sm" />
            添加凭据
          </Button>
        }
      />

      <Tabs
        aria-label="凭据范围"
        value={tab}
        onChange={setTab}
        items={[
          { value: "project", label: "项目共享凭据" },
          { value: "personal", label: "我的个人凭据" },
        ]}
      />

      <Banner icon={Shield}>
        API Key 仅写入，不提供明文查询；Base URL、Headers 等连接配置可编辑。项目策略：user_or_project。
      </Banner>

      <div className={cn(ui.surface, ui.tableWrap)}>
        <table className={ui.dataTable}>
          <thead>
            <tr>
              <th>名称</th>
              <th>Provider</th>
              <th>来源 / 权限</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {list.map((c) => (
              <tr key={c.id}>
                <td>
                  <strong className="inline-flex items-center gap-1">
                    <Icon icon={KeyRound} size="xs" />
                    {c.label}
                  </strong>{" "}
                  {c.default ? <Badge tone="green">项目默认</Badge> : null}
                  <small>
                    ID: cred-{c.id} · v1
                  </small>
                </td>
                <td>
                  {c.provider}
                  <small>{c.baseUrl}</small>
                </td>
                <td>{own ? "仅本人可管理" : "developer+ 可使用；owner 管理"}</td>
                <td>
                  <Badge tone="green">{c.status}</Badge>
                </td>
                <td className={ui.tableActions}>
                  <Button size="sm" variant="secondary" disabled title="P1">
                    配置
                  </Button>
                  <Button size="sm" variant="secondary" disabled title="P1">
                    轮换
                  </Button>
                  <Button size="sm" variant="secondary" disabled title="P1">
                    停用
                  </Button>
                </td>
              </tr>
            ))}
            {list.length === 0 ? (
              <tr>
                <td colSpan={5} className={ui.empty}>
                  暂无个人凭据。可添加仅本人可见的 Provider Key。
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className={ui.bottomGrid}>
        <div className={cn(ui.surface, ui.panel)}>
          <div className={ui.panelTitle}>
            <h2 className={ui.panelTitleH2}>注入时机</h2>
            <Badge tone="green">会话锁定</Badge>
          </div>
          <p className={ui.inlineNote}>
            创建会话时选择凭据并锁定版本。运行中不读取最新密钥；轮换后需新建会话生效。
          </p>
        </div>
        <div className={cn(ui.surface, ui.panel)}>
          <div className={ui.panelTitle}>
            <h2 className={ui.panelTitleH2}>安全边界</h2>
            <span className={ui.badge}>密文</span>
          </div>
          <p className={ui.inlineNote}>
            密钥经 Facade 注入运行时，不回传浏览器。审计仅记录凭据 ID 与版本，不含明文。
          </p>
        </div>
      </div>
    </>
  );
}
