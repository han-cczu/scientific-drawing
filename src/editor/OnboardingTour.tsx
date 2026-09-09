import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/*
 * ============================================================================
 * 分步操作引导（spotlight tour）
 * ============================================================================
 * 目标：
 *   1) 首次使用时按真实操作流程走一遍五区布局
 *   2) 用 data-tour 属性定位高亮目标，与 CSS 类解耦
 *   3) 目标元素缺失时退化为居中卡片，引导永不因布局变化而崩溃
 */

export type TourStep = {
  id: string;
  /** data-tour 选择器值；缺省为居中欢迎卡 */
  target?: string;
  title: string;
  body: string;
};

export const TOUR_STEPS: TourStep[] = [
  {
    id: "welcome",
    title: "欢迎使用 Scientific Drawing",
    body: "这是把论文截图 / 流程图转成可编辑矢量场景的工具，可再导出 SVG / PPTX。花约 1 分钟了解核心操作，随时可按 Esc 跳过。"
  },
  {
    id: "ai-vectorize",
    target: "ai-vectorize",
    title: "AI 矢量化",
    body: "把论文图拖到这里（或点击选择），AI 会重建出语义节点和连线。需要先配置 API Key——最后一步会告诉你在哪配。"
  },
  {
    id: "import",
    target: "import",
    title: "普通分析（无需 AI）",
    body: "不配置 AI 也能用：从这里导入图片做启发式分析，生成高保真锁定底图 + 可编辑辅助框，适合描摹微调。"
  },
  {
    id: "tools",
    target: "tools",
    title: "创作与选择工具",
    body: "文本 / 矩形 / 椭圆 / 线条 / 箭头：选中工具后点击画布即创建。「语义连线」依次点击两个节点；「局部 AI 重建」框选不满意的区域单独重建。"
  },
  {
    id: "canvas",
    target: "canvas",
    title: "画布操作",
    body: "拖拽移动、八向手柄缩放、空白处框选多选、Shift 点选增删、双击节点改文字；Ctrl+滚轮缩放，空格或鼠标中键拖拽平移。"
  },
  {
    id: "inspector",
    target: "inspector",
    title: "样式与排列",
    body: "右栏三个标签页：样式（填充 / 描边 / 虚线 / 快速样式预设）、属性（坐标 / 尺寸 / 文本）、排列（对齐 / 层级顺序）。"
  },
  {
    id: "export",
    target: "export",
    title: "导出成果",
    body: "SVG / PPTX / JSON 一键下载到本地；PPTX 里每个图形仍是可编辑对象。JSON 是 scene 协议文件，可重新导入继续编辑。"
  },
  {
    id: "settings",
    target: "settings",
    title: "AI 配置与本地保存",
    body: "点齿轮配置 API Key 即可启用 AI 重建（支持测试连接）。你的工作在每次修改后会自动保存到浏览器本地，左上角指示器显示保存状态。"
  }
];

type SpotlightRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

type OnboardingTourProps = {
  open: boolean;
  /** completed=true 表示走完全部步骤，false 表示中途跳过 */
  onClose: (completed: boolean) => void;
};

const SPOTLIGHT_PADDING = 6;
const CARD_WIDTH = 340;
const CARD_ESTIMATED_HEIGHT = 200;
const CARD_GAP = 12;

