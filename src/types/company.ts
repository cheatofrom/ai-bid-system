/** 公司信息相关类型 */

/** 公司基本信息 */
export interface CompanyBasic {
  companyNameFull: string;    // 公司全称
  companyNameShort: string;   // 简称
  creditCode: string;         // 统一社会信用代码
  legalPerson: string;        // 法定代表人
  registeredAddress: string;  // 注册地址
  contactPerson: string;      // 联系人
  phone: string;              // 电话
  fax: string;                // 传真
  email: string;              // 邮箱
  bankName: string;           // 开户银行
  bankAccount: string;        // 银行账号
}

/** 资质证书 */
export interface Certificate {
  name: string;               // 证书名称
  number: string;             // 证书编号
  issueDate: string;          // 签发日期
  expireDate: string;         // 到期日期
  file: string;               // 文件路径
}

/** 业绩案例 */
export interface Performance {
  projectName: string;
  client: string;
  amount: number;
  date: string;
  content: string;
}

/** 产品参数 */
export interface Product {
  name: string;
  model: string;
  parameters: Record<string, string>;
}

/** 人员信息 */
export interface Personnel {
  name: string;
  role: string;
  qualification: string;
  certNumber: string;
}

/** 公司完整信息 */
export interface CompanyInfo {
  basic: CompanyBasic;
  certificates: Certificate[];
  performance: Performance[];
  products: Product[];
  personnel: Personnel[];
}
