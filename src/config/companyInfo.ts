/** 公司信息配置 */

import type { CompanyInfo } from '@/types/company';

/** 默认公司信息模板 */
const DEFAULT_COMPANY_INFO: CompanyInfo = {
  basic: {
    companyNameFull: 'XXX科技有限公司',
    companyNameShort: 'XXX科技',
    creditCode: '91XXXXXXXXXXXXXXXX',
    legalPerson: '张三',
    registeredAddress: 'XX省XX市XX区XX路XX号',
    contactPerson: '李四',
    phone: '010-XXXXXXXX',
    fax: '010-XXXXXXXX',
    email: 'contact@example.com',
    bankName: 'XX银行XX支行',
    bankAccount: 'XXXXXXXXXXXXXXXX',
  },
  certificates: [],
  performance: [],
  products: [],
  personnel: [],
};

/** 获取公司信息 */
export function getCompanyInfo(): CompanyInfo {
  const stored = localStorage.getItem('ai_bid_company_info');
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch {
      // 忽略
    }
  }
  return DEFAULT_COMPANY_INFO;
}

/** 保存公司信息 */
export function saveCompanyInfo(info: CompanyInfo): void {
  localStorage.setItem('ai_bid_company_info', JSON.stringify(info));
}
