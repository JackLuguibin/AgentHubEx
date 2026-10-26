import { useState } from "react";
import { Badge, Banner, Button, PageHeader, cn, ui, Icon } from "@agenthub/hub-ui-kit";
import { Folder, HardDrive, Plus, RefreshCw } from "lucide-react";

const FOLDERS = ["docs", "templates", "fixtures"] as const;

const FILES = [
  {
    name: "architecture.md",
    folder: "docs",
    size: "18.4 KB",
    version: 8,
    protected: true,
  },
  {
    name: "api-reference.md",
    folder: "docs",
    size: "32.1 KB",
    version: 3,
  },
  {
    name: "product-brief.md",
    folder: "docs",
    size: "8.6 KB",
    version: 2,
  },
  {
    name: "issue-template.md",
    folder: "templates",
    size: "1.2 KB",
    version: 1,
  },
  {
    name: "sample.json",
    folder: "fixtures",
    size: "2.4 KB",
    version: 1,
  },
];

export function FilesPage() {
  const [folder, setFolder] = useState<(typeof FOLDERS)[number]>("docs");
  const list = FILES.filter((f) => f.folder === folder);

  return (
    <>
      <PageHeader
        eyebrow="工作空间"
        title="项目公共文件"
        description="团队共享的规范与资料，在每个人的工作区中只读使用。"
        actions={
          <>
            <Button variant="secondary" disabled title="P1">
              <Icon icon={RefreshCw} size="sm" />
              同步到我的工作区
            </Button>
            <Button disabled title="P1">
              <Icon icon={Plus} size="sm" />
              上传文件
            </Button>
          </>
        }
      />

      <Banner
        icon={HardDrive}
        trailing={<Badge tone="green">revision 14</Badge>}
      >
        个人挂载目录 <code>/workspace/project-common/</code> · 只读
      </Banner>

      <div className={cn(ui.bottomGrid, ui.bottomGrid)}>
        <div className={cn(ui.surface, ui.panel)}>
          <div className={ui.panelTitle}>
            <h2 className={ui.panelTitleH2}>存储空间</h2>
            <span className={ui.phase}>62.7 KB / 5 GB</span>
          </div>
          <div className={ui.metricBar}>
            <i className={ui.metricBarFill} style={{ width: "2%" }} />
          </div>
          <p className={ui.inlineNote}>
            文件保存在项目公共空间；个人工作区中的修改不会自动写回公共区。
          </p>
        </div>
        <div className={cn(ui.surface, ui.panel)}>
          <div className={ui.panelTitle}>
            <h2 className={ui.panelTitleH2}>同步策略</h2>
            <span className={ui.badge}>on_workspace_start</span>
          </div>
          <p className={ui.inlineNote}>工作区启动时同步，也可手动同步。docs/ 为受保护前缀。</p>
        </div>
      </div>

      <div className={cn(ui.surface, ui.fileBrowser)}>
        <aside className={ui.fileTree} aria-label="目录">
          <div className="mx-1.5 mb-2 mt-0.5 text-[9px] tracking-[0.8px] text-[#98a2b3]">目录</div>
          {FOLDERS.map((f) => (
            <button
              key={f}
              type="button"
              className={cn(ui.fileTreeBtn, folder === f && ui.fileTreeBtnActive)}
              onClick={() => setFolder(f)}
            >
              
              {f === "docs" ? <small>受保护</small> : null}
            </button>
          ))}
        </aside>
        <div>
          <div className={cn(ui.toolbar, ui.fileToolbar)}>
            <div className={ui.breadcrumb}>
              <span>project-common</span>
              <span>/</span>
              <strong>{folder}</strong>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" variant="secondary" disabled title="P1">
                <Icon icon={Plus} size="sm" />
                新建文件夹
              </Button>
              <Button size="sm" variant="secondary" disabled title="P1">
                <Icon icon={Plus} size="sm" />
                新建文本
              </Button>
            </div>
          </div>
          <div className={ui.tableWrap}>
            <table className={ui.dataTable}>
              <thead>
                <tr>
                  <th>文件名</th>
                  <th>大小</th>
                  <th>版本</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {list.map((f) => (
                  <tr key={f.name}>
                    <td>
                      <strong>{f.name}</strong>
                      <small>
                        {f.protected ? "Markdown · 受保护" : "文件"}
                      </small>
                    </td>
                    <td>{f.size}</td>
                    <td>v{f.version}</td>
                    <td className={ui.tableActions}>
                      <Button size="sm" variant="secondary" disabled title="P1">
                        预览
                      </Button>
                      <Button size="sm" variant="secondary" disabled title="P1">
                        历史
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
