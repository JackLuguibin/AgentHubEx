import { Banner, PageHeader, cn, ui } from "@agenthub/hub-ui-kit";
import { Info } from "lucide-react";

export function PlaceholderPage({
  eyebrow = "管理面",
  title,
  description,
}: {
  eyebrow?: string;
  title: string;
  description: string;
}) {
  return (
    <>
      <PageHeader eyebrow={eyebrow} title={title} description={description} />
      <Banner icon={Info}>
        信息架构与视觉对齐 `.cursor/plans/html`；完整业务交互在后续阶段接入 API。
      </Banner>
      <div className={ui.grid2}>
        <div className={cn(ui.surface, ui.panel)}>
          <div className={ui.panelTitle}>
            <h2 className={ui.panelTitleH2}>页面骨架</h2>
            <span className={ui.badge}>设计对齐</span>
          </div>
          <p className={ui.inlineNote}>
            页头、说明条与卡片布局已按原型落地。侧栏三组导航与顶栏面包屑可随时切换上下文。
          </p>
          <div className={ui.metricBar}>
            <i className={ui.metricBarFill} style={{ width: "55%" }} />
          </div>
          <p className={ui.inlineNote}>P0：会话 Facade · P1：管理面完整页</p>
        </div>
        <div className={cn(ui.surface, ui.panel)}>
          <div className={ui.panelTitle}>
            <h2 className={ui.panelTitleH2}>下一步</h2>
          </div>
          <div className={ui.activityRow}>
            <span className={ui.engineLogo}>1</span>
            <span>
              <strong>打开工作台</strong> 验证流式对话
            </span>
          </div>
          <div className={ui.activityRow}>
            <span className={ui.engineLogo}>2</span>
            <span>
              <strong>对照原型</strong> 检查间距与主色
            </span>
          </div>
          <div className={ui.activityRow}>
            <span className={ui.engineLogo}>3</span>
            <span>
              <strong>P1</strong> 接入本页真实数据与表单
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
