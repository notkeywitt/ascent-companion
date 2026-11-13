/**
 * JobTread Pave API client — the verified calls behind the assistant tool.
 *
 * Every query/mutation here was confirmed live against the Pave API in July 2026
 * (see ascent-appscript/CLAUDE.md "Assistant-tool findings" and the `_invp*`
 * probes in Diagnostics.js). Field names marked TODO are NOT yet verified — do
 * not ship them until confirmed (probe-first rule).
 *
 * The grant key stays server-side. Import this only from server code / route
 * handlers, never from the browser.
 */

// The client is split into one file per section under ./jobtread/. Callers
// keep importing from here; this file re-exports exactly the names it always
// exported.

export {
  pave,
  clearJtRefCache,
  clearJobCostCaches,
  PaveTooManyPagesError,
  pageEach,
  pageAll,
} from "./jobtread/core";
export type {
  PaveConfig,
  PageWalk,
} from "./jobtread/core";
export {
  getDraftBills,
  getAllDraftBills,
  getBillDetail,
  getBillJournalSnapshot,
  setBillFields,
  getBillFiles,
  getJobFiles,
  getJobPlans,
  getFileById,
  setBillIssueDate,
  setBillDueDate,
  setBillExternalId,
  setBillTax,
  setBillStatus,
  getDraftVendorBillCount,
  budgetCodeMaps,
  getJobBudget,
  getTimeTrackableLeaves,
  timeTrackableLeaves,
  resolveTimeTrackableLeaf,
  pickTimeLeaf,
  getSalesTaxLeafId,
  getSalesTaxByDoc,
  getWarrantyByDoc,
  getCostToComplete,
} from "./jobtread/codingQueue";
export type {
  DraftBill,
  BillLine,
  BillDetail,
  BillFile,
  JobFile,
  JobPlan,
  BudgetItem,
  TimeLeafResolution,
  CostToComplete,
} from "./jobtread/codingQueue";
export {
  getUntaxedLines,
  isDivisionLevelCode,
  getJobCostDetail,
  getJobCostContributors,
  getJobBillsForMonth,
  getJobTimeEntriesForMonth,
  getOrgTimeEntriesForMonth,
  getBillLinesForJob,
  getJobs,
  getUserJobIds,
  getJobPhaseMap,
} from "./jobtread/jobCostDetail";
export type {
  CostLine,
  CostTypeSplit,
  CostCodeRow,
  CostDivisionRow,
  BudgetBasis,
  JobCostDetail,
  CostCodeBillContributor,
  CostCodeTimeContributor,
  JobCostContributors,
  MonthBill,
  MonthTimeEntry,
  OrgMonthTimeEntry,
  JobBillLine,
  JobRef,
} from "./jobtread/jobCostDetail";
export {
  getJobBoard,
  getJobGantt,
  getLatestJobForUser,
  getVendors,
  getVendorAddresses,
  getVendorEmails,
  getVendorCoiFields,
  getVendorBills,
  getVendorDetail,
  findContacts,
  getJobVendors,
  getJobSpecifications,
  getRecentVendorBills,
  getBillsByNumber,
  getOrgUsers,
  getOrgTimeEntryTypeNames,
  getMembershipRates,
  updateMembershipRates,
  updateLine,
  createLine,
  getLineJournalSnapshot,
  deleteLine,
  combineLines,
} from "./jobtread/homeJobBoard";
export type {
  VendorRef,
  VendorEmailRow,
  VendorCoiFields,
  VendorBillRow,
  VendorContact,
  VendorDetail,
  ContactMatch,
  RecentVendorBill,
  VendorBillMatch,
  PayType,
  UserRef,
} from "./jobtread/homeJobBoard";
export {
  getMonthlyBills,
} from "./jobtread/invoiceStaging";
export type {
  StageLine,
  MonthlyStaging,
  CsiAmount,
  UninvoicedBillRef,
  UninvoicedTimeEntryRef,
  UninvoicedBillLine,
  UninvoicedBills,
  InvoicePreviewMeta,
} from "./jobtread/invoiceStaging";
export {
  CF_COST_CODES,
  qboDocumentTypeFor,
  QBO_EXPENSE_ACCOUNT_ID,
  QBO_SUNSET_EXPENSE_ACCOUNT_ID,
  isSunsetVendor,
  expenseAccountFor,
  sunsetDocName,
  splitSunsetLines,
  sunsetCreditExternalId,
  createSunsetCredit,
  sunsetSwitchBlocker,
  getDraftSunsetBills,
  isExpenseDoc,
  createVendorBill,
  replaceBillLines,
  findNewJobBillByExternalId,
  getLastAmazonBillMonth,
  findBillByExternalId,
  findExistingExternalIds,
  getJobHeaderInfo,
  resolveShopJobId,
  BUYBACK_CSI,
} from "./jobtread/billIngestion";
export type {
  NewBillLine,
  CreateVendorBillArgs,
  BillType,
  SunsetDocName,
  SunsetSwitchTarget,
  DraftSunsetBill,
  BuybackLineArgs,
} from "./jobtread/billIngestion";
export {
  SUNSET_STATEMENT_CSI,
  SUNSET_STATEMENT_COST_TYPE,
  isSunsetStatementBill,
  resolveSunsetStatementLeaf,
  getSunsetStatementBills,
  getSunsetStatementBillStates,
  isVendorInvoiceNumber,
  legacyBuybackExternalId,
  buybackExternalIdFor,
  buybackLine,
  attachFileToDocument,
  deleteDocumentFile,
  getUninvoicedBills,
  getMonthlyInvoiceJobs,
  getOpenCustomerInvoices,
  getJobClientDocuments,
  getMonthlyInvoiceTime,
  getAllBillsForMonth,
  getInvoiceReconciliation,
} from "./jobtread/sunsetStatements";
export type {
  SunsetStatementBillState,
  MonthlyInvoiceJob,
  OpenInvoiceRow,
  ClientDocRow,
  AllJobsBill,
  InvoiceRef,
  InvoiceReconciliation,
} from "./jobtread/sunsetStatements";
export {
  JT_ORG_TZ,
  orgLocalToJtIso,
  jtIsoToOrgLocal,
  getJobTimeLines,
  createTimeEntry,
  getTimeEntryJournalSnapshot,
  updateTimeEntry,
  deleteTimeEntry,
  getTimeEntryOwner,
  getTimeEntrySpan,
  getUserTimeEntries,
  getOpenTimeEntries,
  getOrgTimeEntries,
  getTimeEntriesForExport,
} from "./jobtread/timeEntries";
export type {
  JobTimeLine,
  CreateTimeEntryArgs,
  TimeEntrySpan,
  UserTimeEntry,
  OpenTimeEntry,
  OrgTimeEntry,
  ExportTimeEntry,
} from "./jobtread/timeEntries";
export {
  getMembersByEmail,
  findMemberByEmail,
  getOpenToDos,
  getOpenToDosCached,
  getRecentJobToDos,
  getScheduledTasks,
  getJobSchedule,
  getJobNotes,
  getBoughtLines,
  getJobScopeLines,
  createToDo,
  OFFICE_JOB_ID,
  getToDoJobId,
  updateToDo,
  deleteToDo,
  getUpcomingScheduleTasks,
} from "./jobtread/tasks";
export type {
  OpenToDo,
  MemberRef,
  JobScheduleItem,
  JobNote,
  BoughtLine,
  ScopeLine,
  NewToDo,
  ToDoPatch,
  ScheduleTask,
} from "./jobtread/tasks";
export {
  getJobAccessFor,
  grantJobAccess,
} from "./jobtread/jobAccess";
export type {
  JobAccessRow,
} from "./jobtread/jobAccess";
export {
  getJobCustomerContacts,
  getMonthBillAccess,
  grantDocumentAccess,
  getDocumentAccess,
} from "./jobtread/documentAccess";
export type {
  CustomerContact,
  DocAccessRow,
} from "./jobtread/documentAccess";
export {
  getJobDepositInputs,
} from "./jobtread/jobDeposits";
export type {
  ClientPaymentRow,
  JobDepositRead,
} from "./jobtread/jobDeposits";
export {
  getInvoiceForDraw,
  resolveDepositLeaf,
  writeDepositDraw,
} from "./jobtread/depositDraws";
export type {
  DepositDrawTarget,
  DepositDrawResult,
} from "./jobtread/depositDraws";
export {
  getInvoiceRefs,
  getInvoiceStatuses,
} from "./jobtread/clientInvoiceRefs";
export type {
  PackageInvoice,
} from "./jobtread/clientInvoiceRefs";
export {
  uploadFileToJobFolder,
  getJobFilesById,
  getInvoicesForPayment,
  recordInvoicePayments,
} from "./jobtread/depositChecks";
export type {
  RecordedPayment,
} from "./jobtread/depositChecks";
export { getLswddStatementBills } from "./jobtread/lswddBills";
export type { LswddBill, LswddStatementBills } from "./jobtread/lswddBills";
