// 图生图共享类型。使用方包括创作页主容器、源图上传面板与蒙版编辑交互。

/**
 * 浏览器本地的图生图输入文件。
 *
 * @property file 用户上传或从历史图转换得到的图片文件。
 * @property previewUrl 本地预览地址,由创建方负责在移除时 revoke。
 * @property sourceId 最近生成图的来源 id,用于点击最近列表时切换选中状态。
 */
export type EditImageFile = {
  file: File;
  previewUrl: string;
  sourceId?: string;
};

/**
 * 蒙版画笔点位。
 *
 * @property x 原图坐标系中的横坐标。
 * @property y 原图坐标系中的纵坐标。
 * @property size 画笔半径,单位为原图像素。
 */
export type MaskPoint = {
  x: number;
  y: number;
  size: number;
};
