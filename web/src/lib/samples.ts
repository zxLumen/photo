/**
 * 内置示例照片:都是**普通人实拍**(手机/卡片机的夜市、家里、菜场、酒店、公园…),
 * 而且**确实需要修图**(欠曝 / 灰雾 / 偏色 / 高光溢出 / 噪点 / 倾斜),用来让访客
 * 一键体验「AI 构图 + 自动修图」的前后差异。
 *
 * 图片随应用一起发布(`web/public/samples/`),同源加载 —— 不走外链、不受 CORS 限制,
 * 也不会把访客照片外传。
 *
 * 来源:Wikimedia Commons(CC0 / CC BY / CC BY-SA)+ 1 张 Unsplash。
 * CC BY / CC BY-SA 要求署名,故每条都带 `credit` 与 `source`,画廊底部统一列出。
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
  /** 署名:作者 · 许可证 */
  credit: string
  /** 原始页面(署名/溯源) */
  source: string
}

export const SAMPLE_PHOTOS: SamplePhoto[] = [
  {
    id: 'birthday',
    name: '烛光生日',
    issue: '烛光下严重欠曝、发灰',
    file: '/samples/birthday.jpg',
    thumb: '/samples/thumb/birthday.jpg',
    credit: 'Ardfern · CC BY-SA 4.0',
    source: 'https://commons.wikimedia.org/wiki/File:Birthday_cake_with_6_candles.JPG',
  },
  {
    id: 'night-market',
    name: '庙街夜市',
    issue: '偏灰、黑场浮起、色彩发闷',
    file: '/samples/night-market.jpg',
    thumb: '/samples/thumb/night-market.jpg',
    credit: 'Marim68821 · CC BY-SA 3.0',
    source: 'https://commons.wikimedia.org/wiki/File:HK_Yau_Ma_Tei_Temple_Street_night_food_stall_Apr-2013.JPG',
  },
  {
    id: 'street-food',
    name: '街头小吃摊',
    issue: '欠曝、荧光灯下色彩寡淡',
    file: '/samples/street-food.jpg',
    thumb: '/samples/thumb/street-food.jpg',
    credit: 'Kilroy238 · CC BY 3.0',
    source: 'https://commons.wikimedia.org/wiki/File:Gas_street_food_stall_can_make_almost_anything.JPG',
  },
  {
    id: 'vendor',
    name: '夜市摊主',
    issue: '夜市混合光、肤色需保护',
    file: '/samples/vendor.jpg',
    thumb: '/samples/thumb/vendor.jpg',
    credit: 'eazytraveler · CC BY 2.0',
    source: 'https://commons.wikimedia.org/wiki/File:Female_street_vendor_making_Coffin_Bread_at_Shilin_Night_Market.jpg',
  },
  {
    id: 'park-bench',
    name: '公园长椅',
    issue: '主体太小、大片空地,待智能裁剪',
    file: '/samples/park-bench.jpg',
    thumb: '/samples/thumb/park-bench.jpg',
    credit: 'Thank you for visiting my page · CC BY 2.0',
    source: 'https://commons.wikimedia.org/wiki/File:Picnic_in_the_park._(15132797376).jpg',
  },
  {
    id: 'hotel-room',
    name: '酒店房间',
    issue: '室内欠曝、混合光源',
    file: '/samples/hotel-room.jpg',
    thumb: '/samples/thumb/hotel-room.jpg',
    credit: 'Kleon3 · CC BY-SA 4.0',
    source: 'https://commons.wikimedia.org/wiki/File:Kruisherenhotel,_hotel_room_2.jpg',
  },
  {
    id: 'cat-sofa',
    name: '沙发上的猫',
    issue: '室内偏暗、暗部死黑、色彩寡淡',
    file: '/samples/cat-sofa.jpg',
    thumb: '/samples/thumb/cat-sofa.jpg',
    credit: 'Erik-Jan Leusink · CC0',
    source: 'https://commons.wikimedia.org/wiki/File:Cat_resting_on_a_couch_(Unsplash).jpg',
  },
  {
    id: 'cafe-table',
    name: '咖啡馆桌面',
    issue: '黑场浮起、画面发灰',
    file: '/samples/cafe-table.jpg',
    thumb: '/samples/thumb/cafe-table.jpg',
    credit: 'Bahnfrend · CC BY-SA 4.0',
    source: 'https://commons.wikimedia.org/wiki/File:Muffin,_Einsteins_Coffee_Murdoch_Square,_2025_(01).jpg',
  },
  {
    id: 'wet-market',
    name: '湿货菜场',
    issue: '略暗、有噪点、色彩平淡',
    file: '/samples/wet-market.jpg',
    thumb: '/samples/thumb/wet-market.jpg',
    credit: 'ProjectManhattan · CC BY-SA 3.0',
    source: 'https://commons.wikimedia.org/wiki/File:Vegetable_stall_at_wet_market.jpg',
  },
  {
    id: 'picnic',
    name: '公园野餐',
    issue: '树荫下欠曝、整体偏黄',
    file: '/samples/picnic.jpg',
    thumb: '/samples/thumb/picnic.jpg',
    credit: 'Mænsard vokser · CC BY-SA 4.0',
    source: 'https://commons.wikimedia.org/wiki/File:People_having_a_picnic_under_the_trees_of_park_Parco_del_Lura_in_Saronno,_Italy_2015-05-10.JPG',
  },
  {
    id: 'autumn-trail',
    name: '秋日山径',
    issue: '手机高感噪点、欠曝发灰',
    file: '/samples/autumn-trail.jpg',
    thumb: '/samples/thumb/autumn-trail.jpg',
    credit: 'Tony Webster · CC BY-SA 2.0',
    source: 'https://commons.wikimedia.org/wiki/File:Autumn_on_the_Oberg_Mountain_Hiking_Trail_Loop,_Minnesota_(36723570944).jpg',
  },
  {
    id: 'balcony',
    name: '阳台一角',
    issue: '黑场浮起、高光略溢、画面杂乱待裁剪',
    file: '/samples/balcony.jpg',
    thumb: '/samples/thumb/balcony.jpg',
    credit: 'Roy Googin · CC BY-SA 3.0',
    source: 'https://commons.wikimedia.org/wiki/File:Terrace_Garden_East-57th-St_New_York.jpg',
  },
  {
    id: 'old-town',
    name: '老城街道',
    issue: '阴影压死、画面杂乱待裁剪',
    file: '/samples/old-town.jpg',
    thumb: '/samples/thumb/old-town.jpg',
    credit: 'Rajesh Dhungana · CC BY-SA 4.0',
    source: 'https://commons.wikimedia.org/wiki/File:Rudrayani_Temple_Khokana_Lalitpur_Nepal_Rajesh_Dhungana_(2).jpg',
  },
  {
    id: 'beach',
    name: '海滩人群',
    issue: '灰雾、反差低、黑场浮起',
    file: '/samples/beach.jpg',
    thumb: '/samples/thumb/beach.jpg',
    credit: 'Estrategy · CC BY-SA 3.0',
    source: 'https://commons.wikimedia.org/wiki/File:Hermosa_beach_summer_day.jpg',
  },
  {
    id: 'lake',
    name: '湖面倒影',
    issue: '地平线倾斜,需自动摆正',
    file: '/samples/lake.jpg',
    thumb: '/samples/thumb/lake.jpg',
    credit: 'Unsplash',
    source: 'https://images.unsplash.com/photo-1439066615861-d1af74d74000',
  },
]
