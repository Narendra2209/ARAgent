// AUTO-TRANSCRIBED from the operations team's branch split workbook
// (Metfold_AR_BranchSplit_2026-07-27.xlsx). See branchService.js for why this
// lives in code: MYOB's AR feed carries no branch on any document, so the
// customer->branch assignment cannot be derived from live data and has to come
// from this list. Everything else on the Branch page IS live.
//
// To re-point a customer, move its code to another branch's array below.

/** Branch tab order, matching the workbook's sheet order. */
export const BRANCH_ORDER = ["Sunbury","Melton","Pakenham","Cash Sale"];

/** Customer codes belonging to each branch. */
const BRANCH_CUSTOMERS = {
  "Sunbury": [
    'C0004', 'C0006', 'C0007', 'C0014', 'C0023', 'C0056',
    'C0058', 'C0066', 'C0078', 'C0080', 'C0084', 'C0085',
    'C0086', 'C0089', 'C0096', 'C0100', 'C0102', 'C0110',
    'C0120', 'C0121', 'C0126', 'C0129', 'C0132', 'C0133',
    'C0134', 'C0135M', 'C0139', 'C0140', 'C0146M', 'C0153',
    'C0161', 'C0163', 'C0168', 'C0171', 'C0174', 'C0180',
    'C0185', 'C0190', 'C0208', 'C0210', 'C0214', 'C0215',
    'C0216', 'C0217', 'C0221', 'C0222', 'C0227', 'C0228',
    'C0235', 'C0242', 'C0243', 'C0244', 'C0252', 'C0269',
    'C0275', 'C0281', 'C0283', 'C0287', 'C0288', 'C0291',
    'C0293', 'C0297', 'C0300', 'C0302', 'C0303', 'C0305',
    'C0310', 'C0314', 'C0316', 'C0317', 'C0318', 'C0320',
    'C0325', 'C0328', 'C0333', 'C0335', 'C0337', 'C0340',
    'C0342', 'C0343', 'C0344', 'C0346', 'C0351', 'C0352',
    'C0353', 'C0355', 'C0358', 'C0359', 'C0364', 'C0366',
    'C0369', 'C0370', 'C0371', 'C0372', 'C0377', 'C0379',
    'C0383', 'C0384', 'C0385', 'C0386', 'C0388', 'C0391',
  ],
  "Melton": [
    'C0008', 'C0009', 'C0015', 'C0021', 'C0027', 'C0028',
    'C0035', 'C0037', 'C0041', 'C0042', 'C0045', 'C0048',
    'C0050', 'C0051', 'C0055', 'C0090', 'C0099', 'C0116',
    'C0126M', 'C0129M', 'C0137', 'C0138M', 'C0139M', 'C0140M',
    'C0144M', 'C0145', 'C0148', 'C0156M', 'C0165', 'C0177',
    'C0178', 'C0182', 'C0183', 'C0195', 'C0201', 'C0212',
    'C0234', 'C0238', 'C0248', 'C0261', 'C0271', 'C0279',
    'C0298', 'C0306', 'C0327', 'C0339', 'C0378', 'C0382',
  ],
  "Pakenham": [
    'C0081', 'C0150', 'C0155', 'C0206', 'C0223', 'C0226',
    'C0230', 'C0236', 'C0256', 'C0274', 'C0276', 'C0277',
    'C0282', 'C0294', 'C0308', 'C0315', 'C0323', 'C0324',
    'C0329', 'C0332', 'C0336', 'C0349', 'C0356', 'C0357',
    'C0361', 'C0365', 'C0367', 'C0375', 'C0380',
  ],
  "Cash Sale": [
    'C0016',
  ],
};

// Flattened code -> branch lookup, built once at import.
const BY_CUSTOMER = new Map();
for (const [branch, codes] of Object.entries(BRANCH_CUSTOMERS)) {
  for (const code of codes) BY_CUSTOMER.set(code, branch);
}

/**
 * Branch for a customer code, or null when the code isn't in the workbook.
 * MYOB pads customer ids with trailing spaces ("C0195     "), so trim first.
 */
export function branchForCustomer(customerId) {
  return BY_CUSTOMER.get(String(customerId ?? '').trim()) ?? null;
}

/** Total customers assigned a branch — used by the route's coverage warning. */
export const MAPPED_CUSTOMER_COUNT = BY_CUSTOMER.size;
