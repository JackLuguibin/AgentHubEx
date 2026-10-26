/** Shared Tailwind class recipes — single source of visual truth (no .css modules). */
export const ui = {
  surface: "rounded-[9px] border border-ah-line bg-white shadow-ah",
  banner:
    "flex flex-wrap items-center gap-2.5 rounded-[7px] border border-[#dce5fc] bg-[#f0f4ff] px-3.5 py-2.5 text-[10px] leading-[1.7] text-[#48618d]",
  badge:
    "inline-flex items-center gap-1 whitespace-nowrap rounded px-[7px] py-1 text-[9px] bg-[#f2f4f7] text-[#475467]",
  badgeGreen: "bg-ah-green-soft text-ah-green",
  badgeRed: "bg-[#fef3f2] text-[#b42318]",
  badgeOrange: "bg-[#fffaeb] text-[#b54708]",
  badgePurple: "bg-[#f3eff7] text-[#7955a5]",
  badgeLive: "bg-ah-accent-soft text-ah-accent",
  empty: "px-6 py-16 text-center leading-[2] text-[#91a094]",
  pageHead: "flex flex-wrap items-start justify-between gap-3",
  pageHeadTitle:
    "m-0 mb-1.5 text-[23px] font-[650] tracking-[-0.7px] text-ah-text",
  pageHeadDesc: "m-0 text-[11px] leading-[1.7] text-ah-muted",
  pageHeadActions: "flex flex-wrap items-center gap-2",
  eyebrow: "m-0 mb-1.5 text-[9px] tracking-[1.8px] text-[#92a093]",
  stats: "grid grid-cols-2 gap-3 min-[1101px]:grid-cols-4",
  stat: "rounded-[9px] border border-ah-line bg-white px-[15px] py-3 shadow-ah",
  statTop: "flex justify-between text-[10px] text-[#667085]",
  statValue:
    "my-1 flex items-center gap-2.5 text-[25px] font-semibold tracking-[-1px] text-[#182230]",
  statValueSmall:
    "rounded bg-ah-green-soft px-1.5 py-[3px] text-[10px] font-normal tracking-normal text-ah-green",
  statNote: "text-[10px] text-[#9aa29d]",
  tableWrap: "overflow-auto",
  dataTable:
    "w-full border-collapse text-left text-[11px] [&_th]:whitespace-nowrap [&_th]:border-b [&_th]:border-ah-line [&_th]:bg-[#f9fafb] [&_th]:px-[18px] [&_th]:py-[13px] [&_th]:font-medium [&_th]:text-[#667085] [&_td]:border-b [&_td]:border-[#eef1ed] [&_td]:px-[18px] [&_td]:py-[17px] [&_td]:leading-[1.6] [&_td]:text-[#77857b] [&_tr:last-child_td]:border-0 [&_tr:hover_td]:bg-[#fafbfe] [&_td_strong]:font-[550] [&_td_strong]:text-[#344054] [&_td_small]:mt-0.5 [&_td_small]:block [&_td_small]:text-[9px] [&_td_small]:text-[#9da79e]",
  tableActions: "flex flex-wrap items-center gap-1.5 [&_button]:my-0.5 [&_button]:px-2 [&_button]:py-[5px] [&_button]:text-[10px]",
  panel: "p-3.5 px-4",
  panelTitle: "mb-2.5 flex items-center justify-between",
  panelTitleH2: "m-0 text-xs font-semibold text-[#344054]",
  textLink: "text-[10px] text-[#8d9a90] no-underline hover:text-ah-accent",
  inlineNote: "my-2 text-[10px] leading-[1.7] text-[#94a197]",
  metricBar: "mt-3 h-[7px] overflow-hidden rounded-[5px] bg-[#e9edf5]",
  metricBarFill: "block h-full rounded-[5px] bg-[#6b83e9]",
  grid2: "grid min-w-0 grid-cols-1 gap-[18px] min-[1101px]:grid-cols-[1.25fr_1fr] [&>*]:min-w-0",
  grid3: "grid min-w-0 grid-cols-1 gap-3 min-[681px]:grid-cols-2 min-[1101px]:grid-cols-3 [&>*]:min-w-0",
  bottomGrid:
    "mt-[18px] grid min-w-0 grid-cols-1 gap-3 min-[1101px]:grid-cols-[1.25fr_1fr] [&>*]:min-w-0",
  tabs: "flex flex-wrap gap-5 overflow-auto border-b border-ah-line",
  tab: "cursor-pointer border-0 border-b-2 border-transparent bg-transparent px-0.5 py-2 text-[11px] whitespace-nowrap text-[#667085]",
  tabActive: "border-ah-accent font-semibold text-ah-accent",
  toolbar: "mb-3.5 flex flex-wrap items-center justify-between gap-2.5",
  filters: "ml-auto flex flex-wrap items-center gap-2",
  searchInput:
    "w-[180px] rounded-md border border-[#d0d5dd] bg-white px-2.5 py-[7px] text-[11px] text-[#344054]",
  select:
    "max-w-[140px] rounded-md border border-[#d0d5dd] bg-white px-2.5 py-[7px] text-[11px] text-[#344054]",
  viewToggle: "inline-flex gap-0.5 rounded-[7px] border border-[#e1e6ee] bg-[#e9edf3] p-[3px]",
  viewToggleBtn:
    "inline-flex cursor-pointer items-center gap-1 rounded-[5px] border-0 bg-transparent px-[11px] py-[7px] text-[10px] text-[#667085]",
  viewToggleBtnActive: "bg-white font-[550] text-[#344054] shadow-[0_1px_2px_#1018280a]",
  boardGrid: "grid min-w-0 grid-cols-1 gap-3.5 min-[681px]:grid-cols-2 min-[1101px]:grid-cols-4",
  boardColumn: "min-h-[280px] rounded-[9px] border border-[#e4e7ec] bg-[#eef1f5] p-3",
  boardColumnHead: "mb-3.5 mt-[3px] ml-px flex items-center gap-[7px] text-[11px] font-semibold text-[#344054]",
  boardCount: "ml-0.5 text-[10px] font-normal text-[#667085]",
  boardDot: "inline-block h-1.5 w-1.5 rounded-full bg-[#12a16f]",
  boardDotGray: "bg-[#98a2b3]",
  boardDotOrange: "bg-[#eaa348]",
  boardDotPurple: "bg-[#9471db]",
  boardDotGreen: "bg-[#12a16f]",
  boardAdd:
    "w-full cursor-not-allowed border-0 bg-transparent px-1 py-2 text-left text-[10px] text-[#a0aaa1]",
  issue:
    "mb-2.5 cursor-default rounded-[7px] border border-[#e0e5ec] bg-white p-3.5 shadow-[0_1px_3px_#10182805] transition-[transform,border-color] hover:-translate-y-px hover:border-[#a4b4ed]",
  issueTop: "mb-[11px] flex items-center justify-between text-[9px] text-[#667085]",
  issueTitle: "m-0 mb-[9px] text-xs font-[550] leading-[1.7] text-[#263244]",
  issueDesc: "m-0 mb-[13px] text-[10px] leading-[1.8] text-[#667085]",
  labels: "flex flex-wrap gap-1",
  tag: "rounded-[3px] bg-[#f2f4f7] px-1.5 py-[3px] text-[9px] text-[#475467]",
  tagBlue: "bg-[#eff4ff] text-[#355ab3]",
  tagPurple: "bg-[#f3eff7] text-[#9a89af]",
  issueBottom:
    "mt-3.5 flex items-center gap-[7px] border-t border-[#edf0f4] pt-2.5 text-[9px] text-[#9aa49b]",
  issueSession:
    "mt-3 flex items-center gap-[5px] rounded bg-ah-green-soft px-[7px] py-2 text-[9px] text-ah-green",
  avatar:
    "inline-flex h-[27px] w-[27px] shrink-0 items-center justify-center rounded-full bg-[#eee] text-[9px] font-[650]",
  avatarGreen: "bg-[#e9efff] text-[#3659b8]",
  avatarBlue: "bg-[#e7f0ff] text-[#2463a8]",
  avatarPurple: "bg-[#f0eaff] text-[#7955a5]",
  avatarOrange: "bg-[#fff0e1] text-[#995a20]",
  avatarSmall: "h-[22px] w-[22px] text-[8px]",
  assetCard: "flex flex-col rounded-[9px] border border-ah-line bg-white p-[15px] shadow-ah",
  assetCardTop: "flex items-center justify-between",
  assetCardTitle: "my-1.5 mt-2.5 text-xs font-semibold text-[#182230]",
  assetCardDesc: "my-[7px] text-[10px] leading-[1.8] text-[#667085]",
  cardFooter:
    "mt-auto flex flex-wrap items-center justify-between gap-1.5 border-t border-ah-line pt-2.5",
  phase: "mb-3 overflow-wrap-anywhere text-[9px] text-[#a0aaa1]",
  projectStrip: "flex flex-wrap items-center gap-3 rounded-[9px] border border-ah-line bg-white px-4 py-3.5 shadow-ah",
  projectIcon:
    "grid h-[30px] w-[30px] place-items-center rounded-[7px] bg-ah-accent-soft text-sm text-[#4b60b4]",
  projectStripMeta: "ml-auto inline-flex flex-wrap gap-1.5",
  divider: "h-[22px] w-px bg-ah-line",
  managementGuidance:
    "flex flex-wrap items-center justify-between gap-3 rounded-[9px] border border-ah-line bg-white px-4 py-3.5 shadow-ah",
  managementCount: "text-[11px] text-[#667085]",
  roleGrid: "mt-[22px]",
  memberCell: "flex items-center gap-2.5",
  settingsSection: "mb-3.5 rounded-[9px] border border-ah-line bg-white px-[18px] py-4 shadow-ah",
  settingsSectionH2: "m-0 mb-1.5 text-xs font-semibold text-[#344054]",
  settingsSectionP: "m-0 mb-3.5 text-[10px] text-[#94a197]",
  formGrid: "grid grid-cols-1 gap-3 min-[681px]:grid-cols-2",
  field: "flex flex-col gap-1.5 text-[10px] text-[#667085]",
  fieldFull: "col-span-full",
  fieldControl:
    "rounded-md border border-[#d0d5dd] bg-white px-[11px] py-[9px] text-[11px] text-[#344054]",
  fieldTextarea: "min-h-24 resize-vertical",
  codeArea:
    "w-full min-h-[280px] resize-vertical rounded-md border border-[#d0d5dd] bg-white px-[11px] py-[9px] font-mono text-[11px] leading-[1.65] text-[#344054]",
  settingRow:
    "mt-3 flex items-center justify-between gap-4 border-t border-[#eef1ed] pt-3",
  fileBrowser:
    "mt-3.5 grid min-h-[360px] grid-cols-1 overflow-hidden rounded-[9px] border border-ah-line bg-white shadow-ah min-[681px]:grid-cols-[160px_minmax(0,1fr)]",
  fileTree:
    "flex flex-col gap-0.5 border-ah-line bg-[#fafbfc] p-2.5 px-2.5 min-[681px]:border-r max-[680px]:flex-row max-[680px]:flex-wrap max-[680px]:border-b",
  fileTreeBtn:
    "flex cursor-pointer flex-col items-start gap-0.5 rounded-md border-0 bg-transparent px-[9px] py-2 text-left text-[11px] text-[#475467]",
  fileTreeBtnActive: "bg-[#e9eeff] text-ah-accent",
  fileToolbar: "m-0 flex flex-wrap items-center justify-between gap-2.5 border-b border-ah-line px-4 py-3",
  breadcrumb: "flex flex-wrap items-center gap-1.5 text-[11px] text-[#667085]",
  stepper: "mt-2 flex flex-wrap gap-2.5",
  stepperStep: "rounded-full bg-[#f2f4f7] px-2.5 py-1.5 text-[10px] text-[#475467]",
  monoChip: "rounded bg-[#f2f4f7] px-1.5 py-[3px] font-mono text-[10px] text-[#344054]",
  srOnly: "sr-only",
  healthRow: "mt-3 flex items-center gap-2.5 text-[11px] text-[#475467]",
  engineLogo:
    "grid h-7 w-7 place-items-center rounded-md bg-ah-accent-soft font-mono text-xs text-[#4b60b4]",
  activityRow: "mt-3 flex items-center gap-[11px] text-[10px] text-[#929c94]",
  priority: "text-[9px] tracking-[0.4px] text-[#667085]",
  priorityP0: "text-[#b42318]",
  priorityP1: "text-[#b54708]",
} as const;

export type BadgeTone = "default" | "green" | "red" | "orange" | "purple" | "live";

export function badgeClass(tone: BadgeTone = "default") {
  const map = {
    default: "",
    green: ui.badgeGreen,
    red: ui.badgeRed,
    orange: ui.badgeOrange,
    purple: ui.badgePurple,
    live: ui.badgeLive,
  } as const;
  return `${ui.badge} ${map[tone]}`.trim();
}
