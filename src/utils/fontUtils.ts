/** 字体加载工具 */

/** 项目所需的中文字体列表 */
export const REQUIRED_FONTS = [
  { name: 'SimHei', file: 'SimHei.ttf', label: '黑体' },
  { name: 'FangSong_GB2312', file: 'FangSong_GB2312.ttf', label: '仿宋GB2312' },
  { name: 'SimSun', file: 'SimSun.ttf', label: '宋体' },
  { name: 'KaiTi', file: 'KaiTi.ttf', label: '楷体' },
] as const;

/** 字体加载状态 */
const fontLoadStatus = new Map<string, boolean>();

/**
 * 加载单个字体文件
 * @param name 字体名称
 * @param file 文件路径（相对于 public/fonts/）
 */
async function loadFont(name: string, file: string): Promise<boolean> {
  if (fontLoadStatus.get(name)) return true;

  try {
    const fontFace = new FontFace(name, `url(/fonts/${file})`);
    await fontFace.load();
    document.fonts.add(fontFace);
    fontLoadStatus.set(name, true);
    console.log(`[字体] 已加载: ${name}`);
    return true;
  } catch (err) {
    console.warn(`[字体] 加载失败: ${name} (${file})`, err);
    fontLoadStatus.set(name, false);
    return false;
  }
}

/**
 * 加载所有必需字体
 * @returns 加载结果，包含成功和失败的字体
 */
export async function loadAllFonts(): Promise<{ loaded: string[]; failed: string[] }> {
  const loaded: string[] = [];
  const failed: string[] = [];

  const results = await Promise.allSettled(
    REQUIRED_FONTS.map((f) => loadFont(f.name, f.file))
  );

  results.forEach((result, i) => {
    if (result.status === 'fulfilled' && result.value) {
      loaded.push(REQUIRED_FONTS[i].label);
    } else {
      failed.push(REQUIRED_FONTS[i].label);
    }
  });

  return { loaded, failed };
}

/**
 * 检查某个字体是否已加载
 */
export function isFontLoaded(name: string): boolean {
  return fontLoadStatus.get(name) ?? false;
}
