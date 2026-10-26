import { Badge, Banner, Button, PageHeader, cn, ui, Icon } from "@agenthub/hub-ui-kit";
import { Circle, Info, Plus } from "lucide-react";

const INSTANCES = [
  {
    name: "oc-production-01",
    engine: "OpenCode",
    mode: "external",
    owner: "Jack Lu",
    health: "健康" as const,
    sync: true,
    latency: "42 ms",
  },
  {
    name: "oc-development-02",
    engine: "OpenCode",
    mode: "external",
    owner: "Alex Wang",
    health: "健康" as const,
    sync: true,
    latency: "68 ms",
  },
  {
    name: "oc-staging-03",
    engine: "OpenCode",
    mode: "external",
    owner: "Sarah Chen",
    health: "离线" as const,
    sync: false,
    latency: "—",
  },
];

export function InstancesPage() {
  return (
    <>
      <PageHeader
        eyebrow="工作空间"
        title="运行实例"
        description="集中登记与管理运行时，通过 Hub 安全连接你的个人工作区。"
        actions={
          <Button disabled title="P1">
            <Icon icon={Plus} size="sm" />
            登记远程实例
          </Button>
        }
      />

      <Banner icon={Info}>
        external 实例仅绑定一个成员工作区。节点地址与认证由控制平面保存，成员通过 Hub 访问。
      </Banner>

      <div className={cn(ui.surface, ui.tableWrap)}>
        <table className={ui.dataTable}>
          <thead>
            <tr>
              <th>实例 / 引擎</th>
              <th>模式</th>
              <th>工作区归属</th>
              <th>健康状态</th>
              <th>同步组件</th>
              <th>延迟</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {INSTANCES.map((r) => (
              <tr key={r.name}>
                <td>
                  <strong>{r.name}</strong>
                  <small>{r.engine}</small>
                </td>
                <td>
                  <span className={ui.badge}>{r.mode}</span>
                </td>
                <td>
                  {r.owner}
                  <small>独立工作区</small>
                </td>
                <td>
                  <Badge
                    tone={r.health === "健康" ? "green" : "red"}
                    className="inline-flex items-center gap-1"
                  >
                    <Icon icon={Circle} size="xs" className="fill-current" />
                    {r.health}
                  </Badge>
                </td>
                <td>
                  <Badge tone={r.sync ? "green" : "orange"}>
                    {r.sync ? "agenthub-sync 已连接" : "未连接"}
                  </Badge>
                </td>
                <td>{r.latency}</td>
                <td className={ui.tableActions}>
                  <Button size="sm" variant="secondary" disabled title="P1">
                    检测
                  </Button>
                  <Button size="sm" variant="secondary" disabled title="P1">
                    详情
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={ui.bottomGrid}>
        <div className={cn(ui.surface, ui.panel)}>
          <div className={ui.panelTitle}>
            <h2 className={ui.panelTitleH2}>项目实例绑定</h2>
            <span className={ui.badge}>OpenCode</span>
          </div>
          <p className={ui.inlineNote}>
            当前项目仅允许绑定已登记的 OpenCode 实例。会话创建前将验证成员归属、配置同步与公共文件状态。
          </p>
          <Button size="sm" variant="secondary" disabled title="P1">
            管理绑定
          </Button>
        </div>
        <div className={cn(ui.surface, ui.panel)}>
          <div className={ui.panelTitle}>
            <h2 className={ui.panelTitleH2}>双引擎演进</h2>
            <span className={ui.badge}>Phase 3</span>
          </div>
          <p className={ui.inlineNote}>
            Claude Agent SDK 与 OpenCode 共用会话契约。Claude 运行时将在第三阶段开放；首版沿用 OpenCode 工作台。
          </p>
        </div>
      </div>
    </>
  );
}
