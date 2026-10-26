import type { LucideIcon } from "lucide-react";
import {
  Boxes,
  Building2,
  ClipboardList,
  FileStack,
  FolderKanban,
  KeyRound,
  LayoutDashboard,
  LayoutGrid,
  Settings,
  Server,
  Shield,
  SquareTerminal,
  Users,
} from "lucide-react";

export type NavItem = {
  key: string;
  label: string;
  icon: LucideIcon;
  scope: "platform" | "project";
  phase?: string;
};

/** Aligns with .cursor/plans/html/app.js managementItems / navItems / adminItems */
export const managementNav: NavItem[] = [
  { key: "tenants", label: "租户管理", icon: Building2, scope: "platform" },
  { key: "projects", label: "项目管理", icon: FolderKanban, scope: "platform" },
];

export const workspaceNav: NavItem[] = [
  { key: "overview", label: "项目概览", icon: LayoutDashboard, scope: "project" },
  { key: "board", label: "项目看板", icon: LayoutGrid, scope: "project" },
  { key: "workbench", label: "我的工作台", icon: SquareTerminal, scope: "project" },
  { key: "instances", label: "运行实例", icon: Server, scope: "project" },
  { key: "config", label: "配置中心", icon: Boxes, scope: "project" },
  { key: "files", label: "公共文件", icon: FileStack, scope: "project" },
];

export const adminNav: NavItem[] = [
  { key: "members", label: "成员与角色", icon: Users, scope: "project" },
  { key: "credentials", label: "凭据管理", icon: KeyRound, scope: "project" },
  { key: "nodes", label: "托管节点", icon: Shield, scope: "project", phase: "P2" },
  { key: "audit", label: "审计日志", icon: ClipboardList, scope: "project" },
  { key: "settings", label: "项目设置", icon: Settings, scope: "project" },
];

export const crumbLabels: Record<string, string> = Object.fromEntries(
  [...managementNav, ...workspaceNav, ...adminNav].map((i) => [i.key, i.label]),
);
