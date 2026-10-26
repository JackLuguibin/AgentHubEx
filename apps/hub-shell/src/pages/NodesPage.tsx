import { Badge, Banner, Button, PageHeader, cn, ui, Icon } from "@agenthub/hub-ui-kit";
import { Info, Server } from "lucide-react";

const NODES = [
  {
    name: "node-toronto-01",
    location: "Toronto / CA",
    capacity: "8 vCPU · 16 GB",
    usage: "4 / 8",
    bar: 50,
    pool: "开发池",
  },
  {
    name: "node-frankfurt-02",
    location: "Frankfurt / DE",
    capacity: "16 vCPU · 32 GB",
    usage: "6 / 16",
    bar: 38,
    pool: "开发池",
  },
  {
    name: "node-singapore-03",
    location: "Singapore / SG",
    capacity: "8 vCPU · 16 GB",
    usage: "0 / 8",
    bar: 0,
    pool: "备用池",
  },
];

export function NodesPage() {
  return (
    <>
      <PageHeader
        eyebrow="项目配置"
        title="托管节点"
        description="以独立容器调度工作区，按节点池分配计算资源。"
        actions={<Badge tone="orange">Phase 2 · 设计预览</Badge>}
      />

      <Banner icon={Info}>
        首版使用远程 OpenCode 登记。以下为后续托管编排页面设计，尚未接入 Node Agent。
      </Banner>

      <div className={ui.grid3}>
        {NODES.map((n) => (
          <article key={n.name} className={cn(ui.surface, ui.assetCard)}>
            <div className={ui.assetCardTop}>
              <span className={ui.projectIcon}>
                <Icon icon={Server} size="sm" />
              </span>
              <span className={ui.badge}>规划资源</span>
            </div>
            <h3 className={ui.assetCardTitle}>{n.name}</h3>
            <p>
              {n.location}
              <br />
              {n.capacity}
            </p>
            <div className={ui.statTop}>
              工作区容量 <span>{n.usage}</span>
            </div>
            <div className={ui.metricBar}>
              <i style={{ width: `${n.bar}%` }} />
            </div>
            <div className={ui.cardFooter}>
              <span className={ui.badge}>{n.pool}</span>
              <Button size="sm" variant="secondary" disabled title="P2">
                查看调度设计
              </Button>
            </div>
          </article>
        ))}
      </div>

      <div className={cn(ui.surface, ui.panel)} style={{ marginTop: 22 }}>
        <div className={ui.panelTitle}>
          <h2 className={ui.panelTitleH2}>工作区隔离与调度</h2>
        </div>
        <div className={ui.stepper}>
          <span>① 校验成员与配额</span>
          <span>② 匹配节点池</span>
          <span>③ 启动隔离容器</span>
          <span>④ 挂载公共空间</span>
        </div>
      </div>
    </>
  );
}
