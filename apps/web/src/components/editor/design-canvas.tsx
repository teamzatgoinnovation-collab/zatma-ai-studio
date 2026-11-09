'use client';

import type Konva from 'konva';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  Ellipse,
  Group,
  Image as KImage,
  Layer,
  Line,
  Rect,
  Stage,
  Text,
  Transformer,
} from 'react-konva';
import type { DesignDocument, DesignLayer, ImageLayer, TextLayer } from '@zatma/validation';
import { fontStack } from './fonts';
import { containBox, coverCrop, snapAxis } from './geometry';

/** Loads an image for canvas use (CORS-enabled so exports are not tainted). */
function useCanvasImage(url: string | undefined): HTMLImageElement | null {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    const el = new window.Image();
    el.crossOrigin = 'anonymous';
    el.onload = () => alive && setImg(el);
    el.src = url;
    return () => {
      alive = false;
    };
  }, [url]);
  return url ? img : null;
}

export interface DesignCanvasHandle {
  /** Renders the document at native size (no selection or guides) to a data URL. */
  toDataURL(opts: {
    mimeType: 'image/png' | 'image/jpeg';
    quality?: number;
    targetWidth?: number;
  }): string;
}

interface Props {
  doc: DesignDocument;
  assets: Record<string, string>;
  scale: number;
  selectedId: string | null;
  showGrid: boolean;
  readOnly: boolean;
  /** Bumped after web fonts finish loading to force a redraw. */
  fontEpoch: number;
  onSelect: (id: string | null) => void;
  onChange: (id: string, patch: Partial<DesignLayer>) => void;
  onEditText: (
    layer: TextLayer,
    rect: { x: number; y: number; width: number; height: number },
  ) => void;
}

function BackgroundNode({ doc, assets }: { doc: DesignDocument; assets: Record<string, string> }) {
  const bg = doc.background;
  const img = useCanvasImage(bg.type === 'image' ? assets[bg.fileId] : undefined);
  if (bg.type === 'color')
    return (
      <Rect
        name="background"
        width={doc.width}
        height={doc.height}
        fill={bg.color}
        listening={false}
      />
    );
  if (bg.type === 'gradient') {
    const rad = ((bg.angle - 90) * Math.PI) / 180;
    const cx = doc.width / 2;
    const cy = doc.height / 2;
    const len = Math.abs(doc.width * Math.cos(rad)) / 2 + Math.abs(doc.height * Math.sin(rad)) / 2;
    return (
      <Rect
        name="background"
        width={doc.width}
        height={doc.height}
        listening={false}
        fillLinearGradientStartPoint={{ x: cx - Math.cos(rad) * len, y: cy - Math.sin(rad) * len }}
        fillLinearGradientEndPoint={{ x: cx + Math.cos(rad) * len, y: cy + Math.sin(rad) * len }}
        fillLinearGradientColorStops={[0, bg.from, 1, bg.to]}
      />
    );
  }
  const crop = img
    ? bg.fit === 'cover'
      ? coverCrop(img.width, img.height, doc.width, doc.height)
      : null
    : null;
  const box =
    img && bg.fit === 'contain' ? containBox(img.width, img.height, doc.width, doc.height) : null;
  return (
    <Group listening={false}>
      <Rect width={doc.width} height={doc.height} fill={bg.fallbackColor} />
      {img && crop && <KImage image={img} width={doc.width} height={doc.height} crop={crop} />}
      {img && box && <KImage image={img} {...box} />}
      {bg.overlay && (
        <Rect
          width={doc.width}
          height={doc.height}
          fill={bg.overlay.color}
          opacity={bg.overlay.opacity}
        />
      )}
    </Group>
  );
}

function ImageNode({ layer, url }: { layer: ImageLayer; url: string | undefined }) {
  const img = useCanvasImage(url);
  if (!img)
    return (
      <Rect
        width={layer.width}
        height={layer.height}
        fill="#94A3B8"
        opacity={0.25}
        cornerRadius={layer.cornerRadius}
      />
    );
  if (layer.fit === 'cover') {
    return (
      <KImage
        image={img}
        width={layer.width}
        height={layer.height}
        crop={coverCrop(img.width, img.height, layer.width, layer.height)}
        cornerRadius={layer.cornerRadius}
      />
    );
  }
  const box = containBox(img.width, img.height, layer.width, layer.height);
  return <KImage image={img} {...box} cornerRadius={layer.cornerRadius} />;
}

