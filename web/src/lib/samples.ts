/**
 * 内置示例照片:题材各异、且**确实需要修图**(欠曝 / 灰雾 / 偏色 / 高光溢出 / 噪点),
 * 用来让访客一键体验「AI 构图 + 自动修图」的前后差异。
 *
 * 图片随应用一起发布(`web/public/samples/`),同源加载 —— 不走外链、不受 CORS 限制,
 * 也不会把访客照片外传。来源为 Unsplash(Unsplash License,免费商用,无需署名)。
 */
export interface SamplePhoto {
  id: string
  /** 一句话题材 */
  name: string
  /** 这张图「哪里有毛病」,与修图效果对照 */
  issue: string
  /** 整图(用于载入编辑) */
  file: string
  /** 缩略图(画廊用) */
  thumb: string
}

export const SAMPLE_PHOTOS: SamplePhoto[] = [
  { id: 'sunset', name: '落日星芒', issue: '逆光、高光溢出、暗部压死', file: '/samples/sunset.jpg', thumb: '/samples/thumb/sunset.jpg' },
  { id: 'forest', name: '林地小径', issue: '低对比、偏冷、氛围发闷', file: '/samples/forest.jpg', thumb: '/samples/thumb/forest.jpg' },
  { id: 'lake', name: '湖面倒影', issue: '地平线倾斜、需智能摆正 + 发灰', file: '/samples/lake.jpg', thumb: '/samples/thumb/lake.jpg' },
  { id: 'city-night', name: '城市夜色', issue: '夜景噪点、白平衡偏色', file: '/samples/city-night.jpg', thumb: '/samples/thumb/city-night.jpg' },
  { id: 'milkyway', name: '银河山峰', issue: '极暗、噪点重、暗部死黑', file: '/samples/milkyway.jpg', thumb: '/samples/thumb/milkyway.jpg' },
  { id: 'portrait', name: '人物肖像', issue: '肤色发灰、高光需保护', file: '/samples/portrait.jpg', thumb: '/samples/thumb/portrait.jpg' },
]
