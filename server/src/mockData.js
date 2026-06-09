/**
 * Sample open AR documents used when USE_MOCK_DATA=true.
 * Each row mirrors what we extract from a MYOB open AR invoice:
 * { customerId, customerName, docType, refNbr, date, dueDate, balance }
 * Due dates are expressed as "days before the as-of date" so the demo
 * always shows a realistic spread across aging buckets.
 */
const OFFSETS = [
  { customerId: 'ABCHARDWARE', customerName: 'ABC Hardware Pty Ltd', refNbr: 'INV001045', dueOffset: -5, balance: 1240.5 },
  { customerId: 'ABCHARDWARE', customerName: 'ABC Hardware Pty Ltd', refNbr: 'INV001062', dueOffset: 12, balance: 880.0 },
  { customerId: 'COASTALCAFE', customerName: 'Coastal Cafe', refNbr: 'INV001050', dueOffset: 22, balance: 410.25 },
  { customerId: 'COASTALCAFE', customerName: 'Coastal Cafe', refNbr: 'INV001071', dueOffset: 48, balance: 1560.0 },
  { customerId: 'DELTAENG', customerName: 'Delta Engineering', refNbr: 'INV000998', dueOffset: 67, balance: 3200.0 },
  { customerId: 'DELTAENG', customerName: 'Delta Engineering', refNbr: 'INV001011', dueOffset: 95, balance: 750.0 },
  { customerId: 'EVERGREEN', customerName: 'Evergreen Landscaping', refNbr: 'INV001080', dueOffset: -18, balance: 620.0 },
  { customerId: 'FUSIONIT', customerName: 'Fusion IT Services', refNbr: 'INV000955', dueOffset: 120, balance: 4400.0 },
  { customerId: 'FUSIONIT', customerName: 'Fusion IT Services', refNbr: 'INV001005', dueOffset: 35, balance: 1180.75 },
  { customerId: 'GREENGROCER', customerName: 'Green Grocer Co', refNbr: 'INV001088', dueOffset: 3, balance: 295.4 },
  { customerId: 'HARBOURLOG', customerName: 'Harbour Logistics', refNbr: 'INV000970', dueOffset: 78, balance: 5300.0 },
  { customerId: 'HARBOURLOG', customerName: 'Harbour Logistics', refNbr: 'INV001029', dueOffset: 28, balance: 990.0 },
];

const ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;

/** Which branch each mock customer trades through (drives branch filtering demo). */
const BRANCH_BY_CUSTOMER = {
  ABCHARDWARE: 'Sunbury',
  COASTALCAFE: 'Melton',
  DELTAENG: 'Pakenham',
  EVERGREEN: 'Moama',
  FUSIONIT: 'Sunbury',
  GREENGROCER: 'Melton',
  HARBOURLOG: 'Pakenham',
};

/**
 * Sample customer profiles used when USE_MOCK_DATA=true.
 * Mirrors what we extract from the MYOB Customer entity:
 * { customerId, customerName, creditLimit, email }
 * A couple have no email so the default-email fallback is visible in the demo.
 */
const CUSTOMERS = [
  { customerId: 'ABCHARDWARE', customerName: 'ABC Hardware Pty Ltd', creditLimit: 10000, email: 'accounts@abchardware.com.au' },
  { customerId: 'COASTALCAFE', customerName: 'Coastal Cafe', creditLimit: 5000, email: 'hello@coastalcafe.com.au' },
  { customerId: 'DELTAENG', customerName: 'Delta Engineering', creditLimit: 25000, email: '' },
  { customerId: 'EVERGREEN', customerName: 'Evergreen Landscaping', creditLimit: 7500, email: 'office@evergreen.com.au' },
  { customerId: 'FUSIONIT', customerName: 'Fusion IT Services', creditLimit: 30000, email: 'billing@fusionit.com.au' },
  { customerId: 'GREENGROCER', customerName: 'Green Grocer Co', creditLimit: 4000, email: '' },
  { customerId: 'HARBOURLOG', customerName: 'Harbour Logistics', creditLimit: 50000, email: 'ap@harbourlogistics.com.au' },
];

export function mockCustomers() {
  return CUSTOMERS.map((c) => ({ ...c }));
}

export function mockOpenDocuments(asOf) {
  const base = asOf instanceof Date ? asOf : new Date(asOf);
  return OFFSETS.map((o) => {
    const due = new Date(base);
    due.setDate(due.getDate() - o.dueOffset);
    const date = new Date(due);
    date.setDate(date.getDate() - 30);
    return {
      customerId: o.customerId,
      customerName: o.customerName,
      docType: 'Invoice',
      refNbr: o.refNbr,
      branch: BRANCH_BY_CUSTOMER[o.customerId] || '',
      date: ymd(date),
      dueDate: ymd(due),
      balance: o.balance,
    };
  });
}
