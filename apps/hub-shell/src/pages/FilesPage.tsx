import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CommonEntry } from "@agenthub/domain";
import { Banner, Button, EmptyState, Field, Icon, Input, PageHeader, cn, ui } from "@agenthub/hub-ui-kit";
import { Folder, HardDrive, Plus, RefreshCw } from "lucide-react";
import { useAuth } from "../auth/AuthProvider.js";
import { useTenant } from "../auth/TenantProvider.js";
import { Modal } from "../components/Modal.js";
import { api } from "../lib/api.js";
import { getApiErrorMessage } from "../lib/api-error.js";
import { useToast } from "../lib/toast.js";

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function isTextMime(mime: string) {
  return (
    mime.startsWith("text/") ||
    mime.includes("json") ||
    mime.includes("yaml") ||
    mime.includes("xml") ||
    mime.includes("javascript")
  );
}

export function FilesPage() {
  const { projectId = "" } = useParams();
  const { projects } = useTenant();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const project = projects.find((item) => item.id === projectId) ?? null;
  const tenantRole = user?.tenants.find((item) => item.id === project?.tenantId)?.role;
  const uploadRef = useRef<HTMLInputElement>(null);
  const [prefix, setPrefix] = useState("");
  const [query, setQuery] = useState("");
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [historyPath, setHistoryPath] = useState<string | null>(null);
  const [composer, setComposer] = useState<"dir" | "file" | null>(null);
  const [draftPath, setDraftPath] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [prefixText, setPrefixText] = useState("");
  const [quotaText, setQuotaText] = useState("");

  const treeQuery = useQuery({
    queryKey: ["common-tree", projectId, prefix],
    enabled: Boolean(projectId),
    queryFn: () => api.getCommonTree(projectId, prefix, 1),
  });
  const rootQuery = useQuery({
    queryKey: ["common-tree", projectId, ""],
    enabled: Boolean(projectId) && prefix !== "",
    queryFn: () => api.getCommonTree(projectId, "", 1),
  });
  const searchQuery = useQuery({
    queryKey: ["common-search", projectId, query],
    enabled: Boolean(projectId) && query.trim().length > 0,
    queryFn: () => api.searchCommonFiles(projectId, query.trim()),
  });
  const previewQuery = useQuery({
    queryKey: ["common-file", projectId, previewPath],
    enabled: Boolean(previewPath),
    queryFn: () => api.readCommonFile(projectId, previewPath!),
  });
  const versionsQuery = useQuery({
    queryKey: ["common-versions", projectId, historyPath],
    enabled: Boolean(historyPath),
    queryFn: () => api.listCommonVersions(projectId, historyPath!),
  });

  const tree = treeQuery.data;
  const folders = (prefix === "" ? tree?.entries : rootQuery.data?.entries)?.filter((entry) => entry.isDir) ?? [];
  const rows = query.trim() ? (searchQuery.data?.items ?? []) : (tree?.entries ?? []);
  const canWrite = tree?.canWrite ?? false;
  const canProtect = tree?.canWriteProtected ?? false;
  const hereProtected = Boolean(
    prefix && tree?.protectedPrefixes.some((item) => prefix === item || prefix.startsWith(`${item}/`)),
  );
  const writeHere = canWrite && (!hereProtected || canProtect);

  useEffect(() => {
    if (!tree || settingsOpen) return;
    setPrefixText(tree.protectedPrefixes.join("\n"));
    setQuotaText(String(tree.quotaBytes));
  }, [tree, settingsOpen]);

  function refresh() {
    return queryClient.invalidateQueries({ queryKey: ["common-tree", projectId] });
  }

  async function fail(err: unknown, fallback: string) {
    toast(await getApiErrorMessage(err, fallback));
  }

  const upload = useMutation({
    mutationFn: (files: File[]) => api.uploadCommonFiles(projectId, files, prefix),
    onSuccess: async (result) => {
      toast(`已上传 ${result.entries.length} 个文件`);
      await refresh();
    },
    onError: (err) => void fail(err, "上传失败"),
  });
  const sync = useMutation({
    mutationFn: async () => {
      const workspace = await api.getWorkspaceMe(projectId);
      return api.syncCommon(workspace.id);
    },
    onSuccess: (job) => {
      if (job.status === "skipped") toast("工作区里的公共文件已经是最新");
      else if (job.status === "running") toast("已交给同步代理写入工作区");
      else if (job.status === "succeeded") toast("已同步到工作区的 project-common，且为只读");
      else toast(job.error || "同步未完成");
    },
    onError: (err) => void fail(err, "同步失败"),
  });
  const createDir = useMutation({
    mutationFn: (path: string) => api.createCommonDir(projectId, path),
    onSuccess: async () => {
      setComposer(null);
      toast("文件夹已创建");
      await refresh();
    },
    onError: (err) => void fail(err, "创建文件夹失败"),
  });
  const createFile = useMutation({
    mutationFn: () => api.putCommonText(projectId, draftPath.trim(), draftBody, "text/markdown"),
    onSuccess: async () => {
      setComposer(null);
      toast("文本已保存");
      await refresh();
    },
    onError: (err) => void fail(err, "保存失败"),
  });
  const remove = useMutation({
    mutationFn: (path: string) => api.deleteCommonFile(projectId, path),
    onSuccess: async () => {
      toast("已删除");
      await refresh();
    },
    onError: (err) => void fail(err, "删除失败"),
  });
  const restore = useMutation({
    mutationFn: (version: number) => api.restoreCommonVersion(projectId, historyPath!, version),
    onSuccess: async () => {
      toast("已恢复为新版本");
      await refresh();
      await queryClient.invalidateQueries({ queryKey: ["common-versions", projectId, historyPath] });
    },
    onError: (err) => void fail(err, "恢复失败"),
  });
  const saveSettings = useMutation({
    mutationFn: () =>
      api.putCommonSettings(projectId, {
        protectedPrefixes: prefixText
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
        quotaBytes: Number(quotaText),
      }),
    onSuccess: async () => {
      setSettingsOpen(false);
      toast("公共空间设置已保存");
      await refresh();
    },
    onError: (err) => void fail(err, "保存设置失败"),
  });

  const crumbs = prefix ? prefix.split("/") : [];
  const used = tree?.usedBytes ?? 0;
  const quota = tree?.quotaBytes ?? 1;
  const canSync =
    Boolean(user?.isPlatformAdmin) ||
    tenantRole === "owner" ||
    tenantRole === "admin" ||
    project?.myRole === "owner" ||
    project?.myRole === "developer";

  return (
    <>
      <PageHeader
        eyebrow="工作空间"
        title="项目公共文件"
        description="团队共享的规范与资料。同步后出现在每个人工作区的 project-common，Agent 不能改那里。"
        actions={
          <>
            <Button
              variant="secondary"
              disabled={!canSync || sync.isPending}
              onClick={() => sync.mutate()}
            >
              <Icon icon={RefreshCw} size="sm" />
              同步到我的工作区
            </Button>
            <Button disabled={!writeHere || upload.isPending} onClick={() => uploadRef.current?.click()}>
              <Icon icon={Plus} size="sm" />
              上传文件
            </Button>
            <input
              ref={uploadRef}
              type="file"
              multiple
              hidden
              onChange={(event) => {
                const files = [...(event.target.files ?? [])];
                event.target.value = "";
                if (files.length > 0) upload.mutate(files);
              }}
            />
          </>
        }
      />

      <Banner icon={HardDrive}>
        个人挂载目录 <code>/workspace/project-common/</code> · 只读
        {tree ? ` · ${formatBytes(used)} / ${formatBytes(quota)}` : ""}
      </Banner>

      <div className={ui.bottomGrid}>
        <div className={cn(ui.surface, ui.panel)}>
          <div className={ui.panelTitle}>
            <h2 className={ui.panelTitleH2}>存储空间</h2>
            <span className={ui.phase}>
              {formatBytes(used)} / {formatBytes(quota)}
            </span>
          </div>
          <div className={ui.metricBar}>
            <i className={ui.metricBarFill} style={{ width: `${Math.min(100, (used / quota) * 100)}%` }} />
          </div>
          <p className={ui.inlineNote}>文件保存在项目公共空间；个人工作区中的修改不会自动写回公共区。</p>
        </div>
        <div className={cn(ui.surface, ui.panel)}>
          <div className={ui.panelTitle}>
            <h2 className={ui.panelTitleH2}>同步策略</h2>
            <span className={ui.badge}>{tree?.syncPolicy ?? "on_workspace_start"}</span>
          </div>
          <p className={ui.inlineNote}>
            当前策略 {tree?.syncPolicy ?? "on_workspace_start"}。点「同步到我的工作区」会把公共文件写进只读目录。
            {tree?.protectedPrefixes.length
              ? ` ${tree.protectedPrefixes.join("、")} 为受保护前缀，只有 owner 能改。`
              : " 还没有受保护前缀。"}
          </p>
          {canProtect ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setPrefixText(tree?.protectedPrefixes.join("\n") ?? "");
                setQuotaText(String(tree?.quotaBytes ?? ""));
                setSettingsOpen(true);
              }}
            >
              编辑保护前缀
            </Button>
          ) : null}
        </div>
      </div>

      <div className={cn(ui.surface, ui.fileBrowser)}>
        <aside className={ui.fileTree} aria-label="目录">
          <div className="mx-1.5 mb-2 mt-0.5 text-[9px] tracking-[0.8px] text-[#98a2b3]">目录</div>
          <button
            type="button"
            className={cn(ui.fileTreeBtn, prefix === "" && ui.fileTreeBtnActive)}
            onClick={() => setPrefix("")}
          >
            <Icon icon={Folder} size="sm" />
            全部
          </button>
          {folders.map((folder) => (
            <button
              key={folder.path}
              type="button"
              className={cn(ui.fileTreeBtn, (prefix === folder.path || prefix.startsWith(`${folder.path}/`)) && ui.fileTreeBtnActive)}
              onClick={() => setPrefix(folder.path)}
            >
              <Icon icon={Folder} size="sm" />
              {folder.name}
              {folder.protected ? <small>受保护</small> : null}
            </button>
          ))}
        </aside>
        <div>
          <div className={cn(ui.toolbar, ui.fileToolbar)}>
            <div className={ui.breadcrumb}>
              <button type="button" onClick={() => setPrefix("")}>
                project-common
              </button>
              {crumbs.map((part, index) => {
                const next = crumbs.slice(0, index + 1).join("/");
                return (
                  <span key={next}>
                    <span>/</span>
                    <button type="button" onClick={() => setPrefix(next)}>
                      <strong>{part}</strong>
                    </button>
                  </span>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Input
                variant="filter"
                value={query}
                placeholder="搜索文件名"
                onChange={(event) => setQuery(event.target.value)}
              />
              <Button
                size="sm"
                variant="secondary"
                disabled={!writeHere}
                onClick={() => {
                  setDraftPath(prefix ? `${prefix}/` : "");
                  setComposer("dir");
                }}
              >
                <Icon icon={Plus} size="sm" />
                新建文件夹
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={!writeHere}
                onClick={() => {
                  setDraftPath(prefix ? `${prefix}/` : "");
                  setDraftBody("");
                  setComposer("file");
                }}
              >
                <Icon icon={Plus} size="sm" />
                新建文本
              </Button>
            </div>
          </div>
          {treeQuery.isLoading ? <p className={ui.inlineNote}>正在加载文件…</p> : null}
          {treeQuery.isError ? <p className={ui.inlineNote}>文件列表加载失败。</p> : null}
          {!treeQuery.isLoading && rows.length === 0 ? (
            <EmptyState>这个目录还没有文件。可以上传，或新建一份文本。</EmptyState>
          ) : (
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
                  {rows.map((entry) => (
                    <FileRow
                      key={entry.path}
                      entry={entry}
                      canChange={canWrite && (!entry.protected || canProtect)}
                      onOpen={() => (entry.isDir ? setPrefix(entry.path) : setPreviewPath(entry.path))}
                      onPreview={() => setPreviewPath(entry.path)}
                      onHistory={() => setHistoryPath(entry.path)}
                      onDelete={() => {
                        if (window.confirm(`删除 ${entry.path}？`)) remove.mutate(entry.path);
                      }}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <Modal
        open={previewPath != null}
        title={previewPath ?? "预览"}
        onClose={() => setPreviewPath(null)}
        wide
      >
        {previewQuery.isLoading ? <p>正在读取…</p> : null}
        {previewQuery.data?.text != null ? (
          <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap text-[12px] leading-relaxed">
            {previewQuery.data.text}
          </pre>
        ) : null}
        {previewQuery.data && previewQuery.data.text == null ? (
          <p className={ui.inlineNote}>
            这是 {previewQuery.data.mime}，请下载后查看。
            {previewQuery.data.blob ? (
              <a
                className="ml-2 text-ah-accent"
                href={URL.createObjectURL(previewQuery.data.blob)}
                download={previewPath?.split("/").at(-1)}
              >
                下载
              </a>
            ) : null}
          </p>
        ) : null}
        {previewQuery.isError ? <p>无法预览这个文件。</p> : null}
      </Modal>

      <Modal open={historyPath != null} title="历史版本" onClose={() => setHistoryPath(null)}>
        <ul className="space-y-2 text-[12px]">
          {(versionsQuery.data?.versions ?? []).map((version) => (
            <li key={version.version} className="flex items-center justify-between gap-3">
              <span>
                v{version.version} · {formatBytes(version.size)}
              </span>
              {canWrite ? (
                <Button size="sm" variant="secondary" onClick={() => restore.mutate(version.version)}>
                  恢复
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </Modal>

      <Modal
        open={composer != null}
        title={composer === "dir" ? "新建文件夹" : "新建文本"}
        onClose={() => setComposer(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setComposer(null)}>
              取消
            </Button>
            <Button
              disabled={composer === "dir" ? createDir.isPending : createFile.isPending}
              onClick={() => {
                if (composer === "dir") createDir.mutate(draftPath.trim());
                else createFile.mutate();
              }}
            >
              保存
            </Button>
          </>
        }
      >
        <Field label="路径" hint="例如 docs/spec.md，不能包含 ..">
          <Input variant="field" value={draftPath} onChange={(event) => setDraftPath(event.target.value)} />
        </Field>
        {composer === "file" ? (
          <Field label="内容">
            <textarea
              className={ui.fieldControl}
              rows={8}
              value={draftBody}
              onChange={(event) => setDraftBody(event.target.value)}
            />
          </Field>
        ) : null}
      </Modal>

      <Modal
        open={settingsOpen}
        title="受保护前缀"
        onClose={() => setSettingsOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setSettingsOpen(false)}>
              取消
            </Button>
            <Button disabled={saveSettings.isPending} onClick={() => saveSettings.mutate()}>
              保存
            </Button>
          </>
        }
      >
        <Field label="前缀" hint="每行一个，例如 docs。这些路径只有 owner 能改。">
          <textarea
            className={ui.fieldControl}
            rows={5}
            value={prefixText}
            onChange={(event) => setPrefixText(event.target.value)}
          />
        </Field>
        <Field label="配额（字节）">
          <Input variant="field" value={quotaText} onChange={(event) => setQuotaText(event.target.value)} />
        </Field>
      </Modal>
    </>
  );
}

function FileRow({
  entry,
  canChange,
  onOpen,
  onPreview,
  onHistory,
  onDelete,
}: {
  entry: CommonEntry;
  canChange: boolean;
  onOpen: () => void;
  onPreview: () => void;
  onHistory: () => void;
  onDelete: () => void;
}) {
  const kind = entry.isDir ? "文件夹" : entry.mime && isTextMime(entry.mime) ? "文本" : "文件";
  return (
    <tr>
      <td>
        <button type="button" onClick={onOpen}>
          <strong>{entry.name}</strong>
        </button>
        <small>
          {kind}
          {entry.protected ? " · 受保护" : ""}
        </small>
      </td>
      <td>{entry.isDir ? "—" : formatBytes(entry.size)}</td>
      <td>{entry.isDir ? "—" : `v${entry.version}`}</td>
      <td className={ui.tableActions}>
        {entry.isDir ? (
          <Button size="sm" variant="secondary" onClick={onOpen}>
            打开
          </Button>
        ) : (
          <>
            <Button size="sm" variant="secondary" onClick={onPreview}>
              预览
            </Button>
            <Button size="sm" variant="secondary" onClick={onHistory}>
              历史
            </Button>
          </>
        )}
        {canChange ? (
          <Button size="sm" variant="danger" onClick={onDelete}>
            删除
          </Button>
        ) : null}
      </td>
    </tr>
  );
}
