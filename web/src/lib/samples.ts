/**
 * 内置示例照片:全部是**普通人实拍、未经调色**的直出照片(手机 / 卡片机的夜市、家里、
 * 地铁、小餐馆、超市、公园…),而且**确实需要修图**(欠曝 / 灰雾 / 偏色 / 噪点 / 拍歪 / 构图空)。
 *
 * 筛选标准(不是随手找的图):
 *  - 有相机 EXIF(Model / ISO / 快门),且 EXIF 的 `Software` 不是修图软件
 *    (排除 Photoshop / Lightroom / GIMP / Snapseed / VSCO / 美图 等),即"直出未调色";
 *  - 每张都先跑一遍本项目的实测,确认它确实偏暗/偏色/发灰/歪,`issue` 文案照实测写。
 *
 * 图片随应用一起发布(`web/public/samples/`),同源加载 —— 不走外链、不受 CORS 限制,
 * 也不会把访客照片外传。
 *
 * 来源:Wikimedia Commons(CC0 / CC BY / CC BY-SA),需要署名 —— 每条都带
 * `credit` 与 `source`,画廊底部统一列出。
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
    id: 'subway',
    name: '地铁站台',
    issue: '站台荧光灯、黑场浮起、色彩发闷',
    file: '/samples/subway.jpg',
    thumb: '/samples/thumb/subway.jpg',
    credit: 'Chuoterminal 02 · CC BY 3.0',
    source: 'https://commons.wikimedia.org/wiki/File:Sapporo_subway_Shiroishi_station_platform_20160124_182646.jpg',
  },
  {
    id: 'dinner-table',
    name: '中餐圆桌',
    issue: '餐厅暖光偏色、黑场浮起',
    file: '/samples/dinner-table.jpg',
    thumb: '/samples/thumb/dinner-table.jpg',
    credit: 'Ralff Nestor Nacor · CC BY-SA 4.0',
    source:
      'https://commons.wikimedia.org/wiki/File:Chinese_Foods_in_Round_Table_(Xin_Tian_Di_Restaurant_in_Metro_Manila)_(1).jpg',
  },
  {
    id: 'supermarket',
    name: '超市货架',
    issue: '超市荧光灯、黑场浮起、画面发闷',
    file: '/samples/supermarket.jpg',
    thumb: '/samples/thumb/supermarket.jpg',
    credit: 'Bdx · CC0',
    source: 'https://commons.wikimedia.org/wiki/File:Rimi_supermarket_at_Kaunas_Mega_mall,_2025_aisle.jpg',
  },
  {
    id: 'rainy-street',
    name: '雨夜街头',
    issue: '黄昏街景、黑场浮起、整体偏色',
    file: '/samples/rainy-street.jpg',
    thumb: '/samples/thumb/rainy-street.jpg',
    credit: 'Soumyatapadar · CC BY 3.0',
    source: 'https://commons.wikimedia.org/wiki/File:Rain_Drenched_Cowboy_City_Street_(54902662).jpeg',
  },
  {
    id: 'diner-table',
    name: '小餐馆桌椅',
    issue: '随手拍歪了 → 自动摆正',
    file: '/samples/diner-table.jpg',
    thumb: '/samples/thumb/diner-table.jpg',
    credit: 'KatongLeoung · CC BY-SA 3.0',
    source:
      'https://commons.wikimedia.org/wiki/File:HK_Sheung_Wan_Tung_Kee_Restaurant_table_n_chairs_night_Nov-2013.JPG',
  },
  {
    id: 'street-food',
    name: '街头小吃摊',
    issue: '荧光灯下色彩寡淡、略欠曝',
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
    id: 'night-market',
    name: '庙街夜市',
    issue: '偏灰、黑场浮起、色彩发闷',
    file: '/samples/night-market.jpg',
    thumb: '/samples/thumb/night-market.jpg',
    credit: 'Marim68821 · CC BY-SA 3.0',
    source: 'https://commons.wikimedia.org/wiki/File:HK_Yau_Ma_Tei_Temple_Street_night_food_stall_Apr-2013.JPG',
  },
  {
    id: 'park-bench',
    name: '公园长椅',
    issue: '主体太小、大片空地 → 智能裁剪',
    file: '/samples/park-bench.jpg',
    thumb: '/samples/thumb/park-bench.jpg',
    credit: 'Thank you for visiting my page · CC BY 2.0',
    source: 'https://commons.wikimedia.org/wiki/File:Picnic_in_the_park._(15132797376).jpg',
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
]
