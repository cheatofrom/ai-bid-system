/** 文档生成相关类型 */

/** 占位符定义 */
export interface Placeholder {
  key: string;                // 占位符名称，如 "项目名称"
  source: 'bid' | 'company' | 'system' | 'manual';  // 数据来源
  bidField?: string;          // 对应 BidInfo 的字段路径
  companyField?: string;      // 对应 CompanyInfo 的字段路径
  fallback: string;           // 无法填充时的默认值
}

/** 模板规格 */
export interface TemplateSpec {
  id: string;
  name: string;
  fileName: string;           // 模板文件名
  placeholders: Placeholder[];
}

/** 生成结果 */
export interface GenerateResult {
  success: boolean;
  chapterId: string;
  track: 'template' | 'ai';
  rounds: number;             // AI 章节迭代轮次
  issues: CheckIssue[];       // 遗留问题
  duration: number;           // 耗时(ms)
}

/** 自查问题 */
export interface CheckIssue {
  type: 'star_clause' | 'format' | 'completeness' | 'accuracy' | 'placeholder';
  location: string;           // 问题位置描述
  description: string;        // 问题描述
  severity: 'error' | 'warning' | 'info';
}

/** 合规检查报告 */
export interface ComplianceReport {
  passed: ComplianceItem[];
  failed: ComplianceItem[];
  warnings: ComplianceItem[];
  summary: {
    total: number;
    passedCount: number;
    failedCount: number;
    warningCount: number;
    placeholderCount: number;  // 【待人工补充】数量
  };
}

/** 合规检查项 */
export interface ComplianceItem {
  id: string;
  name: string;
  description: string;
  location?: string;
}

/** 文档生成进度 */
export interface GenerateProgress {
  phase: 'template' | 'ai' | 'check' | 'done';
  currentChapter: string;
  totalChapters: number;
  completedChapters: number;
  currentRound: number;
  maxRounds: number;
  message: string;
}
