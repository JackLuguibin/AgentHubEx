import { Badge, Banner, Button, PageHeader, cn, ui, Icon } from "@agenthub/hub-ui-kit";
import { Info, ArrowUpRight } from "lucide-react";

const EVENTS = [
  {
    time: "今天 14:22",
    actor: "Jack Lu",
    action: "session.create",
    target: "AH-21 · 接入远程 OpenCode",
    result: "成功",
  },
  {
    time: "今天 13:05",
    actor: "Sarah Chen",
    action: "credential.rotate",
    target: "cred-1 · 团队 Anthropic",
    result: "成功",
  },
  {
    time: "昨天 18:40",
    actor: "Alex Wang",
    action: "config.publish",
    target: "Bundle v1.12",
    result: "成功",
  },
  {
    time: "昨天 16:12",
    actor: "system",
    action: "instance.health",
    target: "oc-staging-03",
    result: "失败",
  },
];

export function AuditPage() {
  return (
    <>
      <PageHeader
        eyebrow="项目配置"
        title="审计日志"
        description="记录关键操作元数据；不含消息正文与密钥明文。"
        actions={
          <Button variant="secondary" disabled title="P1">
            <Icon icon={ArrowUpRight} size="sm" />
            导出
          </Button>
        }
      />

      <Banner icon={Info}>
        审计覆盖会话生命周期、凭据变更、配置发布与成员角色调整。会话正文默认不可见。
      </Banner>

      <div className={cn(ui.surface, ui.tableWrap)}>
        <table className={ui.dataTable}>
          <thead>
            <tr>
              <th>时间</th>
              <th>操作者</th>
              <th>动作</th>
              <th>对象</th>
              <th>结果</th>
            </tr>
          </thead>
          <tbody>
            {EVENTS.map((e) => (
              <tr key={`${e.time}-${e.action}-${e.target}`}>
                <td>{e.time}</td>
                <td>
                  <strong>{e.actor}</strong>
                </td>
                <td>
                  <code className={ui.monoChip}>{e.action}</code>
                </td>
                <td>{e.target}</td>
                <td>
                  <Badge tone={e.result === "成功" ? "green" : "red"}>{e.result}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
