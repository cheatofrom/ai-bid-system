/** 格式铁则 — 系统硬性标准 */

/** 字号映射（磅值） */
export const FONT_SIZE = {
  /** 三号 = 16pt */
  SAN_HAO: 16,
  /** 小三 = 15pt */
  XIAO_SAN: 15,
  /** 四号 = 14pt */
  SI_HAO: 14,
  /** 小四 = 12pt */
  XIAO_SI: 12,
  /** 五号 = 10.5pt */
  WU_HAO: 10.5,
} as const;

/** 字体映射 */
export const FONT_FAMILY = {
  /** 黑体 */
  HEI_TI: 'SimHei',
  /** 仿宋GB2312 */
  FANG_SONG: 'FangSong_GB2312',
  /** 宋体 */
  SONG_TI: 'SimSun',
  /** 楷体 */
  KAI_TI: 'KaiTi',
} as const;

/** 格式铁则配置 */
export const FORMAT_RULES = {
  /** 一级标题：三号黑体，加粗，居中 */
  heading1: {
    fontFamily: FONT_FAMILY.HEI_TI,
    fontSize: FONT_SIZE.SAN_HAO,
    bold: true,
    alignment: 'center' as const,
    spacing: { before: 12, after: 6, line: 1.5 },
  },
  /** 二级标题：小三黑体，左对齐 */
  heading2: {
    fontFamily: FONT_FAMILY.HEI_TI,
    fontSize: FONT_SIZE.XIAO_SAN,
    bold: false,
    alignment: 'left' as const,
    spacing: { before: 12, after: 6, line: 1.5 },
  },
  /** 三级标题：四号黑体，加粗 */
  heading3: {
    fontFamily: FONT_FAMILY.HEI_TI,
    fontSize: FONT_SIZE.SI_HAO,
    bold: true,
    alignment: 'left' as const,
    spacing: { before: 6, after: 3, line: 1.5 },
  },
  /** 正文：小四仿宋GB2312 */
  body: {
    fontFamily: FONT_FAMILY.FANG_SONG,
    fontSize: FONT_SIZE.XIAO_SI,
    bold: false,
    alignment: 'justify' as const,
    spacing: { before: 0, after: 3, line: 1.5 },
    firstLineIndent: 2, // 首行缩进2字符
  },
  /** 页面设置 */
  page: {
    width: 21.0,   // A4 宽度 cm
    height: 29.7,  // A4 高度 cm
    marginTop: 2.54,
    marginBottom: 2.54,
    marginLeft: 3.17,
    marginRight: 3.17,
  },
  /** 红色标记（★条款、签章） */
  highlight: {
    starClauseColor: 'FF0000',      // 红色
    signatureColor: 'FF0000',       // 红色
    placeholderColor: 'FF8C00',     // 橙色（待人工补充）
    placeholderBg: 'FFFF00',        // 黄色背景
  },
} as const;

/** 格式规则类型 */
export type FormatRuleKey = keyof typeof FORMAT_RULES;
