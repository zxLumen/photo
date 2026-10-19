/**
 * 内置示例照片:**按「要修什么」分组**,每组 2~3 张,全部是普通人实拍、未经调色的直出照片。
 *
 * 筛选标准(不是随手找的):
 *  - 有相机 EXIF(Model / ISO / 快门),且 EXIF 的 `Software` 不是修图软件
 *    (排除 Photoshop / Lightroom / GIMP / Snapseed / VSCO / 美图 等),即"直出未调色";
 *  - 每张都先跑一遍本项目的实测(分位数 / 溢出 / 彩度 / 雾度 / 噪点 / 倾角),
 *    按结果分到对应组别,`issue` 文案照实测写。
 *
 * 图片随应用一起发布(`web/public/samples/`),同源加载 —— 不走外链、不受 CORS 限制,
 * 也不会把访客照片外传。
 *
 * 来源:Wikimedia Commons(CC0 / CC BY / CC BY-SA),需要署名 —— 每条都带
 * `credit` 与 `source`,画廊底部统一列出。
 */
export interface SampleGroup {
  id: string
  /** 组名,如「角度 · 拍歪了」 */
  label: string
  /** 一句话说明这组演示什么 */
  hint: string
}

export const SAMPLE_GROUPS: SampleGroup[] = [
  { id: 'angle', label: '角度 · 拍歪了', hint: '地平线/桌子/墙线歪了,自动摆正' },
  { id: 'color', label: '色彩 · 偏色', hint: '荧光灯、暖光把颜色带偏,自动纠正白平衡' },
  { id: 'exposure', label: '曝光 · 欠曝 / 偏亮', hint: '烛光下拍黑、阴天拍暗、逆光拍白' },
  { id: 'haze', label: '灰雾 · 不通透', hint: '阴天、雾天拍出来发灰,要压黑场、提反差' },
  { id: 'crop', label: '构图 · 主体太小', hint: '随手一拍主体太远、大片空地,智能裁剪' },
]

export interface SamplePhoto {
  id: string
  /** 所属分组(对应 SAMPLE_GROUPS.id) */
  group: string
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
  // ---------------- 角度 ----------------
  {
    id: 'diner-table',
    group: 'angle',
    name: '小餐馆桌椅',
    issue: '手持拍歪 7.4°',
    file: '/samples/diner-table.jpg',
    thumb: '/samples/thumb/diner-table.jpg',
    credit: 'KatongLeoung · CC BY-SA 3.0',
    source: 'https://commons.wikimedia.org/wiki/File:HK_Sheung_Wan_Tung_Kee_Restaurant_table_n_chairs_night_Nov-2013.JPG',
  },
  {
    id: 'hotel-tilt',
    group: 'angle',
    name: '酒店房间',
    issue: '手持拍歪 5.2°',
    file: '/samples/hotel-tilt.jpg',
    thumb: '/samples/thumb/hotel-tilt.jpg',
    credit: 'Bob Harvey · CC BY-SA 2.0',
    source: 'https://commons.wikimedia.org/wiki/File:A_cramped_hotel_room_-_geograph.org.uk_-_7604287.jpg',
  },
  {
    id: 'workspace',
    group: 'angle',
    name: '书桌工作区',
    issue: '拍歪 3.0°、偏暗',
    file: '/samples/workspace.jpg',
    thumb: '/samples/thumb/workspace.jpg',
    credit: 'Taylor Ramos · CC BY 2.0',
    source: 'https://commons.wikimedia.org/wiki/File:Workspace_2009.jpg',
  },

  // ---------------- 色彩 ----------------
  {
    id: 'subway',
    group: 'color',
    name: '地铁站台',
    issue: '荧光灯偏色、色彩发闷',
    file: '/samples/subway.jpg',
    thumb: '/samples/thumb/subway.jpg',
    credit: 'Chuoterminal 02 · CC BY 3.0',
    source: 'https://commons.wikimedia.org/wiki/File:Sapporo_subway_Shiroishi_station_platform_20160124_182646.jpg',
  },
  {
    id: 'corridor',
    group: 'color',
    name: '教室走廊',
    issue: '荧光灯偏暖、画面发闷',
    file: '/samples/corridor.jpg',
    thumb: '/samples/thumb/corridor.jpg',
    credit: 'Rajeev Kumar · CC BY-SA 4.0',
    source: 'https://commons.wikimedia.org/wiki/File:New_Class_Rooms_GF.JPG',
  },
  {
    id: 'dinner-table',
    group: 'color',
    name: '中餐圆桌',
    issue: '餐厅暖光把菜色带偏',
    file: '/samples/dinner-table.jpg',
    thumb: '/samples/thumb/dinner-table.jpg',
    credit: 'Ralff Nestor Nacor · CC BY-SA 4.0',
    source:
      'https://commons.wikimedia.org/wiki/File:Chinese_Foods_in_Round_Table_(Xin_Tian_Di_Restaurant_in_Metro_Manila)_(1).jpg',
  },

