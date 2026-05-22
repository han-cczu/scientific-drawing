import { Lock, Unlock } from "lucide-react";
import type { SceneNode, SceneStyle } from "../shared/scene";

type PropertiesTabProps = {
  node: SceneNode | null;
  onChange: (patch: Partial<SceneNode>) => void;
  onStyleChange: (patch: SceneStyle) => void;
};

export function PropertiesTab({ node, onChange, onStyleChange }: PropertiesTabProps) {
  if (!node) {
    return (
      <div className="props-tab">
        <div className="panel-title">属性</div>
        <div className="empty-state">未选择对象</div>
      </div>
    );
  }

  const hasText = node.type === "text" || node.text !== undefined;
  const hasFont = node.style.fontSize !== undefined || node.type === "text";

  return (
    <div className="props-tab">
      <div className="panel-title">属性</div>

      {/* 基础信息 */}
      <div className="props-section">
        <div className="props-section-title">基础信息</div>
        <div className="node-id">{node.type} · {node.id}</div>
        <button
          className="lock-toggle"
          type="button"
          onClick={() => onChange({ locked: !node.locked })}
        >
          {node.locked ? <Lock size={16} /> : <Unlock size={16} />}
          <span>{node.locked ? "已锁定" : "可编辑"}</span>
        </button>
      </div>

      {/* 文本 */}
      {hasText ? (
        <div className="props-section">
          <div className="props-section-title">文本</div>
          <label className="field">
            <textarea
              value={node.text ?? ""}
              onChange={(event) => onChange({ text: event.target.value })}
            />
          </label>
        </div>
      ) : null}

      {/* 位置与尺寸 */}
      <div className="props-section">
        <div className="props-section-title">位置与尺寸</div>
        <div className="grid-fields">
          <NumberField label="X" value={node.x} onChange={(value) => onChange({ x: value })} />
          <NumberField label="Y" value={node.y} onChange={(value) => onChange({ y: value })} />
          <NumberField label="W" value={node.w} onChange={(value) => onChange({ w: value })} />
          <NumberField label="H" value={node.h} onChange={(value) => onChange({ h: value })} />
        </div>
      </div>

      {/* 字体 */}
      {hasFont ? (
        <div className="props-section">
          <div className="props-section-title">字体</div>
          <div className="grid-fields">
            <NumberField
              label="字号"
              value={node.style.fontSize ?? 16}
              onChange={(value) => onStyleChange({ fontSize: value })}
            />
            <label className="field">
              <span>文字色</span>
              <input
                type="color"
                value={node.style.color ?? "#111111"}
                onChange={(event) => onStyleChange({ color: event.target.value })}
              />
            </label>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function NumberField({ label, value, onChange }: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    onChange(Number(event.target.value || 0));
  };

  return (
    <label className="field">
      <span>{label}</span>
      <input type="number" value={Math.round(value * 10) / 10} onChange={handleChange} />
    </label>
  );
}