export function OnboardingTour({ open, onClose }: OnboardingTourProps) {
  /*
   * ========================================================================
   * 步骤1：维护引导状态与目标测量
   * ========================================================================
   * 目标：
   *   1) 打开时从第一步开始，步骤切换/窗口缩放时重新测量目标
   *   2) 卡片优先放在目标下方，空间不足时上移，水平方向夹紧到视口内
   */

  // 1.1 步骤与测量状态
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<SpotlightRect | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = useRef<Element | null>(null);

  const step = TOUR_STEPS[Math.min(stepIndex, TOUR_STEPS.length - 1)];
  const isLast = stepIndex === TOUR_STEPS.length - 1;

  // 1.2 打开时复位到第一步并记录焦点还原目标
  useEffect(() => {
    if (open) {
      setStepIndex(0);
      restoreFocusRef.current = document.activeElement;
    }
  }, [open]);

  // 1.3 测量目标元素（步骤切换 / 窗口缩放时重算；目标缺失退化为居中卡）
  //   依赖用 stepIndex 而非 step.target：相邻步骤若复用同一目标也要重测
  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    const measure = () => {
      const target = TOUR_STEPS[Math.min(stepIndex, TOUR_STEPS.length - 1)].target;
      if (!target) {
        setRect(null);
        return;
      }
      const element = document.querySelector(`[data-tour="${target}"]`);
      if (!element) {
        setRect(null);
        return;
      }
      const box = element.getBoundingClientRect();
      setRect({
        top: box.top - SPOTLIGHT_PADDING,
        left: box.left - SPOTLIGHT_PADDING,
        width: box.width + SPOTLIGHT_PADDING * 2,
        height: box.height + SPOTLIGHT_PADDING * 2
      });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [open, stepIndex]);

  // 1.4 焦点管理：步骤切换时聚焦卡片，关闭时还原
  useEffect(() => {
    if (open) {
      cardRef.current?.focus();
    }
  }, [open, stepIndex]);

  const finish = useCallback((completed: boolean) => {
    onClose(completed);
    const restoreTarget = restoreFocusRef.current;
    if (restoreTarget instanceof HTMLElement) {
      restoreTarget.focus?.();
    }
  }, [onClose]);

  const goNext = useCallback(() => {
    if (isLast) {
      finish(true);
    } else {
      setStepIndex((current) => current + 1);
    }
  }, [isLast, finish]);

  const goPrev = useCallback(() => {
    setStepIndex((current) => Math.max(0, current - 1));
  }, []);

  // 1.5 键盘导航：Esc 跳过，←/→ 翻页，Tab 在卡片内循环（焦点陷阱——
  //   遮罩只拦截指针不拦截焦点，不困住 Tab 的话用户可聚焦背景按钮并用
  //   Enter 在遮罩后面误触导出/设置等操作）
  useEffect(() => {
    if (!open) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        finish(false);
        return;
      }
      if (event.key === "Tab") {
        const card = cardRef.current;
        if (!card) {
          return;
        }
        const focusable = Array.from(
          card.querySelectorAll<HTMLElement>("button:not([disabled])")
        );
        if (focusable.length === 0) {
          event.preventDefault();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;
        // 焦点在卡片外（初始在卡片容器上）或越界时拉回循环两端
        if (!event.shiftKey && (active === last || !card.contains(active))) {
          event.preventDefault();
          first.focus();
        } else if (event.shiftKey && (active === first || !card.contains(active))) {
          event.preventDefault();
          last.focus();
        }
        return;
      }
      // 不监听 Enter：按钮聚焦时 Enter 已触发 click，再处理会双步前进
      if (event.key === "ArrowRight") {
        event.preventDefault();
        goNext();
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        goPrev();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, finish, goNext, goPrev]);

  if (!open) {
    return null;
  }

  /*
   * ========================================================================
   * 步骤2：计算卡片位置并渲染
   * ========================================================================
   */

  // 2.1 卡片定位：有目标时优先目标下方，空间不足上移；无目标时居中。
  //   水平/垂直都做钳制，且 Math.max 在外层——视口过小时上界会反转为负，
  //   外层 max 保证最低限度贴边而非被推出屏幕
  let cardStyle: React.CSSProperties;
  if (rect) {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const fitsBelow = rect.top + rect.height + CARD_GAP + CARD_ESTIMATED_HEIGHT <= viewportHeight;
    const rawTop = fitsBelow
      ? rect.top + rect.height + CARD_GAP
      : rect.top - CARD_GAP - CARD_ESTIMATED_HEIGHT;
    const top = Math.max(CARD_GAP, Math.min(rawTop, viewportHeight - CARD_ESTIMATED_HEIGHT - CARD_GAP));
    const left = Math.max(
      CARD_GAP,
      Math.min(rect.left + rect.width / 2 - CARD_WIDTH / 2, viewportWidth - CARD_WIDTH - CARD_GAP)
    );
    cardStyle = { top, left, width: CARD_WIDTH };
  } else {
    cardStyle = { top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: CARD_WIDTH };
  }

  return (
    <div className="tour-root" role="dialog" aria-modal="true" aria-label={`操作引导：${step.title}`}>
      {/* 2.2 遮罩：拦截一切交互；点击不关闭（误触会丢掉只弹一次的引导），
          退出只走「跳过引导」按钮或 Esc */}
      <div className={rect ? "tour-overlay" : "tour-overlay tour-overlay-dim"} />
      {rect ? (
        <div
          className="tour-spotlight"
          style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
        />
      ) : null}

      {/* 2.3 步骤卡片 */}
      <div className="tour-card" style={cardStyle} ref={cardRef} tabIndex={-1}>
        <div className="tour-card-step">
          {stepIndex + 1} / {TOUR_STEPS.length}
        </div>
        <div className="tour-card-title">{step.title}</div>
        <div className="tour-card-body">{step.body}</div>
        <div className="tour-dots" aria-hidden="true">
          {TOUR_STEPS.map((item, index) => (
            <span key={item.id} className={index === stepIndex ? "tour-dot active" : "tour-dot"} />
          ))}
        </div>
        <div className="tour-card-actions">
          <button type="button" className="tour-skip" onClick={() => finish(false)}>
            跳过引导
          </button>
          <div className="tour-card-actions-right">
            <button type="button" className="chip-btn" onClick={goPrev} disabled={stepIndex === 0}>
              上一步
            </button>
            <button type="button" className="chip-btn settings-save" onClick={goNext}>
              {isLast ? "开始使用" : "下一步"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