  // ---------------- 曝光 ----------------
  {
    id: 'birthday',
    group: 'exposure',
    name: '烛光生日',
    issue: '烛光下严重欠曝',
    file: '/samples/birthday.jpg',
    thumb: '/samples/thumb/birthday.jpg',
    credit: 'Ardfern · CC BY-SA 4.0',
    source: 'https://commons.wikimedia.org/wiki/File:Birthday_cake_with_6_candles.JPG',
  },
  {
    id: 'tram-stop',
    group: 'exposure',
    name: '阴天电车站',
    issue: '阴天欠曝、发灰',
    file: '/samples/tram-stop.jpg',
    thumb: '/samples/thumb/tram-stop.jpg',
    credit: 'Nick-D · CC BY-SA 4.0',
    source: 'https://commons.wikimedia.org/wiki/File:Trams_at_the_Alinga_Street_light_rail_stop_on_a_foggy_morning_July_2025.jpg',
  },
  {
    id: 'sailboat',
    group: 'exposure',
    name: '海边帆船',
    issue: '整体偏亮发白、反差低',
    file: '/samples/sailboat.jpg',
    thumb: '/samples/thumb/sailboat.jpg',
    credit: '(SAMSUNG ST70) · CC BY-SA 3.0',
    source: 'https://commons.wikimedia.org/wiki/File:Sail_Boat_on_Horizon_Eagle_Beach_Aruba.jpg',
  },

  // ---------------- 灰雾 ----------------
  {
    id: 'winter-field',
    group: 'haze',
    name: '冬日旷野',
    issue: '雪天发灰、有雾',
    file: '/samples/winter-field.jpg',
    thumb: '/samples/thumb/winter-field.jpg',
    credit: 'Lukas Beck · CC BY 4.0',
    source: 'https://commons.wikimedia.org/wiki/File:Landschaftsschutzgebiet_Südwest-Rügen-Zudar_lub_2026-02-07_img03.jpg',
  },
  {
    id: 'overcast-lake',
    group: 'haze',
    name: '阴天湖山',
    issue: '阴天灰调、色彩偏淡',
    file: '/samples/overcast-lake.jpg',
    thumb: '/samples/thumb/overcast-lake.jpg',
    credit: 'HilACT · CC BY-SA 4.0',
    source: 'https://commons.wikimedia.org/wiki/File:Cradle_Mountain_National_Park_Overcast_Day.jpg',
  },
  {
    id: 'overcast-beach',
    group: 'haze',
    name: '阴天海滩',
    issue: '黑场浮起、整体发灰',
    file: '/samples/overcast-beach.jpg',
    thumb: '/samples/thumb/overcast-beach.jpg',
    credit: 'NPS · Public domain',
    source:
      'https://commons.wikimedia.org/wiki/File:Kayaks_at_Mosquito_Beach_on_an_Overcast_Day_(46c5e2ab-6da8-41b4-84e3-b0c13818b39f).JPG',
  },

  // ---------------- 构图 ----------------
  {
    id: 'park-bench',
    group: 'crop',
    name: '公园长椅',
    issue: '主体太小、大片空地',
    file: '/samples/park-bench.jpg',
    thumb: '/samples/thumb/park-bench.jpg',
    credit: 'Thank you for visiting my page · CC BY 2.0',
    source: 'https://commons.wikimedia.org/wiki/File:Picnic_in_the_park._(15132797376).jpg',
  },
  {
    id: 'playground',
    group: 'crop',
    name: '土操场',
    issue: '主体太小、画面杂乱',
    file: '/samples/playground.jpg',
    thumb: '/samples/thumb/playground.jpg',
    credit: 'CC0',
    source: 'https://commons.wikimedia.org/wiki/File:Playground.JPG',
  },
]
