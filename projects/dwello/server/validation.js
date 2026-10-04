export class AppError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const invalid = (message) => { throw new AppError(400, 'INVALID_INPUT', message); };
export function integer(value, label, max = 50_000_000) {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) invalid(`${label} must be a positive whole number.`);
  return value;
}
export function text(value, label, min, max) {
  if (typeof value !== 'string') invalid(`${label} is required.`);
  const result = value.trim();
  if (result.length < min || result.length > max || /[\u0000-\u001f\u007f]/.test(result)) {
    invalid(`${label} must have ${min}–${max} ordinary characters.`);
  }
  return result;
}
export function date(value, label = 'Date') {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) invalid(`${label} must use YYYY-MM-DD.`);
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value || value < '1900-01-01' || value > '2200-12-31') {
    invalid(`${label} must be a real date between 1900 and 2200.`);
  }
  return value;
}
export function month(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}$/.test(value)) invalid('Month must use YYYY-MM.');
  date(`${value}-01`, 'Month');
  return value;
}

// trace: validate-lease
export function validateLease(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalid('Send a lease object.');
  const email = text(body.email, 'Email', 3, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) invalid('Enter a valid email address.');
  const startDate = date(body.startDate, 'Start date');
  const endDate = date(body.endDate, 'End date');
  if (endDate < startDate) invalid('End date must be on or after the start date.');
  const followingDay = new Date(`${endDate}T00:00:00Z`);
  followingDay.setUTCDate(followingDay.getUTCDate() + 1);
  if (!startDate.endsWith('-01') || followingDay.getUTCDate() !== 1) {
    invalid('This ledger uses whole-month leases: start on the first day and end on the last day of a month.');
  }
  return {
    unitId: integer(body.unitId, 'Unit ID', 2_147_483_647),
    name: text(body.name, 'Name', 2, 100), email, startDate, endDate,
    monthlyRentCents: integer(body.monthlyRentCents, 'Rent in cents'),
  };
}

// trace: validate-payment
export function validatePayment(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalid('Send a payment object.');
  if (!['bank', 'cash', 'check'].includes(body.method)) invalid('Choose bank, cash, or check.');
  return {
    leaseId: integer(body.leaseId, 'Lease ID', 2_147_483_647),
    month: month(body.month), amountCents: integer(body.amountCents, 'Payment in cents'),
    paidOn: date(body.paidOn, 'Payment date'), method: body.method,
    note: text(body.note ?? '', 'Note', 0, 240),
  };
}
