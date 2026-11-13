"use client";

import { BaseBoxShapeUtil, HTMLContainer, T, type TLResizeInfo } from "tldraw";
import { BLOCK_KINDS, BLOCK_META, FORMA_BLOCK_TYPE } from "@/lib/canvas/kinds";
import { FormaBlockCard, type FormaBlockShape } from "@/lib/canvas/forma-block-view";

export class FormaBlockShapeUtil extends BaseBoxShapeUtil<FormaBlockShape> {
  static override type = FORMA_BLOCK_TYPE;
  static override props = {
    w: T.number,
    h: T.number,
    kind: T.literalEnum(...BLOCK_KINDS),
    title: T.string,
    description: T.string,
  };

  override getDefaultProps(): FormaBlockShape["props"] {
    return {
      w: 248,
      h: 132,
      kind: "note",
      title: BLOCK_META.note.defaultTitle,
      description: "",
    };
  }

  override canEdit() {
    return false;
  }

  override isAspectRatioLocked() {
    return false;
  }

  override onResize(shape: FormaBlockShape, info: TLResizeInfo<FormaBlockShape>) {
    const resized = super.onResize(shape, info);
    const next = resized?.props;
    if (!next) return resized;
    return {
      ...resized,
      props: {
        ...next,
        w: Math.max(200, next.w),
        h: Math.max(108, next.h),
      },
    };
  }

  override component(shape: FormaBlockShape) {
    return (
      <HTMLContainer>
        <FormaBlockCard shape={shape} />
      </HTMLContainer>
    );
  }

  override getIndicatorPath(shape: FormaBlockShape) {
    const path = new Path2D();
    path.roundRect(0, 0, shape.props.w, shape.props.h, 12);
    return path;
  }
}
