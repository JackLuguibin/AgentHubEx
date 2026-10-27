import { useState } from "react";
import { useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Badge, Banner, Button, PageHeader, cn, ui, Icon } from "@agenthub/hub-ui-kit";
import { ArrowUpRight, Info } from "lucide-react";
import { useTenant } from "../auth/TenantProvider.js";
import { api } from "../lib/api.js";
import { getApiErrorMessage } from "../lib/api-error.js";
import { useToast } from "../lib/toast.js";

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function metaText(meta: Record<string, unknown>) {
  const text = JSON.stringify(meta);
  if (text === "{}") return "—";
  return text.length > 160 ? `${text.slice(0, 160)}…` : text;
}

export function AuditPage() {
  const { projectId = "" } = useParams();
  const { tenantId } = useTenant();
  const { toast } = useToast();
  const [action, setAction] = useState("");
  const [applied, setApplied] = useState("");

  const query = useQuery({
    queryKey: ["audit", tenantId, projectId, applied],
    enabled: Boolean(tenantId && projectId),
    queryFn: () =>
      api.listAudit(tenantId!, {
        projectId,
        action: applied || undefined,
      }),
  });

  const exportLog = async () => {
    if (!tenantId) return;
    try {
      const text = await api.exportAudit(tenantId, {
        projectId,
        action: applied || undefined,
      });
      const blob = new Blob([text], { type: "application/x-ndjson" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "audit.ndjson";
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast(await getApiErrorMessage(err, "导出失败"));
    }
  };

  const rows = query.data?.items ?? [];

  return (
    <>
      <PageHeader
        eyebrow="项目配置"
        title="审计日志"
        description="记录关键操作元数据；不含消息正文与密钥明文。"
        actions={
          <Button variant="secondary" onClick={() => void exportLog()} disabled={rows.length === 0}>
            <Icon icon={ArrowUpRight} size="sm" />
            导出
          </Button>
        }
      />

      <Banner icon={Info}>
        这里只显示当前项目的记录。改角色、发布配置、同步公共文件之后会出现新的一行。
      </Banner>

      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setApplied(action.trim());
        }}
      >
        <input
          className={cn(ui.fieldControl, "max-w-xs")}
          value={action}
          placeholder="按动作筛选，例如 member"
          onChange={(event) => setAction(event.target.value)}
          aria-label="按动作筛选"
        />
        <Button type="submit" variant="secondary" size="sm">
          筛选
        </Button>
      </form>

      <div className={cn(ui.surface, ui.tableWrap)}>
        <table className={ui.dataTable}>
          <thead>
            <tr>
              <th>时间</th>
              <th>操作者</th>
              <th>动作</th>
              <th>对象</th>
              <th>附加信息</th>
            </tr>
          </thead>
          <tbody>
            {query.isLoading ? (
              <tr>
                <td colSpan={5} className={ui.empty}>
                  加载中…
                </td>
              </tr>
            ) : null}
            {!query.isLoading && query.isError ? (
              <tr>
                <td colSpan={5} className={ui.empty}>
                  审计记录暂时读不出来。
                </td>
              </tr>
            ) : null}
            {!query.isLoading && !query.isError && rows.length === 0 ? (
              <tr>
                <td colSpan={5} className={ui.empty}>
                  还没有审计记录。
                </td>
              </tr>
            ) : null}
            {rows.map((row) => (
              <tr key={`${row.id}-${row.at}`}>
                <td>{formatTime(row.at)}</td>
                <td>
                  <strong>{row.actorName || row.actorType}</strong>
                </td>
                <td>
                  <code className={ui.monoChip}>{row.action}</code>
                </td>
                <td>
                  {row.targetType}
                  {row.targetId ? <small>{row.targetId}</small> : null}
                </td>
                <td>
                  <Badge tone="default">{metaText(row.meta)}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