function TextNode({ layer }: { layer: TextLayer }) {
  const pad = layer.background?.padding ?? 0;
  return (
    <>
      {layer.background && (
        <Rect
          width={layer.width}
          height={layer.height}
          fill={layer.background.fill}
          cornerRadius={Math.min(layer.background.cornerRadius, layer.height / 2)}
        />
      )}
      <Text
        x={pad}
        y={pad}
        width={Math.max(1, layer.width - pad * 2)}
        height={layer.background ? Math.max(1, layer.height - pad * 2) : undefined}
        verticalAlign={layer.background ? 'middle' : 'top'}
        text={layer.text}
        fontFamily={fontStack(layer.fontFamily)}
        fontSize={layer.fontSize}
        fontStyle={String(layer.fontWeight)}
        fill={layer.fill}
        align={layer.align}
        lineHeight={layer.lineHeight}
        letterSpacing={layer.letterSpacing}
        direction={layer.direction === 'rtl' ? 'rtl' : 'ltr'}
        wrap="word"
      />
    </>
  );
}

export const DesignCanvas = forwardRef<DesignCanvasHandle, Props>(function DesignCanvas(
  { doc, assets, scale, selectedId, showGrid, readOnly, fontEpoch, onSelect, onChange, onEditText },
  ref,
) {
  const stageRef = useRef<Konva.Stage>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const [guides, setGuides] = useState<{ v: number | null; h: number | null }>({
    v: null,
    h: null,
  });

  useImperativeHandle(ref, () => ({
    toDataURL({ mimeType, quality, targetWidth }) {
      const stage = stageRef.current!;
      const ui = stage.find('.ui');
      ui.forEach((n) => n.hide());
      const url = stage.toDataURL({
        mimeType,
        quality,
        pixelRatio: (targetWidth ? targetWidth / doc.width : 1) / scale,
      });
      ui.forEach((n) => n.show());
      return url;
    },
  }));

  // Attach the transformer to the selected, unlocked node.
  useEffect(() => {
    const tr = trRef.current;
    const stage = stageRef.current;
    if (!tr || !stage) return;
    const layer = doc.layers.find((l) => l.id === selectedId);
    const node =
      layer && !layer.locked && layer.visible && !readOnly
        ? stage.findOne(`#layer-${selectedId}`)
        : null;
    tr.nodes(node ? [node] : []);
    tr.getLayer()?.batchDraw();
  }, [selectedId, doc, readOnly, fontEpoch]);

  const snapTargetsX = [0, doc.width / 2, doc.width];
  const snapTargetsY = [0, doc.height / 2, doc.height];
  const threshold = 8 / scale;

  const gridLines = [];
  if (showGrid) {
    const step = Math.round(Math.min(doc.width, doc.height) / 12);
    for (let x = step; x < doc.width; x += step)
      gridLines.push(
        <Line
          key={`gx${x}`}
          points={[x, 0, x, doc.height]}
          stroke="#6366F1"
          opacity={0.18}
          strokeWidth={1 / scale}
        />,
      );
    for (let y = step; y < doc.height; y += step)
      gridLines.push(
        <Line
          key={`gy${y}`}
          points={[0, y, doc.width, y]}
          stroke="#6366F1"
          opacity={0.18}
          strokeWidth={1 / scale}
        />,
      );
  }

  return (
    <div
      role="img"
      aria-label={`Design canvas, ${doc.width}×${doc.height}, ${doc.layers.length} layers`}
    >
      <Stage
        ref={stageRef}
        width={Math.round(doc.width * scale)}
        height={Math.round(doc.height * scale)}
        scaleX={scale}
        scaleY={scale}
        onMouseDown={(e) => {
          if (e.target === e.target.getStage() || e.target.name() === 'background') onSelect(null);
        }}
        onTouchStart={(e) => {
          if (e.target === e.target.getStage()) onSelect(null);
        }}
      >
        {/* Remounted when web fonts finish loading so Konva re-measures text with the real faces. */}
        <Layer key={fontEpoch}>
          <BackgroundNode doc={doc} assets={assets} />
          {/* Clickable empty area to deselect */}
          <Rect name="background" width={doc.width} height={doc.height} fill="transparent" />
          {doc.layers.map((layer) =>
            layer.visible ? (
              <Group
                key={layer.id}
                id={`layer-${layer.id}`}
                x={layer.x}
                y={layer.y}
                width={layer.width}
                height={layer.height}
                rotation={layer.rotation}
                opacity={layer.opacity}
                draggable={!readOnly && !layer.locked}
                onMouseDown={() => onSelect(layer.id)}
                onTap={() => onSelect(layer.id)}
                onDblClick={(e) => {
                  if (layer.type !== 'text' || readOnly || layer.locked) return;
                  const box = e.currentTarget.getClientRect();
                  onEditText(layer, box);
                }}
                onDblTap={(e) => {
                  if (layer.type !== 'text' || readOnly || layer.locked) return;
                  onEditText(layer, e.currentTarget.getClientRect());
                }}
                onDragMove={(e) => {
                  const node = e.target;
                  const sx = snapAxis(node.x(), layer.width, snapTargetsX, threshold);
                  const sy = snapAxis(node.y(), layer.height, snapTargetsY, threshold);
                  if (layer.rotation === 0) node.position({ x: sx.value, y: sy.value });
                  setGuides({ v: sx.guide, h: sy.guide });
                }}
                onDragEnd={(e) => {
                  setGuides({ v: null, h: null });
                  onChange(layer.id, { x: Math.round(e.target.x()), y: Math.round(e.target.y()) });
                }}
                onTransformEnd={(e) => {
                  const node = e.target;
                  const sx = node.scaleX();
                  const sy = node.scaleY();
                  node.scaleX(1);
                  node.scaleY(1);
                  onChange(layer.id, {
                    x: Math.round(node.x()),
                    y: Math.round(node.y()),
                    width: Math.max(8, Math.round(layer.width * sx)),
                    height: Math.max(8, Math.round(layer.height * sy)),
                    rotation: Math.round(node.rotation()),
                  });
                }}
              >
                {/* Hit area so empty parts of text boxes stay clickable */}
                <Rect width={layer.width} height={layer.height} fill="transparent" />
                {layer.type === 'text' && <TextNode layer={layer} />}
                {layer.type === 'image' && <ImageNode layer={layer} url={assets[layer.fileId]} />}
                {layer.type === 'shape' &&
                  (layer.shape === 'ellipse' ? (
                    <Ellipse
                      x={layer.width / 2}
                      y={layer.height / 2}
                      radiusX={layer.width / 2}
                      radiusY={layer.height / 2}
                      fill={layer.fill}
                      stroke={layer.stroke}
                      strokeWidth={layer.strokeWidth}
                    />
                  ) : (
                    <Rect
                      width={layer.width}
                      height={layer.height}
                      fill={layer.fill}
                      stroke={layer.stroke}
                      strokeWidth={layer.strokeWidth}
                      cornerRadius={layer.cornerRadius}
                    />
                  ))}
              </Group>
            ) : null,
          )}
          <Group name="ui" listening={false}>
            {gridLines}
            {guides.v !== null && (
              <Line
                points={[guides.v, 0, guides.v, doc.height]}
                stroke="#EC4899"
                strokeWidth={1.5 / scale}
                dash={[6 / scale, 4 / scale]}
              />
            )}
            {guides.h !== null && (
              <Line
                points={[0, guides.h, doc.width, guides.h]}
                stroke="#EC4899"
                strokeWidth={1.5 / scale}
                dash={[6 / scale, 4 / scale]}
              />
            )}
          </Group>
          <Transformer
            ref={trRef}
            name="ui"
            rotateEnabled
            keepRatio={false}
            anchorSize={10}
            borderStroke="#6366F1"
            anchorStroke="#6366F1"
            anchorCornerRadius={3}
            rotationSnaps={[0, 90, 180, 270]}
            boundBoxFunc={(oldBox, newBox) =>
              newBox.width < 8 || newBox.height < 8 ? oldBox : newBox
            }
          />
        </Layer>
      </Stage>
    </div>
  );
});
