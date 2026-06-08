/** 招标文件结构化数据类型 */

/** 项目基本信息 */
export interface ProjectInfo {
  projectName: string;        // 项目名称
  projectCode: string;        // 项目编号
  purchaser: string;          // 采购单位
  agency: string;             // 代理机构
  deadline: string;           // 投标截止时间
  openTime: string;           // 开标时间
  openLocation: string;       // 开标地点
  budget: string;             // 预算金额
}

/** ★号废标条款 */
export interface StarClause {
  id: string;                 // 编号
  content: string;            // 条款内容
  category: string;           // 分类（资格条件/技术要求/商务要求等）
  sourcePage: number;         // 原始页码
}

/** 技术参数 */
export interface TechParam {
  id: string;
  name: string;               // 参数名称
  requirement: string;        // 要求值
  unit: string;               // 单位
  isRequired: boolean;        // 是否为★强制要求
  sourcePage: number;
}

/** 评分标准 */
export interface ScoreRule {
  category: string;           // 评分维度（技术/商务/报价）
  item: string;               // 评分项
  maxScore: number;           // 最高分
  criteria: string;           // 评分细则
}

/** 格式要求 */
export interface FormatRequirement {
  item: string;
  requirement: string;
}

/** 附件清单 */
export interface AttachmentItem {
  id: string;
  name: string;
  isRequired: boolean;
}

/** 资格条件 */
export interface Qualification {
  id: string;
  content: string;
  isRequired: boolean;
}

/** 商务条款 */
export interface CommercialTerm {
  item: string;
  requirement: string;
}

/** 投标文件组成 */
export interface DocumentComposition {
  order: number;
  partName: string;
  description: string;
}

/** 招标文件拆解结果（完整结构化数据） */
export interface BidInfo {
  projectInfo: ProjectInfo;
  starClauses: StarClause[];
  techParams: TechParam[];
  scoreRules: ScoreRule[];
  formatRequirements: FormatRequirement[];
  attachments: AttachmentItem[];
  qualifications: Qualification[];
  commercialTerms: CommercialTerm[];
  documentComposition: DocumentComposition[];
  rawText: string;            // 原始全文（供 AI 参考）
}

/** 章节生成规格 */
export interface ChapterSpec {
  id: string;                 // 章节ID (G-01 ~ G-11)
  name: string;               // 章节名称
  track: 'template' | 'ai';  // 生成轨道
  templateFile?: string;      // 模板文件名（轨道A）
  maxRounds?: number;         // 最大迭代轮次（轨道B）
}

// ============ 需求拆解 + 响应规划 ============

/** 单条需求 */
export interface Requirement {
  id: string;                 // "R-001"
  category: 'starClause' | 'techParam' | 'commercialTerm' | 'document' | 'format' | 'qualification';
  content: string;            // 需求原文
  priority: 'critical' | 'high' | 'medium' | 'low';
  sourceRef: string;          // 来源引用
  isStar: boolean;            // 是否★条款
}

/** 需求清单 */
export interface RequirementsList {
  pdfId: string;
  extractedAt: string;
  totalCount: number;
  categories: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  requirements: Requirement[];
}

/** 响应计划中的单个章节 */
export interface PlanSection {
  id: string;                 // "S-01"
  sectionName: string;        // 章节名称
  source: 'template' | 'create'; // 模板已有 / 需新建
  templateNodeId?: string;    // 模板中的 block nodeId
  status: 'ready' | 'needs_content' | 'needs_section' | 'skipped';
  requirements: string[];     // 关联的 Requirement ID 列表
  notes: string;              // AI 填写指导
}

/** 响应计划 */
export interface ResponsePlan {
  pdfId: string;
  sessionId: string;
  createdAt: string;
  templateFile: string;
  summary: {
    totalRequirements: number;
    mappedToTemplate: number;
    needsNewSection: number;
    skipped: number;
  };
  sections: PlanSection[];
  unmappedRequirements: string[];
}
