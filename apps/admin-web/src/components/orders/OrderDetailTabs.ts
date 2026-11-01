/**
 * Tab bodies for the admin order detail page.
 *
 * Split by tab (one file per operational question) and re-exported here so the
 * page keeps importing from one stable path.
 */

export { OrderOverviewTab } from "./detail-tabs/OrderOverviewTab";
export { OrderItemsTab } from "./detail-tabs/OrderItemsTab";
export { OrderPaymentTab, summarizePayments, type PaymentSummary } from "./detail-tabs/OrderPaymentTab";
export { OrderShippingTab } from "./detail-tabs/OrderShippingTab";
export { OrderFinanceTab } from "./detail-tabs/OrderFinanceTab";
export { PaymentBadge } from "./detail-tabs/PaymentBadge";
