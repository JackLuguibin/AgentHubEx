import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  ArrowUpRight,
  Check,
  Command,
  FileStack,
  Hammer,
  Info,
  LayoutGrid,
  Plus,
  Search,
  Sparkles,
  Zap,
} from "lucide-react";
import {
  Badge,
  Banner,
  Button,
  Field,
  Icon,
  PageHeader,
  Select,
  Tabs,
  cn,
  ui,
} from "@agenthub/hub-ui-kit";

const TABS = ["Agent", "MCP", "Skill", "AGENTS.md", "权限与模型", "下发记录"] as const;
type Tab = (typeof TABS)[number];

const ASSETS: Record<
  "Agent" | "MCP" | "Skill",
  Array<{ icon: LucideIcon; name: string; desc: string; meta: string; scope: string }>
> = {
  Agent: [
    {
      icon: Command,
      name: "Build Agent",
      desc: "实现功能、修改代码并运行检查。",
      meta: "primary · 双引擎映射",
      scope: "项目配置",
    },
    {
      icon: Sparkles,
      name: "Plan Agent",
      desc: "分解需求并生成可执行计划。",
      meta: "read-only · 项目默认",
      scope: "项目配置",
    },
    {
      icon: Check,
      name: "Review Agent",
      desc: "检查变更中的缺陷与边界问题。",
      meta: "read-only · 按需调用",
      scope: "租户继承",
    },
  ],
  MCP: [
    {
      icon: Zap,
      name: "GitHub",
      desc: "remote · https://api.githubcopilot.com/mcp/",
      meta: "secretRef: vault:github",
      scope: "项目配置",
    },
    {
      icon: FileStack,
      name: "Project Docs",
      desc: "local · filesystem · project-common",
      meta: "只读挂载",
      scope: "项目配置",
    },
    {
      icon: Search,
      name: "Web Search",
      desc: "remote · https://search.example/mcp",
      meta: "secretRef: projectCredential:search",
      scope: "租户继承",
    },
  ],
  Skill: [
    {
      icon: LayoutGrid,
      name: "API Conventions",
      desc: "统一端点命名、错误码与请求校验。",
      meta: "SKILL.md · 项目范围",
      scope: "项目配置",
    },
    {
      icon: Command,
      name: "Frontend Guidelines",
      desc: "React、shadcn/ui 与 Tailwind 开发约定。",
      meta: "SKILL.md · 项目范围",
      scope: "项目配置",
    },
    {
      icon: Check,
      name: "Isolation Test",
      desc: "验证跨租户与跨用户的访问边界。",
      meta: "SKILL.md · 租户继承",
      scope: "租户继承",
    },
  ],
};

const INSTRUCTIONS = `# Project instructions

- Follow the project API conventions.
- Never write to /workspace/project-common.
- Keep workspace and session data scoped to the owner.
- Ask the session owner before running privileged tools.`;

