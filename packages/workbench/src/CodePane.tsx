import { useMemo } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { Button, Icon, cn, ui } from "@agenthub/hub-ui-kit";
import { FileCode2 } from "lucide-react";
import { lineDiff, tabDirty, type EditorMode, type EditorTab } from "./model.js";

export function CodePane({
  filesOn,
  tabs,
  activePath,
  mode,
  busy,
  onMode,
  onSelect,
  onClose,
  onChange,
  onSave,
  onAttach,
  onCopy,
}: {
  filesOn: boolean;
  tabs: EditorTab[];
  activePath: string | null;
  mode: EditorMode;
  busy: boolean;
  onMode: (mode: EditorMode) => void;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
  onChange: (path: string, draft: string) => void;
  onSave: (path: string) => void;
  onAttach: (path: string) => void;
  onCopy: (path: string) => void;
}) {
  const active = tabs.find((tab) => tab.path === activePath) ?? null;
  const extensions = useMemo(() => languageOf(active?.path ?? ""), [active?.path]);
  const diff = active && mode === "diff" ? lineDiff(active.original, active.draft) : [];
  const dirty = active ? tabDirty(active) : false;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden" aria-label="工作空间文件预览">
      <div className="flex h-[42px] shrink-0 items-stretch overflow-auto border-b border-ah-line bg-[#fafbfc]" role="tablist" aria-label="已打开的文件">
        {tabs.length === 0 ? (
          <span className="px-3 py-3 text-[10px] text-[#98a2b3]">文件预览</span>
        ) : (
          tabs.map((tab) => {
            const name = tab.path.split("/").filter(Boolean).pop() ?? tab.path;
            const selected = tab.path === activePath;
            return (
              <div
                key={tab.path}
                className={cn(
                  "flex shrink-0 items-center gap-1 border-r border-ah-line border-t-2 border-t-transparent px-2 text-[10px] text-[#667085]",
                  selected && "border-t-ah-accent bg-white text-[#344054]",
                )}
              >
                <button type="button" role="tab" aria-selected={selected} className="cursor-pointer border-0 bg-transparent px-1 py-2 font-mono" onClick={() => onSelect(tab.path)}>
                  {name}
                  {tabDirty(tab) ? " *" : ""}
                </button>
                <button
                  type="button"
                  className="cursor-pointer border-0 bg-transparent px-1 text-[13px] text-[#98a2b3]"
                  aria-label={`关闭 ${name}`}
                  onClick={() => onClose(tab.path)}
                >
                  ×
                </button>
              </div>
            );
          })
        )}
      </div>

      {active ? (
        <>
          <div className="flex min-w-0 shrink-0 items-center justify-between gap-2 border-b border-[#f0f2f5] px-3 py-2 font-mono text-[9px] text-[#667085]">
            <span className="truncate" title={active.path}>
              {active.path}
            </span>
            <span className={ui.badge}>
              {active.zone === "common" ? "公共资料 · 只读" : dirty ? "已修改" : "个人文件"}
            </span>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-1 border-b border-[#f0f2f5] px-2 py-1.5">
            <div className="flex gap-1">
              {(
                [
                  ["code", "代码"],
                  ["diff", "差异"],
                  ["info", "文件信息"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={cn(
                    "cursor-pointer rounded border-0 bg-transparent px-1.5 py-1 text-[9px] text-[#667085]",
                    mode === id && "bg-ah-accent-soft text-ah-accent",
                  )}
                  onClick={() => onMode(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex gap-1">
              {active.editable ? (
                <Button size="sm" variant="secondary" disabled={busy || !dirty} onClick={() => onSave(active.path)}>
                  保存
                </Button>
              ) : null}
              <Button size="sm" variant="secondary" onClick={() => onAttach(active.path)}>
                引用到会话
              </Button>
              <Button size="sm" variant="secondary" onClick={() => onCopy(active.path)}>
                复制路径
              </Button>
            </div>
          </div>
          <div className="min-h-[220px] flex-1 overflow-auto">
            {mode === "code" ? (
              <CodeMirror
                value={active.draft}
                height="100%"
                extensions={extensions}
                editable={active.editable}
                readOnly={!active.editable}
                basicSetup={{ lineNumbers: true, foldGutter: false }}
                onChange={(value) => {
                  if (active.editable) onChange(active.path, value);
                }}
              />
            ) : null}
            {mode === "diff" ? <DiffList lines={diff} /> : null}
            {mode === "info" ? (
              <div className="px-3.5 py-4 text-[11px] leading-[1.8] text-[#475467]">
                <h3 className="m-0 text-[12px] font-medium text-[#344054]">{active.path.split("/").pop()}</h3>
                <p className="m-0">路径：{active.path}</p>
                <p className="m-0">归属：{active.zone === "common" ? "项目公共空间 · 只读" : "个人工作区"}</p>
                <p className="m-0">权限：{active.editable ? "可编辑并保存" : "只读"}</p>
                <p className="m-0">大小：{new Blob([active.draft]).size} bytes</p>
                <p className="m-0">行数：{active.draft.split("\n").length}</p>
              </div>
            ) : null}
          </div>
        </>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center px-5 py-8 text-center text-[11px] leading-[1.8] text-[#667085]">
          <Icon icon={FileCode2} />
          <h3 className="m-0 text-[13px] font-medium text-[#475467]">打开工作空间文件</h3>
          <p className="m-0">
            {filesOn
              ? "在左侧打开文件后，可以预览、查看差异，并编辑个人区文本。"
              : "当前运行实例没有文件能力，文件树已隐藏。"}
          </p>
        </div>
      )}
    </div>
  );
}

function DiffList({ lines }: { lines: ReturnType<typeof lineDiff> }) {
  const added = lines.filter((line) => line.kind === "add").length;
  const removed = lines.filter((line) => line.kind === "del").length;
  if (added === 0 && removed === 0) {
    return <p className="m-0 px-3.5 py-4 text-[11px] text-[#667085]">与打开时的内容一致。</p>;
  }
  return (
    <div className="px-2 py-3 font-mono text-[10px] leading-[1.6]">
      <p className="mb-2 px-1.5 text-[9px] text-[#667085]">
        相对打开时的内容 · +{added} −{removed}
      </p>
      {lines.map((line, index) => (
        <div
          key={`${line.kind}-${index}`}
          className={cn(
            "whitespace-pre-wrap px-1.5",
            line.kind === "add" && "bg-[#ecfdf3] text-[#067647]",
            line.kind === "del" && "bg-[#fef3f2] text-[#b42318]",
            line.kind === "same" && "text-[#98a2b3]",
          )}
        >
          {line.kind === "add" ? "+ " : line.kind === "del" ? "- " : "  "}
          {line.text || " "}
        </div>
      ))}
    </div>
  );
}

function languageOf(path: string) {
  if (/\.(tsx|jsx)$/.test(path)) return [javascript({ jsx: true, typescript: path.endsWith("tsx") })];
  if (/\.(ts|js|mjs|cjs)$/.test(path)) return [javascript({ typescript: path.endsWith(".ts") })];
  if (path.endsWith(".json")) return [json()];
  if (path.endsWith(".md")) return [markdown()];
  return [];
}