export function ConfigPage() {
  const [tab, setTab] = useState<Tab>("Agent");
  const assetTab = tab === "Agent" || tab === "MCP" || tab === "Skill" ? tab : null;

  return (
    <>
      <PageHeader
        eyebrow="工作空间"
        title="配置中心"
        description="一份项目标准，应用到每一个独立工作区。"
        actions={
          <>
            <Button variant="secondary" disabled title="P1">
              合并预览
            </Button>
            <Button disabled title="P1">
              发布与下发
            </Button>
          </>
        }
      />

      <div className={cn(ui.surface, ui.projectStrip)}>
        <span className={ui.projectIcon}>
          <Icon icon={Hammer} size="sm" />
        </span>
        <div>
          <strong>agenthubex-default</strong>
          <small>租户基础配置 → 项目 Bundle → 个人 Overlay</small>
        </div>
        <span className={ui.projectStripMeta}>
          <Badge tone="green">v1.12</Badge>
          <Badge tone="green">已发布</Badge>
        </span>
        <span className={ui.divider} />
        <Button size="sm" variant="secondary" disabled title="P1">
          版本历史
        </Button>
      </div>

      <Tabs
        aria-label="配置分类"
        value={tab}
        onChange={setTab}
        items={TABS.map((t) => ({ value: t, label: t }))}
      />

      {assetTab ? (
        <>
          <div className={ui.toolbar}>
            <span className={ui.inlineNote}>
              {assetTab === "MCP"
                ? "已启用 3 个工具服务 · secret 仅使用引用"
                : assetTab === "Skill"
                  ? "3 项可复用技能 · 上传目录或在线编辑"
                  : "3 个项目 Agent · 继承租户标准"}
            </span>
            <Button size="sm" variant="secondary" disabled title="P1">
              <Icon icon={Plus} size="sm" />
              新建 {assetTab}
            </Button>
          </div>
          <div className={ui.grid3}>
            {ASSETS[assetTab].map((a) => (
              <article key={a.name} className={cn(ui.surface, ui.assetCard)}>
                <div className={ui.assetCardTop}>
                  <span className={ui.projectIcon}>
                    <Icon icon={a.icon} size="sm" />
                  </span>
                  <Badge tone="green">已启用</Badge>
                </div>
                <h3 className={ui.assetCardTitle}>{a.name}</h3>
                <p>{a.desc}</p>
                <span className={ui.phase}>{a.meta}</span>
                <div className={ui.cardFooter}>
                  <span className={ui.badge}>{a.scope}</span>
                  <Button size="sm" variant="secondary" disabled title="P1">
                    编辑
                    <Icon icon={ArrowUpRight} size="xs" />
                  </Button>
                </div>
              </article>
            ))}
          </div>
        </>
      ) : null}

      {tab === "AGENTS.md" ? (
        <div className={cn(ui.surface, ui.panel)}>
          <div className={ui.panelTitle}>
            <h2 className={ui.panelTitleH2}>AGENTS.md</h2>
            <Button size="sm" variant="secondary" disabled title="P1">
              保存草稿
            </Button>
          </div>
          <label className={ui.field}>
            <span className={ui.srOnly}>项目指令</span>
            <textarea
              className={ui.codeArea}
              spellCheck={false}
              defaultValue={INSTRUCTIONS}
              readOnly
            />
          </label>
          <p className={ui.inlineNote}>
            发布后写入个人工作区根目录；项目强制规则不会被个人 Overlay 覆盖。
          </p>
        </div>
      ) : null}

      {tab === "权限与模型" ? (
        <div className={cn(ui.surface, ui.settingsSection)}>
          <h2 className={ui.settingsSectionH2}>项目默认策略</h2>
          <p>项目配置中的 deny 优先于个人覆盖。</p>
          <div className={ui.formGrid}>
            <Field label="默认模型">
              <Select variant="field" disabled defaultValue="sonnet">
                <option value="sonnet">Claude Sonnet</option>
                <option value="gpt">GPT</option>
              </Select>
            </Field>
            <Field label="默认 Agent">
              <Select variant="field" disabled defaultValue="plan">
                <option value="plan">Plan Agent</option>
                <option value="build">Build Agent</option>
              </Select>
            </Field>
          </div>
          <div className={ui.settingRow}>
            <div>
              <strong>锁定 MCP 列表</strong>
              <small>个人 Overlay 不可添加未批准的 MCP</small>
            </div>
            <input type="checkbox" className="h-5 w-9 accent-ah-accent" checked disabled readOnly aria-label="锁定 MCP 列表" />
          </div>
          <div className={ui.settingRow}>
            <div>
              <strong>特权工具执行前请求授权</strong>
              <small>权限请求仅发送至当前会话所有者</small>
            </div>
            <input type="checkbox" className="h-5 w-9 accent-ah-accent" checked disabled readOnly aria-label="特权工具授权" />
          </div>
        </div>
      ) : null}

      {tab === "下发记录" ? (
        <div className={cn(ui.surface, ui.tableWrap)}>
          <table className={ui.dataTable}>
            <thead>
              <tr>
                <th>任务</th>
                <th>版本</th>
                <th>目标</th>
                <th>状态</th>
                <th>校验</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>AP-104</td>
                <td>v1.12</td>
                <td>我的个人工作区</td>
                <td>
                  <Badge tone="green">成功</Badge>
                </td>
                <td>Agent / MCP / Skill 已验证</td>
              </tr>
              <tr>
                <td>AP-103</td>
                <td>v1.11</td>
                <td>oc-staging-03</td>
                <td>
                  <Badge tone="red">失败</Badge>
                </td>
                <td>agenthub-sync 未连接</td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : null}

      <Banner icon={Info} className="mt-[22px]">
        发布流程：解析作用域 → 生成文件与配置 → API / 文件下发 → 可见性校验。失败的工作区需修复后才能继续。
      </Banner>
    </>
  );
}
